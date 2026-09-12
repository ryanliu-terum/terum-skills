import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../ls.js';
import { pendingIds, pendingReceipt, pendingSkill, seedPending } from './pending-eval-fixtures.js';

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

describe('ls carries each skill\'s current-version receipt (card lift)', () => {
  // D60/§8.2. The real stale walk: a receipt under v1 while the skill's latest version is v3. The
  // existing `older` fixture parks its receipt under `evals/<id>/archive/<40-hex>/`, a folder the
  // version walk never visits, so nothing exercised this branch before.
  it('renders no receipt when the newest usable eval belongs to an older version, until B4 ships the disclosure', async () => {
    const fixture = await team();
    await pendingSkill(fixture.seed, 'alpha', pendingIds[0]!, 'v3');
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'alpha v3'], fixture.seed);
    await pendingReceipt(fixture.seed, { version: 'v1', scored: true });
    const { skills } = await skillsOf(await reader(fixture));
    const alpha = skills.find((skill) => skill.name === 'alpha');
    expect(alpha).toMatchObject({ latest: 'v3' });
    // §8.2: "a card showing v3's score next to a v5 install button is a claim about bytes the user
    // will not receive", and the version label is the only thing that keeps the reversal honest. That
    // label ships with B4, so on this branch the honest render is the same "—" main shows today.
    expect(alpha?.receipt).toBeNull();
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

  it('leaves the limb null when the only receipt belongs to an older version', async () => {
    const fixture = await team();
    await pendingReceipt(fixture.seed, { older: true, scored: true });
    const { skills, problems } = await skillsOf(await reader(fixture));
    // A receipt for a tree that is no longer current describes code the card is not showing.
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
