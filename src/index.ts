#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { createConfigStore } from './lib/config.js';
import { packageVersion } from './lib/package.js';
import { createReleaseState, updateNotice } from './lib/update.js';
import { fileURLToPath } from 'node:url';
import { describeLaunch } from './lib/launch.js';
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
const launch = await describeLaunch({
  entry: fileURLToPath(import.meta.url), realpath,
  readJson: async (path) => { try { return JSON.parse(await readFile(path, 'utf8')) as unknown; } catch { return null; } },
});
const noUpdateCheck = Boolean(process.env.CI || process.env.NO_UPDATE_NOTIFIER || process.env.TERUM_SKILLS_NO_UPDATE_NOTIFIER);
const afterVerb = process.stderr.isTTY && !noUpdateCheck
  ? async () => updateNotice({ state: createReleaseState(createConfigStore().root), launch, running: packageVersion(), stderr: (line) => { process.stderr.write(`${line}\n`); } })
  : undefined;
const execute = createExecute({
  afterVerb,
  io: terminalPrompter({ outputClosed }),
  stderr: (line) => { process.stderr.write(`${line}\n`); },
  setExitCode: (code) => { process.exitCode = code; },
});

try {
  await buildProgram(execute, undefined, { launch, noUpdateCheck }).parseAsync();
} catch (error) {
  // commander's own exits (help, version, usage errors) — it has already printed; keep its code.
  process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
}
