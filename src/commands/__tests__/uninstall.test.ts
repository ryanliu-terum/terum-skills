import { getStartedLines } from '../../lib/invocation.js';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, ledgerScopes } from '../uninstall.js';
import { run as install } from '../install.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter, NonInteractivePrompter as NonTtyPrompter, temporaryDirectory, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';

describe('uninstall (§6 pending)', () => {
  it('says no team is configured for a bare ref on an unjoined machine, refuses a missing member or project selector as a usage error, and does not take an inherited key for a project', async () => {
    expect(await run({ ref: 'sample', config: createConfigStore(await temporaryDirectory()) }, new ScriptedPrompter())).toMatchObject({ ok: false, error: getStartedLines(undefined).join('\n') });
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect(await run({ kind: 'member', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Provide a member handle: `npx -y terum-skills@latest uninstall-skill member <handle>`.' });
    const traversal = await run({ kind: 'member', member: '../../../../etc/hostname', config: store }, new ScriptedPrompter());
    expect(traversal).toMatchObject({ ok: false, error: expect.stringContaining('Invalid member handle') });
    expect(traversal.ok ? '' : traversal.error).not.toContain('hostname.json');
    expect(await run({ kind: 'project', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Provide a project name: `npx -y terum-skills@latest uninstall-skill project <name>`.' });
    expect(await run({ kind: 'project', project: 'constructor', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Unknown project constructor.' });
  });

  it('lets a qualified ref decide the team when --team names a different one, exactly as install does', async () => {
    const fixture = await bareTeam(); const id = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await cloneWithIdentity(fixture.bare, store.teamClone('other'));
    await store.update((config) => {
      config.teams.team = { remote: fixture.bare, handle: 'seed' };
      config.teams.other = { remote: fixture.bare, handle: 'seed' };
    });
    expect((await install({ ref: 'team/sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    // `install team/sample --team other` installs team's copy; the inverse must not delete other's.
    expect(await run({ ref: 'team/sample', team: 'other', config: store, home }, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true, value: [{ id, team: 'team', removed: 1 }] });
    expect((await store.read()).placements).toEqual({});
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
    const io = new ScriptedPrompter([], [true]);
    const result = await run({ kind: 'member', member: 'seed', team: 'team', config: store, home }, io);
    expect(io.asked).toEqual(['Remove everything you installed (2 skills)?']);
    expect(result).toMatchObject({ ok: true, value: [{ id: first }, { id: second }] });
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
    // One write for the whole member, not one push per skill (M2 review 4b, D9 sweep).
    expect(Number((await git(['rev-list', '--count', 'main'], fixture.bare)).trim())).toBe(commitsBefore + 1);
    expect((await store.read()).pending).toEqual([]);
    expect((await store.read()).placements).toEqual({});
  });



  it('declines an automatically endorsed uninstall, preserves approval, and clears the decline on explicit reinstall', async () => {
    const fixture = await bareTeam();
    const id = '66666666-6666-4666-8666-666666666666';
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nallowed-tools: Bash(ls)\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [id], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const approved = (await store.read()).approvals[id];
    expect((await run({ ref: 'sample', team: 'team', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
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
    // §7.2: install refuses an --into path that is not already a project, so the fixture adds it.
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.projects = [{ root: checkout, label: 'checkout' }]; });

    expect((await install({ kind: 'project', project: 'product', config: store, home, into: checkout, cwd: checkout }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    expect((await install({ ref: 'personal', into: 'global', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const projectApproval = (await store.read()).approvals[projectId];
    const personalApproval = (await store.read()).approvals[personalId];
    const projectPath = join(checkout, '.claude', 'skills', 'projected');
    const personalPath = join(home, '.claude', 'skills', 'personal');

    expect((await run({ ref: 'projected', team: 'team', config: store, home, from: checkout, cwd: checkout }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const afterProject = JSON.parse(await readFile(join(store.teamClone('team'), 'people', 'seed.json'), 'utf8'));
    expect(afterProject.declined).toContain(projectId);
    expect(afterProject.installed.map((entry: { id: string }) => entry.id)).not.toContain(projectId);
    await expect(access(projectPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Object.values((await store.read()).placements).some((entry) => entry.id === projectId)).toBe(false);
    expect((await store.read()).approvals[projectId]).toEqual(projectApproval);

    expect((await run({ ref: 'personal', from: 'global', team: 'team', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const afterPersonal = JSON.parse(await readFile(join(store.teamClone('team'), 'people', 'seed.json'), 'utf8'));
    expect(afterPersonal.declined).not.toContain(personalId);
    expect(afterPersonal.installed.map((entry: { id: string }) => entry.id)).not.toContain(personalId);
    await expect(access(personalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Object.values((await store.read()).placements)).toEqual([]);
    expect((await store.read()).approvals[projectId]).toEqual(projectApproval);
    expect((await store.read()).approvals[personalId]).toEqual(personalApproval);
  });

  it('uninstall project removes only that project\'s placement and never declines a skill still installed globally', async () => {
    const fixture = await bareTeam(); const product = await bareTeam();
    const id = 'dededede-dede-4ede-8ede-dededededede';
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [product.bare], skills: [id] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const checkout = await cloneWithIdentity(product.bare, join(product.root, 'checkout'));
    // §7.2: install refuses an --into path that is not already a project, so the fixture adds it.
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.projects = [{ root: checkout, label: 'checkout' }]; });
    // Installed globally, and into the project. §7.2 took cwd out of the destination decision, so a
    // headless install with a project registered has to name where it goes.
    expect((await install({ ref: 'sample', into: 'global', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    expect((await install({ kind: 'project', project: 'product', config: store, home, into: checkout, cwd: checkout }, new ScriptedPrompter())).ok).toBe(true);
    const globalPath = join(home, '.claude', 'skills', 'sample'); const projectPath = join(checkout, '.claude', 'skills', 'sample');
    // (The project key is git's realpath of the checkout — /private/var on macOS — so count, do not compare it.)
    expect(Object.keys((await store.read()).placements)).toHaveLength(2);
    expect((await run({ kind: 'project', project: 'product', team: 'team', config: store, home, from: checkout, cwd: checkout }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    await expect(access(projectPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(globalPath)).resolves.toBeUndefined();
    expect(Object.keys((await store.read()).placements)).toEqual([globalPath]);
    const seed = JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8'));
    expect(seed.installed).toEqual([expect.objectContaining({ id, scope: { kind: 'global' } })]);
    expect(seed.declined).toEqual([]);
  });

  it('requires a copy selector for two project copies and removes only the selected copy', async () => {
    const fixture = await bareTeam();
    const product = await bareTeam();
    const id = '99999999-9999-4999-8999-999999999999';
    await pushFromSeed(fixture.seed, 'skills/projected/v1/SKILL.md', `---\nname: projected\ndescription: projected\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [product.bare], skills: [id] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const checkoutA = await cloneWithIdentity(product.bare, join(product.root, 'checkout-a'));
    const checkoutB = await cloneWithIdentity(product.bare, join(product.root, 'checkout-b'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.projects = [{ root: checkoutA, label: 'a' }, { root: checkoutB, label: 'b' }]; });
    expect((await install({ kind: 'project', project: 'product', config: store, home, into: checkoutA, cwd: checkoutA }, new ScriptedPrompter())).ok).toBe(true);
    expect((await install({ kind: 'project', project: 'product', config: store, home, into: checkoutB, cwd: checkoutB }, new ScriptedPrompter())).ok).toBe(true);
    await store.update((config) => {
      for (const entry of Object.values(config.placements)) {
        if (entry.id === id && entry.scope.kind === 'project') Object.assign(entry.scope, { future_passthrough: 'kept' });
      }
    });
    expect(await run({ ref: 'projected', team: 'team', config: store, home }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Pass --from global or --from <checkout root>' });
    expect((await run({ ref: 'projected', team: 'team', config: store, home, from: checkoutA }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    await expect(access(join(checkoutB, '.claude', 'skills', 'projected'))).resolves.toBeUndefined();
    expect((await run({ ref: 'projected', team: 'team', config: store, home, from: checkoutB }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    await expect(access(join(checkoutA, '.claude', 'skills', 'projected'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(checkoutB, '.claude', 'skills', 'projected'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.read()).placements).toEqual({});
    expect((await store.read()).pending).toEqual([]);
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
  });

  it('clears a shared install record from a second machine without pretending it removed that machine’s missing placement', async () => {
    const fixture = await bareTeam();
    const id = 'abababab-abab-4bab-8bab-abababababab';
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const homeA = join(fixture.root, 'home-a'); const homeB = join(fixture.root, 'home-b');
    const storeA = createConfigStore(join(fixture.root, 'state-a')); const storeB = createConfigStore(join(fixture.root, 'state-b'));
    const cloneA = await cloneWithIdentity(fixture.bare, storeA.teamClone('team'));
    const cloneB = await cloneWithIdentity(fixture.bare, storeB.teamClone('team'));
    for (const store of [storeA, storeB]) await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: storeA, home: homeA }, new ScriptedPrompter())).ok).toBe(true);
    await git(['pull', '--ff-only'], cloneB);
    const onB = new ScriptedPrompter([], [true]);
    expect((await run({ ref: 'team/sample', config: storeB, home: homeB }, onB)).ok).toBe(true);
    expect(onB.lines.join('\n')).toContain('not placed on this machine');
    expect((await storeB.read()).placements).toEqual({});
    expect(JSON.parse(await readFile(join(cloneB, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
    await expect(access(join(homeA, '.claude', 'skills', 'sample'))).resolves.toBeUndefined();
    // A's clone still has its pre-B record, so it proves the locally-owned folder is removable.
    expect((await run({ ref: 'team/sample', config: storeA, home: homeA }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    await expect(access(join(homeA, '.claude', 'skills', 'sample'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(cloneA, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
  });

  it('says a never-installed team skill is not placed on this machine instead of exiting silently', async () => {
    const fixture = await bareTeam();
    const id = 'efefefef-efef-4fef-8fef-efefefefefef';
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    expect(await run({ ref: 'team/sample', config: store, home }, io)).toMatchObject({ ok: true, value: [] });
    expect(io.lines).toContain(`${id.slice(0, 8)} is not placed on this machine.`);
  });

  it('does not turn an incidental team.json description mention into a durable decline', async () => {
    const fixture = await bareTeam(); const id = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', `---\nname: sample\ndescription: ${id}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [`note ${id}`], global: [], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    expect((await run({ ref: 'team/sample', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).declined).not.toContain(id);
    expect((await store.read()).placements).toEqual({});
  });
});

it('unions people scopes and matching ledger scopes without borrowing another team or skill', async () => {
  const store = createConfigStore(await temporaryDirectory());
  const id = '11111111-1111-4111-8111-111111111111';
  await store.update(config => {
    for (const [name, team, skillId, project] of [
      ['mine', 'acme', id, 'local'], ['other-team', 'other', id, 'foreign'],
      ['other-skill', 'acme', '22222222-2222-4222-8222-222222222222', 'unrelated'],
    ]) config.placements[join(store.root, name!)] = { id: skillId!, team: team!, version: null, scope: { kind: 'project', project: project! }, placed_at: '2026-09-08', fingerprint: 'fixture' };
  });
  const before = await store.read();
  expect(await ledgerScopes(store, 'acme', id, [{ kind: 'global' }, { kind: 'project', project: 'people-only' }, { kind: 'project', project: 'local' }])).toEqual([
    { kind: 'global' }, { kind: 'project', project: 'people-only' }, { kind: 'project', project: 'local' },
  ]);
  expect(await store.read()).toEqual(before);
});

async function projectPreviewFixture() {
  const fixture = await bareTeam(), product = await bareTeam();
  const ids = ['91919191-9191-4191-8191-919191919191', '92929292-9292-4292-8292-929292929292'];
  for (const [index, name] of ['shared', 'projected'].entries()) await pushFromSeed(fixture.seed, `skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name}\nlicense: UNLICENSED\nmetadata:\n  id: ${ids[index]}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
  await pushFromSeed(fixture.seed, 'team.json', JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [product.bare], skills: ids } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }));
  const store = createConfigStore(join(fixture.root, 'state')), home = join(fixture.root, 'home');
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  const checkouts = await Promise.all(['a', 'b'].map(name => cloneWithIdentity(product.bare, join(product.root, name))));
  await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.projects = checkouts.map((root, index) => ({ root, label: ['a', 'b'][index]! })); });
  expect((await install({ ref: 'shared', into: 'global', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
  for (const cwd of checkouts) expect((await install({ kind: 'project', project: 'product', config: store, home, into: cwd, cwd }, new ScriptedPrompter())).ok).toBe(true);
  const before = await store.read(), people = await readFile(join(clone, 'people/seed.json'), 'utf8');
  const projectPaths = Object.entries(before.placements).filter(([, entry]) => entry.scope.kind === 'project').map(([path]) => path);
  // Placement keys are git's realpath of each checkout (/private/var on macOS): group by the checkout's basename, not its fixture path.
  const pathsIn = (letter: 'a' | 'b') => ['shared', 'projected'].map(name => projectPaths.find(path => basename(path) === name && basename(dirname(dirname(dirname(path)))) === letter)!);
  const quarantine = `Local changes are moved to ${join(store.root, 'quarantine')}, never deleted.`;
  const kept = 'Install records dropped from your people file (0): another copy stays, so your records are kept';
  const title = "Remove product's 2 skills from this machine?";
  const detail = ['Folders removed (2):', ...pathsIn('a').map(path => `  ${path}  ·  project product`), quarantine, kept, 'Copies installed to Global stay.'];
  return { fixture, store, home, clone, checkouts, ids, before, people, projectPaths, pathsIn, quarantine, kept, title, detail, args: { kind: 'project' as const, project: 'product', config: store, home, from: checkouts[0]! } };
}

it('previews a project once and declining writes nothing', async () => {
  const f = await projectPreviewFixture(), io = new ScriptedPrompter([], [false]);
  const commits = await git(['rev-list', '--count', 'main'], f.fixture.bare);
  expect(await run(f.args, io)).toEqual({ ok: false, cancelled: true, error: 'Remove was declined.' });
  expect(io.asked).toEqual([f.title]); expect(io.details[f.title]).toEqual(f.detail);
  expect(await f.store.read()).toEqual(f.before);
  expect(await readFile(join(f.clone, 'people/seed.json'), 'utf8')).toBe(f.people);
  expect(await git(['rev-list', '--count', 'main'], f.fixture.bare)).toBe(commits);
  for (const path of Object.keys(f.before.placements)) await expect(access(path)).resolves.toBeUndefined();
});

it('confirms the chosen checkout\'s paths, keeps the other copy and global, and moves records only with the last copy', async () => {
  const f = await projectPreviewFixture(), io = new ScriptedPrompter([], [true]);
  const commits = Number(await git(['rev-list', '--count', 'main'], f.fixture.bare));
  expect((await run(f.args, io)).ok).toBe(true);
  expect(io.asked).toEqual([f.title]); expect(io.details[f.title]).toEqual(f.detail);
  const globalPath = join(f.home, '.claude/skills/shared');
  expect(io.details[f.title]?.join('\n')).not.toContain(globalPath);
  for (const path of f.pathsIn('a')) await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  for (const path of [globalPath, ...f.pathsIn('b')]) await expect(access(path)).resolves.toBeUndefined();
  // Checkout b still holds both skills, so no install record moves and nothing is pushed (the last-copy rule).
  expect(await readFile(join(f.clone, 'people/seed.json'), 'utf8')).toBe(f.people);
  expect(Number(await git(['rev-list', '--count', 'main'], f.fixture.bare))).toBe(commits);
  expect((await f.store.read()).pending).toEqual([]);
  // The last copies: the records go, the project-only skill is declined, one commit.
  const last = new ScriptedPrompter([], [true]);
  expect((await run({ ...f.args, from: f.checkouts[1]! }, last)).ok).toBe(true);
  expect(last.asked).toEqual([f.title]);
  expect(last.details[f.title]).toEqual(['Folders removed (2):', ...f.pathsIn('b').map(path => `  ${path}  ·  project product`), f.quarantine, 'Install records dropped from your people file (2): shared, projected', 'Not offered again until you install them: projected', 'These have no remaining install record, so sync stops placing them anywhere.', 'Copies installed to Global stay.']);
  expect(Object.keys((await f.store.read()).placements)).toEqual([globalPath]);
  const caller = JSON.parse(await readFile(join(f.clone, 'people/seed.json'), 'utf8'));
  expect(caller.installed).toEqual([expect.objectContaining({ id: f.ids[0], scope: { kind: 'global' } })]);
  expect(caller.declined).toEqual([f.ids[1]]);
  expect((await f.store.read()).pending).toEqual([]);
  expect(Number(await git(['rev-list', '--count', 'main'], f.fixture.bare))).toBe(commits + 1);
});

it('asks which copy first, then confirms exactly the chosen copies', async () => {
  const f = await projectPreviewFixture();
  const chosen = [f.pathsIn('a')[0]!, f.pathsIn('b')[1]!];
  const io = new ScriptedPrompter([...chosen], [true], true);
  expect((await run({ kind: 'project', project: 'product', config: f.store, home: f.home }, io)).ok).toBe(true);
  expect(io.asked).toEqual(['Remove which copy?', 'Remove which copy?', f.title]);
  expect(io.offered).toEqual([[f.pathsIn('a')[0], f.pathsIn('b')[0]], [f.pathsIn('a')[1], f.pathsIn('b')[1]]]);
  expect(io.details[f.title]).toEqual(['Folders removed (2):', ...chosen.map(path => `  ${path}  ·  project product`), f.quarantine, f.kept, 'Copies installed to Global stay.']);
  for (const path of chosen) await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  for (const path of [f.pathsIn('a')[1]!, f.pathsIn('b')[0]!, join(f.home, '.claude/skills/shared')]) await expect(access(path)).resolves.toBeUndefined();
  expect(await readFile(join(f.clone, 'people/seed.json'), 'utf8')).toBe(f.people);
});

it('fails closed at the non-interactive confirm before any project write', async () => {
  const f = await projectPreviewFixture(), io = new NonTtyPrompter();
  const commits = await git(['rev-list', '--count', 'main'], f.fixture.bare);
  expect(await run(f.args, io)).toEqual({ ok: false, error: `Cannot ask "${f.title}": this command needs an interactive terminal (stdin is not a TTY).` });
  expect(io.asked).toEqual([f.title]);
  expect(await f.store.read()).toEqual(f.before);
  expect(await readFile(join(f.clone, 'people/seed.json'), 'utf8')).toBe(f.people);
  expect(await git(['rev-list', '--count', 'main'], f.fixture.bare)).toBe(commits);
  for (const path of Object.keys(f.before.placements)) await expect(access(path)).resolves.toBeUndefined();
});

it('removes a member installed list and leaves authored-only skills untouched', async () => {
  const fixture = await bareTeam();
  const authored = '93939393-9393-4393-8393-939393939393', installed = '94949494-9494-4494-8494-949494949494';
  for (const [name, id, author] of [['authored', authored, 'Member <member@example.com>'], ['used', installed, 'Seed <seed@example.com>']]) await pushFromSeed(fixture.seed, `skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: ${author}\n  terum-category: testing\n---\n`);
  await pushFromSeed(fixture.seed, 'people/member.json', JSON.stringify(person('member', { installed: [{ id: installed, scope: { kind: 'global' }, version: null, since: '2026-09-04' }] })));
  const store = createConfigStore(join(fixture.root, 'state')), home = join(fixture.root, 'home');
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  for (const ref of ['authored', 'used']) expect((await install({ ref, config: store, home }, new ScriptedPrompter())).ok).toBe(true);
  const io = new ScriptedPrompter([], [true]), title = "Remove member's 1 skills from this machine?";
  expect(await run({ kind: 'member', member: 'member', config: store }, io)).toMatchObject({ ok: true, value: [{ id: installed, removed: 1 }] });
  expect(io.asked).toEqual([title]);
  expect(io.details[title]).toEqual(['Folders removed (1):', `  ${join(home, '.claude/skills/used')}  ·  Global`, `Local changes are moved to ${join(store.root, 'quarantine')}, never deleted.`, 'Install records dropped from your people file (1): used', "Targets are member's current installed list, not what you installed from them."]);
  await expect(access(join(home, '.claude/skills/authored'))).resolves.toBeUndefined();
  await expect(access(join(home, '.claude/skills/used'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.parse(await readFile(join(clone, 'people/seed.json'), 'utf8')).installed).toEqual([expect.objectContaining({ id: authored })]);
  expect(JSON.parse(await readFile(join(clone, 'people/member.json'), 'utf8')).installed).toEqual([expect.objectContaining({ id: installed })]);
});

it.each(['member', 'project'] as const)('does not ask, print, or write for an empty %s preview', async kind => {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'team.json', JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [], skills: ['95959595-9595-4595-8595-959595959595'] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }));
  const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const before = await store.read(), people = await readFile(join(clone, 'people/seed.json'), 'utf8');
  const commits = await git(['rev-list', '--count', 'main'], fixture.bare), io = new ScriptedPrompter();
  expect(await run({ ...(kind === 'member' ? { kind, member: 'seed' } : { kind, project: 'product' }), config: store }, io)).toEqual({ ok: true, value: [] });
  expect(io.asked).toEqual([]); expect(io.lines).toEqual([]);
  expect(await store.read()).toEqual(before);
  expect(await readFile(join(clone, 'people/seed.json'), 'utf8')).toBe(people);
  expect(await git(['rev-list', '--count', 'main'], fixture.bare)).toBe(commits);
});

it('removes only --from and updates the shared record and decline only after the last Global-scope copy', async () => {
  const fixture = await bareTeam(); const id = 'acacacac-acac-4cac-8cac-acacacacacac';
  await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
  const team = JSON.parse(await readFile(join(fixture.seed, 'team.json'), 'utf8')); team.global = [id];
  await pushFromSeed(fixture.seed, 'team.json', JSON.stringify(team));
  const home = join(fixture.root, 'home'); const store = createConfigStore(join(home, '.terum', 'skills'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  const checkout = await temporaryDirectory();
  await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.projects = [{ root: checkout, label: 'checkout' }]; });
  for (const into of ['global', checkout]) expect((await install({ ref: 'sample', into, config: store }, new ScriptedPrompter())).ok).toBe(true);
  const personPath = join(clone, 'people', 'seed.json'); const before = await readFile(personPath, 'utf8');
  const runner = wrapRunner(systemRunner, async () => { throw new Error('No team write is allowed while another copy remains'); });
  expect(await run({ ref: 'sample', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Pass --from global or --from <checkout root>' });
  expect((await store.read()).pending).toEqual([]);
  expect(await run({ ref: 'sample', from: checkout, config: store, runner }, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true, value: [{ removed: 1 }] });
  expect(await readFile(personPath, 'utf8')).toBe(before);
  await expect(access(join(checkout, '.claude', 'skills', 'sample'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(join(home, '.claude', 'skills', 'sample'))).resolves.toBeUndefined();
  expect(await run({ ref: 'sample', from: 'global', config: store }, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true, value: [{ removed: 1 }] });
  expect(JSON.parse(await readFile(personPath, 'utf8'))).toMatchObject({ installed: [], declined: [id] });
  expect(await store.read()).toMatchObject({ pending: [], placements: {} });
});
