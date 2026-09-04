import { stat } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as login } from '../login.js';
import { createConfigStore } from '../../lib/config.js';
import { fakeGh, ghOnlyRunner, noGhRunner, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';

describe('login (§6, §5.4 per-team tokens and handles)', () => {
  it('a bound per-team handle and a stored token survive a re-login through gh, in any remote spelling', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    await store.update((config) => { config.teams.team = { remote: 'github.com/acme/team', token: 'ghp_old', handle: 'bound' }; });
    const io = new ScriptedPrompter(['', 'Other Name', 'other@example.com']);
    const result = await login({ team: 'team', remote: 'https://GitHub.com/Acme/Team.git', config: store, runner: ghOnlyRunner(fakeGh('octocat')) }, io);
    expect(result).toEqual({ ok: true, value: { authenticated: true, github: true } });
    expect(io.askedAbout('Team handle')).toBe(false);
    expect((await store.read()).teams.team).toEqual({ remote: 'github.com/acme/team', token: 'ghp_old', handle: 'bound' });
  });

  it('a first login never binds a handle; with gh logged out the PAT is probed against the repository and stored 0600', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    const runner = ghOnlyRunner(fakeGh('octocat', {}, false));
    const io = new ScriptedPrompter(['ghp_new', 'octocat', 'ryan', 'Ryan', 'ryan@example.com']);
    const result = await login({ team: 'team', remote: 'git@github.com:acme/team.git', config: store, runner }, io);
    expect(result).toEqual({ ok: true, value: { authenticated: true, github: true } });
    expect((await store.read()).teams.team).toEqual({ remote: 'github.com/acme/team', token: 'ghp_new', handle: null });
    expect(((await stat(pathJoin(store.root, 'config.json'))).mode & 0o777).toString(8)).toBe('600');
    const probe = runner.calls.find((call) => call.command === 'git' && call.args[0] === 'ls-remote');
    expect(probe?.args).toContain('https://github.com/acme/team.git');
    expect(probe?.env?.GH_TOKEN).toBe('ghp_new');
  });

  it('works without gh at all for a GitHub remote (the PAT is verified through git), as §6 requires', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    const io = new ScriptedPrompter(['ghp_new', 'octocat', 'ryan', 'Ryan', 'ryan@example.com']);
    const result = await login({ team: 'team', remote: 'github.com/acme/team', config: store, runner: noGhRunner }, io);
    expect(result).toEqual({ ok: true, value: { authenticated: true, github: true } });
    expect((await store.read()).teams.team?.token).toBe('ghp_new');
  });

  it('a non-GitHub remote stores no token, asks for no PAT, and says access is ambient', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
    const result = await login({ team: 'team', remote: 'https://gitlab.com/acme/team.git', config: store, runner: ghOnlyRunner(fakeGh('me', {}, false)) }, io);
    expect(result).toEqual({ ok: true, value: { authenticated: false, github: false } });
    expect(io.asked.some((question) => /PAT|token/i.test(question))).toBe(false);
    expect(io.lines.some((line) => line.includes('ambient git credentials'))).toBe(true);
    expect((await store.read()).teams.team).toEqual({ remote: 'gitlab.com/acme/team', token: null, handle: null });
  });

  it('refuses a remote mismatch, a remote already bound to another team name, and an invalid team name, with readable errors', async () => {
    const store = createConfigStore(pathJoin(await temporaryDirectory(), 'skills'));
    await store.update((config) => { config.teams['acme-skills'] = { remote: 'github.com/acme/skills', token: null, handle: 'ajay' }; config.teams.other = { remote: 'github.com/acme/other', token: null, handle: 'me' }; });
    const gh = () => ghOnlyRunner(fakeGh('octocat'));
    expect(await login({ team: 'skills', remote: 'github.com/acme/skills', config: store, runner: gh() }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('already configured as team acme-skills') });
    expect(await login({ team: 'other', remote: 'https://github.com/acme/elsewhere.git', config: store, runner: gh() }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('configured for github.com/acme/other') });
    expect(await login({ team: 'team', remote: 'nonsense', config: store, runner: gh() }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('Unsupported remote') });
    expect(await login({ team: '../x', remote: 'github.com/acme/x', config: store, runner: gh() }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid team name: /) });
    expect(Object.keys((await store.read()).teams).sort()).toEqual(['acme-skills', 'other']);
  });
});
