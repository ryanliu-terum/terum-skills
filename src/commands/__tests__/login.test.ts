import { stat } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as login } from '../login.js';
import { createConfigStore } from '../../lib/config.js';
import { fakeGh, ghOnlyRunner, noGhRunner, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';

describe('login (§6, rev 9 Decision 4: bare, no team entry, no token)', () => {
  it('with gh logged in, records identity from the gh defaults, writes no team entry, and stores config 0600', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    const io = new ScriptedPrompter(['', '', 'Ryan', 'ryan@example.com']);
    const result = await login({ config: store, runner: ghOnlyRunner(fakeGh('octocat')) }, io);
    expect(result).toEqual({ ok: true, value: { gh: { installed: true, authenticated: true }, handle: 'octocat' } });
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
    expect(result).toEqual({ ok: true, value: { gh: { installed: false, authenticated: false }, handle: 'me' } });
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
