import { describe, expect, it } from 'vitest';
import { createExecute } from '../execute.js';
import { PromptClosedError } from '../prompt.js';
import { failure, success } from '../result.js';
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

  it('a hook sync sends its notices and the review count to stderr on success and on failure, before any error line', async () => {
    const ok = sink();
    await ok.execute(async () => success({ placed: 0, deferred: ['a', 'b'], notices: ['Skipping team/x: bad'], changed: false, hook: true }));
    expect(ok.lines).toEqual(['Skipping team/x: bad', '2 skills need review — run `npx -y terum-skills@latest sync`']);
    expect(ok.codes).toEqual([]);
    const failed = sink();
    await failed.execute(async () => failure('Could not fast-forward team: offline', { placed: 0, deferred: [], notices: ['note'], changed: false, hook: true }));
    expect(failed.lines).toEqual(['note', 'Could not fast-forward team: offline']);
    expect(failed.codes).toEqual([1]);
    const quiet = sink();
    // A plain (non-hook) sync carries the same shape; its notices already went to stdout, so nothing is echoed here.
    await quiet.execute(async () => success({ placed: 1, deferred: ['a'], notices: ['note'], changed: true, hook: false }));
    expect(quiet.lines).toEqual([]);
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
