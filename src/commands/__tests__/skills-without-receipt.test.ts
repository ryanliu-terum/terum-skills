import { expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { bareTeam, git } from '../../lib/__tests__/fixtures.js';
import { skillsWithoutReceipt } from '../eval.js';
import { pendingIds, pendingReceipt, pendingSkill, seedPending } from './pending-eval-fixtures.js';

it('returns the skills whose HIGHEST version folder carries no receipt', async () => {
  const { seed } = await bareTeam(); await seedPending(seed); await pendingReceipt(seed, { older: true });
  const reports: string[] = []; const read = () => skillsWithoutReceipt(seed, 'team', (line) => reports.push(line));
  // The archived receipt is testimony about bytes that are not v1, so both skills are still pending.
  expect(await read()).toEqual({ shared: 2, considered: 2, pending: ['alpha', 'beta'].map((name, index) => ({ name, id: pendingIds[index], version: 'v1' })) });
  await pendingReceipt(seed);
  expect((await read()).pending.map((skill) => skill.name)).toEqual(['beta']);
  expect(reports).toEqual([]);
});

it('a receipt at an older version does not cover the newest one', async () => {
  const { seed } = await bareTeam(); await seedPending(seed, 1); await pendingReceipt(seed);
  expect((await skillsWithoutReceipt(seed, 'team', () => undefined)).pending).toEqual([]);
  // §6.5: `evals/<id>/<highest v>` — publishing v2 leaves v1's receipt behind, and alpha is pending again.
  await pendingSkill(seed, 'alpha', pendingIds[0]!, 'v2');
  await git(['add', '--all'], seed); await git(['commit', '-q', '-m', 'alpha v2'], seed);
  expect((await skillsWithoutReceipt(seed, 'team', () => undefined)).pending).toEqual([{ name: 'alpha', id: pendingIds[0], version: 'v2' }]);
});

it('a skill name holding no version folder is reported, never offered', async () => {
  const { seed } = await bareTeam();
  await mkdir(join(seed, 'skills', 'x'), { recursive: true });
  const lines: string[] = [];
  // Shared-but-unreadable, so the caller must not say "every shared skill already has a receipt".
  expect(await skillsWithoutReceipt(seed, 'team', (line) => lines.push(line))).toEqual({ pending: [], shared: 0, considered: 0 });
  expect(lines).toEqual(['x: skills/x holds no v<N> folder.']);
});

it('an unreadable newest receipt is reported and excluded, never silently rerun', async () => {
  const { seed } = await bareTeam(); await seedPending(seed, 1); await pendingReceipt(seed, { invalid: true });
  const lines: string[] = [];
  expect((await skillsWithoutReceipt(seed, 'team', (line) => lines.push(line))).pending).toEqual([]);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^alpha: the newest receipt for the current version is invalid/);
});

it('a team that shares nothing reports zero shared skills rather than an empty batch', async () => {
  const { seed } = await bareTeam(); const lines: string[] = [];
  expect(await skillsWithoutReceipt(seed, 'team', (line) => lines.push(line))).toEqual({ pending: [], shared: 0, considered: 0 });
  expect(lines).toEqual([]);
});
