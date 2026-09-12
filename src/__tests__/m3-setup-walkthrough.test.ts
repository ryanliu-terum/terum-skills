import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCOVER_QUESTION, run as setup } from '../commands/setup.js';
import { createConfigStore } from '../lib/config.js';
import { HOOK_ENTRY, installHook } from '../lib/hook.js';
import { fakeGh, git, mappedRunner, ScriptedPrompter, temporaryDirectory, wrapperFor } from '../lib/__tests__/fixtures.js';

const REMOTE = 'https://github.com/alice/team.git';
const hookFor = (root: string, name: string) => ({ settingsFile: join(root, `${name}.json`), backupDir: join(root, `${name}-backups`) });

describe('M3 setup walkthrough', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('gives each participating machine exactly one canonical session-start entry', async () => {
    const root = await temporaryDirectory('terum-m3-setup-');
    const alice = hookFor(root, 'alice'); const bob = hookFor(root, 'bob');
    await installHook(alice); await installHook(bob);
    expect(JSON.parse(await readFile(alice.settingsFile, 'utf8')).hooks.SessionStart).toEqual([HOOK_ENTRY]);
    expect(JSON.parse(await readFile(bob.settingsFile, 'utf8')).hooks.SessionStart).toEqual([HOOK_ENTRY]);
  });

  it('onboards Alice and Bob without publishing either machine’s local skills', async () => {
    const root = await temporaryDirectory('terum-m3-setup-');
    const aliceStore = createConfigStore(join(root, 'alice-state'));
    const bare = join(root, 'team.git'); await git(['init', '-q', '--bare', bare]);
    const aliceRunner = mappedRunner(REMOTE, bare, fakeGh('alice', { 'repo create team --private': { code: 0, stdout: '', stderr: '' }, 'repo view team --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'alice/team\n', stderr: '' } }));
    const aliceIo = new ScriptedPrompter(['Create a new team', 'team', '', '', 'Alice', 'alice@example.com', 'team', ''], [false, false, false], true);
    const alice = await setup({ app: false, config: aliceStore, home: join(root, 'alice-home'), runner: aliceRunner, hook: hookFor(root, 'alice-setup'), wrapper: wrapperFor(join(root, 'alice-home')), communityUrl: '' }, aliceIo);
    expect(alice).toMatchObject({ ok: true, value: { steps: { team: 'done', invite: 'skipped', done: 'printed' } } });
    expect(aliceIo.asked).toContain(DISCOVER_QUESTION);
    // A newly created, empty team has no candidate to offer for evaluation.
    expect(aliceIo.asked).not.toContain('Evaluate the 0 shared skills that have no receipt yet? This runs Claude on each one and records results locally.');
  });
});
