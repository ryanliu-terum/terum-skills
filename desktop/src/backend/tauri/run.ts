import type { Frame, Result, Run } from '../types';
import type { AppState, Bridge, LineEvent } from './bridge';
import { parseCliFrame, type CliFrame } from './frames';

export const NO_STATE = 'The desktop app could not find where terum-skills is installed. Run `terum-skills app` from a terminal once; it records the location and opens this app.';

let serial = 0;
function nextId(): string {
  serial += 1;
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `r${serial}-${random}`;
}

export interface CliRunOptions<TIn, TOut> {
  cwd?: string | undefined;
  map(value: TIn): TOut;
  onHello?(frame: Extract<CliFrame, { t: 'hello' }>): void;
  onSettled?(result: Result<TOut>): void;
}

/**
 * One CLI process as a seam `Run<T>`: spawn `terum-skills --frames <argv>`, turn its frames into the seam's
 * frames, forward answers, and settle `done` from the `result` frame. Frames are buffered so a consumer that
 * subscribes late still sees every one (same contract as the mock's createRun).
 */
export function cliRun<TIn, TOut>(bridge: Bridge, state: Promise<AppState | null>, argv: readonly string[], options: CliRunOptions<TIn, TOut>): Run<TOut> {
  const id = nextId();
  const buffer: Frame[] = [];
  const readers = new Set<() => void>();
  let finished = false;
  let started = false;
  let cancelled = false;
  let settle!: (result: Result<TOut>) => void;
  const done = new Promise<Result<TOut>>((resolve) => { settle = resolve; });
  const stderr: string[] = [];
  let unlisten: (() => void) | undefined;
  let cleanupRequested = false;
  const cleanup = () => {
    cleanupRequested = true;
    const stop = unlisten;
    unlisten = undefined;
    stop?.();
  };

  const push = (frame: Frame) => { if (finished) return; buffer.push(frame); for (const wake of readers) wake(); readers.clear(); };
  const finish = (result: Result<TOut>, frame?: Frame) => {
    if (finished) return;
    if (frame) push(frame); else push({ t: 'result', ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
    finished = true;
    for (const wake of readers) wake();
    readers.clear();
    settle(result);
    options.onSettled?.(result);
  };

  const onEvent = (event: LineEvent) => {
    if (finished && event.kind !== 'exit') {
      if (event.kind === 'stdout') stderr.push(`stdout after settle: ${event.line}`);
      return;
    }
    switch (event.kind) {
      case 'stdout': {
        const frame = parseCliFrame(event.line);
        if (!frame) { stderr.push(`unparseable line from terum-skills: ${event.line.slice(0, 200)}`); return; }
        onFrame(frame);
        return;
      }
      case 'stderr': stderr.push(event.line); return;
      case 'exit': {
        if (!finished) {
          finish({ ok: false, error: cancelled ? 'Cancelled.' : `terum-skills exited${event.code === null ? '' : ` with code ${event.code}`} before reporting a result.${stderr.length ? ` ${stderr.slice(-3).join(' ')}` : ''}` });
        }
        cleanup();
        return;
      }
      case 'error': finish({ ok: false, error: event.message }); return;
    }
  };
  const onFrame = (frame: CliFrame) => {
    switch (frame.t) {
      case 'hello': options.onHello?.(frame); return;
      case 'print': push({ t: 'print', line: frame.level === 'info' ? frame.line : `${frame.level}: ${frame.line}` }); return;
      case 'ask': push({ t: 'ask', id: frame.id, kind: frame.kind, question: frame.question, ...(frame.default === undefined ? {} : { default: frame.default }), ...(frame.choices === undefined ? {} : { choices: frame.choices }), ...(frame.detail === undefined ? {} : { detail: frame.detail }) }); return;
      case 'progress': { const current = frame.current ?? 0; push({ t: 'progress', done: current, total: Math.max(frame.total ?? current, current, 1), label: frame.step }); return; }
      case 'result': {
        if (cancelled) { finish({ ok: false, error: 'Cancelled.' }); return; }
        if (frame.ok) {
          let mapped: TOut;
          try { mapped = options.map(frame.value as TIn); } catch (error) { finish({ ok: false, error: `terum-skills answered, but the desktop app could not read the result: ${error instanceof Error ? error.message : String(error)}` }); return; }
          finish({ ok: true, value: mapped }, { t: 'result', ok: true });
        } else {
          const error = frame.error ?? 'terum-skills reported a failure.';
          let value: TOut | undefined;
          if (frame.value !== undefined) {
            try { value = options.map(frame.value as TIn); } catch { value = undefined; }
          }
          finish({ ok: false, error, ...(frame.declined === true ? { cancelled: true } : {}), ...(frame.refused === true ? { refused: true } : {}), ...(value === undefined ? {} : { value }) }, { t: 'result', ok: false, error, ...(frame.declined === true ? { declined: true } : {}), ...(frame.refused === true ? { refused: true } : {}) });
        }
        return;
      }
    }
  };

  // Deferred start so the consumer can subscribe to frames before the first one; mirrors the mock.
  void Promise.resolve().then(async () => {
    if (finished) return;
    const resolved = await state.catch((error: unknown) => { finish({ ok: false, error: error instanceof Error ? error.message : String(error) }); return null; });
    if (finished) return;
    if (!resolved) { finish({ ok: false, error: NO_STATE }); return; }
    started = true;
    try {
      unlisten = await bridge.spawn(id, resolved, argv, options.cwd, onEvent);
      // A short-lived child can exit (or be cancelled) before spawn returns the listener.
      if (cleanupRequested) cleanup();
    } catch (error) {
      finish({ ok: false, error: `Could not start terum-skills: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  return {
    done,
    frames: {
      async *[Symbol.asyncIterator]() {
        let cursor = 0;
        while (true) {
          const frame = buffer[cursor];
          if (frame) { cursor++; yield structuredClone(frame); continue; }
          if (finished) return;
          await new Promise<void>((resolve) => readers.add(resolve));
        }
      },
    },
    answer(askId, value) {
      if (finished) return;
      void bridge.write(id, JSON.stringify({ t: 'answer', id: askId, value })).catch((error: unknown) => finish({ ok: false, error: `Could not answer terum-skills: ${error instanceof Error ? error.message : String(error)}` }));
    },
    async cancel() {
      if (!finished) {
        cancelled = true;
        if (started) {
          await bridge.write(id, JSON.stringify({ t: 'cancel' })).catch(() => undefined);
          await bridge.kill(id).catch(() => undefined);
        }
        finish({ ok: false, error: 'Cancelled.' });
      }
      cleanup();
      await done;
    },
  };
}
