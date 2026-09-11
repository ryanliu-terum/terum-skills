import { describe, expect, it } from 'vitest';
import { createExecute } from '../execute.js';
import { PromptClosedError } from '../prompt.js';
import { failure, success, cancelled, CancelledError } from '../result.js';
import { ScriptedPrompter } from './fixtures.js';

const sink = () => {
  const lines: string[] = [];
  const codes: number[] = [];
  const io = new ScriptedPrompter();
  const execute = createExecute({ io, stderr: (line) => { lines.push(line); }, setExitCode: (code) => { codes.push(code); } });
  return { lines, codes, io, execute: (invoke: Parameters<typeof execute>[0]) => execute(invoke, { verb: 'test', notices: false }) };
};

describe('execute — the bin contract (§3)', () => {
  it('a failing Result is one stderr line and exit 1; a thrown verb likewise; success writes nothing and sets no code', async () => {
    const failed = sink();
    await failed.execute(async () => failure('Unsupported remote: nope'));
    expect(failed.lines).toEqual(['Unsupported remote: nope']);
    expect(failed.codes).toEqual([1]);
    const thrown = sink();
    await thrown.execute(async () => { throw new PromptClosedError('Team handle', 'not-interactive'); });
    expect(thrown.lines).toEqual([expect.stringContaining('needs an interactive terminal')]);
    expect(thrown.codes).toEqual([1]);
    const ok = sink();
    await ok.execute(async (io) => { expect(io).toBe(ok.io); return success({ team: 't' }); });
    expect(ok.lines).toEqual([]);
    expect(ok.codes).toEqual([]);
  });




  it('sends a hook manual-refresh notice to stderr before a failed result, leaving verb stdout alone', async () => {
    const lines: string[] = []; const codes: number[] = [];
    const execute = createExecute({ io: new ScriptedPrompter(), stderr: line => { lines.push(line); }, setExitCode: code => { codes.push(code); } });
    await execute(async () => success({ changed: false, teams: [], notices: ['Updated your /terum-skills manual for this CLI.'], hook: true }), { verb: 'sync', notices: false });
    expect(lines).toEqual(['Updated your /terum-skills manual for this CLI.']);
    expect(codes).toEqual([]);
    await execute(async () => failure('fetch failed', { changed: false, teams: [], notices: ['Updated your /terum-skills manual for this CLI.'], hook: true }), { verb: 'sync', notices: false });
    expect(lines).toEqual(['Updated your /terum-skills manual for this CLI.', 'Updated your /terum-skills manual for this CLI.', 'fetch failed']);
    expect(codes).toEqual([1]);
  });
});


describe('release notice tail', () => {
  it.each(['success', 'failure', 'throw'])('runs last after %s and preserves exit codes', async (outcome) => {
    const lines: string[] = []; const codes: number[] = [];
    const execute = createExecute({ io: new ScriptedPrompter(), stderr: (line) => { lines.push(line); }, setExitCode: (code) => { codes.push(code); }, afterVerb: async () => { lines.push('notice'); } });
    await execute(async () => { lines.push('verb'); if (outcome === 'throw') throw new Error('failure'); return outcome === 'failure' ? failure('failure') : success(undefined); }, { verb: 'ls', notices: true });
    expect(lines).toEqual(outcome === 'success' ? ['verb', 'notice'] : ['verb', 'failure', 'notice']);
    expect(codes).toEqual(outcome === 'success' ? [] : [1]);
  });
  it('explicitly suppresses ineligible tails', async () => {
    let calls = 0;
    await createExecute({ io: new ScriptedPrompter(), stderr: () => undefined, setExitCode: () => undefined, afterVerb: async () => { calls++; } })(async () => success(undefined), { verb: 'sync', notices: false });
    expect(calls).toBe(0);
  });
  it.each([false, true])('swallows notifier failure (synchronous: %s)', async (synchronous) => {
    const codes: number[] = [];
    const execute = createExecute({ io: new ScriptedPrompter(), stderr: () => undefined, setExitCode: (code) => { codes.push(code); }, afterVerb: () => { if (synchronous) throw new Error('tail'); return Promise.reject(new Error('tail')); } });
    await expect(execute(async () => success(undefined), { verb: 'ls', notices: true })).resolves.toBeUndefined();
    expect(codes).toEqual([]);
  });
});

it.each([false, true])('carries typed cancellation to the result sink without changing stderr or exit (throw=%s)', async thrown => {
  const outcomes: unknown[] = [], lines: string[] = [], codes: number[] = [];
  const execute = createExecute({ io: new ScriptedPrompter(), stderr: line => { lines.push(line); }, setExitCode: code => { codes.push(code); }, result: outcome => { outcomes.push(outcome); } });
  await execute(async () => { if (thrown) throw new CancelledError('Leave was cancelled.'); return cancelled('Leave was cancelled.'); }, { verb: 'team leave', notices: false });
  expect(outcomes).toEqual([{ verb: 'team leave', ok: false, error: 'Leave was cancelled.', cancelled: true, exitCode: 1, ...(thrown ? {} : { value: undefined }) }]);
  expect(lines).toEqual(['Leave was cancelled.']);
  expect(codes).toEqual([1]);
});
