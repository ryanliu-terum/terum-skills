import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GuardError } from '../guard.js';
import { Runner, systemRunner } from '../runner.js';
import { assertSafePath, CloneBusy, cloneTeam, openTeamRepo, pushGuardHook, PushRefused, refreshClone, SafeWriteExhausted, treeText } from '../teamRepo.js';
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

  it('a non-main branch is created, never replaced: origin/main is byte-identical, a name already on the remote is refused with nothing overwritten, and a branch that appears mid-write survives with no fallback name', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const mainBefore = await originSha(fixture.bare);
    const first = await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me', branch: 'publish/x' });
    expect(first.pushedTo).toBe('publish/x');
    expect(await originSha(fixture.bare)).toBe(mainBefore);
    expect(await git(['ls-tree', '--name-only', 'publish/x:people'], fixture.bare)).toContain('me.json');
    const firstSha = await originSha(fixture.bare, 'publish/x');
    // The same name again — even by the same writer — is a refusal, not a refresh (R2: one fresh branch per publish).
    await expect(openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('people/me.json', personJson('me').replace('""', '"v2"')), { action: 'join', handle: 'me', branch: 'publish/x' })).rejects.toBeInstanceOf(PushRefused);
    expect(await originSha(fixture.bare, 'publish/x')).toBe(firstSha);
    expect((await git(['branch', '--list', 'publish/x-2'], fixture.bare)).trim()).toBe('');
    // Someone creates the name after our fetch and before our push: theirs stands, ours is refused, no fallback name.
    let injected = false;
    const racing = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && !injected) {
        injected = true;
        await git(['push', '-q', 'origin', 'HEAD:refs/heads/publish/y'], fixture.seed);
      }
      return next();
    });
    const theirs = (await git(['rev-parse', 'HEAD'], fixture.seed)).trim();
    await expect(openTeamRepo(clone, fixture.bare, racing).safeWrite((tree) => tree.set('people/me.json', personJson('me').replace('""', '"v3"')), { action: 'join', handle: 'me', branch: 'publish/y' })).rejects.toBeInstanceOf(PushRefused);
    expect(await originSha(fixture.bare, 'publish/y')).toBe(theirs);
    expect((await git(['branch', '--list', 'publish/y*'], fixture.bare)).trim()).toBe('publish/y');
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
      await store.update((config) => { config.display_name = `User ${index}`; config.email = `u${index}@example.com`; config.teams.team = { remote: fixture.bare, handle: `u${index}` }; });
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

  it('never echoes a credential in the wrong-repository or failed-clone messages', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    await git(['remote', 'set-url', 'origin', 'https://me:tok@github.com/acme/team.git'], clone);
    let mutated = false;
    const wrong = await openTeamRepo(clone, 'https://me:tok@github.com/someone/else.git').safeWrite(() => { mutated = true; }, { action: 'join', handle: 'me' }).then(() => '', (error: Error) => error.message);
    expect(mutated).toBe(false);
    expect(wrong).toContain('points at https://github.com/acme/team.git, not https://github.com/someone/else.git');
    expect(wrong).not.toContain('tok');
    expect(wrong).not.toContain('@');
    const refusing: Runner = { async run(command, args, options) { if (command === 'git' && args[0] === 'clone') return { code: 1, stdout: '', stderr: `fatal: repository '${args[args.length - 2]}' not found` }; return systemRunner.run(command, args, options); } };
    const failed = await cloneTeam('https://me:tok@github.com/acme/team.git', join(fixture.root, 'dest'), refusing).then(() => '', (error: Error) => error.message);
    expect(failed).toContain("Could not clone https://github.com/acme/team.git: fatal: repository 'https://github.com/acme/team.git' not found");
    expect(failed).not.toContain('tok');
    expect(failed).not.toContain('@');
  });
  it('retries ref-lock contention on a derived branch; a commit pushed in between is never overwritten and gets no fallback name; a protected-branch refusal is one push and a PushRefused', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    let pushes = 0;
    const contended = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && pushes++ === 0) return { code: 1, stdout: '', stderr: "error: cannot lock ref 'refs/heads/publish/x': is at abc but expected def" };
      return next();
    });
    const result = await openTeamRepo(clone, fixture.bare, contended).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me', branch: 'publish/x', deadlineMs: 5_000 });
    expect(result.pushedTo).toBe('publish/x');
    expect(pushes).toBe(2);
    // Contention, and someone lands on publish/y before our retry: the name now exists, so the retry is refused and theirs stands — no fallback name.
    let racing = 0;
    const raced = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && racing++ === 0) {
        await git(['push', '-q', 'origin', 'HEAD:refs/heads/publish/y'], fixture.seed);
        return { code: 1, stdout: '', stderr: "error: cannot lock ref 'refs/heads/publish/y'" };
      }
      return next();
    });
    const theirs = (await git(['rev-parse', 'HEAD'], fixture.seed)).trim();
    await expect(openTeamRepo(clone, fixture.bare, raced).safeWrite((tree) => tree.set('people/me.json', personJson('me').replace('""', '"y"')), { action: 'join', handle: 'me', branch: 'publish/y', deadlineMs: 5_000 })).rejects.toBeInstanceOf(PushRefused);
    expect(await originSha(fixture.bare, 'publish/y')).toBe(theirs);
    expect((await git(['branch', '--list', 'publish/y-2'], fixture.bare)).trim()).toBe('');
    let refused = 0;
    const protectedBranch: Runner = { run(command, args, options) { if (command === 'git' && args[0] === 'push') { refused++; return Promise.resolve({ code: 1, stdout: '', stderr: ' ! [remote rejected] HEAD -> publish/z (protected branch hook declined)' }); } return systemRunner.run(command, args, options); } };
    await expect(openTeamRepo(clone, fixture.bare, protectedBranch).safeWrite((tree) => tree.set('people/me.json', personJson('me').replace('""', '"v2"')), { action: 'join', handle: 'me', branch: 'publish/z' })).rejects.toBeInstanceOf(PushRefused);
    expect(refused).toBe(1);
    expect((await git(['branch', '--list', 'publish/z*'], fixture.bare)).trim()).toBe('');
  });

  it('a deletion is restored by the finally when the push is refused, lands when it is not, and a byte-identical rewrite is no change', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'people/gone.json', personJson('gone'));
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const denied: Runner = { run(command, args, options) { if (command === 'git' && args[0] === 'push') return Promise.resolve({ code: 1, stdout: '', stderr: 'remote: Permission denied' }); return systemRunner.run(command, args, options); } };
    await expect(openTeamRepo(clone, fixture.bare, denied).safeWrite((tree) => tree.remove('people/gone.json'), { action: 'join', handle: 'gone' })).rejects.toThrow(PushRefused);
    expect(await exists(join(clone, 'people', 'gone.json'))).toBe(true);
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
    expect(await git(['ls-tree', '--name-only', 'main:people'], fixture.bare)).toContain('gone.json');
    expect(await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.remove('people/gone.json'), { action: 'join', handle: 'gone' })).toEqual({ changed: true, pushedTo: 'main' });
    expect(await git(['ls-tree', '--name-only', 'main:people'], fixture.bare)).not.toContain('gone.json');
    expect(await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('people/seed.json', tree.before('people/seed.json')!), { action: 'join', handle: 'seed' })).toEqual({ changed: false, pushedTo: 'main' });
  });

  it('refreshClone re-checks its lock before the reset: a fetch that outlives the stale window does not rewind the writer that took the lock', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    await writeFile(join(clone, 'stray.txt'), 'local'); await git(['add', '--all'], clone); await git(['commit', '-q', '-m', 'local-only'], clone);
    const head = (await git(['rev-parse', 'HEAD'], clone)).trim();
    const lock = join(fixture.root, '.clone.safewrite.lock');
    // The lock is stolen during the fetch. proper-lockfile refreshes on a tick clamped to
    // max(min(update, stale/2), 1000) = 1000 ms here and records the loss only in that tick's async
    // stat callback, so the wait must clear one full tick plus slack for a busy event loop.
    const slow = wrapRunner(systemRunner, async (command, args, _options, next) => {
      const result = await next();
      if (command === 'git' && args[0] === 'fetch') { await rm(lock, { recursive: true, force: true }); await new Promise((done) => setTimeout(done, 3_000)); }
      return result;
    });
    const lost = refreshClone(slow, clone, { lockStale: 2_000 });
    await expect(lost).rejects.toThrow(/Lost the safeWrite lock/);
    await expect(lost).rejects.toBeInstanceOf(CloneBusy);
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).toBe(head);
    await refreshClone(systemRunner, clone);
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).not.toBe(head);
  });

  it('a lock lost to another process aborts before the push and does NOT reset the clone, which that process now owns', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const lock = join(fixture.root, '.clone.safewrite.lock');
    // Steal the lock while our commit is being made; proper-lockfile notices on its next 1000 ms tick
    // (its floor), in that tick's async stat callback, so the wait clears a full tick plus slack.
    const stolen = wrapRunner(systemRunner, async (command, args, _options, next) => {
      const result = await next();
      if (command === 'git' && args[0] === 'commit') { await rm(lock, { recursive: true, force: true }); await new Promise((done) => setTimeout(done, 3_000)); }
      return result;
    });
    const before = await originSha(fixture.bare);
    await expect(openTeamRepo(clone, fixture.bare, stolen).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me', lockStale: 2_000 })).rejects.toThrow(/Lost the safeWrite lock/);
    expect(await originSha(fixture.bare)).toBe(before);
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).not.toBe((await git(['rev-parse', 'origin/main'], clone)).trim());
    // The next write resets the clone itself and lands.
    expect(await openTeamRepo(clone, fixture.bare).safeWrite((tree) => tree.set('people/me.json', personJson('me')), { action: 'join', handle: 'me' })).toEqual({ changed: true, pushedTo: 'main' });
  });

});

