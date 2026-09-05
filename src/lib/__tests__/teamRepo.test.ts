import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GuardError } from '../guard.js';
import { Runner, systemRunner } from '../runner.js';
import { assertSafePath, openTeamRepo, PushRefused, SafeWriteExhausted, treeText } from '../teamRepo.js';
import { createConfigStore } from '../config.js';
import { run as share } from '../../commands/share.js';
import { ScriptedPrompter } from './fixtures.js';
import { bareTeam, cloneWithIdentity, git, originSha, person, pushFromSeed, temporaryDirectory, wrapRunner } from './fixtures.js';

const exists = (path: string) => access(path).then(() => true, () => false);
const personJson = (handle: string) => `${JSON.stringify(person(handle))}\n`;

describe('safeWrite (§6.0)', () => {
  it('regenerates README only for generic remotes before the push', async () => {
    const fixture = await bareTeam();
    const generic = await cloneWithIdentity(fixture.bare, join(fixture.root, 'generic'));
    let genericStaged = '';
    const genericRunner = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push') genericStaged = await git(['show', '--name-only', '--format=', 'HEAD'], generic);
      return next();
    });
    await openTeamRepo(generic, fixture.bare, genericRunner).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me' });
    expect(await readFile(join(generic, 'README.md'), 'utf8')).toContain('<!-- terum-skills:begin -->');
    expect(genericStaged).toContain('README.md');
    const githubFixture = await bareTeam();
    const github = await cloneWithIdentity(githubFixture.bare, join(githubFixture.root, 'github'));
    const publicRemote = 'https://github.com/acme/team.git';
    await git(['remote', 'set-url', 'origin', publicRemote], github);
    let githubStaged = '';
    const runner = wrapRunner(systemRunner, async (command, args, options, next) => {
      if (command === 'git' && args[0] === 'fetch') return { code: 0, stdout: '', stderr: '' };
      if (command === 'git' && args[0] === 'remote' && args[1] === 'get-url') return { code: 0, stdout: `${publicRemote}\n`, stderr: '' };
      if (command === 'git' && args[0] === 'push') { githubStaged = await git(['show', '--name-only', '--format=', 'HEAD'], github); return { code: 1, stdout: '', stderr: 'remote: Permission denied' }; }
      return next();
    });
    await expect(openTeamRepo(github, publicRemote, runner).safeWrite((tree) => tree.set('people/github.json', personJson('github')), { action: 'join', handle: 'github' })).rejects.toThrow(PushRefused);
    expect(githubStaged).not.toContain('README.md');
    expect(await exists(join(github, 'README.md'))).toBe(false);
  });

  it('derives every generic-remote README version from the written index in one ls-tree call', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    let lsTrees = 0;
    const runner = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'ls-tree') lsTrees++;
      return next();
    });
    const skill = '---\nname: new\ndescription: New\nlicense: UNLICENSED\nmetadata:\n  id: 55555555-5555-4555-8555-555555555555\n  author: Me <me@example.com>\n  terum-category: docs\n---\n';
    await openTeamRepo(clone, fixture.bare, runner).safeWrite((tree) => tree.set('skills/new/SKILL.md', skill), { action: 'share', handle: 'me', author: 'Me <me@example.com>' });
    await git(['fetch', '-q', 'origin'], fixture.seed);
    await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    const latest = (await git(['rev-parse', 'main:skills/new'], fixture.bare)).trim();
    expect(await readFile(join(fixture.seed, 'README.md'), 'utf8')).toContain(`| new | docs | New | 0 | — | ${latest.slice(0, 8)} |`);
    expect(lsTrees).toBe(1);
  });

  it('omits a removed tracked person from the regenerated generic-remote README', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'people/me.json', personJson('me'));
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.remove('people/me.json'), { action: 'join', handle: 'me' });
    expect(await readFile(join(clone, 'README.md'), 'utf8')).not.toContain('- @me — me');
  });
  it('lands eight barrier-released writers within the deadline and leaves every clone clean', async () => {
    const fixture = await bareTeam();
    const clones = await Promise.all(Array.from({ length: 8 }, (_, index) => cloneWithIdentity(fixture.bare, join(fixture.root, `clone-${index}`), `User ${index}`, `u${index}@example.com`)));
    let release!: () => void;
    const barrier = new Promise<void>((done) => { release = done; });
    const writers = clones.map(async (clone, index) => {
      await barrier;
      return openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set(`people/u${index}.json`, personJson(`u${index}`)), { action: 'join', handle: `u${index}` });
    });
    release();
    const results = await Promise.all(writers);
    expect(results.every((result) => result.changed && result.pushedTo === 'main')).toBe(true);
    for (const clone of clones) expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
    await git(['fetch', '-q', 'origin'], fixture.seed);
    await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    for (let index = 0; index < 8; index++) expect(await readFile(join(fixture.seed, 'people', `u${index}.json`), 'utf8')).toContain(`"handle":"u${index}"`);
  });

  it('replays a pure mutation on rejection without minting a second value', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    let pushes = 0;
    let executions = 0;
    const runner: Runner = { run(command, args, options) { if (command === 'git' && args[0] === 'push' && pushes++ === 0) return Promise.resolve({ code: 1, stdout: '', stderr: ' ! [rejected]        HEAD -> main (fetch first)\nerror: failed to push some refs' }); return systemRunner.run(command, args, options); } };
    const id = '4e80fd2a-04bc-4d9f-88f7-a849d92879f1';
    await openTeamRepo(clone, fixture.bare, runner).safeWrite((tree) => { executions++; tree.set('people/me.json', personJson('me').replace('{', `{"id":"${id}",`)); }, { action: 'join', handle: 'me', deadlineMs: 5_000 });
    expect(executions).toBe(2);
    await git(['fetch', '-q', 'origin'], fixture.seed);
    await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    expect(await readFile(join(fixture.seed, 'people', 'me.json'), 'utf8')).toContain(id);
  });

  it('deadline exhaustion resets to origin/main, removes what it created, and fails loudly', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    let clock = 0;
    const rejecting: Runner = { run(command, args, options) { if (command === 'git' && args[0] === 'push') return Promise.resolve({ code: 1, stdout: '', stderr: ' ! [rejected]        HEAD -> main (non-fast-forward)' }); return systemRunner.run(command, args, options); } };
    await expect(openTeamRepo(clone, fixture.bare, rejecting).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me', deadlineMs: 1, now: () => clock, sleep: async () => { clock = 2; } })).rejects.toThrow(SafeWriteExhausted);
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).toBe((await git(['rev-parse', 'origin/main'], clone)).trim());
    expect(await exists(join(clone, 'people', 'me.json'))).toBe(false);
  });

  it('a guard rejection pushes nothing, leaves the clone clean, and removes the folder it created', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const before = await originSha(fixture.bare);
    await expect(openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('skills/new/SKILL.md', '---\nname: new\n---\n'), { action: 'join', handle: 'me' })).rejects.toThrow(GuardError);
    expect(await originSha(fixture.bare)).toBe(before);
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
    expect(await exists(join(clone, 'skills', 'new'))).toBe(false);
  });

  it('stages only the mutation: an untracked file in the clone is neither pushed nor deleted', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    await writeFile(join(clone, 'junk.txt'), 'stray');
    await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me' });
    expect(await readFile(join(clone, 'junk.txt'), 'utf8')).toBe('stray');
    expect((await git(['ls-tree', '--name-only', 'main'], fixture.bare))).not.toContain('junk.txt');
    expect((await git(['ls-tree', '--name-only', 'main:people'], fixture.bare))).toContain('me.json');
  });

  it('a permission or protection refusal fails fast with git\'s own message, never a 30 s retry loop', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    let pushes = 0;
    const denied: Runner = { run(command, args, options) { if (command === 'git' && args[0] === 'push') { pushes++; return Promise.resolve({ code: 1, stdout: '', stderr: 'remote: Permission to acme/skills.git denied to bob.\nfatal: unable to access' }); } return systemRunner.run(command, args, options); } };
    await expect(openTeamRepo(clone, fixture.bare, denied).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me' })).rejects.toThrow(PushRefused);
    await expect(openTeamRepo(clone, fixture.bare, denied).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me' })).rejects.toThrow(/Permission to acme\/skills\.git denied/);
    expect(pushes).toBe(2);
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
    const protectedBranch: Runner = { run(command, args, options) { if (command === 'git' && args[0] === 'push') return Promise.resolve({ code: 1, stdout: '', stderr: ' ! [remote rejected] HEAD -> publish/x (protected branch hook declined)' }); return systemRunner.run(command, args, options); } };
    await expect(openTeamRepo(clone, fixture.bare, protectedBranch).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me', branch: 'publish/x' })).rejects.toThrow(/protected branch hook declined/);
    expect((await git(['branch', '--list', 'publish/x-2'], fixture.bare)).trim()).toBe('');
  });

  it('refuses unsafe paths inside the mutation and refuses a clone that points at a different remote', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    for (const bad of ['../escape.json', '/etc/passwd', '.git/config', '.Git/config', '.GIT/hooks/pre-commit', 'skills/x/.git/config', 'skills/x/GIT~1/config', 'people/../team.json', 'a/./b', 'a//b', 'people\\me.json', 'people/', '']) expect(() => assertSafePath(bad), bad).toThrow(GuardError);
    for (const good of ['people/me.json', 'skills/x/SKILL.md', 'skills/x/.gitkeep', 'team.json']) expect(() => assertSafePath(good), good).not.toThrow();
    await expect(openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('../escape.json', '{}'), { action: 'join', handle: 'me' })).rejects.toThrow(GuardError);
    let mutated = false;
    await expect(openTeamRepo(clone, 'https://github.com/someone/else.git').safeWrite(() => { mutated = true; }, { action: 'join', handle: 'me' })).rejects.toThrow('wrong repository');
    expect(mutated).toBe(false);
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
  });

  it('a refused path never reaches the working tree, and a .Git spelling cannot touch the clone\'s git config', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const configBefore = await readFile(join(clone, '.git', 'config'), 'utf8');
    await expect(openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('.Git/config', '[core]\n'), { action: 'join', handle: 'me' })).rejects.toThrow(GuardError);
    expect(await readFile(join(clone, '.git', 'config'), 'utf8')).toBe(configBefore);
    await expect(openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('skills/new/SKILL.md', 'x'), { action: 'join', handle: 'me' })).rejects.toThrow(GuardError);
    expect(await exists(join(clone, 'skills', 'new'))).toBe(false);
  });

  it('never writes or deletes through a symlinked parent that leaves the clone', async () => {
    const fixture = await bareTeam();
    const outside = await temporaryDirectory();
    await writeFile(join(outside, 'me.json'), 'precious');
    // The team repo commits `people` as a symlink pointing outside any clone.
    await git(['rm', '-r', '-q', 'people'], fixture.seed);
    await symlink(outside, join(fixture.seed, 'people'));
    await git(['add', '--all'], fixture.seed);
    await git(['commit', '-q', '-m', 'symlink'], fixture.seed);
    await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    await expect(openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me' })).rejects.toThrow(/outside the clone|symlink/);
    expect(await readFile(join(outside, 'me.json'), 'utf8')).toBe('precious');
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
  });

  it('serializes two writers on the same clone and lands both', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const repo = openTeamRepo(clone, fixture.bare);
    await Promise.all(['a', 'b'].map((handle) => repo.safeWrite((tree) => tree.set(`people/${handle}.json`, personJson(handle)), { action: 'join', handle })));
    expect((await git(['ls-tree', '--name-only', 'main:people'], fixture.bare)).split('\n')).toEqual(expect.arrayContaining(['a.json', 'b.json']));
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
  });

  it('permits the archive-only roster mutation and uses the handle-prefixed commit message', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'), 'Admin', 'admin@example.com');
    await openTeamRepo(clone, fixture.bare).safeWrite((tree) => {
      const team = JSON.parse(treeText(tree.after('team.json')!));
      team.archived.push('seed');
      tree.set('team.json', `${JSON.stringify(team)}\n`);
    }, { action: 'team-remove', handle: 'admin', targetHandle: 'seed' });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).archived).toEqual(['seed']);
    expect((await git(['log', '-1', '--format=%s', 'main'], fixture.bare)).trim()).toBe('admin: team-remove');
  });

  it('a non-main branch is pushed under a lease and origin/main is byte-identical; a stale lease falls back to -2', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const mainBefore = await originSha(fixture.bare);
    const first = await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me', branch: 'publish/x' });
    expect(first.pushedTo).toBe('publish/x');
    expect(await originSha(fixture.bare)).toBe(mainBefore);
    expect(await git(['ls-tree', '--name-only', 'publish/x:people'], fixture.bare)).toContain('me.json');
    const second = await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('people/me.json', personJson('me').replace('""', '"v2"')), { action: 'join', handle: 'me', branch: 'publish/x' });
    expect(second.pushedTo).toBe('publish/x');
    let injected = false;
    const racing = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && !injected) {
        injected = true;
        await git(['push', '-q', '-f', 'origin', 'HEAD:refs/heads/publish/x'], fixture.seed); // someone else moved the branch after our fetch
      }
      return next();
    });
    const third = await openTeamRepo(clone, fixture.bare, racing).safeWrite((tree) => tree.set('people/me.json', personJson('me').replace('""', '"v3"')), { action: 'join', handle: 'me', branch: 'publish/x' });
    expect(third.pushedTo).toBe('publish/x-2');
    expect(await git(['ls-tree', '--name-only', 'publish/x-2:people'], fixture.bare)).toContain('me.json');
    expect(await originSha(fixture.bare)).toBe(mainBefore);
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
  });

  it('a mutation that sees the fresh tree can react to a concurrent change', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    let pushes = 0;
    const racing = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && pushes++ === 0) await pushFromSeed(fixture.seed, 'people/taken.json', personJson('taken'));
      return next();
    });
    const seen: boolean[] = [];
    await openTeamRepo(clone, fixture.bare, racing).safeWrite((tree) => { seen.push(tree.before('people/taken.json') !== undefined); tree.set('people/me.json', personJson('me')); }, { action: 'join', handle: 'me' });
    expect(seen).toEqual([false, true]);
  });

  it('writes a Buffer SKILL.md byte-for-byte instead of decoding it through UTF-8', async () => {
    const fixture = await bareTeam();
    const id = '11111111-1111-4111-8111-111111111111';
    const initial = `---\nname: binary\ndescription: binary\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Me <me@example.com>\n  terum-category: testing\n---\n`;
    await pushFromSeed(fixture.seed, 'skills/binary/SKILL.md', initial);
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const payload = Buffer.concat([Buffer.from(initial), Buffer.from([0xff, 0xfe, 0x80])]);
    await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('skills/binary/SKILL.md', payload), { action: 'sync', handle: 'me', author: 'Me <me@example.com>' });
    expect(await readFile(join(clone, 'skills', 'binary', 'SKILL.md'))).toEqual(payload);
  });

  it('lists the tree as mutated, including additions and excluding removals', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/x/SKILL.md', 'skill');
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    let observed = false;
    await expect(openTeamRepo(clone, fixture.bare).safeWrite((tree) => {
      tree.set('people/new.json', personJson('new'));
      tree.remove('skills/x/SKILL.md');
      expect(tree.paths('people/')).toContain('people/new.json');
      expect(tree.paths('skills/x/')).not.toContain('skills/x/SKILL.md');
      observed = true;
    }, { action: 'join', handle: 'new' })).rejects.toThrow(GuardError);
    expect(observed).toBe(true);
  });

  it('lands eight barrier-released real shares with unique IDs and leaves every clone clean', async () => {
    const fixture = await bareTeam();
    const stores = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const store = createConfigStore(join(fixture.root, `state-${index}`));
      const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'), `User ${index}`, `u${index}@example.com`);
      await store.update((config) => { config.display_name = `User ${index}`; config.email = `u${index}@example.com`; config.teams.team = { remote: fixture.bare, token: null, handle: `u${index}` }; });
      const source = join(fixture.root, `skill-${index}`); await mkdir(source);
      await writeFile(join(source, 'SKILL.md'), `---\nname: skill-${index}\ndescription: skill ${index}\nmetadata:\n  terum-category: testing\n---\n`);
      return { store, clone, source };
    }));
    let release!: () => void;
    const barrier = new Promise<void>((done) => { release = done; });
    const writes = stores.map(async ({ store, source }) => { await barrier; return share({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [true])); });
    release();
    const results = await Promise.all(writes);
    expect(results.every((result) => result.ok)).toBe(true);
    for (const { clone } of stores) expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
    const ids = await Promise.all(Array.from({ length: 8 }, (_, index) => git(['show', `main:skills/skill-${index}/SKILL.md`], fixture.bare).then((source) => /^\s+id:\s+(.+)$/m.exec(source)?.[1])));
    expect(new Set(ids).size).toBe(8);
  });
});
