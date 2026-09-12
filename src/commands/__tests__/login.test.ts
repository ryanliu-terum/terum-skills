import { readFile, writeFile, stat } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { run as login } from '../login.js';
import { createConfigStore } from '../../lib/config.js';
import { fakeGh, ghOnlyRunner, noGhRunner, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';

describe('login (§6, rev 9 Decision 4: bare, no team entry, no token)', () => {
  it('with gh logged in, records identity from the gh defaults, writes no team entry, and stores config 0600', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    const io = new ScriptedPrompter(['', '', 'Ryan', 'ryan@example.com']);
    const result = await login({ config: store, runner: ghOnlyRunner(fakeGh('octocat')) }, io);
    expect(result).toEqual({ ok: true, value: { gh: { installed: true, authenticated: true }, handle: 'octocat', updated: [], notice: null } });
    const config = await store.read();
    expect(config).toMatchObject({ default_handle: 'octocat', github: 'octocat', display_name: 'Ryan', email: 'ryan@example.com' });
    expect(config.teams).toEqual({});
    expect(((await stat(pathJoin(store.root, 'config.json'))).mode & 0o777).toString(8)).toBe('600');
    expect(io.lines.some((line) => line.includes('gh is logged in'))).toBe(true);
    expect(io.asked.some((question) => /PAT|token/i.test(question))).toBe(false);
  });

  it('with gh installed but logged out, makes the gh auth login offer once on an interactive channel and never asks for a token', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    const runner = ghOnlyRunner(fakeGh('octocat', {}, false));
    const io = new ScriptedPrompter(['', 'ryan', 'Ryan', 'ryan@example.com'], [true], true);
    const result = await login({ config: store, runner }, io);
    expect(result).toMatchObject({ ok: true, value: { gh: { installed: true, authenticated: true }, handle: 'ryan' } });
    expect(io.countAsked('gh auth login')).toBe(1);
    expect(runner.calls.filter((call) => call.args.join(' ') === 'auth login')).toHaveLength(1);
    expect(io.asked.some((question) => /PAT|token/i.test(question))).toBe(false);
    expect((await store.read()).teams).toEqual({});
    // Declined: identity is still saved, the message says what a GitHub team needs, and nothing else is asked.
    const declined = new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com'], [false], true);
    const outcome = await login({ config: createConfigStore(pathJoin(await temporaryDirectory(), 'skills')), runner: ghOnlyRunner(fakeGh('me', {}, false)) }, declined);
    expect(outcome).toMatchObject({ ok: true, value: { gh: { installed: true, authenticated: false } } });
    expect(declined.lines.some((line) => line.includes('logged out'))).toBe(true);
  });

  it('without gh at all, still records identity and says what a GitHub team would need', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
    const result = await login({ config: store, runner: noGhRunner }, io);
    expect(result).toEqual({ ok: true, value: { gh: { installed: false, authenticated: false }, handle: 'me', updated: [], notice: null } });
    expect(io.lines.some((line) => line.includes('not installed'))).toBe(true);
    expect((await store.read())).toMatchObject({ default_handle: 'me', teams: {} });
  });

  it('leaves existing team bindings untouched and refreshes only the machine-wide identity', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    await store.update((config) => { config.teams.team = { remote: 'github.com/acme/team', handle: 'bound' }; config.default_handle = 'bound'; });
    const io = new ScriptedPrompter(['', 'newdefault', 'Other Name', 'other@example.com']);
    const result = await login({ config: store, runner: ghOnlyRunner(fakeGh('octocat')) }, io);
    expect(result).toMatchObject({ ok: true, value: { handle: 'newdefault' } });
    const config = await store.read();
    expect(config.teams).toEqual({ team: { remote: 'github.com/acme/team', handle: 'bound' } });
    expect(config).toMatchObject({ default_handle: 'newdefault', display_name: 'Other Name', email: 'other@example.com', github: 'octocat' });
  });

  it('a closed prompt is a clean failure that writes nothing', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    expect(await login({ config: store, runner: noGhRunner }, new ScriptedPrompter(['me']))).toMatchObject({ ok: false, error: expect.stringContaining('Input ended before') });
    expect((await store.read()).default_handle).toBeUndefined();
  });
});


