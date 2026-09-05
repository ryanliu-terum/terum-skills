import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../uninstall.js';
import { run as install } from '../install.js';
import { run as sync } from '../sync.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter, temporaryDirectory, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';

describe('uninstall (§6 pending)', () => {
  it('requires an unambiguous configured team before changing local provenance', async () => {
    const result = await run({ ref: 'sample', config: createConfigStore(await temporaryDirectory()) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('ambiguous') });
  });

  it('uninstalls all of a member\'s skills with one team-repo write', async () => {
    const fixture = await bareTeam();
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    for (const [name, id] of [['first', first], ['second', second]] as const) await pushFromSeed(fixture.seed, `skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'people/seed.json', `${JSON.stringify(person('seed', { installed: [
      { id: first, version: null, scope: { kind: 'global' }, since: '2026-09-04' },
      { id: second, version: null, scope: { kind: 'global' }, since: '2026-09-04' },
    ] }), null, 2)}\n`);
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const home = join(fixture.root, 'home');
    await store.update((config) => {
      config.teams.team = { remote: fixture.bare, handle: 'seed' };
      config.placements[join(home, '.claude', 'skills', 'first')] = { id: first, team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-09-04', fingerprint: 'sha256:first' };
      config.placements[join(home, '.claude', 'skills', 'second')] = { id: second, team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-09-04', fingerprint: 'sha256:second' };
    });
    const commitsBefore = Number((await git(['rev-list', '--count', 'main'], fixture.bare)).trim());
    const result = await run({ kind: 'member', member: 'seed', team: 'team', config: store, home }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: [{ id: first }, { id: second }] });
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
    // One write for the whole member, not one push per skill (M2 review 4b, D9 sweep).
    expect(Number((await git(['rev-list', '--count', 'main'], fixture.bare)).trim())).toBe(commitsBefore + 1);
    expect((await store.read()).pending).toEqual([]);
    expect((await store.read()).placements).toEqual({});
  });

  it('keeps an interrupted uninstall gone and completes its people-file removal from pending intent', async () => {
    const fixture = await bareTeam();
    const id = '33333333-3333-4333-8333-333333333333';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(home, '.terum', 'skills'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: store }, new ScriptedPrompter())).ok).toBe(true);
    let clock = 0;
    const rejecting = wrapRunner(systemRunner, async (command, args, _options, next) => command === 'git' && args[0] === 'push'
      ? { code: 1, stdout: '', stderr: ' ! [rejected] HEAD -> main (non-fast-forward)' }
      : next());
    const interrupted = await run({ ref: 'sample', team: 'team', config: store, runner: rejecting, safeWrite: { deadlineMs: 1, now: () => clock, sleep: async () => { clock = 2; } } }, new ScriptedPrompter());
    expect(interrupted.ok).toBe(false);
    const path = join(home, '.claude', 'skills', 'sample');
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.read()).placements).toEqual({});
    expect((await store.read()).pending).toHaveLength(1);
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect((await store.read()).pending).toEqual([]);
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('declines an automatically endorsed uninstall, preserves approval, and clears the decline on explicit reinstall', async () => {
    const fixture = await bareTeam();
    const id = '66666666-6666-4666-8666-666666666666';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nallowed-tools: Bash(ls)\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [id], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const approved = (await store.read()).approvals[id];
    expect((await run({ ref: 'sample', team: 'team', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    expect(JSON.parse(await readFile(join(store.teamClone('team'), 'people', 'seed.json'), 'utf8')).declined).toContain(id);
    expect((await store.read()).approvals[id]).toEqual(approved);
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    expect(JSON.parse(await readFile(join(store.teamClone('team'), 'people', 'seed.json'), 'utf8')).declined).not.toContain(id);
    expect((await store.read()).approvals[id]).toEqual(approved);
  });

  it('declines a project-list uninstall but not a personal uninstall, while removing both placements and retaining approval', async () => {
    const fixture = await bareTeam();
    const product = await bareTeam();
    const projectId = '77777777-7777-4777-8777-777777777777';
    const personalId = '88888888-8888-4888-8888-888888888888';
    for (const [name, id] of [['projected', projectId], ['personal', personalId]] as const) {
      await pushFromSeed(fixture.seed, `skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name}\nlicense: UNLICENSED\nallowed-tools: Bash(ls)\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    }
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [product.bare], skills: [projectId] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const checkout = await cloneWithIdentity(product.bare, join(product.root, 'checkout'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });

    expect((await install({ kind: 'project', project: 'product', config: store, home, cwd: checkout }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    expect((await install({ ref: 'personal', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const projectApproval = (await store.read()).approvals[projectId];
    const personalApproval = (await store.read()).approvals[personalId];
    const projectPath = join(checkout, '.claude', 'skills', 'projected');
    const personalPath = join(home, '.claude', 'skills', 'personal');

    expect((await run({ ref: 'projected', team: 'team', config: store, home, cwd: checkout }, new ScriptedPrompter())).ok).toBe(true);
    const afterProject = JSON.parse(await readFile(join(store.teamClone('team'), 'people', 'seed.json'), 'utf8'));
    expect(afterProject.declined).toContain(projectId);
    expect(afterProject.installed.map((entry: { id: string }) => entry.id)).not.toContain(projectId);
    await expect(access(projectPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Object.values((await store.read()).placements).some((entry) => entry.id === projectId)).toBe(false);
    expect((await store.read()).approvals[projectId]).toEqual(projectApproval);

    expect((await run({ ref: 'personal', team: 'team', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const afterPersonal = JSON.parse(await readFile(join(store.teamClone('team'), 'people', 'seed.json'), 'utf8'));
    expect(afterPersonal.declined).not.toContain(personalId);
    expect(afterPersonal.installed.map((entry: { id: string }) => entry.id)).not.toContain(personalId);
    await expect(access(personalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Object.values((await store.read()).placements)).toEqual([]);
    expect((await store.read()).approvals[projectId]).toEqual(projectApproval);
    expect((await store.read()).approvals[personalId]).toEqual(personalApproval);
  });

  it('removes every project placement for a skill installed in two checkouts', async () => {
    const fixture = await bareTeam();
    const product = await bareTeam();
    const id = '99999999-9999-4999-8999-999999999999';
    await pushFromSeed(fixture.seed, 'skills/projected/SKILL.md', `---\nname: projected\ndescription: projected\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [product.bare], skills: [id] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const checkoutA = await cloneWithIdentity(product.bare, join(product.root, 'checkout-a'));
    const checkoutB = await cloneWithIdentity(product.bare, join(product.root, 'checkout-b'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ kind: 'project', project: 'product', config: store, home, cwd: checkoutA }, new ScriptedPrompter())).ok).toBe(true);
    expect((await install({ kind: 'project', project: 'product', config: store, home, cwd: checkoutB }, new ScriptedPrompter())).ok).toBe(true);
    await store.update((config) => {
      for (const entry of Object.values(config.placements)) {
        if (entry.id === id && entry.scope.kind === 'project') Object.assign(entry.scope, { future_passthrough: 'kept' });
      }
    });
    expect((await run({ ref: 'projected', team: 'team', config: store, home, cwd: checkoutA }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(join(checkoutA, '.claude', 'skills', 'projected'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(checkoutB, '.claude', 'skills', 'projected'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.read()).placements).toEqual({});
    expect((await store.read()).pending).toEqual([]);
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
  });

  it('clears a shared install record from a second machine without pretending it removed that machine’s missing placement', async () => {
    const fixture = await bareTeam();
    const id = 'abababab-abab-4bab-8bab-abababababab';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const homeA = join(fixture.root, 'home-a'); const homeB = join(fixture.root, 'home-b');
    const storeA = createConfigStore(join(fixture.root, 'state-a')); const storeB = createConfigStore(join(fixture.root, 'state-b'));
    const cloneA = await cloneWithIdentity(fixture.bare, storeA.teamClone('team'));
    const cloneB = await cloneWithIdentity(fixture.bare, storeB.teamClone('team'));
    for (const store of [storeA, storeB]) await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: storeA, home: homeA }, new ScriptedPrompter())).ok).toBe(true);
    await git(['pull', '--ff-only'], cloneB);
    const onB = new ScriptedPrompter();
    expect((await run({ ref: 'team/sample', config: storeB, home: homeB }, onB)).ok).toBe(true);
    expect(onB.lines.join('\n')).toContain('not placed on this machine');
    expect((await storeB.read()).placements).toEqual({});
    expect(JSON.parse(await readFile(join(cloneB, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
    await expect(access(join(homeA, '.claude', 'skills', 'sample'))).resolves.toBeUndefined();
    // A's clone still has its pre-B record, so it proves the locally-owned folder is removable.
    expect((await run({ ref: 'team/sample', config: storeA, home: homeA }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(join(homeA, '.claude', 'skills', 'sample'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(cloneA, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
  });

  it('does not turn an incidental team.json description mention into a durable decline', async () => {
    const fixture = await bareTeam(); const id = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: ${id}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [`note ${id}`], global: [], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    expect((await run({ ref: 'team/sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).declined).not.toContain(id);
    expect((await store.read()).placements).toEqual({});
  });
});
