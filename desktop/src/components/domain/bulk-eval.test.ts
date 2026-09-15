import { describe, expect, it } from 'vitest';
import { evalManyCommand, evalManyLabel, evalManyStatus, evalManySubject, isEvalManyResult } from './bulk-eval';

it('names the run by its one skill, a count, or the pending set', () => {
  expect(evalManyLabel({ refs: ['alpha'] })).toBe('alpha');
  expect(evalManyLabel({ refs: ['alpha', 'beta'] })).toBe('2 skills');
  expect(evalManyLabel({ refs: [], pending: true })).toBe('pending skills');
  expect(evalManyLabel({ refs: ['alpha'], pending: true })).toBe('1 skill and pending skills');
});

it('prints the terminal line for every choice, quoting a path with spaces', () => {
  expect(evalManyCommand({ refs: ['alpha', 'beta'], mode: 'now' })).toBe('npx -y terum-skills@latest eval alpha beta');
  expect(evalManyCommand({ refs: ['alpha', 'beta'], mode: 'batches', batch: 2, team: 'acme' })).toBe('npx -y terum-skills@latest eval alpha beta --team acme --batch 2');
  expect(evalManyCommand({ refs: ['alpha'], mode: 'overnight' })).toBe('npx -y terum-skills@latest eval alpha --window overnight');
  expect(evalManyCommand({ refs: [], mode: 'now', pending: true })).toBe('npx -y terum-skills@latest eval --pending');
  expect(evalManyCommand({ refs: ['/Users/me/my skills/alpha'], mode: 'later' })).toBe('npx -y terum-skills@latest eval "/Users/me/my skills/alpha" --window later');
});

it('summarises the finished run in the CLI\'s counts, or its error', () => {
  const queued = { skill: 'beta', path: '/x/beta', contentHash: `sha256:${'0'.repeat(64)}`, requestedAt: '2026-09-14T00:00:00Z', window: 'later' as const };
  expect(evalManyStatus({ ok: true, value: { mode: 'ran', team: null, skills: ['alpha', 'beta'], ok: 2, failed: 0, queued: [] } }, { mode: 'now' })).toBe('Evaluated 2 of 2; 0 failed.');
  expect(evalManyStatus({ ok: true, value: { mode: 'ran', team: null, skills: ['alpha', 'beta'], ok: 1, failed: 0, queued: [queued], stoppedAfter: 1 } }, { mode: 'batches' })).toBe('Evaluated 1 of 2; 0 failed. 1 queued for later.');
  expect(evalManyStatus({ ok: true, value: { mode: 'queued', team: null, skills: ['beta'], ok: 0, failed: 0, queued: [{ ...queued, window: 'overnight' }] } }, { mode: 'overnight' })).toBe('Queued 1 eval for overnight.');
  expect(evalManyStatus({ ok: false, error: '1 of 2 evals failed.' }, { mode: 'now' })).toBe('1 of 2 evals failed.');
  expect(evalManyStatus({ ok: true, value: { name: 'alpha' } }, { mode: 'now' })).toBe('Finished');
  expect(isEvalManyResult({ items: [] })).toBe(false);
});

describe('evalManySubject', () => {
  it('names a short list as is', () => {
    expect(evalManySubject(['deploy-check', 'migration-guard'])).toBe('deploy-check, migration-guard');
    expect(evalManySubject(['a', 'b', 'c', 'd'])).toBe('a, b, c, d');
  });
  it('reads a folder path as its folder name (UI policy §2) and caps a long list with a count (§6)', () => {
    const unc = (name: string) => `\\\\wsl.localhost\\Ubuntu\\home\\t\\.claude\\skills\\${name}`;
    expect(evalManySubject([unc('handoff'), '/home/t/.claude/skills/state'])).toBe('handoff, state');
    const many = Array.from({ length: 28 }, (_, i) => unc(`skill-${i}`));
    expect(evalManySubject(many)).toBe('skill-0, skill-1, skill-2 and 25 more');
    expect(evalManySubject(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
  });
});
