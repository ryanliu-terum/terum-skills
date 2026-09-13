import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../ls.js';
import { measuredReceipt, pendingIds, pendingReceipt, pendingSkill, seedPending } from './pending-eval-fixtures.js';

/** A two-skill team (alpha, beta), pushed and cloned, with `ls` ready to read it. */
async function team() {
  const fixture = await bareTeam();
  const config = { layout_version: 3, name: 'team', categories: [], projects: { Global: { remotes: [], skills: pendingIds } }, archived: [] as string[], policy: { skill_license: 'UNLICENSED' } };
  await writeFile(join(fixture.seed, 'team.json'), `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(join(fixture.seed, 'people', 'amy.json'), `${JSON.stringify(person('amy', { display_name: 'Amy', installed: [] }), null, 2)}\n`);
  await seedPending(fixture.seed);
  return fixture;
}

/** Push the seed and hand back a config store whose `team` clone mirrors it. */
async function reader(fixture: Awaited<ReturnType<typeof team>>) {
  await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
  const store = createConfigStore(join(fixture.root, 'local'));
  await store.ensureRoot();
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'amy' }; });
  return store;
}

const skillsOf = async (store: Awaited<ReturnType<typeof reader>>, io = new ScriptedPrompter()) => {
  const result = await run({ config: store }, io);
  if (!result.ok) throw new Error(result.error);
  return { skills: result.value.skills, problems: result.value.problems, lines: io.lines };
};

describe('ls carries the selected published-version receipt (card lift)', () => {
  // §8.1/§8.2 through a real pushed clone: a receipt under v1 while the skill's latest version is v3.
  // The `older` fixture parks its receipt under `evals/<id>/archive/<40-hex>/`, a folder the version
  // walk never visits, so this is the one stale-walk test that goes through git rather than a local
  // directory. On B3 this rendered null under D60's gate; B4 ships the disclosure limbs, so the older
  // receipt is shown together with the version it belongs to and the state of the latest.
  it('renders the older version\'s receipt with the disclosure limbs when the newest usable eval is stale', async () => {
    const fixture = await team();
    await pendingSkill(fixture.seed, 'alpha', pendingIds[0]!, 'v3');
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'alpha v3'], fixture.seed);
    await pendingReceipt(fixture.seed, { version: 'v1', scored: true });
    const { skills, problems } = await skillsOf(await reader(fixture));
    const alpha = skills.find((skill) => skill.name === 'alpha');
    expect(alpha).toMatchObject({ latest: 'v3', latestVersion: 'v3', evalVersion: 1, latestEvalState: 'none' });
    expect(alpha?.receipt).not.toBeNull();
    expect(problems).toEqual([]);
  });

  it('reports the receipt\'s own comparison, arm scores and provenance for the evaluated skill, and null for the unevaluated one', async () => {
    const fixture = await team();
    await pendingReceipt(fixture.seed, { scored: true });
    const { skills, problems } = await skillsOf(await reader(fixture));

    const alpha = skills.find((skill) => skill.name === 'alpha')!;
    expect(alpha.receipt).toEqual({
      run_id: '20260101T000000Z',
      verdict: 'PASS',
      execution_status: 'complete',
      expected_rows: 0,
      scored_rows: 0,
      comparisons: { 'candidate-vs-baseline': { win: 7, loss: 2, tie: 1, net_lift: 0.5, sign_p: 0.09 } },
      arm_scores: { candidate: 0.82, baseline: 0.61 },
      provenance: { model: 'sonnet', k: 1, cc_version: 'test', timestamp: '2026-01-01T00:00:00Z', runner_handle: 'alice' },
    });
    // A skill nobody has evaluated is the honest "—" state, not a zero.
    expect(skills.find((skill) => skill.name === 'beta')!.receipt).toBeNull();
    expect(problems).toEqual([]);
  });

  it('leaves the limb null when the only receipt is archived', async () => {
    const fixture = await team();
    await pendingReceipt(fixture.seed, { older: true, scored: true });
    const { skills, problems } = await skillsOf(await reader(fixture));
    // An archived tree hash is not a published ordinal and is never read.
    expect(skills.find((skill) => skill.name === 'alpha')!.receipt).toBeNull();
    expect(problems).toEqual([]);
  });

  it('reports an unreadable receipt as that skill\'s problem and still lists every skill', async () => {
    const fixture = await team();
    // §3.4: receipts are filed under the version FOLDER.
    const version = 'v1';
    const directory = join(fixture.seed, 'evals', pendingIds[0]!, version);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '20260101T000000Z.json'), '{ not json');
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'broken receipt'], fixture.seed);

    const { skills, problems, lines } = await skillsOf(await reader(fixture));
    // One corrupt file costs its own card's number and nothing else.
    expect(skills.map((skill) => skill.name)).toEqual(['alpha', 'beta']);
    expect(skills.find((skill) => skill.name === 'alpha')!.receipt).toBeNull();
    expect(problems).toEqual([{ source: `evals/${pendingIds[0]}`, message: expect.stringContaining('invalid JSON') }]);
    expect(lines.some((line) => line.startsWith('alpha: schema-invalid receipt'))).toBe(true);
  });

  it('reports a receipt whose recorded skill id disagrees with its path rather than showing its numbers', async () => {
    const fixture = await team();
    // The receipt is valid JSON and schema-valid, but filed under alpha while naming beta's id.
    await pendingReceipt(fixture.seed, { scored: true, id: pendingIds[1] });
    // §3.4: receipts are filed under the version FOLDER.
    const version = 'v1';
    await rm(join(fixture.seed, 'evals', pendingIds[1]!, version), { recursive: true, force: true });
    const directory = join(fixture.seed, 'evals', pendingIds[0]!, version);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '20260101T000000Z.json'), JSON.stringify({
      schema_version: 1, skill_id: pendingIds[1], skill_name: 'beta', version, run_id: '20260101T000000Z', verdict: 'PASS',
      attribution: 'misfiled', execution_status: 'complete', expected_rows: 0, scored_rows: 0,
      comparisons: { 'candidate-vs-baseline': { win: 9, loss: 0, tie: 0, net_lift: 0.9, sign_p: 0.01 } }, arm_scores: {}, triggers: null, efficiency: {},
      provenance: { engine_version: 'test', engine_commit: 'unknown', cc_version: 'test', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-01-01T00:00:00Z', runner_handle: 'alice' },
    }));
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'misfiled receipt'], fixture.seed);

    const { skills, problems } = await skillsOf(await reader(fixture));
    expect(skills.find((skill) => skill.name === 'alpha')!.receipt).toBeNull();
    expect(problems).toEqual([{ source: `evals/${pendingIds[0]}`, message: expect.stringContaining('misfiled receipt') }]);
  });
});

// B4's full fallback matrix uses a local checkout-shaped directory: no child process is needed.
describe('§8.1 card eval fallback', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
  async function listing(entries: { folder: string; receipt?: unknown; file?: string }[], versions = ['v10', 'v3', 'v2', 'v1']) {
    const root = await mkdtemp(join(tmpdir(), 'b4-card-')); roots.push(root);
    const store = createConfigStore(join(root, 'state'));
    await store.update(config => { config.teams.team = { remote: '/local/team.git', handle: 'amy' }; });
    const clone = store.teamClone('team');
    await mkdir(join(clone, 'people'), { recursive: true });
    await writeFile(join(clone, 'team.json'), JSON.stringify({ layout_version: 3, name: 'team', categories: [], projects: { Global: { remotes: [], skills: [] } }, archived: [], policy: { skill_license: 'UNLICENSED' } }));
    for (const version of versions) await pendingSkill(clone, 'alpha', pendingIds[0]!, version);
    for (const entry of entries) {
      const dir = join(clone, 'evals', pendingIds[0]!, entry.folder);
      await mkdir(dir, { recursive: true });
      if (entry.receipt !== undefined) await writeFile(join(dir, entry.file ?? '20260909T000000Z.json'), JSON.stringify(entry.receipt));
    }
    const result = await run({ config: store, runner: { run: async () => ({ code: 0, stdout: '2026-09-09T00:00:00Z', stderr: '' }) } }, new ScriptedPrompter());
    if (!result.ok) throw new Error(result.error);
    return { card: result.value.skills[0]!, problems: result.value.problems };
  }
  const receipt = (version: string) => ({ ...measuredReceipt(1, 100), version });
  it.each([{ entries: [] }, { entries: [{ folder: 'v10' }] }])('has no score for absent or empty receipt directories: %j', async ({ entries }) => {
    const { card, problems } = await listing(entries);
    expect(card).toMatchObject({ receipt: null, evalVersion: null, latestVersion: 'v10', latest: 'v10', versionCount: 4, latestEvalState: 'none' });
    expect(problems).toEqual([]);
  });
  it('uses the latest numeric version at parity and its newest run', async () => {
    const newest = { ...receipt('v10'), run_id: '20260910T000000Z', verdict: 'FAIL' };
    const { card } = await listing([{ folder: 'v10', receipt: receipt('v10') }, { folder: 'v10', receipt: newest, file: '20260910T000000Z.json' }, { folder: 'v3', receipt: receipt('v3') }]);
    expect(card).toMatchObject({ evalVersion: 10, latestEvalState: 'ok', receipt: { run_id: newest.run_id, verdict: 'FAIL' } });
  });
  it('descends in numeric version order when the latest has no receipt', async () => {
    const { card } = await listing([{ folder: 'v3', receipt: receipt('v3') }, { folder: 'v2', receipt: receipt('v2') }]);
    expect(card).toMatchObject({ evalVersion: 3, latestVersion: 'v10', latestEvalState: 'none', receipt: { run_id: '20260909T000000Z' } });
  });
  it('fails closed for an invalid newest file, not the whole history or an older file in that version', async () => {
    const { card, problems } = await listing([{ folder: 'v10', receipt: receipt('v10') }, { folder: 'v10', receipt: { schema_version: 1 }, file: '20260910T000000Z.json' }, { folder: 'v3', receipt: { schema_version: 1 } }, { folder: 'v2', receipt: receipt('v2') }]);
    expect(card).toMatchObject({ evalVersion: 2, latestEvalState: 'invalid' });
    expect(problems).toHaveLength(2);
    expect(problems.every(p => p.message.includes('schema-invalid receipt'))).toBe(true);
  });
  it('does not label an unevaluated latest invalid when an older version is corrupt', async () => {
    const { card } = await listing([{ folder: 'v3', receipt: {} }, { folder: 'v2', receipt: receipt('v2') }]);
    expect(card).toMatchObject({ evalVersion: 2, latestEvalState: 'none' });
  });
  it.each([{ skill_id: pendingIds[1] }, { version: 'v3' }, { schema_version: 2, skill_id: null, content_digest: 'sha256:' + 'a'.repeat(64) }])('reports misfiled latest %j and falls back', async override => {
    const { card, problems } = await listing([{ folder: 'v10', receipt: { ...receipt('v10'), ...override } }, { folder: 'v1', receipt: receipt('v1') }]);
    expect(card).toMatchObject({ evalVersion: 1, latestEvalState: 'invalid' });
    expect(problems).toEqual([{ source: `evals/${pendingIds[0]}`, message: expect.stringContaining('misfiled receipt') }]);
  });
  it('does not render a null-id receipt under v1 or inspect receipts for absent versions', async () => {
    const { card, problems } = await listing([{ folder: 'v1', receipt: { ...receipt('v1'), schema_version: 2, skill_id: null, content_digest: 'sha256:' + 'a'.repeat(64) } }, { folder: 'v99', receipt: receipt('v99') }], ['v1']);
    expect(card).toMatchObject({ receipt: null, evalVersion: null, latestEvalState: 'invalid' });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('misfiled receipt');
  });
});
