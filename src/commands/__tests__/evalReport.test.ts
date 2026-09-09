import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { bareTeam, cloneWithIdentity, git, pushFromSeed, ScriptedPrompter, denyingRunner } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';
import { run } from '../evalReport.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ids = ['20260907T010000Z', '20260907T020000Z'];
const skill = `---\nname: sample\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nbody\n`;
function receipt(version: string, run_id: string) {
  return receiptSchema.parse({
    schema_version: 1, skill_id: ID, skill_name: 'sample', version, run_id,
    verdict: 'PASS', attribution: 'test', execution_status: 'complete', expected_rows: 1, scored_rows: 1,
    comparisons: {}, arm_scores: {}, triggers: null, efficiency: {}, future: { retained: true },
    provenance: { engine_version: '0.1.7', engine_commit: 'unknown', cc_version: 'stub', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-09-07T00:00:00Z', runner_handle: 'seed' },
  });
}
async function setup(newest?: string, receipts = true) {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill);
  const tree = (await git(['rev-parse', 'HEAD:skills/sample'], fixture.seed)).trim();
  if (receipts) for (const id of ids) await pushFromSeed(fixture.seed, `evals/${ID}/${tree}/${id}.json`, JSON.stringify(receipt(tree, id)));
  if (newest !== undefined) await pushFromSeed(fixture.seed, `evals/${ID}/${tree}/20260907T030000Z.json`, newest);
  const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update(c => { c.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const runner = denyingRunner([{ command: 'git', argsPrefix: ['rev-parse', '--verify', 'HEAD:skills/sample'] }], systemRunner);
  return { store, clone, tree, runner };
}

describe('eval-report offline read model', () => {
  it('selects the newest committed receipt, preserves passthrough fields, and reads without prompts or fetch', async () => {
    const { store, clone, tree, runner } = await setup(); const io = new ScriptedPrompter();
    const before = await readFile(join(store.root, 'config.json'), 'utf8');
    const result = await run({ ref: 'sample', config: store, runner }, io);
    expect(result).toMatchObject({ ok: true, value: { skill: { id: ID, name: 'sample' }, latestState: 'ok', latest: { ...receipt(tree, ids[1]!), path: join(clone, 'evals', ID, tree, `${ids[1]}.json`) }, versions: { teamCurrent: tree, evaluated: tree, placed: null }, localRuns: [] } });
    expect(result.value?.history).toEqual([...ids].reverse().map(run_id => ({ version: tree, run_id, verdict: 'PASS', execution_status: 'complete', model: 'sonnet', cc_version: 'stub', runner_handle: 'seed', timestamp: '2026-09-07T00:00:00Z', comparison: null, committed: true })));
    expect(io.asked).toEqual([]); expect(io.lines).toEqual([]);
    expect(await readFile(join(store.root, 'config.json'), 'utf8')).toBe(before);
  });

  it.each(['{"nope":true}', '{'])('never substitutes an older receipt when the newest is invalid (%s)', async newest => {
    const { store, clone, tree, runner } = await setup(newest); const io = new ScriptedPrompter();
    const result = await run({ ref: ID, config: store, runner }, io);
    expect(result).toMatchObject({ ok: true, value: { latestState: 'invalid', latest: null, versions: { evaluated: null } } });
    expect(result.value?.history.map(row => row.run_id)).toEqual([...ids].reverse());
    expect(io.lines).toEqual([expect.stringContaining(join(clone, 'evals', ID, tree, '20260907T030000Z.json'))]);
    expect(io.asked).toEqual([]);
  });

  it('reports placed and current versions independently', async () => {
    const { store, tree, runner } = await setup();
    await store.update(c => { c.placements['/tmp/x'] = { id: ID, team: 'team', version: 'a'.repeat(40), scope: { kind: 'global' }, placed_at: '2026-09-07T00:00:00Z', fingerprint: 'test' }; });
    expect(await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { versions: { placed: 'a'.repeat(40), teamCurrent: tree } } });
  });

  it.each(['skill_id', 'version'] as const)('rejects a newest receipt with mismatched %s without substituting history', async field => {
    const { store, clone, tree, runner } = await setup();
    const path = join(clone, 'evals', ID, tree, '20260907T030000Z.json');
    await writeFile(path, JSON.stringify({ ...receipt(tree, '20260907T030000Z'), [field]: field === 'version' ? 'b'.repeat(40) : '22222222-2222-4222-8222-222222222222' }));
    const io = new ScriptedPrompter();
    expect(await run({ ref: 'sample', config: store, runner }, io)).toMatchObject({ ok: true, value: { latestState: 'invalid', latest: null, versions: { evaluated: null } } });
    expect(io.lines).toEqual([expect.stringContaining(path)]);
  });

  it('lists valid history across tree directories and ignores other directories and non-JSON files', async () => {
    const { store, clone, tree, runner } = await setup();
    for (const directory of ['b'.repeat(40), 'not-a-tree']) {
      const path = join(clone, 'evals', ID, directory); await mkdir(path);
      await writeFile(join(path, '20260907T030000Z.json'), JSON.stringify(receipt('b'.repeat(40), '20260907T030000Z')));
    }
    await writeFile(join(clone, 'evals', ID, tree, '20260907T040000Z.txt'), JSON.stringify(receipt(tree, '20260907T040000Z')));
    const result = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter());
    expect(result.value?.history.map(row => [row.version, row.run_id])).toEqual([['b'.repeat(40), '20260907T030000Z'], [tree, ids[1]], [tree, ids[0]]]);
    expect(result.value?.latest?.run_id).toBe(ids[1]);
  });

  it('lists local runs only with run.jsonl and gets status from receipt.json, never the log', async () => {
    const { store, tree, runner } = await setup();
    for (const id of [...ids, '20260907T030000Z', '20260907T040000Z']) {
      const dir = join(store.root, 'evals', 'team', ID, id); await mkdir(dir, { recursive: true });
      if (id !== '20260907T040000Z') await writeFile(join(dir, 'run.jsonl'), '{"execution_status":"complete"}\n');
      if (id === ids[1]) await writeFile(join(dir, 'receipt.json'), JSON.stringify({ ...receipt(tree, id), execution_status: 'partial' }));
      if (id === '20260907T030000Z') await writeFile(join(dir, 'receipt.json'), '{');
    }
    const result = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter());
    expect(result.value?.localRuns).toEqual([
      { run_id: '20260907T030000Z', run_dir: join(store.root, 'evals', 'team', ID, '20260907T030000Z'), execution_status: 'unknown', committed: false, receipt: null },
      expect.objectContaining({ run_id: ids[1], execution_status: 'partial', committed: true, receipt: expect.objectContaining({ path: join(store.root, 'evals', 'team', ID, ids[1]!, 'receipt.json') }) }),
      expect.objectContaining({ run_id: ids[0], execution_status: 'unknown', committed: true, receipt: null }),
    ]);
  });

  it('has no latest when there are no receipts and uses eval’s missing skill message', async () => {
    const { store, runner } = await setup(undefined, false);
    expect(await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { latest: null, latestState: 'none', history: [], versions: { evaluated: null } } });
    expect(await run({ ref: 'missing', config: store, runner }, new ScriptedPrompter())).toEqual({ ok: false, error: 'No skill named or identified by missing exists in team team.' });
  });
});

 it('carries the baseline comparison and provenance verbatim in history', async () => {
  const { store, clone, tree, runner } = await setup();
  const comparison = { win: 4, loss: 1, tie: 2, net_lift: 3 / 7, sign_p: 0.375 };
  const row = receipt(tree, ids[1]!);
  row.comparisons['candidate-vs-baseline'] = comparison;
  await writeFile(join(clone, 'evals', ID, tree, `${ids[1]}.json`), JSON.stringify(row));
  const result = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter());
  expect(result.value?.history[0]).toMatchObject({ comparison, runner_handle: row.provenance.runner_handle, timestamp: row.provenance.timestamp });
 });
