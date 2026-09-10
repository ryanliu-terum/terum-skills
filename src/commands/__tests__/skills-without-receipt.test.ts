import { expect, it } from 'vitest';
import { bareTeam, git } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';
import { skillsWithoutReceipt } from '../eval.js';
import { pendingIds, pendingReceipt, pendingSkill, seedPending } from './pending-eval-fixtures.js';
it('skillsWithoutReceipt returns the skills whose current tree hash has no receipt', async () => {
  const { seed } = await bareTeam(); await seedPending(seed); await pendingReceipt(seed, { older: true });
  const reports: string[] = []; const read = () => skillsWithoutReceipt(seed, 'team', systemRunner, line => reports.push(line));
  expect(await read()).toEqual({ shared: 2, considered: 2, pending: await Promise.all(['alpha', 'beta'].map(async (name, i) => ({ name, id: pendingIds[i], version: (await git(['rev-parse', `HEAD:skills/${name}`], seed)).trim() }))) });
  await pendingReceipt(seed); expect((await read()).pending.map(s => s.name)).toEqual(['beta']); expect(reports).toEqual([]);
});
it('skillsWithoutReceipt reports a skill absent from HEAD:skills instead of offering it', async () => {
  const { seed } = await bareTeam(); await pendingSkill(seed, 'x', pendingIds[0]!); const lines: string[] = [];
  // Shared but not considered: the caller must not say "every shared skill already has a receipt".
  expect(await skillsWithoutReceipt(seed, 'team', systemRunner, line => lines.push(line))).toEqual({ pending: [], shared: 1, considered: 0 });
  expect(lines).toEqual(['x: could not resolve the current version: absent from HEAD:skills']);
});
it('reports a failed version reader and excludes unresolved skills', async () => {
  const { seed } = await bareTeam(); await seedPending(seed, 1); const lines: string[] = [];
  expect(await skillsWithoutReceipt(seed, 'team', { run: async () => { throw new Error('git unavailable'); } }, line => lines.push(line)))
    .toEqual({ pending: [], shared: 1, considered: 0, versionProblem: 'git unavailable' });
  expect(lines).toEqual(['alpha: could not resolve the current version: git unavailable']);
});
it('a team that shares nothing reports zero shared skills rather than an empty batch', async () => {
  const { seed } = await bareTeam(); const lines: string[] = [];
  expect(await skillsWithoutReceipt(seed, 'team', systemRunner, line => lines.push(line))).toEqual({ pending: [], shared: 0, considered: 0 });
  expect(lines).toEqual([]);
});