describe('login --set (MC-11)', () => {
  const notice = (name: string, email = 'seed@example.com') => `This changes the author line (${name} <${email}>) that publish writes into the skills you publish from this machine; versions already published keep their recorded author.`;
  async function fixture() {
    const store = createConfigStore(await temporaryDirectory());
    await store.update(config => { config.display_name = 'Seed'; config.email = 'seed@example.com'; config.default_handle = 'seed'; config.github = 'seed'; config.teams.acme = { remote: 'github.com/acme/team', handle: 'seed' }; config.extra = { nested: ['a', { name: 'Seed' }], unicode: '雪' }; });
    const path = pathJoin(store.root, 'config.json');
    // Hand formatting, nested matching names and escaped text are all unrelated bytes.
    const raw = JSON.stringify(await store.read()).replace('"Seed"', '"Se\\u0065d"') + '\n';
    await writeFile(path, raw);
    return { store, path, raw };
  }
  it('changes only display_name bytes, prints before disk write, and never probes or asks', async () => {
    const { store, path, raw } = await fixture();
    const runner = { run: vi.fn(() => { throw new Error('No probe allowed'); }) };
    const io = new ScriptedPrompter();
    const originalUpdate = store.update.bind(store);
    vi.spyOn(store, 'update').mockImplementation((mutate, options) => originalUpdate(async fresh => {
      await mutate(fresh);
      expect(io.lines).toEqual([notice('Ryan = Liu')]);
      expect(await readFile(path, 'utf8')).toBe(raw);
    }, options));
    expect(await login({ config: store, runner, set: ['name=Ryan = Liu'] }, io)).toEqual({ ok: true, value: { gh: null, handle: 'seed', updated: [{ key: 'name', value: 'Ryan = Liu' }], notice: notice('Ryan = Liu') } });
    expect(await readFile(path, 'utf8')).toBe(raw.replace('"Se\\u0065d"', '"Ryan = Liu"'));
    expect(io.asked).toEqual([]); expect(runner.run).not.toHaveBeenCalled();
  });
  it.each(['email=', 'email=no-address', 'name=', 'default-handle=bad_handle', 'email'])('refuses invalid %s atomically', async pair => {
    const { store, path, raw } = await fixture(); const io = new ScriptedPrompter();
    expect((await login({ config: store, set: ['name=Changed', pair] }, io)).ok).toBe(false);
    expect(await readFile(path, 'utf8')).toBe(raw); expect(io.lines).toEqual([]); expect(io.asked).toEqual([]);
  });
  it.each(['github=', 'unknown=x'])('refuses %s with the accepted-keys line', async pair => {
    const { store, path, raw } = await fixture();
    expect(await login({ config: store, set: [pair] }, new ScriptedPrompter())).toEqual({ ok: false, error: 'Accepted keys: name, email, default-handle.' });
    expect(await readFile(path, 'utf8')).toBe(raw);
  });
  it('sets two fields atomically and normalizes the default handle without changing team bindings', async () => {
    const { store, path, raw } = await fixture(); const io = new ScriptedPrompter();
    expect(await login({ config: store, set: ['email=other@example.com', 'default-handle= New-Handle '] }, io)).toEqual({ ok: true, value: { gh: null, handle: 'new-handle', updated: [{ key: 'email', value: 'other@example.com' }, { key: 'default-handle', value: 'new-handle' }], notice: notice('Seed', 'other@example.com') } });
    expect(await readFile(path, 'utf8')).toBe(raw.replace('"email":"seed@example.com"', '"email":"other@example.com"').replace('"default_handle":"seed"', '"default_handle":"new-handle"'));
  });
  it('inserts absent identity fields through the same config writer', async () => {
    const store = createConfigStore(await temporaryDirectory());
    const result = await login({ config: store, set: ['name=New', 'email=new@example.com'] }, new ScriptedPrompter());
    expect(result).toEqual({ ok: true, value: { gh: null, handle: null, updated: [{ key: 'name', value: 'New' }, { key: 'email', value: 'new@example.com' }], notice: notice('New', 'new@example.com') } });
    expect((await store.read()).display_name).toBe('New');
    await login({ config: store, set: ['default-handle=new'] }, new ScriptedPrompter());
    expect((await store.read()).default_handle).toBe('new');
  });
});
