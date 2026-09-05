import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as publish } from '../commands/publish.js';
import { run as setup } from '../commands/setup.js';
import { run as sync } from '../commands/sync.js';
import { createConfigStore } from '../lib/config.js';
import { HOOK_ENTRY, installHook } from '../lib/hook.js';
import { fakeGh, git, mappedRunner, ScriptedPrompter, temporaryDirectory } from '../lib/__tests__/fixtures.js';

const REMOTE = 'https://github.com/alice/team.git';
const hookFor = (root: string, name: string) => ({ settingsFile: join(root, `${name}.settings.json`), backupDir: join(root, `${name}-backups`) });

async function emptyBare(root: string): Promise<string> {
  const bare = join(root, 'team.git');
  await git(['init', '-q', '--bare', bare]);
  return bare;
}

describe('M3 setup walkthrough', () => {
  it('gives each participating machine exactly one canonical session-start entry', async () => {
    const root = await temporaryDirectory('terum-m3-setup-');
    const alice = { settingsFile: join(root, 'alice.json'), backupDir: join(root, 'alice-backups') };
    const bob = { settingsFile: join(root, 'bob.json'), backupDir: join(root, 'bob-backups') };
    await installHook(alice); await installHook(bob);
    expect(JSON.parse(await readFile(alice.settingsFile, 'utf8')).hooks.SessionStart).toEqual([HOOK_ENTRY]);
    expect(JSON.parse(await readFile(bob.settingsFile, 'utf8')).hooks.SessionStart).toEqual([HOOK_ENTRY]);
  });

  it('takes Alice and Bob through setup, then delivers Alice’s published skill on Bob’s next sync', async () => {
    const root = await temporaryDirectory('terum-m3-setup-');
    const bare = await emptyBare(root);
    const aliceHome = join(root, 'alice-home'); const bobHome = join(root, 'bob-home');
    const aliceStore = createConfigStore(join(root, 'alice-state'));
    const aliceRunner = mappedRunner(REMOTE, bare, fakeGh('alice', {
      'repo create team --private': { code: 0, stdout: '', stderr: '' },
      'repo view team --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'alice/team\n', stderr: '' },
      'api -X PUT --include repos/alice/team/collaborators/bob': { code: 0, stdout: 'HTTP/2 201\n', stderr: '' },
    }));
    const source = join(aliceHome, '.claude', 'skills', 'sample');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: setup walkthrough skill\nmetadata:\n  terum-category: testing\n---\n');
    const aliceIo = new ScriptedPrompter(['team', '', '', 'Alice', 'alice@example.com', 'team', 'sample', 'bob'], [true, true]);
    const alice = await setup({ config: aliceStore, home: aliceHome, runner: aliceRunner, hook: hookFor(root, 'alice'), communityUrl: '' }, aliceIo);
    if (!alice.ok) throw new Error(alice.error);
    expect(alice.value.steps).toMatchObject({ team: 'done', actions: 'done', invite: 'done', hook: 'done', done: 'printed' });
    expect(aliceIo.lines).toContain('  @alice — Alice');
    expect(aliceRunner.calls.filter((call) => call.command === 'git' && call.args[0] === 'push')).toHaveLength(2);

    const bobStore = createConfigStore(join(root, 'bob-state'));
    const bobRunner = mappedRunner(REMOTE, bare, fakeGh('bob', { 'api user/repository_invitations': { code: 0, stdout: '[]', stderr: '' } }));
    const bobIo = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com'], [true]);
    const bob = await setup({ target: 'alice/team', config: bobStore, home: bobHome, runner: bobRunner, hook: hookFor(root, 'bob'), communityUrl: '' }, bobIo);
    if (!bob.ok) throw new Error(bob.error);
    expect(bob.value.steps).toMatchObject({ team: 'done', actions: 'skipped', invite: 'skipped', hook: 'done', done: 'printed' });
    expect(bobIo.countAsked('team-endorsed')).toBe(0);
    expect(bobIo.countAsked('Install the Claude Code session-start hook')).toBe(1);
    expect(bobIo.lines).toEqual(expect.arrayContaining(['  @alice — Alice', '  @bob — Bob']));
    expect(bobRunner.calls.filter((call) => call.command === 'git' && call.args[0] === 'push')).toHaveLength(1);

    const publishRunner = mappedRunner(REMOTE, bare, (args, options) => args[0] === 'pr'
      ? { code: 0, stdout: 'https://github.com/alice/team/pull/1\n', stderr: '' }
      : fakeGh('alice')(args, options));
    const published = await publish({ ref: 'sample', config: aliceStore, runner: publishRunner }, new ScriptedPrompter());
    if (!published.ok) throw new Error(published.error);
    expect(published.value).toMatchObject({ policy: 'pr', branch: 'publish/sample' });
    await git(['fetch', 'origin'], aliceStore.teamClone('team'));
    await git(['push', 'origin', 'refs/remotes/origin/publish/sample:main'], aliceStore.teamClone('team'));

    const syncIo = new ScriptedPrompter([], [true], true);
    const synchronized = await sync({ config: bobStore, runner: bobRunner }, syncIo);
    if (!synchronized.ok) throw new Error(synchronized.error);
    expect(syncIo.countAsked('Install 1 newly endorsed skill(s) from team?')).toBe(1);
    expect((await git(['ls-tree', '--name-only', 'main:people'], bare)).split('\n').filter(Boolean).sort()).toEqual(['alice.json', 'bob.json']);
    expect(await git(['ls-tree', '--name-only', 'main:skills'], bare)).toContain('sample');
    for (const name of ['alice', 'bob']) expect(JSON.parse(await readFile(hookFor(root, name).settingsFile, 'utf8')).hooks.SessionStart).toEqual([HOOK_ENTRY]);
  });
});
