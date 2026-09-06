#!/usr/bin/env node
import { CommanderError } from 'commander';
import { buildProgram } from './cli.js';
import { createExecute } from './lib/execute.js';
import { terminalPrompter } from './lib/prompt.js';

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
const execute = createExecute({
  io: terminalPrompter({ outputClosed }),
  stderr: (line) => { process.stderr.write(`${line}\n`); },
  setExitCode: (code) => { process.exitCode = code; },
});

try {
  await buildProgram(execute).parseAsync();
} catch (error) {
  // commander's own exits (help, version, usage errors) — it has already printed; keep its code.
  process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
}
