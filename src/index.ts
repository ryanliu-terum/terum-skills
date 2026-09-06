#!/usr/bin/env node
import { CommanderError } from 'commander';
import { buildProgram } from './cli.js';
import { createExecute } from './lib/execute.js';
import { terminalPrompter } from './lib/prompt.js';

// The bin entry: a terminal Prompter, failures on stderr, a non-zero exit for every failure path.
// The Result → stderr/exit-code mapping itself lives in lib/execute.ts, so it is tested without a process.
const execute = createExecute({
  io: terminalPrompter(),
  stderr: (line) => { process.stderr.write(`${line}\n`); },
  setExitCode: (code) => { process.exitCode = code; },
});

try {
  await buildProgram(execute).parseAsync();
} catch (error) {
  // commander's own exits (help, version, usage errors) — it has already printed; keep its code.
  process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
}
