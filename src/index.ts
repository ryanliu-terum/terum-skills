#!/usr/bin/env node
import module from 'node:module';
// Caches the compiled form of every module loaded AFTER this line, which is the unbundled tree the tests and
// `npm link` run. It cannot cache the shipped bundle: `dist/index.js` is one file and V8 has already compiled
// it by the time this line executes. Measured (node 24, 15 runs) `--version` is 86 ms with this call and 74 ms
// with NODE_COMPILE_CACHE set in the environment instead; see desktop/GAPS.md for why the 12 ms is not taken.
try { module.enableCompileCache(); } catch { /* Unsupported runtime: a cache miss is a slower start, never a wrong answer. */ }
import { constants } from 'node:fs';
import path from 'node:path';
import { resolveInvocationForm } from './lib/invocation.js';
import { readFile, realpath, access, stat } from 'node:fs/promises';
import { createConfigStore } from './lib/config.js';
import { packageVersion } from './lib/package.js';
import { createReleaseState, updateNotice } from './lib/update.js';
import { fileURLToPath } from 'node:url';
import { describeLaunch } from './lib/launch.js';
import { CommanderError } from 'commander';
import { run as serve } from './commands/serve.js';
import { buildProgram } from './cli.js';
import { createExecute } from './lib/execute.js';
import { terminalPrompter } from './lib/prompt.js';
import { runShutdownHooks } from './lib/shutdown.js';
import { FRAMES_FLAG, frameChannel, attemptedVerb, COMMANDER_NON_ERRORS, type ResultOutcome } from './lib/frames.js';

// A reader that closes early (`terum-skills ls | head -5`) surfaces as an asynchronous 'error' on
// the stream, reachable by no try/catch below, and a broken pipe is not a failure of the verb. A
// broken stdout is reported to the Prompter, though: a question asked after the reader went away
// must fail closed instead of parking the run on a prompt nobody can see. Anything else on a
// stream stays fatal.
let reportBrokenOutput: () => void = () => undefined;
const outputClosed = new Promise<void>((resolve) => { reportBrokenOutput = resolve; });
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error;
    if (stream === process.stdout) reportBrokenOutput();
  });
}

// The bin entry: a terminal Prompter, failures on stderr, a non-zero exit for every failure path.
// The Result → stderr/exit-code mapping itself lives in lib/execute.ts, so it is tested without a process.
const launch = await describeLaunch({
  entry: fileURLToPath(import.meta.url), realpath,
  readJson: async (path) => { try { return JSON.parse(await readFile(path, 'utf8')) as unknown; } catch { return null; } },
});
const form = await resolveInvocationForm({ launch, env: process.env, platform: process.platform, pathEntries: (process.env.PATH ?? '').split(path.delimiter), access: (p) => access(p, constants.X_OK), realpath, stat });
// Frame mode (docs/frame-protocol.md): a program is on the other end, not a person. The flag is
// global and position-independent, so it is taken off argv before commander sees it; the same
// Result → exit-code contract applies, plus one terminal `result` frame per run. The session hook
// is refused here: its stdout is the reload directive, which is not a frame.
const separator = process.argv.indexOf('--');
const prefixEnd = separator === -1 ? process.argv.length : separator;
const frames = process.argv.slice(0, prefixEnd).includes(FRAMES_FLAG);
const argv = process.argv.filter((argument, index) => index >= prefixEnd || argument !== FRAMES_FLAG);
if (argv[2] === 'serve') {
  // A session owns stdin and many results; never attach the one-shot channel/report sink.
  const diagnostic = (line: string) => { process.stderr.write(`${line}\n`); };
  const runSession = async () => {
    process.exitCode = await serve({
      frames, version: packageVersion(), input: process.stdin, output: process.stdout, diagnostic, form,
      onCancel: () => { runShutdownHooks(); process.exit(143); },
      buildProgram: execute => buildProgram(execute, undefined, { launch, form, noUpdateCheck: true }),
    });
  };
  try {
    await buildProgram(async () => undefined, undefined, { launch, form, serve: runSession })
      .configureOutput({ writeOut: diagnostic, writeErr: diagnostic }).parseAsync(argv);
  } catch (error) {
    const failure = frameChannel({ input: process.stdin, output: process.stdout, diagnostic });
    failure.result({ verb: 'serve', ok: false, error: error instanceof Error ? error.message : String(error), exitCode: 1 });
    process.exitCode = 1;
  }
} else {
// A verb that never asks (eval) would otherwise keep running after cancel. Exit, never self-signal:
// on Windows process.kill(self) is TerminateProcess, which runs no 'exit' handler, so the clone's
// writer lock would be left behind for up to a minute. process.exit runs the hooks' children-killing
// and then lets signal-exit release every lock this process holds.
const channel = frames ? frameChannel({ onCancel: () => { runShutdownHooks(); process.exit(143); }, input: process.stdin, output: process.stdout, diagnostic: (line) => { process.stderr.write(`${line}\n`); } }) : undefined;
let reported = false;
const report = (outcome: ResultOutcome) => {
  if (!channel || reported) return;
  reported = true;
  channel.result(outcome);
};
const noUpdateCheck = frames || Boolean(process.env.CI || process.env.NO_UPDATE_NOTIFIER || process.env.TERUM_SKILLS_NO_UPDATE_NOTIFIER);
const afterVerb = process.stderr.isTTY && !noUpdateCheck
  ? async () => updateNotice({ state: createReleaseState(createConfigStore().root), launch, running: packageVersion(), stderr: (line) => { process.stderr.write(`${line}\n`); } })
  : undefined;
const execute = createExecute({
  afterVerb, form,
  io: channel?.io ?? terminalPrompter({ outputClosed }),
  stderr: (line) => { process.stderr.write(`${line}\n`); },
  setExitCode: (code) => { process.exitCode = code; },
  result: channel ? report : undefined,
});

try {
  if (channel) {
    channel.hello(packageVersion());
    const separator = argv.indexOf('--');
    if (argv.slice(0, separator === -1 ? argv.length : separator).includes('--hook')) {
      report({ verb: 'sync', ok: false, error: '`sync --hook` is the session hook and is not available over frames; run plain `sync`.', exitCode: 1 });
      process.exitCode = 1;
    } else {
      await buildProgram(execute, undefined, { launch, form, noUpdateCheck, frames: true }).parseAsync(argv);
    }
  } else {
    await buildProgram(execute, undefined, { launch, form, noUpdateCheck }).parseAsync();
  }
} catch (error) {
  // commander's own exits (help, version, usage errors) — it has already printed; keep its code.
  process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
  // Commander also uses commander.help for missing arguments, with exitCode 1.
  const nonError = error instanceof CommanderError && error.exitCode === 0 && COMMANDER_NON_ERRORS.has(error.code);
  if (channel && !nonError && (!(error instanceof CommanderError) || error.exitCode !== 0)) {
    const verb = attemptedVerb(argv.slice(2));
    const message = error instanceof Error ? error.message : String(error);
    report({ verb, ok: false, error: message === '(outputHelp)' ? `Usage error: ${verb} needs an argument; run it without --frames for the full help.` : message, exitCode: 1 });
  }
}

}