describe('the clone-local push guard arming (D12)', () => {
  /**
   * Drive a hook the way git does: arguments plus the ref lines on stdin. An absolute `/bin/sh`, because the
   * npx-fallback case strips PATH and a PATH-resolved shell would then fail to spawn at all; and an explicit
   * child env, as in bin.test.ts — no inherited NODE_OPTIONS and no node warnings, either of which would
   * break the exact `stderr: ''` below for reasons unrelated to the guard. PATH stays: the hook body runs `cat`.
   */
  const sh = (script: string, args: string[], stdin: string, env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' }) => new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn('/bin/sh', [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env });
    const out: Buffer[] = []; const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('close', (code) => done({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
    child.stdin.end(stdin);
  });

  // POSIX-only: the case drives the generated `#!/bin/sh` hook through `sh`, which Windows has no portable path to.
  it.skipIf(process.platform === 'win32')('cloneTeam arms the guard: the hook at 0700 with core.hooksPath pinned to the clone; the hook turns git\'s stdin lines into arguments, quotes its launcher, fails open when its launcher is gone, and never falls back to `@latest`', async () => {
    const fixture = await bareTeam();
    const clone = join(fixture.root, 'armed');
    await cloneTeam(fixture.bare, clone);
    const hook = join(clone, '.git', 'hooks', 'pre-push');
    expect((await stat(hook)).mode & 0o777).toBe(0o700);
    // Under the TypeScript sources there is no built entry, so the arming falls back to npx pinned to this package's version.
    const { version } = createRequire(import.meta.url)('../../../package.json') as { version: string };
    expect(await readFile(hook, 'utf8')).toContain(`terum-skills@${version}' guard-push`);
    expect((await git(['config', '--local', 'core.hooksPath'], clone)).trim()).toBe('.git/hooks');
    // The body, driven the way git drives it, with a stub launcher that echoes its arguments and exits 3: two stdin lines become one flat argument list, and the launcher's exit status is the hook's.
    const stub = join(fixture.root, 'stub.js');
    await writeFile(stub, 'console.log(process.argv.slice(2).join(" ")); process.exit(3);\n');
    const armed = join(fixture.root, 'armed.sh');
    await writeFile(armed, pushGuardHook({ node: process.execPath, entry: stub }));
    const ran = await sh(armed, ['origin', 'https://x/y.git'], 'refs/heads/main a1 refs/heads/main b2\nrefs/heads/x c3 refs/heads/publish/x 00\n');
    expect(ran).toEqual({ code: 3, stdout: 'guard-push origin https://x/y.git refs/heads/main a1 refs/heads/main b2 refs/heads/x c3 refs/heads/publish/x 00\n', stderr: '' });
    const gone = join(fixture.root, 'gone.sh');
    await writeFile(gone, pushGuardHook({ node: process.execPath, entry: join(fixture.root, 'missing.js') }));
    const skipped = await sh(gone, ['origin', 'https://x/y.git'], 'refs/heads/main a1 refs/heads/main b2\n');
    expect(skipped.code).toBe(0);
    expect(skipped.stdout).toBe('');
    expect(skipped.stderr).toContain('NOT checked');
    // The launcher is quoted, not merely interpolated: a directory with a space and a quote in its name is still one word to the shell.
    const awkward = join(fixture.root, "a dir's name");
    await mkdir(awkward, { recursive: true });
    const awkwardStub = join(awkward, 'stub.js');
    await writeFile(awkwardStub, 'console.log(process.argv.slice(2).join(" ")); process.exit(3);\n');
    const quoted = join(fixture.root, 'quoted.sh');
    await writeFile(quoted, pushGuardHook({ node: process.execPath, entry: awkwardStub }));
    expect(await sh(quoted, ['origin', 'https://x/y.git'], 'refs/heads/main a1 refs/heads/main b2\n')).toEqual({ code: 3, stdout: 'guard-push origin https://x/y.git refs/heads/main a1 refs/heads/main b2\n', stderr: '' });
    // The npx fallback's fail-open, run rather than read: with no npx on PATH the hook warns and exits 0 instead of blocking the push.
    const fallback = join(fixture.root, 'fallback.sh');
    await writeFile(fallback, pushGuardHook(null));
    const withoutNpx = await sh(fallback, ['origin', 'https://x/y.git'], 'refs/heads/main a1 refs/heads/main b2\n', { PATH: join(fixture.root, 'no-npx'), NODE_NO_WARNINGS: '1' });
    expect(withoutNpx.code).toBe(0);
    expect(withoutNpx.stderr).toContain('NOT checked');
    expect(pushGuardHook(null)).toContain(`terum-skills@${version}`);
    expect(pushGuardHook(null)).not.toContain('@latest');
  });
});
