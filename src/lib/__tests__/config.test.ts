import { chmod, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getStartedLines } from '../invocation.js';
import { createConfigStore, selectTeam } from '../config.js';
import { emptyConfig } from '../schema.js';
import { temporaryDirectory } from './fixtures.js';

describe('config store (§5.4)', () => {
  it('reads an empty config when the file is absent and round-trips unknown fields', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'skills'));
    expect(await store.read()).toEqual(emptyConfig());
    await store.update((config) => { (config as Record<string, unknown>).future = { keep: true }; config.default_handle = 'me'; });
    const back = await store.read();
    expect(back.default_handle).toBe('me');
    expect((back as Record<string, unknown>).future).toEqual({ keep: true });
  });

  it('writes mode 0600 through a temp file, creates a 0700 root, and leaves no temp files behind', async () => {
    const root = join(await temporaryDirectory(), 'skills');
    const store = createConfigStore(root);
    await store.update((config) => { config.teams.t = { remote: 'github.com/a/t', handle: 'me' }; });
    expect(((await stat(join(root, 'config.json'))).mode & 0o777).toString(8)).toBe('600');
    expect(((await stat(root)).mode & 0o777).toString(8)).toBe('700');
    expect(((await stat(join(root, 'teams'))).mode & 0o777).toString(8)).toBe('700');
    expect((await readdir(root)).filter((name) => name.includes('.tmp'))).toEqual([]);
    expect((await store.read()).teams.t?.handle).toBe('me');
  });

  it.skipIf(process.platform === 'win32')('tightens a pre-existing world-readable root and teams directory back to 0700 on ensureRoot', async () => {
    const root = join(await temporaryDirectory(), 'skills');
    await mkdir(join(root, 'teams'), { recursive: true });
    // Explicit chmods: mkdir's mode is umask-masked, so it cannot stage the loose case reliably.
    await chmod(root, 0o755); await chmod(join(root, 'teams'), 0o755);
    await createConfigStore(root).ensureRoot();
    expect(((await stat(root)).mode & 0o777).toString(8)).toBe('700');
    expect(((await stat(join(root, 'teams'))).mode & 0o777).toString(8)).toBe('700');
  });

  it.skipIf(process.platform === 'win32')('refuses a root that is a symlink instead of tightening whatever it points at', async () => {
    const base = await temporaryDirectory();
    const elsewhere = join(base, 'elsewhere'); await mkdir(elsewhere); await chmod(elsewhere, 0o755);
    const root = join(base, 'skills'); await symlink(elsewhere, root);
    await expect(createConfigStore(root).ensureRoot()).rejects.toThrow('not a plain directory');
    expect(((await stat(elsewhere)).mode & 0o777).toString(8)).toBe('755');
  });

  it('migrates a pre-rev-9 config on read: a handle-less entry is dropped, a retired token is dropped, and the next write leaves neither on disk', async () => {
    const root = join(await temporaryDirectory(), 'skills');
    const store = createConfigStore(root);
    await store.ensureRoot();
    const legacy = { teams: { t: { remote: 'github.com/a/t', token: 'ghp_old', handle: 'me' }, unbound: { remote: 'github.com/a/u', token: 'ghp_unbound', handle: null } }, shared: {}, approvals: {}, pending: [], placements: {} };
    await writeFile(join(root, 'config.json'), JSON.stringify(legacy));
    expect((await store.read()).teams).toEqual({ t: { remote: 'github.com/a/t', handle: 'me' } });
    await store.update((config) => { config.default_handle = 'me'; });
    const written = await readFile(join(root, 'config.json'), 'utf8');
    expect(written).not.toContain('ghp_');
    expect(written).not.toContain('unbound');
    expect(JSON.parse(written).teams).toEqual({ t: { remote: 'github.com/a/t', handle: 'me' } });
  });

  // D72's taken medium (B3 full review, schema.ts:245): §3.4's read-time migrations — `migrateVersion`
  // (40-hex tree hash → null) and `migrateScope` (any-case `global` project → `Global`) — rewrite every
  // user's placement ledger on first read, and the next `update()` makes that rewrite permanent on disk.
  // Through the store rather than the schema so the test fails if EITHER half stops: the read no
  // longer migrating, or the write no longer persisting what the read produced.
  it('migrates placements and pending on read (40-hex version → null), leaves every other row untouched, and the next update makes the rewrite permanent on disk', async () => {
    const root = join(await temporaryDirectory(), 'skills');
    const store = createConfigStore(root);
    await store.ensureRoot();
    const hash = '0123456789abcdef0123456789abcdef01234567';
    const id = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const row = (version: string | null, scope: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, team: 'acme', version, scope, placed_at: '2026-01-01T00:00:00Z', fingerprint: 'fp', ...extra });
    const seeded = {
      teams: {}, approvals: {},
      pending: [{ op: 'install', id, team: 'acme', scope: { kind: 'project', project: 'global' }, started: '2026-01-01T00:00:00Z', version: hash }],
      placements: {
        '/h/hash': row(hash, { kind: 'global' }),
        '/h/v3': row('v3', { kind: 'global' }),
        '/h/null': row(null, { kind: 'global' }),
        '/h/lower': row('v1', { kind: 'project', project: 'global' }, { note: 'kept' }),
        '/h/upper': row('v1', { kind: 'project', project: 'GLOBAL' }),
        '/h/exact': row('v1', { kind: 'project', project: 'Global' }),
        '/h/other': row('v1', { kind: 'project', project: 'terum' }),
        '/h/global-kind': row('v1', { kind: 'global' }),
      },
    };
    await writeFile(join(root, 'config.json'), JSON.stringify(seeded));
    // Only the 40-hex version becomes null. Nothing rewrites a scope's project name any more: there is
    // no reserved `Global` project, so a stored spelling is display text and is carried verbatim.
    const migrated = {
      pending: [{ ...seeded.pending[0]!, version: null }],
      placements: { ...seeded.placements, '/h/hash': { ...seeded.placements['/h/hash'], version: null } },
    };
    const first = await store.read();
    expect(first.placements).toEqual(migrated.placements);
    expect(first.pending).toEqual(migrated.pending);
    // Persisted by an UNRELATED change: the migration rides along with whatever the next verb writes.
    await store.update((config) => { config.default_handle = 'me'; });
    const written = await readFile(join(root, 'config.json'), 'utf8');
    expect(written).not.toContain(hash);
    const onDisk = JSON.parse(written) as { placements: unknown; pending: unknown; default_handle: unknown };
    expect(onDisk.placements).toEqual(migrated.placements);
    expect(onDisk.pending).toEqual(migrated.pending);
    expect(onDisk.default_handle).toBe('me');
    // Idempotent: a second read of the already-migrated bytes changes nothing.
    expect(await store.read()).toEqual({ ...first, default_handle: 'me' });
  });

  // legacy: two teams bound before the one-team rule (2026-09-08); reads/syncs keep working
  it('serializes concurrent updates so neither is lost', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'skills'));
    await Promise.all(Array.from({ length: 6 }, (_, index) => store.update(async (config) => {
      await new Promise((done) => setTimeout(done, 5));
      config.teams[`t${index}`] = { remote: `github.com/a/t${index}`, handle: 'me' };
    })));
    expect(Object.keys((await store.read()).teams).sort()).toEqual(['t0', 't1', 't2', 't3', 't4', 't5']);
  });

  it('a throwing mutate leaves the file byte-identical and releases the lock for the next update', async () => {
    const root = join(await temporaryDirectory(), 'skills');
    const store = createConfigStore(root);
    await store.update((config) => { config.default_handle = 'me'; });
    const before = await readFile(join(root, 'config.json'), 'utf8');
    await expect(store.update((config) => { config.default_handle = 'changed'; throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe(before);
    await store.update((config) => { config.default_handle = 'next'; });
    expect((await store.read()).default_handle).toBe('next');
    expect((await readdir(root)).filter((name) => name.includes('.lock'))).toEqual([]);
  });

  it('a corrupt config.json is reported, never silently replaced by an empty one', async () => {
    const root = join(await temporaryDirectory(), 'skills');
    const store = createConfigStore(root);
    await store.ensureRoot();
    await writeFile(join(root, 'config.json'), '{not json');
    await expect(store.read()).rejects.toThrow(/Invalid .*config\.json/);
    await expect(store.update((config) => { config.default_handle = 'me'; })).rejects.toThrow(/Invalid .*config\.json/);
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe('{not json');
  });

  it('refuses a team name that would escape the teams directory', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'skills'));
    for (const bad of ['../x', 'a/b', '.hidden', '']) expect(() => store.teamClone(bad), bad).toThrow('Invalid team name');
    expect(store.teamClone('team-skills-terum')).toBe(join(store.root, 'teams', 'team-skills-terum'));
  });
  it('a lock lost to another process during the mutate aborts before the write and leaves the file byte-identical', async () => {
    const root = join(await temporaryDirectory(), 'skills');
    const store = createConfigStore(root, { lockStale: 2_000 });
    await store.update((config) => { config.default_handle = 'me'; });
    const before = await readFile(join(root, 'config.json'), 'utf8');
    await expect(store.update(async (config) => {
      await rm(join(root, 'config.json.lock'), { recursive: true, force: true });
      // proper-lockfile notices on its next 1000 ms tick (its floor), in that tick's async stat callback.
      await new Promise((done) => setTimeout(done, 3_000));
      config.default_handle = 'stale-snapshot';
    })).rejects.toThrow(/Lost the lock/);
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe(before);
    await store.update((config) => { config.default_handle = 'next'; });
    expect((await store.read()).default_handle).toBe('next');
  });

});


