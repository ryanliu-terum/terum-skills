import { describe, expect, it } from 'vitest';
import { askUntilValid, authenticateCreator, bindTeam, collectIdentity, detectOrOfferGh, gitAuthEnv, identityForJoiner, teamByRemote } from '../auth.js';
import { ConfigStore } from '../config.js';
import { emptyConfig } from '../schema.js';
import { fakeGh, ghOnlyRunner, noGhRunner, ScriptedPrompter } from './fixtures.js';

const memoryStore = (seed = emptyConfig()): ConfigStore => ({ root: '', read: async () => seed, update: async (mutate) => { await mutate(seed); return seed; }, ensureRoot: async () => undefined, teamClone: (team) => team });

describe('gh detection and the login offer (§6 login)', () => {
  it('offers gh auth login only on an interactive channel, with inherited stdio, then re-checks auth status only', async () => {
    const runner = ghOnlyRunner(fakeGh('me', {}, false));
    const io = new ScriptedPrompter([], [true], true);
    expect(await detectOrOfferGh(io, runner)).toEqual({ installed: true, authenticated: true });
    expect(io.askedAbout('gh auth login')).toBe(true);
    const login = runner.calls.find((call) => call.args.join(' ') === 'auth login');
    expect(login).toBeDefined();
    expect(runner.calls.filter((call) => call.args[0] === '--version')).toHaveLength(1);
  });

  it('never offers on a non-interactive channel, when declined, or when gh is not installed', async () => {
    const runner = ghOnlyRunner(fakeGh('me', {}, false));
    expect(await detectOrOfferGh(new ScriptedPrompter([], [true], false), runner)).toEqual({ installed: true, authenticated: false });
    expect(runner.calls.some((call) => call.args.join(' ') === 'auth login')).toBe(false);
    expect(await detectOrOfferGh(new ScriptedPrompter([], [false], true), runner)).toEqual({ installed: true, authenticated: false });
    expect(await detectOrOfferGh(new ScriptedPrompter([], [true], true), noGhRunner)).toEqual({ installed: false, authenticated: false });
  });
});

describe('identity (§5.4)', () => {
  it('re-prompts an invalid handle with the rule, lowercases a valid one, and gives up after three tries with the rule', async () => {
    const io = new ScriptedPrompter(['me', 'Bad Handle', 'a--b', 'Good-One', 'Me', 'me@x.test']);
    const identity = await collectIdentity(io, emptyConfig(), noGhRunner);
    expect(identity).toEqual({ handle: 'good-one', displayName: 'Me', email: 'me@x.test', github: 'me' });
    expect(io.lines.filter((line) => line.includes('single internal hyphens'))).toHaveLength(2);
    await expect(askUntilValid(new ScriptedPrompter(['x', 'x', 'x']), 'Thing', undefined, () => ({ ok: false, rule: 'never' }))).rejects.toThrow('Invalid thing after 3 attempts: never');
  });

  it('a bound per-team handle is not asked again; an invalid email is re-prompted; an exhausted script fails loudly', async () => {
    const io = new ScriptedPrompter(['me', 'Me', 'not-an-email', 'me@x.test']);
    const identity = await collectIdentity(io, emptyConfig(), noGhRunner, { fixedHandle: 'bound' });
    expect(identity).toMatchObject({ handle: 'bound', email: 'me@x.test' });
    expect(io.askedAbout('Team handle')).toBe(false);
    await expect(collectIdentity(new ScriptedPrompter(['me']), emptyConfig(), noGhRunner)).rejects.toThrow(/Input ended before "Team handle"/);
  });

  it('defaults the GitHub login from gh when logged in, or from a known login without calling gh', async () => {
    const runner = ghOnlyRunner(fakeGh('octocat'));
    const identity = await collectIdentity(new ScriptedPrompter(['', '', 'Me', 'me@x.test']), emptyConfig(), runner, { gh: { installed: true, authenticated: true } });
    expect(identity).toMatchObject({ github: 'octocat', handle: 'octocat' });
    const quiet = ghOnlyRunner(fakeGh('octocat'));
    await collectIdentity(new ScriptedPrompter(['', '', 'Me', 'me@x.test']), emptyConfig(), quiet, { gh: { installed: true, authenticated: true }, githubLogin: 'known' });
    expect(quiet.calls).toEqual([]);
  });
});

