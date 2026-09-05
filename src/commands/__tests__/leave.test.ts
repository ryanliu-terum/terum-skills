import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { cloneLockPath } from '../../lib/teamRepo.js';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { place } from '../../lib/placer.js';
import { bareTeam, cloneWithIdentity, git, originSha, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../leave.js';
import { installHook } from '../../lib/hook.js';

async function prepared() {
  const fixture = await bareTeam(); const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  const source = join(fixture.root, 'source'); await mkdir(source); await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: 22222222-2222-4222-8222-222222222222\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n');
  const root = join(fixture.root, 'home', '.claude', 'skills'); const placed = await place(source, root, 'sample');
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.placements[placed.path] = { id: '22222222-2222-4222-8222-222222222222', team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-01-01', fingerprint: placed.snapshot.fingerprint }; config.shared.sample = { source, team: 'team' }; config.pending.push({ op: 'install', id: '22222222-2222-4222-8222-222222222222', team: 'team', scope: { kind: 'global' }, started: '2026-01-01' }); config.approvals.keep = { grants: 'sha256:x', approved_at: '2026-01-01' }; });
  return { fixture, store, clone, placed };
}

describe('team leave (§6)', () => {
  it('removes only local state and leaves the team repository unchanged', async () => {
    const { fixture, store, placed } = await prepared(); const before = await originSha(fixture.bare);
    const personBefore = await git(['show', 'main:people/seed.json'], fixture.bare);
    const cache = join(store.root, 'cache', 'team', 'cached-version'); const stamp = join(store.root, 'run', 'team.stamp');
    await mkdir(cache, { recursive: true }); await mkdir(join(store.root, 'run'), { recursive: true }); await writeFile(stamp, 'stamp');
    await expect(run({ name: 'team', config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: true, value: { removed: 1, cloneRemoved: true } });
    await expect(access(placed.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(cache)).rejects.toMatchObject({ code: 'ENOENT' }); await expect(access(stamp)).rejects.toMatchObject({ code: 'ENOENT' });
    const config = await store.read(); expect(config.teams).toEqual({}); expect(config.placements).toEqual({}); expect(config.pending).toEqual([]); expect(config.shared).toEqual({}); expect(config.approvals.keep).toBeDefined();
    expect(await originSha(fixture.bare)).toBe(before);
    expect(await git(['show', 'main:people/seed.json'], fixture.bare)).toBe(personBefore);
  });

  it('does nothing when declined, quarantines edits, and then becomes idempotently unconfigured', async () => {
    const { store, placed } = await prepared();
    await expect(run({ name: 'team', config: store }, new ScriptedPrompter([], [false]))).resolves.toMatchObject({ ok: false, error: 'Leave was cancelled.' });
    await expect(access(placed.path)).resolves.toBeUndefined();
    await writeFile(join(placed.path, 'SKILL.md'), `${await readFile(join(placed.path, 'SKILL.md'), 'utf8')}edited\n`);
    const io = new ScriptedPrompter([], [true]); await expect(run({ name: 'team', config: store }, io)).resolves.toMatchObject({ ok: true });
    expect(io.lines.join('\n')).toContain('moved to');
    await expect(run({ name: 'team', config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'Team team is not configured.' });
  });

  it('leaves one configured team without disturbing another, then leaves the other', async () => {
    const { fixture, store } = await prepared();
    const other = await bareTeam();
    const otherClone = await cloneWithIdentity(other.bare, store.teamClone('other'));
    const source = join(fixture.root, 'other-source'); await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: other-sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: 33333333-3333-4333-8333-333333333333\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n');
    const otherPlaced = await place(source, join(fixture.root, 'other-home', '.claude', 'skills'), 'other-sample');
    await store.update((config) => {
      config.teams.other = { remote: other.bare, handle: 'seed' };
      config.placements[otherPlaced.path] = { id: '33333333-3333-4333-8333-333333333333', team: 'other', version: null, scope: { kind: 'global' }, placed_at: '2026-01-01', fingerprint: otherPlaced.snapshot.fingerprint };
    });
    await expect(run({ name: 'team', config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: true, value: { team: 'team' } });
    await expect(access(otherPlaced.path)).resolves.toBeUndefined(); await expect(access(otherClone)).resolves.toBeUndefined();
    expect((await store.read()).teams.other).toEqual({ remote: other.bare, handle: 'seed' });
    await expect(run({ name: 'other', config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: true, value: { team: 'other' } });
    await expect(access(otherPlaced.path)).rejects.toMatchObject({ code: 'ENOENT' }); await expect(access(otherClone)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.read()).teams).toEqual({});
  });

  it('keeps the hook while another team remains and removes it after the last team leaves', async () => {
    const { fixture, store } = await prepared();
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    const hook = { settingsFile: join(fixture.root, 'settings.json'), backupDir: join(fixture.root, 'backups') };
    await installHook(hook);
    await expect(run({ name: 'team', config: store, hook }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(await readFile(hook.settingsFile, 'utf8')).hooks.SessionStart).toHaveLength(1);
    const io = new ScriptedPrompter([], [true]);
    await expect(run({ name: 'other', config: store, hook }, io)).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(await readFile(hook.settingsFile, 'utf8')).hooks).toBeUndefined();
    expect(io.lines).toContain(`Removed the session hook from ${hook.settingsFile}.`);
  });

  it('refuses a ledger path outside a skills directory and keeps the team configured', async () => {
    const { fixture, store } = await prepared();
    const elsewhere = join(fixture.root, 'documents', 'thing'); await mkdir(elsewhere, { recursive: true }); await writeFile(join(elsewhere, 'file.txt'), 'keep');
    await store.update((config) => { config.placements[elsewhere] = { id: '44444444-4444-4444-8444-444444444444', team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-01-01', fingerprint: 'sha256:bogus' }; });
    await expect(run({ name: 'team', config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: false, error: expect.stringContaining('not a skills directory') });
    expect(await readFile(join(elsewhere, 'file.txt'), 'utf8')).toBe('keep');
    expect((await store.read()).teams.team).toBeDefined();
  });

  it('cleans config when a partially completed leave already removed the clone', async () => {
    const { store, clone } = await prepared();
    await rm(clone, { recursive: true, force: true });
    await expect(run({ name: 'team', config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: true, value: { cloneRemoved: false } });
    expect((await store.read()).teams).toEqual({});
  });
  it('removes what the ledger says AFTER the prompt, so a placement renamed while the question waited is still removed', async () => {
    const { store, placed } = await prepared();
    const renamed = join(placed.path, '..', 'sample-renamed');
    class RenamingPrompter extends ScriptedPrompter {
      override async confirm(question: string): Promise<boolean> {
        // What a hook sync's rename does: the folder moves and the ledger key follows it.
        await rename(placed.path, renamed);
        await store.update((config) => { const entry = config.placements[placed.path]!; delete config.placements[placed.path]; config.placements[renamed] = entry; });
        return super.confirm(question);
      }
    }
    await expect(run({ name: 'team', config: store }, new RenamingPrompter([], [true]))).resolves.toMatchObject({ ok: true, value: { removed: 1 } });
    await expect(access(renamed)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.read()).placements).toEqual({});
  });

  it('a placement whose parent directory is gone is dropped from the ledger without recreating the tree', async () => {
    const { store, placed } = await prepared();
    const parent = join(placed.path, '..', '..');
    await rm(parent, { recursive: true, force: true });
    await expect(run({ name: 'team', config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: true, value: { removed: 1 } });
    await expect(access(parent)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.read()).placements).toEqual({});
  });

  it('waits for, then refuses, a clone another operation is writing to, and removes nothing meanwhile', async () => {
    const { store, clone, placed } = await prepared();
    const release = await lockfile.lock(clone, { lockfilePath: cloneLockPath(clone), realpath: false, stale: 60_000 });
    try {
      await expect(run({ name: 'team', config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/lock/i) });
      await expect(access(clone)).resolves.toBeUndefined();
      // The placement itself was already removed before the clone step; the config still names the team.
      await expect(access(placed.path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await store.read()).teams.team).toBeDefined();
    } finally { await release(); }
    await expect(run({ name: 'team', config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: true, value: { cloneRemoved: true } });
    await expect(access(cloneLockPath(clone))).rejects.toMatchObject({ code: 'ENOENT' });
  });

});
