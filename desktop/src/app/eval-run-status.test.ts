import { describe, expect, it } from 'vitest';
import { evalChip, evalRunCovers } from './eval-run-status';
import type { EvalRunState } from './eval-run-context';
import type { Run } from '../backend/types';

const run = { cancel: async () => {}, frames: (async function* () {})() } as unknown as Run<never>;
const base: EvalRunState = { ref: 'deploy-check', name: 'deploy-check', team: 'terum', run, lines: [], startedAt: 0, state: 'running' };
const local = { name: 'handoff', teamed: false, path: '\\\\wsl.localhost\\Ubuntu\\home\\t\\.claude\\skills\\handoff' };
const teamCard = { name: 'deploy-check', teamed: true, path: '/x/deploy-check' };

describe('evalRunCovers', () => {
  it('is false with no run or a finished run', () => {
    expect(evalRunCovers(null, teamCard)).toBe(false);
    expect(evalRunCovers({ ...base, state: 'done' }, teamCard)).toBe(false);
  });
  it('matches a team run to a team card of that name and a local run to a local card by name or path', () => {
    expect(evalRunCovers(base, teamCard)).toBe(true);
    expect(evalRunCovers(base, { ...teamCard, teamed: false })).toBe(false);
    expect(evalRunCovers(base, local)).toBe(false);
    const localRun = { ...base, team: undefined, ref: local.path, name: 'handoff' };
    expect(evalRunCovers(localRun, local)).toBe(true);
    expect(evalRunCovers(localRun, { ...local, name: 'other' })).toBe(true);
    expect(evalRunCovers(localRun, { ...local, name: 'other', path: '/elsewhere' })).toBe(false);
    expect(evalRunCovers(localRun, { ...teamCard, name: 'handoff' })).toBe(false);
  });
  it('matches a several-skills run by the card ref or name, never by a pending set', () => {
    const many = { ...base, name: '2 skills', many: { refs: [local.path, 'deploy-check'], mode: 'now' as const } };
    expect(evalRunCovers(many, local)).toBe(true);
    expect(evalRunCovers(many, teamCard)).toBe(true);
    expect(evalRunCovers(many, { ...local, name: 'other', path: '/nope' })).toBe(false);
    expect(evalRunCovers({ ...base, name: 'pending skills', many: { refs: [], mode: 'now' as const, pending: true } }, teamCard)).toBe(false);
  });
  it('never claims a queued drain', () => { expect(evalRunCovers({ ...base, queue: true }, teamCard)).toBe(false); });
});

describe('evalChip', () => {
  it('says starting until the CLI prints, then evaluating, then the count', () => {
    expect(evalChip(base)).toEqual({ label: 'Starting eval · deploy-check', tone: 'running', running: true });
    expect(evalChip({ ...base, lines: ['x'] })?.label).toBe('Evaluating · deploy-check');
    expect(evalChip({ ...base, progress: { t: 'progress', done: 3, total: 28 } })?.label).toBe('Evaluating · 3 of 28 · deploy-check');
    expect(evalChip({ ...base, name: '28 skills', many: { refs: [], mode: 'now' }, progress: { t: 'progress', done: 3, total: 28 } })?.label).toBe('Evaluating · 3 of 28');
  });
  it('names the end state', () => {
    expect(evalChip({ ...base, state: 'done' })).toEqual({ label: 'Eval finished · deploy-check', tone: 'done', running: false });
    expect(evalChip({ ...base, state: 'failed' })?.tone).toBe('failed');
    expect(evalChip({ ...base, state: 'stopped' })?.label).toBe('Eval stopped · deploy-check');
    expect(evalChip(null)).toBeNull();
  });
});