describe('creator and joiner paths (D7/D8)', () => {
  it('a joiner is never asked for a PAT, even with gh logged out and no gh at all', async () => {
    for (const runner of [ghOnlyRunner(fakeGh('me', {}, false)), noGhRunner]) {
      const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@x.test']);
      await identityForJoiner(io, { config: memoryStore(), runner });
      expect(io.asked.some((question) => /PAT|token/i.test(question))).toBe(false);
    }
  });

  it('a creator without gh gets a clear error naming gh and --remote, and is never asked for a PAT', async () => {
    const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@x.test']);
    await expect(authenticateCreator(io, { config: memoryStore(), runner: noGhRunner }, { requireGh: true })).rejects.toThrow(/GitHub CLI \(gh\)[\s\S]*--remote/);
    expect(io.askedAbout('PAT')).toBe(false);
  });

  it('with gh logged out the PAT is taken through the secret channel, probed once via GH_TOKEN, and its login reused without a second call', async () => {
    const runner = ghOnlyRunner(fakeGh('octocat', {}, false));
    const io = new ScriptedPrompter(['ghp_secret', '', 'ryan', 'Ryan', 'ryan@x.test']);
    const auth = await authenticateCreator(io, { config: memoryStore(), runner }, { requireGh: true });
    expect(auth).toMatchObject({ token: 'ghp_secret', identity: { github: 'octocat', handle: 'ryan' } });
    expect(io.asked.find((question) => question.includes('PAT'))).toBeDefined();
    const probes = runner.calls.filter((call) => call.args.join(' ') === 'api user -q .login');
    expect(probes).toHaveLength(1);
    expect(probes[0]?.env?.GH_TOKEN).toBe('ghp_secret');
    expect(runner.calls.some((call) => call.args.includes('--with-token'))).toBe(false);
  });

  it('login with a known GitHub remote probes the PAT against the repository, so it works without gh', async () => {
    const calls: string[][] = [];
    const runner = { async run(command: 'git' | 'gh', args: readonly string[], options?: { env?: NodeJS.ProcessEnv }) { calls.push([command, ...args]); if (command === 'gh') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); expect(options?.env?.GH_TOKEN).toBe('ghp_secret'); return { code: 0, stdout: 'abc\trefs/heads/main\n', stderr: '' }; } };
    const auth = await authenticateCreator(new ScriptedPrompter(['ghp_secret', 'me', 'me', 'Me', 'me@x.test']), { config: memoryStore(), runner }, { remote: 'github.com/acme/team' });
    expect(auth.token).toBe('ghp_secret');
    expect(calls).toContainEqual(['git', 'ls-remote', '--heads', 'https://github.com/acme/team.git']);
  });

  it('a PAT is refused for a non-GitHub remote, a bad PAT fails the probe, and an empty one is refused', async () => {
    await expect(authenticateCreator(new ScriptedPrompter(['ghp_x']), { config: memoryStore(), runner: ghOnlyRunner(fakeGh('me', {}, false)) }, { remote: 'https://gitlab.com/acme/team.git' })).rejects.toThrow(/not on GitHub.*GitHub-only/);
    const bad = ghOnlyRunner((args) => (args[0] === '--version' ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: 'Bad credentials' }));
    await expect(authenticateCreator(new ScriptedPrompter(['ghp_bad']), { config: memoryStore(), runner: bad }, { requireGh: true })).rejects.toThrow('token probe failed');
    await expect(authenticateCreator(new ScriptedPrompter(['']), { config: memoryStore(), runner: ghOnlyRunner(fakeGh('me', {}, false)) })).rejects.toThrow('authentication is required');
  });
});

describe('gitAuthEnv (§5.4 tokens) and team binding', () => {
  it('is empty without a token; scopes the helper to github.com; appends after inherited GIT_CONFIG entries', () => {
    expect(gitAuthEnv(null, {})).toEqual({});
    expect(gitAuthEnv('ghp_secret', {})).toEqual({
      GH_TOKEN: 'ghp_secret',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!f() { printf "username=x-access-token\\npassword=%s\\n" "$GH_TOKEN"; }; f',
    });
    const inherited = gitAuthEnv('ghp_secret', { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.proxy', GIT_CONFIG_VALUE_0: 'http://proxy' });
    expect(inherited.GIT_CONFIG_COUNT).toBe('3');
    expect(inherited.GIT_CONFIG_KEY_1).toBe('credential.https://github.com.helper');
    expect(inherited.GIT_CONFIG_KEY_2).toBe('credential.https://github.com.helper');
    expect(inherited.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(JSON.stringify(inherited)).not.toContain('credential.helper"');
  });

  it('bindTeam keeps what it is not told to change, and teamByRemote finds an entry by normalized remote', () => {
    const config = emptyConfig();
    bindTeam(config, 't', { remote: 'https://github.com/Acme/Team.git', token: 'ghp_a', handle: 'me' });
    bindTeam(config, 't', { remote: 'github.com/acme/team' });
    expect(config.teams.t).toEqual({ remote: 'github.com/acme/team', token: 'ghp_a', handle: 'me' });
    bindTeam(config, 't', { remote: 'github.com/acme/team', token: null });
    expect(config.teams.t?.token).toBeNull();
    expect(teamByRemote(config, 'git@github.com:ACME/team.git')?.[0]).toBe('t');
    expect(teamByRemote(config, 'https://gitlab.com/acme/team')).toBeUndefined();
  });
});
