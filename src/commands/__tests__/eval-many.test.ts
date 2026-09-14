import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ProgressUpdate } from '../../lib/prompt.js';
import { createConfigStore } from '../../lib/config.js';
import { readEvalQueue } from '../../lib/evals/queue.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { pendingIds } from './pending-eval-fixtures.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { failure, success } from '../../lib/result.js';
import { runMany, type EvalArgs, type EvalResult } from '../eval.js';

const skill = (name: string) => `---\nname: ${name}\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-11111111111${name.length}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;
/** §6.3: eval targets folders in the LIBRARY; a machine with no team evaluates single-arm (D42). */
async function library(names: string[]) {
  const home = await temporaryDirectory();
  for (const name of names) { const path = join(home, '.claude', 'skills', name); await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), skill(name)); }
  const config = createConfigStore(await temporaryDirectory());
  return { home, config };
}
const outcome = (name: string): EvalResult => ({ team: null, id: null, name, runDir: `/runs/${name}`, ccVersion: 'test', executionStatus: 'complete' });
const evaluator = () => vi.fn(async (args: EvalArgs) => { await Promise.resolve(); return success(outcome(args.ref!)); });
const probe = () => vi.fn(async () => success({ ccVersion: 'test' }));

it('runs several skills as one batch: one shared probe, the eval flags passed through, counts reported', async () => {
  const { home, config } = await library(['alpha', 'beta']); const io = new ScriptedPrompter(); const preflight = probe();
  const evaluate = vi.fn(async (args: EvalArgs) => { expect(args).toMatchObject({ k: 3, model: 'sonnet', lockWaitMs: 300_000, home }); expect(args.team).toBeUndefined(); expect(await args.preflight?.()).toEqual(success({ ccVersion: 'test' })); return success(outcome(args.ref!)); });
  const result = await runMany({ refs: ['alpha', 'beta'], k: 3, model: 'sonnet', home, config, preflight, evaluate }, io);
  expect(result).toEqual(success({ mode: 'ran', team: null, skills: ['alpha', 'beta'], ok: 2, failed: 0, queued: [] }));
  expect(evaluate).toHaveBeenCalledTimes(2); expect(preflight).toHaveBeenCalledTimes(1);
  expect(evaluate.mock.calls.map(([args]) => args.ref).sort()).toEqual(['alpha', 'beta']);
  expect(io.lines).toContain('Evaluating 2 skills, 2 at a time…'); expect(io.lines).toContain('Evaluated 2 of 2; 0 failed.');
  expect(io.asked).toEqual([]);
});
it('a failed eval is reported, the batch continues, and the result carries the failure without hiding the successes', async () => {
  const { home, config } = await library(['alpha', 'beta']); const io = new ScriptedPrompter();
  const evaluate = vi.fn(async (args: EvalArgs) => args.ref === 'alpha' ? failure('claude is not signed in') : success(outcome(args.ref!)));
  const result = await runMany({ refs: ['alpha', 'beta'], home, config, preflight: probe(), evaluate }, io);
  expect(result).toMatchObject({ ok: false, error: '1 of 2 evals failed.', value: { mode: 'ran', ok: 1, failed: 1 } });
  expect(io.lines).toContain('✗ alpha: claude is not signed in'); expect(io.lines).toContain('Evaluated 1 of 2; 1 failed.');
});
it('--batch runs that many at a time, asks between batches, and queues the remainder for later when declined', async () => {
  const { home, config } = await library(['alpha', 'beta', 'gamma']); const io = new ScriptedPrompter([], [false], true); const evaluate = evaluator();
  const result = await runMany({ refs: ['alpha', 'beta', 'gamma'], batch: 2, home, config, preflight: probe(), evaluate }, io);
  expect(evaluate).toHaveBeenCalledTimes(2); expect(evaluate.mock.calls.map(([args]) => args.ref).sort()).toEqual(['alpha', 'beta']);
  expect(io.asked).toEqual(['Continue with the next 1? (2 of 3 done, 1 left)']);
  expect(result).toMatchObject({ ok: true, value: { mode: 'ran', ok: 2, failed: 0, stoppedAfter: 2, queued: [expect.objectContaining({ skill: 'gamma', window: 'later' })] } });
  expect((await readEvalQueue(config.root)).items.map(item => [item.skill, item.window])).toEqual([['gamma', 'later']]);
  expect(io.lines).toContain('Queued 1 eval for later. Run it with `npx -y terum-skills@latest eval --drain`.');
});
it('--batch continues through every batch when confirmed, with cumulative progress', async () => {
  const { home, config } = await library(['alpha', 'beta', 'gamma']); const io = new ScriptedPrompter([], [true], true); const evaluate = evaluator();
  const progress: { current?: number; total?: number }[] = []; const reporting = Object.assign(io, { progress: (update: ProgressUpdate) => { progress.push({ current: update.current, total: update.total }); } });
  expect(await runMany({ refs: ['alpha', 'beta', 'gamma'], batch: 2, parallel: 8, home, config, preflight: probe(), evaluate }, reporting)).toMatchObject({ ok: true, value: { ok: 3, failed: 0, queued: [] } });
  expect(evaluate).toHaveBeenCalledTimes(3); expect(io.lines).toContain('Evaluating 3 skills, 2 at a time…');
  expect(progress.map(update => update.current)).toEqual([1, 2, 3]); expect(progress.every(update => update.total === 3)).toBe(true);
});
it('a non-interactive caller runs every batch without a question', async () => {
  const { home, config } = await library(['alpha', 'beta', 'gamma']); const io = new ScriptedPrompter(); const evaluate = evaluator();
  expect(await runMany({ refs: ['alpha', 'beta', 'gamma'], batch: 1, home, config, preflight: probe(), evaluate }, io)).toMatchObject({ ok: true, value: { ok: 3 } });
  expect(evaluate).toHaveBeenCalledTimes(3); expect(io.asked).toEqual([]);
});
it('--window overnight queues the skills without probing the agent or running anything', async () => {
  const { home, config } = await library(['alpha', 'beta']); const io = new ScriptedPrompter(); const preflight = probe(), evaluate = evaluator();
  const result = await runMany({ refs: ['alpha', 'beta'], window: 'overnight', home, config, preflight, evaluate }, io);
  expect(result).toMatchObject({ ok: true, value: { mode: 'queued', ok: 0, failed: 0, queued: [expect.objectContaining({ skill: 'alpha', window: 'overnight' }), expect.objectContaining({ skill: 'beta', window: 'overnight' })] } });
  expect(preflight).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled();
  expect((await readEvalQueue(config.root)).items.map(item => item.skill)).toEqual(['alpha', 'beta']);
  expect(io.lines).toContain('Queued 2 evals for overnight: the app runs them in parallel between 01:00 and 05:00 while it is open and idle. Run them now with `npx -y terum-skills@latest eval --drain`.');
});
it('--window later queues for a manual drain', async () => {
  const { home, config } = await library(['alpha']); const io = new ScriptedPrompter();
  expect(await runMany({ refs: ['alpha'], window: 'later', home, config, preflight: probe(), evaluate: evaluator() }, io)).toMatchObject({ ok: true, value: { mode: 'queued' } });
  expect((await readEvalQueue(config.root)).items.map(item => [item.skill, item.window])).toEqual([['alpha', 'later']]);
});
it('refuses an unknown skill before any paid work, naming it', async () => {
  const { home, config } = await library(['alpha']); const preflight = probe(), evaluate = evaluator();
  expect(await runMany({ refs: ['alpha', 'nope'], home, config, preflight, evaluate }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('`nope`') });
  expect(preflight).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled();
});
it('names each skill once even when it is passed twice', async () => {
  const { home, config } = await library(['alpha']); const evaluate = evaluator();
  expect(await runMany({ refs: ['alpha', 'alpha'], home, config, preflight: probe(), evaluate }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { skills: ['alpha'], ok: 1 } });
  expect(evaluate).toHaveBeenCalledTimes(1);
});
it.each([
  [{ refs: [] }, 'Provide at least one skill, or --pending.'],
  [{ refs: ['alpha'], window: 'overnight', batch: 2 }, '--batch and --parallel run evals now; --window queues them instead.'],
  [{ refs: ['alpha'], window: 'overnight', parallel: 2 }, '--batch and --parallel run evals now; --window queues them instead.'],
  [{ refs: ['alpha'], window: 'tonight' }, '--window must be overnight or later.'],
  [{ refs: ['alpha'], batch: 0 }, '--batch must be a positive integer.'],
  [{ refs: ['alpha'], parallel: 1.5 }, '--parallel must be a positive integer.'],
  [{ refs: ['alpha'], pending: true }, '--pending needs a team; this machine has none.'],
] as const)('rejects %j before any paid work', async (extra, error) => {
  const { home, config } = await library(['alpha']); const preflight = probe(), evaluate = evaluator();
  expect(await runMany({ ...(extra as { refs: readonly string[]; window?: string; batch?: number; parallel?: number; pending?: boolean }), home, config, preflight, evaluate }, new ScriptedPrompter())).toEqual(failure(error));
  expect(preflight).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled();
});
it('a failing agent probe stops the batch before any eval', async () => {
  const { home, config } = await library(['alpha', 'beta']); const evaluate = evaluator();
  expect(await runMany({ refs: ['alpha', 'beta'], home, config, preflight: async () => failure('claude is not runnable'), evaluate }, new ScriptedPrompter())).toEqual(failure('claude is not runnable'));
  expect(evaluate).not.toHaveBeenCalled();
});
/** A team whose shared alpha has no receipt and whose beta does, with a Library copy of each (what setup's offer sees). */
async function teamWithPending() {
  const fixture = await bareTeam();
  const source = (name: string, id: string) => `---\nname: ${name}\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;
  await pushFromSeed(fixture.seed, 'skills/alpha/v1/SKILL.md', source('alpha', pendingIds[0]!));
  await pushFromSeed(fixture.seed, 'skills/beta/v1/SKILL.md', source('beta', pendingIds[1]!));
  const receipt = receiptSchema.parse({ schema_version: 1, skill_id: pendingIds[1], skill_name: 'beta', version: 'v1', run_id: '20260101T000000Z', verdict: 'PASS', attribution: 'test receipt', execution_status: 'complete', expected_rows: 0, scored_rows: 0, comparisons: {}, arm_scores: {}, triggers: null, efficiency: {}, provenance: { engine_version: 'test', engine_commit: 'unknown', cc_version: 'test', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-01-01T00:00:00Z', runner_handle: 'alice' } });
  await pushFromSeed(fixture.seed, `evals/${pendingIds[1]}/v1/20260101T000000Z.json`, JSON.stringify(receipt));
  const config = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, config.teamClone('team'));
  await config.update(c => { c.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const home = await temporaryDirectory();
  for (const [name, id] of [['alpha', pendingIds[0]!], ['beta', pendingIds[1]!]] as const) { const path = join(home, '.claude', 'skills', name); await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), source(name, id)); }
  return { config, home, seed: fixture.seed, receipt: (id: string, name: string) => JSON.stringify(receiptSchema.parse({ ...receipt, skill_id: id, skill_name: name })) };
}
it('--pending evaluates the shared skills with no receipt for their current version, under the team, and nothing else', async () => {
  const { config, home } = await teamWithPending(); const io = new ScriptedPrompter(); const evaluate = evaluator();
  const result = await runMany({ refs: [], pending: true, home, config, preflight: probe(), evaluate }, io);
  expect(result).toMatchObject({ ok: true, value: { mode: 'ran', team: 'team', skills: ['alpha'], ok: 1, failed: 0 } });
  expect(evaluate).toHaveBeenCalledTimes(1); expect(evaluate.mock.calls[0]![0]).toMatchObject({ ref: 'alpha', team: 'team' });
});
it('--pending merges with named skills without evaluating one twice, and --window queues the union', async () => {
  const { config, home } = await teamWithPending(); const io = new ScriptedPrompter();
  const result = await runMany({ refs: ['alpha', 'beta'], pending: true, window: 'overnight', home, config, preflight: probe(), evaluate: evaluator() }, io);
  expect(result).toMatchObject({ ok: true, value: { mode: 'queued', team: 'team', skills: ['alpha', 'beta'] } });
  expect((await readEvalQueue(config.root)).items.map(item => [item.team, item.skill, item.window])).toEqual([['team', 'alpha', 'overnight'], ['team', 'beta', 'overnight']]);
});
it('--pending on a fully receipted team says so and runs nothing', async () => {
  const { config, home, seed, receipt } = await teamWithPending(); const io = new ScriptedPrompter(); const evaluate = evaluator(), preflight = probe();
  await pushFromSeed(seed, `evals/${pendingIds[0]}/v1/20260102T000000Z.json`, receipt(pendingIds[0]!, 'alpha'));
  expect(await runMany({ refs: [], pending: true, home, config, preflight, evaluate }, io)).toEqual(success({ mode: 'ran', team: 'team', skills: [], ok: 0, failed: 0, queued: [] }));
  expect(io.lines).toContain('Every shared skill already has an eval receipt for its current version.');
  expect(preflight).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled();
});
