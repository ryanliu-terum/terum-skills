#!/usr/bin/env node
import { CommanderError } from 'commander';
import { buildProgram } from './cli.js';
import { Prompter, terminalPrompter } from './lib/prompt.js';
import { Result } from './lib/result.js';

// The bin entry: a terminal Prompter, failures on stderr, a non-zero exit for every failure path.
async function execute(invoke: (io: Prompter) => Promise<Result<unknown>>): Promise<void> {
  const io = terminalPrompter();
  try {
    const outcome = await invoke(io);
    if (!outcome.ok) { process.stderr.write(`${outcome.error}\n`); process.exitCode = 1; }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

try {
  await buildProgram(execute).parseAsync();
} catch (error) {
  // commander's own exits (help, version, usage errors) — it has already printed; keep its code.
  process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
}
