import { describe, expect, it } from 'vitest';
import { evalChip, evalRunCovers, runStatus } from './eval-run-status';
import type { EvalRunState } from './eval-run-context';
import type { Run } from '../backend/types';

const run = { cancel: async () => {}, frames: (async function* () {})() } as unknown as Run<never>;
const base: EvalRunState = { ref: 'deploy-check', name: 'deploy-check', team: 'terum', run, lines: [], startedAt: 0, state: 'running' };
const local = { name: 'handoff', teamed: false, path: '\\\\wsl.localhost\\Ubuntu\\home\\t\\.claude\\skills\\handoff' };
const project = { name: 'handoff', teamed: false, path: '\\\\wsl.localhost\\Ubuntu\\home\\t\\Projects\\terum\\.claude\\skills\\handoff' };
const teamCard = { name: 'deploy-check', teamed: true, path: '/x/deploy-check' };

describe('evalRunCovers', () => {
  it('is false with no run, a finished run, or a queued drain', () => {
    expect(evalRunCovers(null, teamCard)).toBe(false);
    expect(evalRunCovers({ ...base, state: 'done' }, teamCard)).toBe(false);
    expect(evalRunCovers({ ...base, queue: true }, teamCard)).toBe(false);
  });
  it('matches a team run to the team card of that name only', () => {
    expect(evalRunCovers(base, teamCard)).toBe(true);
    expect(evalRunCovers(base, { ...teamCard, teamed: false })).toBe(false);
    expect(evalRunCovers(base, local)).toBe(false);
  });
  it('matches a local run by the folder path, so two folders of one name in two roots never light together', () => {
    const localRun = { ...base, team: undefined, ref: local.path, name: 'handoff' };
    expect(evalRunCovers(localRun, local)).toBe(true);
    expect(evalRunCovers(localRun, project)).toBe(false);
    expect(evalRunCovers(localRun, { ...local, name: 'other' })).toBe(true);
    expect(evalRunCovers(localRun, { ...local, path: '/elsewhere' })).toBe(false);
    expect(evalRunCovers(localRun, { ...teamCard, name: 'handoff' })).toBe(false);
  });
  it('matches a several-skills run by the same ref the Library handed over, never a pending or a queueing run', () => {
    const many = { ...base, name: '2 skills', many: { refs: [local.path, 'deploy-check'], mode: 'now' as const } };
    expect(evalRunCovers(many, local)).toBe(true);
    expect(evalRunCovers(many, project)).toBe(false);
    expect(evalRunCovers(many, teamCard)).toBe(true);
    expect(evalRunCovers(many, { ...local, name: 'other', path: '/nope' })).toBe(false);
    expect(evalRunCovers({ ...base, name: 'pending skills', many: { refs: [], mode: 'now' as const, pending: true } }, teamCard)).toBe(false);
    expect(evalRunCovers({ ...many, many: { ...many.many, mode: 'overnight' as const } }, local)).toBe(false);
    expect(evalRunCovers({ ...many, many: { ...many.many, mode: 'later' as const } }, local)).toBe(false);
  });
});

describe('evalChip', () => {
  it('says starting until the CLI prints, then evaluating, then the count', () => {
    expect(evalChip(base)).toEqual({ label: 'Starting eval · deploy-check', title: 'Starting eval · deploy-check', tone: 'running', running: true });
    expect(evalChip({ ...base, lines: ['x'] })?.label).toBe('Evaluating · deploy-check');
    expect(evalChip({ ...base, progress: { t: 'progress', done: 3, total: 28 } })?.label).toBe('Evaluating · 3 of 28 · deploy-check');
    expect(evalChip({ ...base, name: '28 skills', many: { refs: [], mode: 'now' }, progress: { t: 'progress', done: 3, total: 28 } })?.label).toBe('Evaluating · 3 of 28');
  });
  it('names the end state and carries the failure in the title', () => {
    expect(evalChip({ ...base, state: 'done' })).toEqual({ label: 'Eval finished · deploy-check', title: 'Eval finished · deploy-check', tone: 'done', running: false });
    const failed = evalChip({ ...base, state: 'failed', result: { ok: false, error: 'claude is not installed' } });
    expect(failed).toMatchObject({ label: 'Eval failed · deploy-check', title: 'Eval failed · deploy-check — claude is not installed', tone: 'failed', running: false });
    expect(evalChip({ ...base, state: 'stopped' })?.label).toBe('Eval stopped · deploy-check');
    expect(evalChip(null)).toBeNull();
  });
});

describe('runStatus', () => {
  it('climbs the ladder: starting, running, the count, then the end state', () => {
    expect(runStatus(base)).toBe('Starting…');
    expect(runStatus({ ...base, lines: ['preflight ok'] })).toBe('Running…');
    expect(runStatus({ ...base, lines: ['x'], progress: { t: 'progress', done: 2, total: 5 } })).toBe('2 of 5 evaluated');
    expect(runStatus({ ...base, state: 'stopped' })).toBe('Stopped');
    expect(runStatus({ ...base, state: 'failed', result: { ok: false, error: 'boom' } })).toBe('boom');
    expect(runStatus({ ...base, state: 'done' })).toBe('Finished');
    expect(runStatus({ ...base, state: 'done', result: { ok: true, value: { mode: 'ran', team: null, skills: ['a'], ok: 1, failed: 0, queued: [] } } }, () => 'Evaluated 1 of 1; 0 failed.')).toBe('Evaluated 1 of 1; 0 failed.');
  });
});
