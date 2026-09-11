import { PassThrough } from 'node:stream';
import { CommanderError, type Command } from 'commander';
import type { Execute } from '../cli.js';
import { createExecute } from '../lib/execute.js';
import type { InvocationForm } from '../lib/invocation.js';
import { attemptedVerb, COMMANDER_NON_ERRORS, frameChannel, readFrames, SERVE_READ_VERBS, type FrameChannel, type FrameStreams, type RequestFrame, type ResultOutcome } from '../lib/frames.js';

export interface ServeOptions extends FrameStreams {
  frames: boolean;
  version: string | null;
  buildProgram(execute: Execute): Command;
  form?: InvocationForm;
}

/** Stdio only, owned by the desktop child; no listener, daemon, or shared writer state. */
export async function run(options: ServeOptions): Promise<0 | 1 | 143> {
  const { input, output } = options;
  const diagnostic = options.diagnostic ?? (() => undefined);
  const greetingInput = new PassThrough();
  const greeting = frameChannel({ input: greetingInput, output });
  if (!options.frames) {
    greeting.result({ verb: 'serve', ok: false, error: 'serve requires --frames', exitCode: 1 });
    return 1;
  }
  greeting.hello(options.version);
  greetingInput.destroy();
  const originalCwd = process.cwd();
  const queue: RequestFrame[] = [];
  const ids = new Set<string>();
  let active: { request: RequestFrame; input: PassThrough; channel: FrameChannel; report(outcome: ResultOutcome): void } | undefined;
  let running = false;
  let ended = false;
  let cancelled = false;
  let finish!: (code: 0 | 143) => void;
  const done = new Promise<0 | 143>(resolve => { finish = resolve; });
  const close = (code: 0 | 143) => {
    stop();
    const socket = input as { pause?(): void; unref?(): void };
    socket.pause?.(); socket.unref?.();
    finish(code);
  };
  // chdir is process-global. Never start the next read until the previous invocation has
  // unwound, even after cancellation. Three warm reads cost less than another process boot.
  const pump = async () => {
    if (running || cancelled) return;
    running = true;
    while (queue.length && !cancelled) {
      const request = queue.shift()!;
      const requestInput = new PassThrough();
      const channel = frameChannel({ input: requestInput, output, requestId: request.id, diagnostic });
      const verb = attemptedVerb(request.argv);
      let reported = false;
      const report = (outcome: ResultOutcome) => {
        if (reported || cancelled) return;
        reported = true;
        channel.result(outcome);
      };
      active = { request, input: requestInput, channel, report };
      if (ended) requestInput.end();
      try {
        if (!SERVE_READ_VERBS.includes(request.argv[0] ?? '')) {
          report({ verb, ok: false, error: `serve does not run ${verb}; spawn it as its own process`, exitCode: 1 });
        } else {
          if (request.cwd !== undefined) process.chdir(request.cwd);
          const execute = createExecute({ io: channel.io, form: options.form, stderr: diagnostic, setExitCode: () => undefined, result: report });
          const program = options.buildProgram(execute);
          // Commander help and usage output must never put unframed text on session stdout.
          program.configureOutput({ writeOut: text => channel.io.print(text.trimEnd()), writeErr: diagnostic });
          await program.parseAsync(request.argv, { from: 'user' });
          report({ verb, ok: true, exitCode: 0 });
        }
      } catch (error) {
        const nonError = error instanceof CommanderError && error.exitCode === 0 && COMMANDER_NON_ERRORS.has(error.code);
        report({ verb, ok: nonError, ...(nonError ? {} : { error: error instanceof Error ? error.message : String(error) }), exitCode: nonError ? 0 : 1 });
      } finally {
        // A removed original directory is not recoverable: do not run a later request in
        // the wrong directory. The outer failure handler closes the session in that case.
        process.chdir(originalCwd);
        requestInput.destroy();
        ids.delete(request.id);
        active = undefined;
      }
    }
    running = false;
    if (ended && !cancelled) close(0);
  };
  const startPump = () => {
    void pump().catch(error => {
      // cwd restoration failure cannot safely continue the queue; fail it and close.
      diagnostic(`serve: session failed: ${error instanceof Error ? error.message : String(error)}`);
      cancelled = true;
      options.onCancel?.();
      close(143);
    });
  };
  const stop = readFrames(input, frame => {
    if (cancelled) return;
    if (frame.t === 'request') {
      if (ids.has(frame.id)) { diagnostic(`serve: duplicate in-flight id ${JSON.stringify(frame.id)} ignored`); return; }
      ids.add(frame.id); queue.push(frame); startPump();
    } else if (frame.t === 'answer') {
      if (!active || active.request.id !== frame.id || active.channel.closed) {
        diagnostic(`serve: answer for unknown id ${JSON.stringify(frame.id)} ignored`); return;
      }
      active.input.write(`${JSON.stringify(frame)}\n`);
    } else if ('id' in frame && frame.id !== undefined) {
      if (active?.request.id === frame.id) {
        active.input.write('{"t":"cancel"}\n');
        active.report({ verb: attemptedVerb(active.request.argv), ok: false, error: 'cancelled', cancelled: true, exitCode: 1 });
      } else {
        const index = queue.findIndex(request => request.id === frame.id);
        if (index === -1) { diagnostic(`serve: cancel for unknown id ${JSON.stringify(frame.id)} ignored`); return; }
        const request = queue.splice(index, 1)[0]!;
        const channel = frameChannel({ input: new PassThrough(), output, requestId: request.id });
        channel.result({ verb: attemptedVerb(request.argv), ok: false, error: 'cancelled', cancelled: true, exitCode: 1 });
        ids.delete(request.id);
      }
    } else {
      cancelled = true; queue.length = 0;
      active?.input.write('{"t":"cancel"}\n');
      options.onCancel?.();
      close(143);
    }
  }, line => diagnostic(`serve: ignored malformed line ${JSON.stringify(line.slice(0, 200))}`), () => {
    ended = true;
    active?.input.end();
    if (!running) close(0);
  }, true);
  return done;
}
