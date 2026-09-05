#!/usr/bin/env node
import { CommanderError } from 'commander';
import { buildProgram } from './cli.js';
import { Prompter, terminalPrompter } from './lib/prompt.js';
import { Result } from './lib/result.js';
import type { SyncResult } from './commands/sync.js';

// The bin entry: a terminal Prompter, failures on stderr, a non-zero exit for every failure path.
async function execute(invoke: (io: Prompter) => Promise<Result<unknown>>): Promise<void> {
  const io = terminalPrompter();
  try {
    const outcome = await invoke(io);
    if (!outcome.ok) {
      if (isHookSync(outcome.value)) writeHookNotices(outcome.value);
      process.stderr.write(`${outcome.error}\n`); process.exitCode = 1;
    }
    else if (isHookSync(outcome.value)) {
      writeHookNotices(outcome.value);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

/** Hook command output stays on its two-channel contract without giving command modules stdio. */
function isHookSync(value: unknown): value is SyncResult {
  return Boolean(value) && typeof value === 'object' && (value as Partial<SyncResult>).hook === true && Array.isArray((value as Partial<SyncResult>).deferred) && Array.isArray((value as Partial<SyncResult>).notices);
}
function writeHookNotices(value: SyncResult): void {
  for (const notice of value.notices) process.stderr.write(`${notice}\n`);
  if (value.deferred.length) process.stderr.write(`${value.deferred.length} skills need review — run \`terum-skills sync\`\n`);
}

try {
  await buildProgram(execute).parseAsync();
} catch (error) {
  // commander's own exits (help, version, usage errors) — it has already printed; keep its code.
  process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
}
