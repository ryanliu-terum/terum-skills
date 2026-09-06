import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../guardPush.js';

const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';
const skill = (name: string, id: string, author: string, body = 'body') => `---\nname: ${name}\ndescription: d\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: ${author}\n  terum-category: testing\n---\n${body}\n`;
const ZERO = '0'.repeat(40);

async function prepared() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/mine/SKILL.md', skill('mine', MINE, 'Seed <seed@example.com>'));
  await pushFromSeed(fixture.seed, 'skills/theirs/SKILL.md', skill('theirs', THEIRS, 'Other <other@example.com>'));
  await pushFromSeed(fixture.seed, 'people/other.json', `${JSON.stringify(person('other'), null, 2)}\n`);
  const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'), 'Seed', 'seed@example.com');
  await store.update((config) => { config.display_name = 'Seed'; config.email = 'seed@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const main = (await git(['rev-parse', 'origin/main'], clone)).trim();
  return { fixture, store, clone, main };
}

/** Commit one file on top of origin/main in the clone and return the commit sha (the clone's HEAD is reset first). */
async function commitOnMain(clone: string, path: string, content: string): Promise<string> {
  await git(['reset', '-q', '--hard', 'origin/main'], clone);
  await mkdir(join(clone, path, '..'), { recursive: true });
  await writeFile(join(clone, path), content);
  await git(['add', '--all'], clone);
  await git(['commit', '-q', '-m', `raw: ${path}`], clone);
  return (await git(['rev-parse', 'HEAD'], clone)).trim();
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

  it('holds team.json to the publish, remove and rejoin shapes; checks a new branch against origin/main; lets a deletion through; refuses an unjoined remote', async () => {
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
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['(delete)', ZERO, 'refs/heads/publish/mine', endorsed], cwd: clone, config: store }, io)).toMatchObject({ ok: true, value: { checked: 0 } });
    expect(await run({ remote: 'origin', url: 'https://github.com/nobody/nothing.git', refs: ['refs/heads/main', endorsed, 'refs/heads/main', main], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('is not a team this machine has joined') });
    expect(await run({ remote: 'origin', url: fixture.bare, refs: ['refs/heads/main', endorsed, 'refs/heads/main'], cwd: clone, config: store }, io)).toMatchObject({ ok: false, error: expect.stringContaining('groups') });
  });
});
