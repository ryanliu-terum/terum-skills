import { createExecute } from '../../lib/execute.js';
import type { ResultOutcome } from '../../lib/frames.js';
import { getStartedLines } from '../../lib/invocation.js';
import { access, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { basename, join, posix, win32 } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as setup from '../setup.js';
import { installHook } from '../../lib/hook.js';
import { placementHome, run } from '../install.js';
import type { ProgressUpdate } from '../../lib/prompt.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, fakeGh, git, mappedRunner, person, pushFromSeed, ScriptedPrompter, NonInteractivePrompter, temporaryDirectory, wrapRunner, wrapperFor } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';
import { allowedTools } from '../../lib/schema.js';

describe('install (§6 refs)', () => {
  it('13 suppresses connect during a non-interactive bootstrap with a shareable global skill', async () => {
    const fixture = await bareTeam(); const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    const id = '31313131-3131-4131-8131-313131313131';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const local = join(home, '.claude', 'skills', 'local'); await mkdir(local, { recursive: true });
    const bytes = '---\nname: local\ndescription: local skill\n---\n'; await writeFile(join(local, 'SKILL.md'), bytes);
    const remote = 'https://github.com/acme/team.git'; const runner = mappedRunner(remote, fixture.bare, fakeGh('seed'));
    const hook = { settingsFile: join(fixture.root, 'settings.json'), backupDir: join(fixture.root, 'backups') }; await installHook(hook);
    const realSetup = setup.run;
    // Resume the bootstrap after its durable join: identity and hook consent already happened.
    // A fresh join still requires those prompts; this isolates the new connect suppression.
    const spy = vi.spyOn(setup, 'run').mockImplementation(async (args, io) => {
      await cloneWithIdentity(fixture.bare, store.teamClone('team'));
      await store.update((config) => { config.teams.team = { remote: 'github.com/acme/team', handle: 'seed' }; });
      const result = await realSetup(args, io);
      expect(result).toMatchObject({ ok: true });
      return result;
    });
    try {
      const io = new NonInteractivePrompter();
      // The bundled wrapper is resolved from the package root (W-02), so whether it exists depends on whether this
      // checkout was built; an unavailable bundle keeps the wrapper step from asking and makes the case build-independent.
      const wrapper = { skillsRoot: join(home, '.claude', 'skills'), source: join(fixture.root, 'no-bundle', 'SKILL.md') };
      expect(await run({ ref: 'acme/team/sample', config: store, home, runner, hook, wrapper }, io)).toMatchObject({ ok: true, value: [{ id }] });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0]).toMatchObject({ quiet: true });
      expect(io.asked).toEqual([]);
      expect(await readFile(join(local, 'SKILL.md'), 'utf8')).toBe(bytes);
    } finally { spy.mockRestore(); }
  });

  it('says no team is configured — the one sentence every verb uses — for a bare ref on an unjoined machine, and refuses a missing member or project selector as a usage error', async () => {
    const store = createConfigStore(await temporaryDirectory());
    expect(await run({ ref: 'sample', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: getStartedLines(undefined).join('\n') });
    expect(await run({ kind: 'member', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Provide a member handle: `npx -y terum-skills@latest install member <handle>`.' });
    expect(await run({ kind: 'project', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Provide a project name: `npx -y terum-skills@latest install project <name>`.' });
    // A handle is held to the handle rule before it can become a path segment: no traversal, and no path echoed back.
    const traversal = await run({ kind: 'member', member: '../../../config', config: store }, new ScriptedPrompter());
    expect(traversal).toMatchObject({ ok: false, error: expect.stringContaining('Invalid member handle') });
    expect(traversal.ok ? '' : traversal.error).not.toContain('config.json');
    // An inherited object key is not a configured team either.
    expect(await run({ ref: 'sample', team: 'constructor', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Team constructor is not configured.' });
  });

  it('a three-part ref on a machine that never joined bootstraps through setup — quiet, every prompt still asked — and then installs: one command (§6, M4 exit)', async () => {
    const fixture = await bareTeam();
    const id = '31313131-3131-4131-8131-313131313131';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const root = join(fixture.root, 'fresh'); const store = createConfigStore(join(root, 'state')); const home = join(root, 'home');
    const remote = 'https://github.com/acme/team.git';
    const runner = mappedRunner(remote, fixture.bare, fakeGh('bob', { 'api user/repository_invitations': { code: 0, stdout: '[]\n', stderr: '' } }));
    // Identity: GitHub login and handle default to gh's login, then name and email; the §8 hook offer and the /terum-skills skill offer are declined.
    const io = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com'], [false, false]);
    const result = await run({ ref: 'acme/team/sample', config: store, home, runner, hook: { settingsFile: join(root, 'settings.json'), backupDir: join(root, 'backups') }, wrapper: wrapperFor(home) }, io);
    expect(result).toMatchObject({ ok: true, value: [{ id, team: 'team', path: join(home, '.claude', 'skills', 'sample') }] });
    expect((await store.read()).teams.team).toMatchObject({ handle: 'bob' });
    expect(await readFile(join(home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('name: sample');
    expect(JSON.parse(await git(['show', 'main:people/bob.json'], fixture.bare)).installed).toHaveLength(1);
    expect(io.countAsked('Install the Claude Code session-start hook')).toBe(1);
    expect(io.countAsked('Install the /terum-skills Claude Code skill')).toBe(1);
    await expect(readFile(join(home, '.claude', 'skills', 'terum-skills', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    const printed = io.lines.join('\n');
    expect(printed).not.toContain('Welcome to terum-skills');
    expect(printed).not.toContain('Next, from any terminal');
    expect(printed).not.toContain('Feedback and requests');
    expect(printed).not.toContain('Repository:');
    // A configured machine refuses a second binding before bootstrap.
    const second = createConfigStore(join(root, 'second-state'));
    await second.update((config) => { config.teams.other = { remote: 'github.com/other/repo', handle: 'bob' }; });
    expect(await run({ ref: 'acme/team/sample', config: second, home: join(root, 'second-home'), runner }, new ScriptedPrompter())).toMatchObject({ ok: false, refused: true, error: expect.stringContaining('One team per machine') });
  });

  it('an inherited object key is not a project', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect(await run({ kind: 'project', project: 'constructor', config: store, home: join(fixture.root, 'home') }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Unknown project constructor.' });
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
    expect(io.lines.join('\n')).not.toContain('helper requests allowed-tools:');
    expect(io.details['Approve these tools for helper?']).toEqual(['helper requests allowed-tools:', 'Bash(*)']);
    const grants = allowedTools('Bash(*)'); if (!grants.ok) throw new Error('test grant must normalize');
    expect((await store.read()).approvals[id]?.grants).toBe(grants.hash);
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
    expect(io.lines.join('\n')).not.toContain('{"Bash":"*"}');
    expect(io.details['Install sample despite malformed allowed-tools?']).toEqual([expect.stringMatching(/^allowed-tools for sample could not be parsed: /)]);
    expect(io.details['Install sample despite malformed allowed-tools?']![0]).toContain('{"Bash":"*"}');
    expect(io.askedAbout('despite malformed')).toBe(true);
    expect((await store.read()).approvals).toEqual({});
    expect((await store.read()).pending).toEqual([]);
    expect((await store.read()).placements).toEqual({});
  });

  it('keeps the malformed-allowed-tools consent prompt when the YAML value cannot be serialized (a self-referencing anchor)', async () => {
    const fixture = await bareTeam();
    const id = '46464646-4646-4646-8646-464646464646';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nallowed-tools: &a [*a]\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter([], [false]);
    expect(await run({ ref: 'sample', config: store, home: join(fixture.root, 'home') }, io)).toMatchObject({ ok: false, error: expect.stringContaining('malformed allowed-tools') });
    expect(io.askedAbout('despite malformed')).toBe(true);
    expect(io.lines.join('\n')).not.toContain('allowed-tools for sample could not be parsed: ');
    expect(io.details['Install sample despite malformed allowed-tools?']).toEqual([expect.stringMatching(/^allowed-tools for sample could not be parsed: /)]);
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
    // Added only now: the two Global installs above are headless with no --into, and §9.1's headless
    // default only reaches Global while the library has no projects to choose between.
    await store.update((config) => { config.projects = [{ root: checkout, label: 'checkout' }]; });
    expect((await run({ kind: 'project', project: 'product', config: store, home: projectHome, into: checkout, cwd: checkout }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(foreign, 'SKILL.md'), 'utf8')).toBe('user-owned');
    await expect(access(join(checkout, '.claude', 'skills', 'sample', 'SKILL.md'))).resolves.toBeUndefined();
  });

  it('re-installing over an owned placement moves hand edits to quarantine instead of deleting them', async () => {
    const fixture = await bareTeam();
    const id = '55555555-5555-4555-8555-555555555555';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await run({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const placed = join(home, '.claude', 'skills', 'sample');
    await writeFile(join(placed, 'SKILL.md'), 'hand edited');
    const io = new ScriptedPrompter();
    expect((await run({ ref: 'sample', config: store, home }, io)).ok).toBe(true);
    expect(await readFile(join(placed, 'SKILL.md'), 'utf8')).toContain('description: sample');
    const quarantine = join(store.root, 'quarantine');
    const entries = await readdir(quarantine, { recursive: true });
    const copies = await Promise.all(entries.filter((item) => item.endsWith('sample/SKILL.md')).map((item) => readFile(join(quarantine, item), 'utf8')));
    expect(copies).toEqual(['hand edited']);
    expect(io.lines.filter((line) => line.startsWith(`Local changes at ${placed} moved to `))).toHaveLength(1);
  });

  it('places project packages in explicit checkouts from any cwd and refreshes Global from outside', async () => {
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
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.projects = [alphaOne, alphaTwo, beta].map((root) => ({ root, label: basename(root) })); });

    expect((await run({ kind: 'project', project: 'alpha', config: store, home, into: alphaOne, cwd: alphaOne }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(join(alphaOne, '.claude', 'skills', 'project-a', 'SKILL.md'))).resolves.toBeUndefined();
    await expect(access(join(beta, '.claude', 'skills', 'project-a'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(alphaOne, '.git', 'info', 'exclude'), 'utf8')).toContain('.claude/skills/project-a');
    expect(await readFile(join(beta, '.git', 'info', 'exclude'), 'utf8')).not.toContain('.claude/skills/project-a');

    expect((await run({ kind: 'project', project: 'beta', config: store, home, into: beta, cwd: beta }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(join(beta, '.claude', 'skills', 'project-b', 'SKILL.md'))).resolves.toBeUndefined();
    expect(await readFile(join(beta, '.git', 'info', 'exclude'), 'utf8')).toContain('.claude/skills/project-b');
    expect(await readFile(join(alphaOne, '.git', 'info', 'exclude'), 'utf8')).not.toContain('.claude/skills/project-b');

    expect((await run({ kind: 'project', project: 'alpha', config: store, home, into: alphaTwo, cwd: alphaTwo }, new ScriptedPrompter())).ok).toBe(true);
    const alphaPlacements = Object.entries((await store.read()).placements).filter(([, entry]) => entry.id === projectAId && entry.scope.kind === 'project' && entry.scope.project === 'alpha');
    expect(alphaPlacements).toHaveLength(2);
    const installed = JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')).installed;
    expect(installed.filter((entry: { id: string; scope: { kind: string; project?: string } }) => entry.id === projectAId && entry.scope.kind === 'project' && entry.scope.project === 'alpha')).toHaveLength(1);

    const outside = await temporaryDirectory('terum-unmatched-project-');
    const ledgerBeforeOutside = Object.keys((await store.read()).placements);
    const outsideInstall = await run({ kind: 'project', project: 'alpha', config: store, home, into: alphaOne, cwd: outside }, new ScriptedPrompter());
    expect(outsideInstall).toMatchObject({ ok: true, value: [{ path: join(await realpath(alphaOne), '.claude', 'skills', 'project-a') }] });
    expect((await store.read()).pending).toEqual([]);
    expect(Object.keys((await store.read()).placements)).toEqual(ledgerBeforeOutside);
    await expect(access(join(outside, '.claude', 'skills', 'project-a'))).rejects.toMatchObject({ code: 'ENOENT' });

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
      // legacy: two teams bound before the one-team rule (2026-09-08); reads/syncs keep working
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
    expect(await run({ ref: 'other/repo/dup', config: store, home }, new ScriptedPrompter())).toMatchObject({ ok: false, refused: true, error: expect.stringContaining("One team per machine") });
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


it('skillAtSource carries the materialized source body rather than the clone body', async () => {
  const { skillAtSource } = await import('../install.js');
  const { skillRecords } = await import('../../lib/skills.js');
  const fixture = await bareTeam();
  const source = '---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n';
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', source+'clone prose');
  const record = (await skillRecords(fixture.seed, 'team'))[0]!;
  expect(record.body).toBe('clone prose');
  const pinned = join(fixture.root, 'pinned'); await mkdir(pinned);
  await writeFile(join(pinned, 'SKILL.md'), source+'pinned prose');
  expect((await skillAtSource(pinned, record)).body).toBe('pinned prose');
});

it('placementHome finds HOME two segments above the default store root on either separator, and keeps a custom root as its own home', () => {
  // win32 store roots are backslash-separated; a hard-coded `/.terum/skills` suffix missed them and
  // sent global placements to ~\.terum\skills\.claude\skills, where Claude Code never looks.
  expect(placementHome({ root: win32.join('C:\\Users\\me', '.terum', 'skills') }, win32)).toBe('C:\\Users\\me');
  expect(placementHome({ root: 'C:\\Users\\me\\state' }, win32)).toBe('C:\\Users\\me\\state');
  expect(placementHome({ root: posix.join('/home/me', '.terum', 'skills') }, posix)).toBe('/home/me');
  expect(placementHome({ root: '/tmp/terum-test/state' }, posix)).toBe('/tmp/terum-test/state');
  // A test store root that merely LOOKS like the default shape keeps the two-levels-up intent.
  expect(placementHome({ root: posix.join('/tmp/fixture', '.terum', 'skills') }, posix)).toBe('/tmp/fixture');
});

it.each(['refused', 'cancelled'] as const)('zero-team install bootstrap preserves setup %s', async flag => {
  const config = createConfigStore(await temporaryDirectory());
  const spy = vi.spyOn(setup, 'run').mockResolvedValue({ ok: false, error: 'stopped', [flag]: true });
  try {
    expect(await run({ ref: 'acme/team/sample', config }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'stopped', [flag]: true });
    expect(spy).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
});

it('install refusal survives createExecute without bootstrap or runner calls', async () => {
  const config = createConfigStore(await temporaryDirectory());
  await config.update(fresh => { fresh.teams.team = { remote: 'github.com/one/team', handle: 'me' }; });
  const frames: ResultOutcome[] = [];
  const runner = mappedRunner('https://github.com/other/repo.git', '/unused', fakeGh('me'));
  const execute = createExecute({ io: new ScriptedPrompter(), stderr: () => {}, setExitCode: () => {}, result: outcome => frames.push(outcome) });
  await execute(io => run({ config, runner, ref: 'other/repo/skill' }, io), { verb: 'install', notices: false });
  expect(frames).toEqual([expect.objectContaining({ ok: false, refused: true, exitCode: 1 })]);
  expect(runner.calls).toEqual([]);
});

async function destinationFixture() {
  const fixture = await bareTeam();
  const id = 'abababab-abab-4bab-8bab-abababababab';
  const content = `---\nname: sample\ndescription: first\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', content);
  const home = join(fixture.root, 'home');
  const store = createConfigStore(join(home, '.terum', 'skills'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  const checkout = join(fixture.root, 'checkout'); await mkdir(checkout);
  // §7.2: install never adds a project, so a destination has to be in the library beforehand.
  await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.projects = [{ root: checkout, label: 'checkout' }]; });
  return { ...fixture, id, content, home, store, clone, checkout };
}

describe('Library install destinations', () => {
  it('places a Global package in a project, adds nothing to the library, and keeps Global scope', async () => {
    const f = await destinationFixture(); const io = new ScriptedPrompter();
    const before = (await f.store.read()).projects;
    for (let i = 0; i < 2; i++) expect(await run({ ref: 'sample', config: f.store, home: f.home, into: f.checkout }, io)).toMatchObject({ ok: true });
    const root = await realpath(f.checkout); const config = await f.store.read();
    expect(config.projects).toEqual(before);
    expect(config.placements[join(root, '.claude', 'skills', 'sample')]).toMatchObject({ id: f.id, scope: { kind: 'global' } });
    expect(io.lines.some(line => line.startsWith('Added '))).toBe(false);
    await expect(access(join(f.home, '.claude', 'skills', 'sample'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  /** §7.2: "the app never adds a project by itself" — an untracked --into refuses and names `project add`. */
  it('refuses an --into path that is not a project, naming project add, and writes nothing', async () => {
    const f = await destinationFixture(); const outside = join(f.root, 'outside'); await mkdir(outside);
    const result = await run({ ref: 'sample', config: f.store, home: f.home, into: outside }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('project add') });
    expect(result.ok ? '' : result.error).toContain(await realpath(outside));
    expect(await f.store.read()).toMatchObject({ pending: [], placements: {}, projects: [{ root: f.checkout }] });
    await expect(access(join(outside, '.claude'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a missing destination without creating it, intent, or a placement', async () => {
    const f = await destinationFixture(); const missing = join(f.root, 'missing');
    expect(await run({ ref: 'sample', config: f.store, into: missing }, new ScriptedPrompter())).toMatchObject({ ok: false, error: `Project folder ${missing} is missing` });
    await expect(access(missing)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.store.read()).toMatchObject({ pending: [], placements: {} });
  });

  it('offers both matching checkouts without a default or an unregistered cwd choice', async () => {
    const f = await destinationFixture(); const other = join(f.root, 'other'); await mkdir(other);
    await f.store.update(config => { config.projects = [{ root: f.checkout, label: 'checkout' }, { root: other, label: 'other' }]; });
    const { resolveDestination } = await import('../install.js'); const { readTeam } = await import('../../lib/skills.js');
    const team = await readTeam(f.clone); team.projects.alpha = { remotes: ['git@github.com:acme/product.git'], skills: [f.id] };
    const runner = wrapRunner(systemRunner, async () => ({ code: 0, stdout: 'https://github.com/acme/product.git\n', stderr: '' }));
    const io = new ScriptedPrompter([''], [], true);
    expect(await resolveDestination(f.store, team, 'alpha', io, true, { cwd: f.seed, runner, home: f.home })).toEqual({ kind: 'global' });
    expect(io.asked).toEqual(['Install to']);
    expect(io.offered).toEqual([['Global (~/.claude/skills)', `checkout · ${await realpath(f.checkout)}`, `other · ${await realpath(other)}`]]);
    expect(io.offeredDefaults).toEqual([undefined]);
  });

  it('keeps Global first and defaults to the sole origin match; Global packages still ask', async () => {
    const f = await destinationFixture(); await f.store.update(config => { config.projects = [{ root: f.seed, label: 'seed' }]; });
    const { resolveDestination } = await import('../install.js'); const { readTeam } = await import('../../lib/skills.js');
    const team = await readTeam(f.clone); team.projects.alpha = { remotes: [f.bare], skills: [f.id] };
    const io = new ScriptedPrompter(['', ''], [], true);
    const opts = { cwd: f.seed, runner: systemRunner, home: f.home };
    expect(await resolveDestination(f.store, team, 'alpha', io, true, opts)).toEqual({ kind: 'checkout', root: await realpath(f.seed) });
    expect(await resolveDestination(f.store, team, undefined, io, true, opts)).toEqual({ kind: 'global' });
    expect(io.offered[0]?.[0]).toBe('Global (~/.claude/skills)');
    // §7.2 deleted writableCheckout, so no choice is marked "current repository" any more.
    expect(io.offeredDefaults).toEqual([`seed · ${await realpath(f.seed)}`, 'Global (~/.claude/skills)']);
    expect(io.countAsked('Install to')).toBe(2);
    expect(await run({ ref: 'sample', config: f.store }, new NonInteractivePrompter())).toMatchObject({ ok: false, error: 'Pass --into global or --into <project root>' });
  });

  it('updates the version of matching pending intent in place and retains its destination', async () => {
    const f = await destinationFixture();
    const v1 = (await git(['rev-parse', 'HEAD:skills/sample'], f.clone)).trim();
    await pushFromSeed(f.seed, 'skills/sample/SKILL.md', f.content.replace('first', 'second'));
    await git(['fetch', 'origin'], f.clone); await git(['reset', '--hard', 'origin/main'], f.clone);
    const v2 = (await git(['rev-parse', 'HEAD:skills/sample'], f.clone)).trim();
    const target = join(f.checkout, '.claude', 'skills', 'sample'); await mkdir(target, { recursive: true }); await writeFile(join(target, 'SKILL.md'), 'foreign');
    for (const version of [v1, v2]) expect((await run({ ref: `sample@${version}`, into: f.checkout, config: f.store }, new ScriptedPrompter())).ok).toBe(false);
    expect((await f.store.read()).pending).toEqual([expect.objectContaining({ version: v2, destination: { kind: 'checkout', root: await realpath(f.checkout) } })]);
  });

  it('recognizes owned placement through a symlinked parent and keeps one ledger key', async () => {
    const f = await destinationFixture();
    expect((await run({ ref: 'sample', config: f.store, into: f.checkout }, new ScriptedPrompter())).ok).toBe(true);
    const alias = join(f.root, 'alias'); await symlink(f.checkout, alias);
    const { installOne } = await import('../install.js');
    await writeFile(join(f.checkout, '.claude', 'skills', 'sample', 'SKILL.md'), 'local edit');
    await expect(installOne({ team: 'team', id: f.id, destination: { kind: 'checkout', root: alias }, store: f.store, runner: systemRunner }, new ScriptedPrompter())).resolves.toMatchObject({ path: join(alias, '.claude', 'skills', 'sample') });
    expect(Object.keys((await f.store.read()).placements)).toHaveLength(1);
    expect(await readFile(join(alias, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: first');
  });
});


describe('W-02 install progress', () => {
  it.each(['success','no-sink','declined','collision'] as const)('reports only reached steps: %s',async mode=>{
    const f=await bareTeam();const home=join(f.root,'home');const store=createConfigStore(join(f.root,'state'));const id='31313131-3131-4131-8131-313131313131';
    await pushFromSeed(f.seed,'skills/sample/SKILL.md',`---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nallowed-tools: Bash\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await cloneWithIdentity(f.bare,store.teamClone('team'));await store.update(c=>{c.teams.team={remote:f.bare,handle:'seed'};});
    if(mode==='collision'){await mkdir(join(home,'.claude/skills/sample'),{recursive:true});await writeFile(join(home,'.claude/skills/sample/foreign'),'foreign');}
    // Progress rides the prompter (Prompter.progress, the frame channel implements it); a terminal prompter has none.
    const steps:unknown[]=[];const scripted=new ScriptedPrompter([], [mode!=='declined']);
    const io=mode==='no-sink'?scripted:Object.assign(scripted,{progress(update:ProgressUpdate){steps.push([update.step,update.current,update.total]);}});
    const result=await run({ref:'sample',config:store,home},io);
    expect(result.ok).toBe(mode==='success'||mode==='no-sink');
    const expected=[['Reading the team clone',1,4],['Placing sample',2,4],['Publishing to the team repository',3,4],['Recording your install',4,4]];
    expect(steps).toEqual(mode==='no-sink'?[]:expected.slice(0,mode==='declined'?1:mode==='collision'?2:4));
    if(mode==='declined')expect(result).toMatchObject({cancelled:true});
  });
});