describe('guarded config removal', () => {
  it('keeps a configured team byte-identically when the guard refuses', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'state'));
    await store.update((c) => { c.teams.t = { remote: 'github.com/a/t', handle: 'me' }; });
    const path = join(store.root, 'config.json'); const before = await readFile(path, 'utf8');
    expect(await store.remove((c) => Object.keys(c.teams).length === 0)).toBe('kept');
    expect(await readFile(path, 'utf8')).toBe(before);
    await expect(stat(`${path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('removes an empty config under its lock and leaves no lock behind', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'state'));
    await store.update(() => undefined);
    expect(await store.remove(() => true)).toBe('removed');
    await expect(stat(join(store.root, 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(store.root, 'config.json.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('returns absent without creating a root or calling the guard', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'state'));
    expect(await store.remove(() => { throw new Error('must not run'); })).toBe('absent');
    await expect(stat(store.root)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('recreates config through update after removal', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'state'));
    await store.update(() => undefined); await store.remove(() => true);
    await store.update((c) => { c.teams.new = { remote: 'github.com/a/new', handle: 'me' }; });
    expect((await store.read()).teams.new).toEqual({ remote: 'github.com/a/new', handle: 'me' });
  });
});

it.each([undefined, 'bare'] as const)('uses the shared setup hints for zero teams (form=%s)', (form) => {
  expect(() => selectTeam(emptyConfig().teams, undefined, form)).toThrow(getStartedLines(form).join('\n'));
});
