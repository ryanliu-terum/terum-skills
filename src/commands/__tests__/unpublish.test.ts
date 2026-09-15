import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, mappedRunner, originSha, person, pushFromSeed, ScriptedPrompter, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { runUnpublish } from '../unpublish.js';

const REMOTE = 'https://github.com/acme/team.git';
const ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '99999999-8888-4777-8666-555555555555';

const skillMd = (name: string, id: string, body: string) => `---
name: ${name}
description: A skill.
license: UNLICENSED
metadata:
  id: ${id}
  author: Seed <seed@example.com>
  terum-category: General
---
${body}
`;

/**
 * A team whose marketplace holds `deploy-check` at v1 and v2 — with an eval asset, a receipt, a
 * project listing and a member endorsement — plus a second skill that must survive untouched.
 */
async function published() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/deploy-check/v1/SKILL.md', skillMd('deploy-check', ID, 'One.'));
  await pushFromSeed(fixture.seed, 'skills/deploy-check/v2/SKILL.md', skillMd('deploy-check', ID, 'Two.'));
  await pushFromSeed(fixture.seed, 'skills/deploy-check/evals/cases/smoke.md', 'a case\n');
  await pushFromSeed(fixture.seed, `evals/${ID}/v2/20260914T101500Z.json`, `${JSON.stringify({ skill_id: ID, version: 'v2' })}\n`);
  await pushFromSeed(fixture.seed, 'skills/keeper/v1/SKILL.md', skillMd('keeper', OTHER_ID, 'Keep.'));
  await pushFromSeed(fixture.seed, `evals/${OTHER_ID}/v1/20260914T101500Z.json`, `${JSON.stringify({ skill_id: OTHER_ID, version: 'v1' })}\n`);
  await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ ...TEAM_JSON, projects: { Global: { remotes: [], skills: [ID, OTHER_ID] }, Payments: { remotes: [], skills: [OTHER_ID] } } })}\n`);
  await pushFromSeed(fixture.seed, 'people/seed.json', `${JSON.stringify(person('seed', { profile: [{ id: ID, name: 'deploy-check', version: 'v2', added: '2026-09-14', via: 'publish' }, { id: OTHER_ID, name: 'keeper', version: 'v1', added: '2026-09-14', via: 'publish' }] }))}\n`);
  await pushFromSeed(fixture.seed, 'people/mira.json', `${JSON.stringify(person('mira', { profile: [{ id: ID, name: 'deploy-check', version: 'v1', added: '2026-09-14', via: 'install' }] }))}\n`);
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: REMOTE, handle: 'seed' }; });
  return { fixture, store, runner: mappedRunner(REMOTE, fixture.bare) };
}

/** The origin's tracked paths, so a removal is asserted against what was actually pushed. */
async function pathsOnOrigin(seed: string): Promise<string[]> {
  await git(['fetch', '-q', 'origin'], seed);
  return (await git(['ls-tree', '-r', '--name-only', 'origin/main'], seed)).split('\n').filter(Boolean);
}
async function showOnOrigin(seed: string, path: string): Promise<string> {
  await git(['fetch', '-q', 'origin'], seed);
  return git(['show', `origin/main:${path}`], seed);
}

describe('unpublish (2026-09-14: anyone may retract a skill)', () => {
  it('removes every version, its assets, receipts, listings and endorsements in one commit', async () => {
    const { fixture, store, runner } = await published();
    const io = new ScriptedPrompter(['deploy-check'], [], true);

    const result = await runUnpublish({ ref: 'deploy-check', config: store, runner }, io);

    expect(result).toMatchObject({ ok: true, value: { team: 'team', id: ID, name: 'deploy-check', versions: ['v2', 'v1'], evalAssets: 1, receipts: 1, projects: ['Global'], profiles: 2 } });
    const paths = await pathsOnOrigin(fixture.seed);
    expect(paths.filter((path) => path.startsWith('skills/deploy-check/'))).toEqual([]);
    expect(paths.filter((path) => path.startsWith(`evals/${ID}/`))).toEqual([]);
    // The other skill is untouched in all four places the retracted one was named.
    expect(paths).toContain('skills/keeper/v1/SKILL.md');
    expect(paths).toContain(`evals/${OTHER_ID}/v1/20260914T101500Z.json`);
    const team = JSON.parse(await showOnOrigin(fixture.seed, 'team.json')) as { projects: Record<string, { skills: string[] }> };
    expect(team.projects.Global!.skills).toEqual([OTHER_ID]);
    expect(team.projects.Payments!.skills).toEqual([OTHER_ID]);
    const seedPerson = JSON.parse(await showOnOrigin(fixture.seed, 'people/seed.json')) as { profile: { id: string }[]; installed: unknown[] };
    expect(seedPerson.profile.map((entry) => entry.id)).toEqual([OTHER_ID]);
    const mira = JSON.parse(await showOnOrigin(fixture.seed, 'people/mira.json')) as { profile: unknown[] };
    expect(mira.profile).toEqual([]);
  });

  it('says what it removed and that installed copies survive until each machine syncs', async () => {
    const { store, runner } = await published();
    const io = new ScriptedPrompter(['deploy-check'], [], true);

    await runUnpublish({ ref: 'deploy-check', config: store, runner }, io);

    expect(io.lines).toContain('Unpublished deploy-check from the team marketplace: removed 2 versions.');
    expect(io.lines).toContain('Also removed 1 eval asset file(s) and 1 eval receipt(s).');
    expect(io.lines).toContain('Removed it from Global.');
    expect(io.lines).toContain('Removed it from 2 member profile(s).');
    expect(io.lines).toContain('Machines that installed deploy-check keep their copy until they sync, which reports it as removed from the team.');
  });

  it('writes nothing when the typed name does not match', async () => {
    const { fixture, store, runner } = await published();
    const before = await originSha(fixture.bare);
    const io = new ScriptedPrompter(['deploy-chek'], [], true);

    const result = await runUnpublish({ ref: 'deploy-check', config: store, runner }, io);

    expect(result).toMatchObject({ ok: false, error: 'deploy-check was not unpublished.' });
    expect(await originSha(fixture.bare)).toBe(before);
    expect(io.lines).toContain('This removes ALL 2 versions of deploy-check from the team marketplace, for everyone.');
  });

  it('refuses to run unattended without --yes, and runs with it', async () => {
    const { fixture, store, runner } = await published();
    const before = await originSha(fixture.bare);

    const refused = await runUnpublish({ ref: 'deploy-check', config: store, runner }, new ScriptedPrompter());
    expect(refused).toMatchObject({ ok: false, error: 'Refusing to unpublish deploy-check without confirmation; pass --yes.' });
    expect(await originSha(fixture.bare)).toBe(before);

    const allowed = await runUnpublish({ ref: 'deploy-check', yes: true, config: store, runner }, new ScriptedPrompter());
    expect(allowed.ok).toBe(true);
    expect(await originSha(fixture.bare)).not.toBe(before);
  });

  it('refuses a skill the marketplace never published, without touching the repository', async () => {
    const { fixture, store, runner } = await published();
    const before = await originSha(fixture.bare);

    const result = await runUnpublish({ ref: 'nope', yes: true, config: store, runner }, new ScriptedPrompter());

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toMatch(/team has no published skill named nope/);
    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('retracts a skill that is in no project list and on nobody profile', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/lonely/v1/SKILL.md', skillMd('lonely', ID, 'Alone.'));
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: REMOTE, handle: 'seed' }; });

    const result = await runUnpublish({ ref: 'lonely', yes: true, config: store, runner: mappedRunner(REMOTE, fixture.bare) }, new ScriptedPrompter());

    expect(result).toMatchObject({ ok: true, value: { versions: ['v1'], evalAssets: 0, receipts: 0, projects: [], profiles: 0 } });
    expect(await pathsOnOrigin(fixture.seed)).not.toContain('skills/lonely/v1/SKILL.md');
  });
});
