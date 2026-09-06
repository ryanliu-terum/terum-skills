import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../config.js';
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
      await new Promise((done) => setTimeout(done, 1_500));
      config.default_handle = 'stale-snapshot';
    })).rejects.toThrow(/Lost the lock/);
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe(before);
    await store.update((config) => { config.default_handle = 'next'; });
    expect((await store.read()).default_handle).toBe('next');
  });

});
