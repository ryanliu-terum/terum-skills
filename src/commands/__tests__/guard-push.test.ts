import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { systemRunner } from '../../lib/runner.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { run } from '../guardPush.js';

const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';
const skill = (name: string, id: string, author: string, body = 'body') => `---\nname: ${name}\ndescription: d\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: ${author}\n  terum-category: testing\n---\n${body}\n`;
const ZERO = '0'.repeat(40);
const ZERO_SHA256 = '0'.repeat(64); // git's null OID in an --object-format=sha256 repository

async function prepared() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/mine/SKILL.md', skill('mine', MINE, 'Seed <seed@example.com>'));
  await pushFromSeed(fixture.seed, 'skills/theirs/SKILL.md', skill('theirs', THEIRS, 'Other <other@example.com>'));
  await pushFromSeed(fixture.seed, 'skills/theirs/references/note.md', 'their aux file\n');
  await pushFromSeed(fixture.seed, 'people/other.json', `${JSON.stringify(person('other'), null, 2)}\n`);
  const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'), 'Seed', 'seed@example.com');
  await store.update((config) => { config.display_name = 'Seed'; config.email = 'seed@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const main = (await git(['rev-parse', 'origin/main'], clone)).trim();
  return { fixture, store, clone, main };
}

/** Reset the clone to origin/main, apply `change` to its working tree, commit everything, and return the commit sha. */
async function commitChange(clone: string, change: () => Promise<void>, message = 'raw change'): Promise<string> {
  await git(['reset', '-q', '--hard', 'origin/main'], clone);
  await change();
  await git(['add', '--all'], clone);
  await git(['commit', '-q', '-m', message], clone);
  return (await git(['rev-parse', 'HEAD'], clone)).trim();
}

/** Commit one file on top of origin/main in the clone and return the commit sha (the clone's HEAD is reset first). */
async function commitOnMain(clone: string, path: string, content: string): Promise<string> {
  return commitChange(clone, async () => {
    await mkdir(join(clone, path, '..'), { recursive: true });
    await writeFile(join(clone, path), content);
  }, `raw: ${path}`);
}

describe('guard-push — the clone-local pre-push hook entry (D12)', () => {
  it('lets your own skill edit and your own people file through, refuses another author\'s skill and someone else\'s people file, and names the path', async () => {
    const { fixture, store, clone, main } = await prepared();
    const own = await commitOnMain(clone, 'skills/mine/SKILL.md', skill('mine', MINE, 'Seed <seed@example.com>', 'edited'));
    const io = new ScriptedPrompter();
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', own, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { team: 'team', checked: 1 } });
    const ownPeople = await commitOnMain(clone, 'people/seed.json', `${JSON.stringify(person('seed', { bio: 'hi' }), null, 2)}\n`);
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', ownPeople, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { checked: 1 } });
    const foreign = await commitOnMain(clone, 'skills/theirs/SKILL.md', skill('theirs', THEIRS, 'Other <other@example.com>', 'meddled'));
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', foreign, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused skills/theirs/SKILL.md') });
    const aux = await commitOnMain(clone, 'skills/theirs/references/note.md', 'an aux file in a folder that is not mine');
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', aux, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused skills/theirs/references/note.md') });
    const otherPeople = await commitOnMain(clone, 'people/other.json', `${JSON.stringify(person('other', { bio: 'rewritten by seed' }), null, 2)}\n`);
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', otherPeople, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused people/other.json') });
  });

  it('holds team.json to the publish, remove and rejoin shapes; checks a new branch against main; refuses every deletion and every non-branch ref; refuses an unjoined remote', async () => {
    const { fixture, store, clone, main } = await prepared();
    const team = JSON.parse(await git(['show', 'origin/main:team.json'], clone));
    const endorsed = await commitOnMain(clone, 'team.json', `${JSON.stringify({ ...team, global: [MINE] }, null, 2)}\n`);
    const io = new ScriptedPrompter();
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/publish/mine', endorsed, 'refs/heads/publish/mine', ZERO], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { checked: 1 } });
    const renamed = await commitOnMain(clone, 'team.json', `${JSON.stringify({ ...team, name: 'hijacked' }, null, 2)}\n`);
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', renamed, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused team.json') });
    const selfArchived = await commitOnMain(clone, 'team.json', `${JSON.stringify({ ...team, archived: ['seed'] }, null, 2)}\n`);
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', selfArchived, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused team.json') });
    const otherArchived = await commitOnMain(clone, 'team.json', `${JSON.stringify({ ...team, archived: ['other'] }, null, 2)}\n`);
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', otherArchived, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { checked: 1 } });
    // A deletion is pure loss the guard cannot attribute: a teammate's pending publish branch exists nowhere else.
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['(delete)', ZERO, 'refs/heads/publish/mine', endorsed], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused deleting refs/heads/publish/mine') });
    // `git push --prune` arrives as one delete line per remote branch this clone does not carry — main itself included; the first refusal aborts the whole push.
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['(delete)', ZERO, 'refs/heads/main', main, '(delete)', ZERO, 'refs/heads/publish/theirs', endorsed], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused deleting refs/heads/main') });
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/tags/v1', endorsed, 'refs/tags/v1', ZERO], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused refs/tags/v1') });
    // The same two markers as a sha-256 repository spells them: a 64-zero null OID is still "new branch" and "deletion", never an object to diff.
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/publish/mine', endorsed, 'refs/heads/publish/mine', ZERO_SHA256], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { checked: 1 } });
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['(delete)', ZERO_SHA256, 'refs/heads/publish/mine', endorsed], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused deleting') });
    expect(await run({ remote: 'origin', url: 'https://github.com/nobody/nothing.git', refs: ['refs/heads/main', endorsed, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('is not a team this machine has joined') });
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', endorsed, 'refs/heads/main'], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('groups') });
  });

  it('judges a new branch from its fork point, so main advancing under it with a teammate\'s commit is not charged to the pusher; an existing branch is judged against what it replaces; no base at all is a refusal', async () => {
    const { fixture, store, clone } = await prepared();
    const own = await commitOnMain(clone, 'skills/mine/SKILL.md', skill('mine', MINE, 'Seed <seed@example.com>', 'edited'));
    await pushFromSeed(fixture.seed, 'skills/theirs/SKILL.md', skill('theirs', THEIRS, 'Other <other@example.com>', 'moved on'));
    await git(['fetch', '-q', 'origin'], clone);
    const advanced = (await git(['rev-parse', 'origin/main'], clone)).trim();
    const io = new ScriptedPrompter();
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/publish/mine', own, 'refs/heads/publish/mine', ZERO], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { checked: 1 } });
    // Pushing the same commit OVER the advanced main would undo the teammate's commit: that is what a force-push replaces, and it is refused by name.
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', own, 'refs/heads/main', advanced], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused skills/theirs/SKILL.md') });
    await git(['update-ref', '-d', 'refs/remotes/origin/main'], clone);
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/publish/mine', own, 'refs/heads/publish/mine', ZERO], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringMatching(/origin\/main could not be resolved[\s\S]*git push --no-verify/) });
    // git hands the hook the push target as `$1` — the credentialed URL itself when someone pushes by URL — and neither a refusal nor a git argument may echo it.
    const argv: string[][] = [];
    const recording = wrapRunner(systemRunner, async (command, args, _options, next) => { if (command === 'git') argv.push([...args]); return next(); });
    expect(await run({ remote: 'https://user:ghp_secret_token@github.com/org/team.git', url: fixture.bare, refs: ['refs/heads/publish/mine', own, 'refs/heads/publish/mine', ZERO], cwd: clone, config: store, runner: recording }, io)).toMatchObject({ ok: false, error: expect.not.stringContaining('ghp_secret_token') });
    expect(argv.flat().some((arg) => arg.includes('ghp_secret_token'))).toBe(false);
    expect(argv.some((args) => args[0] === 'rev-parse' && args.some((arg) => arg.startsWith('refs/remotes/') && arg.includes('github.com/org/team')))).toBe(true);
    // ...but a NAME is not a URL: a remote called `up@stream` must survive whole into `refs/remotes/<name>/main` and into a remedy that can be run.
    expect(await run({ remote: 'up@stream', url: fixture.bare, refs: ['refs/heads/publish/mine', own, 'refs/heads/publish/mine', ZERO], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Run `git fetch up@stream`') });
  });

  it('re-voices a failure that is not a verdict — a corrupt config.json — so the blocked push still names the guard and the attributed bypass', async () => {
    const { fixture, store, clone, main } = await prepared();
    const own = await commitOnMain(clone, 'skills/mine/SKILL.md', skill('mine', MINE, 'Seed <seed@example.com>', 'edited'));
    await writeFile(join(store.root, 'config.json'), '{ this is not json');
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', own, 'refs/heads/main', main], cwd: clone, config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringMatching(/^Push guard could not run: Invalid[\s\S]*git push --no-verify/) });
  });

  it('sees the path a rename takes away — a teammate\'s folder cannot be taken over by moving it and rewriting the author, nor their aux file by moving it into yours — and reads a non-ASCII path verbatim', async () => {
    const { fixture, store, clone, main } = await prepared();
    const io = new ScriptedPrompter();
    const taken = await commitChange(clone, async () => {
      await git(['mv', 'skills/theirs', 'skills/theirs-taken'], clone);
      await writeFile(join(clone, 'skills', 'theirs-taken', 'SKILL.md'), skill('theirs-taken', THEIRS, 'Seed <seed@example.com>'));
    });
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', taken, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused skills/theirs/SKILL.md') });
    const moved = await commitChange(clone, async () => {
      await mkdir(join(clone, 'skills', 'mine', 'references'), { recursive: true });
      await git(['mv', 'skills/theirs/references/note.md', 'skills/mine/references/note.md'], clone);
    });
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', moved, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused skills/theirs/references/note.md') });
    const accented = await commitOnMain(clone, 'skills/mine/references/café.md', 'notes with an accent in the file name\n');
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', accented, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { checked: 1 } });
  });

  it('judges every group of a multi-ref push, accumulating the count, and names the missing local identity rather than ownership when the config has no name and email', async () => {
    const { fixture, store, clone, main } = await prepared();
    const own = await commitOnMain(clone, 'skills/mine/SKILL.md', skill('mine', MINE, 'Seed <seed@example.com>', 'edited'));
    const ownPeople = await commitOnMain(clone, 'people/seed.json', `${JSON.stringify(person('seed', { bio: 'hi' }), null, 2)}\n`);
    const foreign = await commitOnMain(clone, 'skills/theirs/SKILL.md', skill('theirs', THEIRS, 'Other <other@example.com>', 'meddled'));
    const io = new ScriptedPrompter();
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', own, 'refs/heads/main', main, 'refs/heads/publish/x', foreign, 'refs/heads/publish/x', ZERO], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('Push guard refused skills/theirs/SKILL.md') });
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', own, 'refs/heads/main', main, 'refs/heads/publish/x', ownPeople, 'refs/heads/publish/x', ZERO], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { checked: 2 } });
    await store.update((config) => { delete config.display_name; delete config.email; });
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', own, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringMatching(/no name and email[\s\S]*terum-skills login/) });
  });
});
