import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as publish } from '../commands/publish.js';
import { run as connect } from '../commands/connect.js';
import { run as sync } from '../commands/sync.js';
import { createConfigStore } from '../lib/config.js';
import { bareTeam, cloneWithIdentity, git, mappedRunner, person, pushFromSeed, ScriptedPrompter } from '../lib/__tests__/fixtures.js';

const REMOTE = 'https://github.com/acme/team.git';

describe('M3 publish walkthrough (§12)', () => {
  it('publishes by PR and offers the merged endorsement to a teammate once', async () => {
    const fixture = await bareTeam();
    const aHome = join(fixture.root, 'a-home'); const bHome = join(fixture.root, 'b-home');
    const aStore = createConfigStore(join(aHome, '.terum', 'skills'));
    await cloneWithIdentity(fixture.bare, aStore.teamClone('team'), 'Alice', 'alice@example.com');
    await aStore.update((config) => { config.display_name = 'Alice'; config.email = 'alice@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample'); await mkdir(source); await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: sample\nmetadata:\n  terum-category: testing\n---\n');
    const shared = await connect({ path: source, team: 'team', config: aStore }, new ScriptedPrompter([], [true]));
    if (!shared.ok || !shared.value) throw new Error(shared.ok ? 'connect returned no skill' : shared.error);
    const sharedSkill = shared.value;
    await aStore.update((config) => { config.teams.team!.remote = REMOTE; });
    const published = await publish({ ref: 'sample', config: aStore, runner: mappedRunner(REMOTE, fixture.bare) }, new ScriptedPrompter());
    // One fresh branch per publish (R2): the name is minted per run, so the walkthrough follows the result.
    expect(published).toMatchObject({ ok: true, value: { branch: expect.stringMatching(/^publish\/sample-seed-[0-9a-f]{8}$/) } });
    const endorsementBranch = published.ok ? published.value.branch! : '';
    await git(['fetch', 'origin'], fixture.seed);
    await git(['push', 'origin', `refs/remotes/origin/${endorsementBranch}:main`], fixture.seed);
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).global).toContain(sharedSkill.id);

    await pushFromSeed(fixture.seed, 'people/bob.json', `${JSON.stringify(person('bob', { display_name: 'Bob', email: 'bob@example.com', github: 'bob' }))}\n`);
    const bStore = createConfigStore(join(bHome, '.terum', 'skills'));
    await cloneWithIdentity(fixture.bare, bStore.teamClone('team'), 'Bob', 'bob@example.com');
    await bStore.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'bob' }; });
    const first = new ScriptedPrompter([], [true], true);
    await expect(sync({ config: bStore }, first)).resolves.toMatchObject({ ok: true });
    expect(first.countAsked('Install 1 newly endorsed skill(s) from team?')).toBe(1);
    expect(await git(['show', 'main:people/bob.json'], fixture.bare)).toContain(sharedSkill.id);
    await expect(access(join(bHome, '.claude', 'skills', 'sample', 'SKILL.md'))).resolves.toBeUndefined();
    // Offered once: an interactive second sync with no scripted answers would throw if it asked again, and defers nothing.
    await expect(sync({ config: bStore }, new ScriptedPrompter([], [], true))).resolves.toMatchObject({ ok: true, value: { placed: 0, deferred: [] } });
  });
});
