import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { emptyTranscript, fractionPassed, runChecks, type TranscriptText } from '../checks.js';

const transcript: TranscriptText = {
  allText: () => 'Set STRIPE_KEY in the env.\n{"command":"npm test"}',
  bashCommands: () => ['npm test', 'git status', './scripts/deploy.sh --dry-run'],
};

let sandbox: string;
beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'checks-'));
  await writeFile(join(sandbox, 'deployed.marker'), '');
});

describe('the five check kinds (§5.1, verbatim port)', () => {
  it('transcript_mentions is case-insensitive substring', () => {
    expect(runChecks([{ transcript_mentions: 'stripe_key' }], transcript, sandbox)[0]).toMatchObject({ passed: true });
    expect(runChecks([{ transcript_mentions: 'ROLLBACK' }], transcript, sandbox)[0]).toMatchObject({ passed: false, detail: expect.stringContaining('never appeared') });
  });

  it('command_matching / no_command_matching are regexes over Bash commands', () => {
    expect(runChecks([{ command_matching: 'npm t.st' }], transcript, sandbox)[0]).toMatchObject({ passed: true });
    expect(runChecks([{ command_matching: 'docker' }], transcript, sandbox)[0]).toMatchObject({ passed: false });
    expect(runChecks([{ no_command_matching: 'deploy\\.sh' }], transcript, sandbox)[0]).toMatchObject({ passed: false, detail: expect.stringContaining('deploy.sh') });
    expect(runChecks([{ no_command_matching: 'rm -rf' }], transcript, sandbox)[0]).toMatchObject({ passed: true });
  });

  it('file_exists / file_absent look inside the sandbox only', () => {
    expect(runChecks([{ file_exists: 'deployed.marker' }], transcript, sandbox)[0]).toMatchObject({ passed: true });
    expect(runChecks([{ file_exists: 'missing.txt' }], transcript, sandbox)[0]).toMatchObject({ passed: false });
    expect(runChecks([{ file_absent: '.env.leaked' }], transcript, sandbox)[0]).toMatchObject({ passed: true });
    expect(runChecks([{ file_absent: 'deployed.marker' }], transcript, sandbox)[0]).toMatchObject({ passed: false });
    expect(runChecks([{ file_exists: '../../etc/passwd' }], transcript, sandbox)[0]).toMatchObject({ passed: false, detail: expect.stringContaining('escapes') });
    expect(runChecks([{ file_absent: '../outside' }], transcript, sandbox)[0]).toMatchObject({ passed: false });
  });
});

describe('spec parsing (§5.1)', () => {
  it('unknown kinds and malformed specs FAIL, never throw', () => {
    expect(runChecks([{ made_up_kind: 'x' }], transcript, sandbox)[0]).toMatchObject({ passed: false, detail: expect.stringContaining('unknown check kind') });
    expect(runChecks([{ two: 1, keys: 2 }], transcript, sandbox)[0]).toMatchObject({ passed: false, detail: 'unrecognized check spec' });
    expect(runChecks(['transcript_mentions'], transcript, sandbox)[0]).toMatchObject({ passed: false }); // bare string form parses, arg is undefined
  });
});

describe('arm-score fraction (§16.4) and the empty transcript (§7.1)', () => {
  it('fraction of checks passed; null when the case has no checks', () => {
    const results = runChecks([{ transcript_mentions: 'stripe_key' }, { command_matching: 'docker' }], transcript, sandbox);
    expect(fractionPassed(results)).toBe(0.5);
    expect(fractionPassed([])).toBeNull();
  });

  it('a failed arm scored against the empty transcript fails every transcript check', () => {
    const results = runChecks([{ transcript_mentions: 'x' }, { command_matching: '.' }], emptyTranscript, sandbox);
    expect(results.every((result) => !result.passed)).toBe(true);
    expect(fractionPassed(results)).toBe(0);
  });
});
