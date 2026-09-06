import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../install.js';
import { run as sync } from '../sync.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, mappedRunner, person, pushFromSeed, ScriptedPrompter, temporaryDirectory, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';
import { allowedTools } from '../../lib/schema.js';

describe('install (§6 refs)', () => {
  it('refuses a bare ref when no configured team can resolve it', async () => {
    const result = await run({ ref: 'sample', config: createConfigStore(await temporaryDirectory()) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('ambiguous') });
  });

  it('records a short requested version as its resolved full tree hash', async () => {
    const fixture = await bareTeam();
    const id = '11111111-1111-4111-8111-111111111111';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const tree = (await git(['rev-parse', 'HEAD:skills/sample'], clone)).trim();
    const result = await run({ ref: `sample@${tree.slice(0, 8)}`, config: store, home: join(fixture.root, 'home') }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: [{ version: tree }] });
    const person = JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8'));
    expect(person.installed[0].version).toBe(tree);
    expect(Object.values((await store.read()).placements)[0]).toMatchObject({ version: tree });
  });

  it('asks consent for allowed-tools in the pinned tree, rather than HEAD', async () => {
    const fixture = await bareTeam();
    const id = '12121212-1212-4212-8212-121212121212';
    await pushFromSeed(fixture.seed, 'skills/helper/SKILL.md', `---\nname: helper\ndescription: historical\nlicense: UNLICENSED\nallowed-tools: Bash(*)\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const pinned = (await git(['rev-parse', 'HEAD:skills/helper'], fixture.seed)).trim();
    await pushFromSeed(fixture.seed, 'skills/helper/SKILL.md', `---\nname: helper\ndescription: current\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter([], [true]);
    expect(await run({ ref: `helper@${pinned}`, config: store, home: join(fixture.root, 'home') }, io)).toMatchObject({ ok: true });
    expect(io.askedAbout('Approve these tools')).toBe(true);
    const grants = allowedTools('Bash(*)'); if (!grants.ok) throw new Error('test grant must normalize');
    expect((await store.read()).approvals[id]?.grants).toBe(grants.hash);
  });

  it('leaves durable install intent when placement succeeds but the people-file write exhausts, then sync completes it', async () => {
    const fixture = await bareTeam();
    const id = '33333333-3333-4333-8333-333333333333';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(home, '.terum', 'skills'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    let clock = 0;
    const rejecting = wrapRunner(systemRunner, async (command, args, _options, next) => command === 'git' && args[0] === 'push'
      ? { code: 1, stdout: '', stderr: ' ! [rejected] HEAD -> main (non-fast-forward)' }
      : next());
    const first = await run({ ref: 'sample', config: store, runner: rejecting, safeWrite: { deadlineMs: 1, now: () => clock, sleep: async () => { clock = 2; } } }, new ScriptedPrompter());
    expect(first.ok).toBe(false);
    const path = join(home, '.claude', 'skills', 'sample');
    await expect(access(join(path, 'SKILL.md'))).resolves.toBeUndefined();
    expect((await store.read()).pending).toHaveLength(1);
    expect((await store.read()).placements[path]).toMatchObject({ id });
    const { run: sync } = await import('../sync.js');
    const recovered = await sync({ config: store }, new ScriptedPrompter());
    if (!recovered.ok) throw new Error(recovered.error);
    expect(recovered).toMatchObject({ ok: true });
    expect((await store.read()).pending).toEqual([]);
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed).toMatchObject([{ id }]);
    const personAfterFirstReplay = await readFile(join(clone, 'people', 'seed.json'), 'utf8');
    const ledgerAfterFirstReplay = JSON.stringify((await store.read()).placements);
    const folderAfterFirstReplay = await readFile(join(path, 'SKILL.md'), 'utf8');
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).toBe(personAfterFirstReplay);
    expect(JSON.stringify((await store.read()).placements)).toBe(ledgerAfterFirstReplay);
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe(folderAfterFirstReplay);
  });

  it('shows malformed allowed-tools verbatim, requires consent, and leaves no durable intent when declined', async () => {
    const fixture = await bareTeam();
    const id = '44444444-4444-4444-8444-444444444444';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nallowed-tools:\n  Bash: \"*\"\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter([], [false]);
    const result = await run({ ref: 'sample', config: store, home: join(fixture.root, 'home') }, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('malformed allowed-tools') });
    expect(io.lines.join('\n')).toContain('[object Object]');
    expect(io.askedAbout('despite malformed')).toBe(true);
    expect((await store.read()).approvals).toEqual({});
    expect((await store.read()).pending).toEqual([]);
    expect((await store.read()).placements).toEqual({});
  });

  it('keeps an earlier matching pending install when this attempt declines consent', async () => {
    const fixture = await bareTeam(); const id = '45454545-4545-4545-8545-454545454545';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nallowed-tools:\n  Bash: "*"\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const started = '2026-09-04T00:00:00.000Z';
    await store.update((config) => {
      config.teams.team = { remote: fixture.bare, handle: 'seed' };
      config.pending.push({ op: 'install', id, team: 'team', scope: { kind: 'global' }, started });
    });
    expect((await run({ ref: 'sample', config: store, home: join(fixture.root, 'home') }, new ScriptedPrompter([], [false]))).ok).toBe(false);
    expect((await store.read()).pending).toEqual([expect.objectContaining({ op: 'install', id, started })]);
    expect((await store.read()).placements).toEqual({});
  });

  it('never overwrites a foreign target without force, and force moves it to quarantine before placing', async () => {
    const fixture = await bareTeam();
    const id = '55555555-5555-4555-8555-555555555555';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const target = join(home, '.claude', 'skills', 'sample');
    await mkdir(target, { recursive: true }); await writeFile(join(target, 'SKILL.md'), 'user-owned');
    const first = await run({ ref: 'sample', config: store, home }, new ScriptedPrompter());
    expect(first).toMatchObject({ ok: false, error: expect.stringContaining('--force') });
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('user-owned');
    expect((await store.read()).placements).toEqual({});
    expect((await store.read()).pending).toHaveLength(1);
    const forced = await run({ ref: 'sample', config: store, home, force: true }, new ScriptedPrompter());
    expect(forced.ok).toBe(true);
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('name: sample');
    const quarantined = await readdirRecursive(join(store.root, 'quarantine'));
    const quarantinedSkill = quarantined.find((entry) => entry.endsWith('sample/SKILL.md'));
    expect(quarantinedSkill).toBeDefined();
    expect(await readFile(join(store.root, 'quarantine', quarantinedSkill!), 'utf8')).toBe('user-owned');
  });

  it('replays pending install intent after a placement failure without duplicating state', async () => {
    const fixture = await bareTeam();
    const id = '77777777-7777-4777-8777-777777777777';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(home, '.terum', 'skills'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    await mkdir(join(home, '.claude'), { recursive: true }); await writeFile(join(home, '.claude', 'skills'), 'not a directory');
    const failed = await run({ ref: 'sample', config: store, home }, new ScriptedPrompter());
    expect(failed.ok).toBe(false);
    expect((await store.read()).pending).toHaveLength(1);
    expect(JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
    await rm(join(home, '.claude', 'skills'));
    const { run: sync } = await import('../sync.js');
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    const target = join(home, '.claude', 'skills', 'sample');
    await expect(access(join(target, 'SKILL.md'))).resolves.toBeUndefined();
    expect((await store.read()).pending).toEqual([]);
    const person = await readFile(join(clone, 'people', 'seed.json'), 'utf8');
    const ledger = JSON.stringify((await store.read()).placements);
    const placed = await readFile(join(target, 'SKILL.md'), 'utf8');
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).toBe(person);
    expect(JSON.stringify((await store.read()).placements)).toBe(ledger);
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(placed);
  });

  it('re-places its own target and never consults a foreign global target for a project install', async () => {
    const fixture = await bareTeam(); const product = await bareTeam();
    const id = '88888888-8888-4888-8888-888888888888';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [product.bare], skills: [id] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(home, '.terum', 'skills'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const checkout = await cloneWithIdentity(product.bare, join(product.root, 'checkout'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await run({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const global = join(home, '.claude', 'skills', 'sample');
    const quarantine = join(store.root, 'quarantine');
    expect((await run({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(global)).resolves.toBeUndefined();
    await expect(access(quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
    const projectHome = join(fixture.root, 'project-home'); const foreign = join(projectHome, '.claude', 'skills', 'sample');
    await mkdir(foreign, { recursive: true }); await writeFile(join(foreign, 'SKILL.md'), 'user-owned');
    expect((await run({ kind: 'project', project: 'product', config: store, home: projectHome, cwd: checkout }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(foreign, 'SKILL.md'), 'utf8')).toBe('user-owned');
    await expect(access(join(checkout, '.claude', 'skills', 'sample', 'SKILL.md'))).resolves.toBeUndefined();
  });

  it('keeps project placements worktree-local across two projects and two checkouts, and sync never guesses an unrelated checkout', async () => {
    const fixture = await bareTeam();
    const productA = await bareTeam();
    const productB = await bareTeam();
    const projectAId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const projectBId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const globalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    for (const [name, id, description] of [
      ['project-a', projectAId, 'project a'],
      ['project-b', projectBId, 'project b'],
      ['global', globalId, 'global before'],
    ] as const) {
      await pushFromSeed(fixture.seed, `skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${description}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    }
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: {
      alpha: { remotes: [productA.bare], skills: [projectAId] },
      beta: { remotes: [productB.bare], skills: [projectBId] },
    }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const alphaOne = await cloneWithIdentity(productA.bare, join(productA.root, 'alpha-one'));
    const alphaTwo = await cloneWithIdentity(productA.bare, join(productA.root, 'alpha-two'));
    const beta = await cloneWithIdentity(productB.bare, join(productB.root, 'beta'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });

    expect((await run({ kind: 'project', project: 'alpha', config: store, home, cwd: alphaOne }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(join(alphaOne, '.claude', 'skills', 'project-a', 'SKILL.md'))).resolves.toBeUndefined();
    await expect(access(join(beta, '.claude', 'skills', 'project-a'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(alphaOne, '.git', 'info', 'exclude'), 'utf8')).toContain('.claude/skills/project-a');
    expect(await readFile(join(beta, '.git', 'info', 'exclude'), 'utf8')).not.toContain('.claude/skills/project-a');

    expect((await run({ kind: 'project', project: 'beta', config: store, home, cwd: beta }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(join(beta, '.claude', 'skills', 'project-b', 'SKILL.md'))).resolves.toBeUndefined();
    expect(await readFile(join(beta, '.git', 'info', 'exclude'), 'utf8')).toContain('.claude/skills/project-b');
    expect(await readFile(join(alphaOne, '.git', 'info', 'exclude'), 'utf8')).not.toContain('.claude/skills/project-b');

    expect((await run({ kind: 'project', project: 'alpha', config: store, home, cwd: alphaTwo }, new ScriptedPrompter())).ok).toBe(true);
    const alphaPlacements = Object.entries((await store.read()).placements).filter(([, entry]) => entry.id === projectAId && entry.scope.kind === 'project' && entry.scope.project === 'alpha');
    expect(alphaPlacements).toHaveLength(2);
    const installed = JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed;
    expect(installed.filter((entry: { id: string; scope: { kind: string; project?: string } }) => entry.id === projectAId && entry.scope.kind === 'project' && entry.scope.project === 'alpha')).toHaveLength(1);

    const outside = await temporaryDirectory('terum-unmatched-project-');
    const ledgerBeforeOutside = JSON.stringify((await store.read()).placements);
    const outsideInstall = await run({ kind: 'project', project: 'alpha', config: store, home, cwd: outside }, new ScriptedPrompter());
    expect(outsideInstall).toMatchObject({ ok: false, error: expect.stringContaining('no matching project context') });
    expect((await store.read()).pending).toEqual([]);
    expect(JSON.stringify((await store.read()).placements)).toBe(ledgerBeforeOutside);
    await expect(access(join(outside, '.claude', 'skills', 'project-a'))).rejects.toMatchObject({ code: 'ENOENT' });

    expect((await run({ ref: 'global', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const globalPath = join(home, '.claude', 'skills', 'global', 'SKILL.md');
    const alphaBeforeSync = await readFile(join(alphaOne, '.claude', 'skills', 'project-a', 'SKILL.md'), 'utf8');
    const betaBeforeSync = await readFile(join(beta, '.claude', 'skills', 'project-b', 'SKILL.md'), 'utf8');
    await pushFromSeed(fixture.seed, 'skills/global/SKILL.md', `---\nname: global\ndescription: global after\nlicense: UNLICENSED\nmetadata:\n  id: ${globalId}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    expect((await sync({ config: store, cwd: outside }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(globalPath, 'utf8')).toContain('description: global after');
    expect(await readFile(join(alphaOne, '.claude', 'skills', 'project-a', 'SKILL.md'), 'utf8')).toBe(alphaBeforeSync);
    expect(await readFile(join(beta, '.claude', 'skills', 'project-b', 'SKILL.md'), 'utf8')).toBe(betaBeforeSync);
  });

  it('resolves qualified, self-locating, and unique ID refs while rejecting ambiguous batch versions and prefixes without placement', async () => {
    const first = await bareTeam();
    const second = await bareTeam();
    const dupId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const memberId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const prefixOne = 'deadbeef-0000-4000-8000-000000000001';
    const prefixTwo = 'deadbeef-0000-4000-8000-000000000002';
    for (const [name, id, description] of [
      ['dup', dupId, 'from first'],
      ['member-only', memberId, 'member skill'],
      ['one', prefixOne, 'first prefix'],
      ['two', prefixTwo, 'second prefix'],
    ] as const) await pushFromSeed(first.seed, `skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${description}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(second.seed, 'skills/dup/SKILL.md', `---\nname: dup\ndescription: from second\nlicense: UNLICENSED\nmetadata:\n  id: ${dupId}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(first.seed, 'people/me.json', `${JSON.stringify(person('me'))}\n`);
    await pushFromSeed(first.seed, 'people/seed.json', `${JSON.stringify(person('seed', { installed: [{ id: memberId, version: null, scope: { kind: 'global' }, since: '2026-09-04' } ] }))}\n`);
    const home = join(first.root, 'home');
    const store = createConfigStore(join(first.root, 'state'));
    await cloneWithIdentity(first.bare, store.teamClone('team-a'));
    await cloneWithIdentity(second.bare, store.teamClone('team-b'));
    await store.update((config) => {
      config.teams['team-a'] = { remote: 'github.com/org/repo', handle: 'me' };
      config.teams['team-b'] = { remote: second.bare, handle: 'seed' };
    });
    const mapped = mappedRunner('github.com/org/repo', first.bare);

    const bare = await run({ ref: 'dup', config: store, home }, new ScriptedPrompter());
    expect(bare).toMatchObject({ ok: false, error: expect.stringContaining('team-a/dup') });
    expect(bare).toMatchObject({ ok: false, error: expect.stringContaining('team-b/dup') });
    expect((await store.read()).placements).toEqual({});

    expect((await run({ ref: 'team-a/dup', config: store, home, runner: mapped }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(home, '.claude', 'skills', 'dup', 'SKILL.md'), 'utf8')).toContain('description: from first');
    expect((await run({ ref: 'org/repo/dup', config: store, home, runner: mapped }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(home, '.claude', 'skills', 'dup', 'SKILL.md'), 'utf8')).toContain('description: from first');

    const beforeUnjoined = JSON.stringify(await store.read());
    expect(await run({ ref: 'other/repo/dup', config: store, home }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('team join other/repo') });
    expect(JSON.stringify(await store.read())).toBe(beforeUnjoined);
    expect((await run({ ref: `team-a/${dupId.slice(0, 8)}`, config: store, home, runner: mapped }, new ScriptedPrompter())).ok).toBe(true);
    expect(await run({ ref: 'team-a/deadbeef', config: store, home }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('ambiguous') });

    const beforeBatchVersions = JSON.stringify(await store.read());
    expect(await run({ kind: 'member', member: 'seed@abc', team: 'team-a', config: store, home }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('single-skill') });
    expect(await run({ kind: 'project', project: 'alpha@abc', team: 'team-a', config: store, home }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('single-skill') });
    expect(JSON.stringify(await store.read())).toBe(beforeBatchVersions);

    const secondHome = join(first.root, 'second-home');
    const secondStore = createConfigStore(join(first.root, 'second-state'));
    await cloneWithIdentity(first.bare, secondStore.teamClone('team-a'));
    await secondStore.update((config) => { config.teams['team-a'] = { remote: 'github.com/org/repo', handle: 'me' }; });
    expect((await run({ kind: 'member', member: 'seed', team: 'team-a', config: secondStore, home: secondHome, runner: mapped }, new ScriptedPrompter())).ok).toBe(true);
    expect(Object.values((await secondStore.read()).placements).map((entry) => entry.id)).toEqual([memberId]);
    expect(await readFile(join(secondHome, '.claude', 'skills', 'member-only', 'SKILL.md'), 'utf8')).toContain('name: member-only');
  });
});

async function readdirRecursive(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).map(String);
}
