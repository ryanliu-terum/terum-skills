import { describe, expect, it } from 'vitest';
import { askUntilValid, assertBindable, authenticateCreator, bindTeam, collectIdentity, detectOrOfferGh, explainGhFailure, identityForJoiner, teamByRemote } from '../auth.js';
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
    expect(login?.args.includes('--with-token')).toBe(false);
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

  it('validates the GitHub login when one is given, accepts an empty one, and never lets a blank persisted login hide the gh default', async () => {
    const io = new ScriptedPrompter(['bad--login', 'x/../y', 'Octo-Cat', 'me', 'Me', 'me@x.test']);
    const identity = await collectIdentity(io, emptyConfig(), noGhRunner);
    expect(identity.github).toBe('Octo-Cat');
    expect(io.lines.filter((line) => line.includes('Invalid github login'))).toHaveLength(2);
    const blank = await collectIdentity(new ScriptedPrompter(['', 'me', 'Me', 'me@x.test']), emptyConfig(), noGhRunner);
    expect(blank.github).toBe('');
    await expect(collectIdentity(new ScriptedPrompter(['a--b', 'a--b', 'a--b']), emptyConfig(), noGhRunner)).rejects.toThrow('Invalid github login after 3 attempts');
    // A persisted '' (or an invalid legacy value) is no default: the gh login is still looked up.
    for (const persisted of ['', 'bad--login']) {
      const runner = ghOnlyRunner(fakeGh('octocat'));
      const suggested = await collectIdentity(new ScriptedPrompter(['', '', 'Me', 'me@x.test']), { ...emptyConfig(), github: persisted }, runner, { gh: { installed: true, authenticated: true } });
      expect(suggested, persisted).toMatchObject({ github: 'octocat', handle: 'octocat' });
    }
    // Once a login is suggested, Enter takes it and `-` clears it.
    const cleared = await collectIdentity(new ScriptedPrompter(['-', 'me', 'Me', 'me@x.test']), { ...emptyConfig(), github: 'octocat' }, noGhRunner);
    expect(cleared.github).toBe('');
    const kept = await collectIdentity(new ScriptedPrompter(['', '', 'Me', 'me@x.test']), { ...emptyConfig(), github: 'octocat' }, noGhRunner);
    expect(kept).toMatchObject({ github: 'octocat', handle: 'octocat' });
    // gh's own answer is validated too: a garbage login is never suggested.
    const garbage = ghOnlyRunner((args) => (args[0] === '--version' || args.join(' ') === 'auth status' ? { code: 0, stdout: '', stderr: '' } : { code: 0, stdout: 'not a login/\n', stderr: '' }));
    expect((await collectIdentity(new ScriptedPrompter(['', 'me', 'Me', 'me@x.test']), emptyConfig(), garbage, { gh: { installed: true, authenticated: true } })).github).toBe('');
  });

  it('a bound per-team handle is not asked again; an invalid email is re-prompted; an exhausted script fails loudly', async () => {
    const io = new ScriptedPrompter(['me', 'Me', 'not-an-email', 'me@x.test']);
    const identity = await collectIdentity(io, emptyConfig(), noGhRunner, { fixedHandle: 'bound' });
    expect(identity).toMatchObject({ handle: 'bound', email: 'me@x.test' });
    expect(io.askedAbout('Team handle')).toBe(false);
    await expect(collectIdentity(new ScriptedPrompter(['me']), emptyConfig(), noGhRunner)).rejects.toThrow(/Input ended before "Team handle"/);
  });

  it('defaults the GitHub login from gh when logged in, and from config without calling gh', async () => {
    const runner = ghOnlyRunner(fakeGh('octocat'));
    const identity = await collectIdentity(new ScriptedPrompter(['', '', 'Me', 'me@x.test']), emptyConfig(), runner, { gh: { installed: true, authenticated: true } });
    expect(identity).toMatchObject({ github: 'octocat', handle: 'octocat' });
    const quiet = ghOnlyRunner(fakeGh('octocat'));
    const known = await collectIdentity(new ScriptedPrompter(['', '', 'Me', 'me@x.test']), { ...emptyConfig(), github: 'known' }, quiet, { gh: { installed: true, authenticated: true } });
    expect(known).toMatchObject({ github: 'known', handle: 'known' });
    expect(quiet.calls).toEqual([]);
  });
});

describe('creator and joiner paths (D7/D8, rev 9 Decision 2: no token anywhere)', () => {
  it('a joiner is never asked for a token, even with gh logged out and no gh at all', async () => {
    for (const runner of [ghOnlyRunner(fakeGh('me', {}, false)), noGhRunner]) {
      const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@x.test']);
      await identityForJoiner(io, { config: memoryStore(), runner });
      // Exactly the four identity questions and nothing else: a credential prompt of any wording would show up here.
      expect(io.asked).toEqual(['GitHub login', 'Team handle', 'Your name', 'Your email']);
    }
  });

  it('a creator without gh gets a clear error naming gh and --remote, and is never asked for a token', async () => {
    const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@x.test']);
    await expect(authenticateCreator(io, { config: memoryStore(), runner: noGhRunner })).rejects.toThrow(/GitHub CLI \(gh\)[\s\S]*--remote/);
    expect(io.asked).toEqual([]);
  });

  it('a creator with gh logged out is offered gh auth login once; declined, the creator path stops without a token prompt', async () => {
    const accepted = ghOnlyRunner(fakeGh('octocat', {}, false));
    const io = new ScriptedPrompter(['', 'ryan', 'Ryan', 'ryan@x.test'], [true], true);
    const auth = await authenticateCreator(io, { config: memoryStore(), runner: accepted });
    expect(auth).toMatchObject({ gh: { installed: true, authenticated: true }, identity: { github: 'octocat', handle: 'ryan' } });
    expect(io.countAsked('gh auth login')).toBe(1);
    const declined = ghOnlyRunner(fakeGh('octocat', {}, false));
    const quiet = new ScriptedPrompter(['me', 'me', 'Me', 'me@x.test'], [false], true);
    await expect(authenticateCreator(quiet, { config: memoryStore(), runner: declined })).rejects.toThrow(/GitHub authentication is required[\s\S]*gh auth login[\s\S]*--remote/);
    expect(quiet.asked).toEqual(['GitHub CLI is installed but logged out. Run `gh auth login` now?']);
    expect(declined.calls.some((call) => call.args.includes('--with-token') || call.env?.GH_TOKEN)).toBe(false);
    // Non-interactive: no offer, same stop.
    await expect(authenticateCreator(new ScriptedPrompter(['me', 'me', 'Me', 'me@x.test']), { config: memoryStore(), runner: ghOnlyRunner(fakeGh('me', {}, false)) })).rejects.toThrow('GitHub authentication is required');
  });
});

describe('team binding (§5.4, rev 9)', () => {
  it('bindTeam writes the normalized remote and the proven handle, keeps unknown keys, and drops a stale token', () => {
    const config = emptyConfig();
    config.teams.t = { remote: 'github.com/acme/team', handle: 'old', token: 'ghp_stale', future: 'kept' };
    bindTeam(config, 't', { remote: 'https://github.com/Acme/Team.git', handle: 'me' });
    expect(config.teams.t).toEqual({ remote: 'github.com/acme/team', handle: 'me', future: 'kept' });
    expect(teamByRemote(config, 'git@github.com:ACME/team.git')?.[0]).toBe('t');
    expect(teamByRemote(config, 'https://gitlab.com/acme/team')).toBeUndefined();
  });

  it('assertBindable refuses a remote bound under another name and a name bound to another remote, in any spelling', () => {
    const config = emptyConfig();
    bindTeam(config, 't', { remote: 'github.com/acme/team', handle: 'me' });
    expect(() => assertBindable(config, 't', 'https://github.com/ACME/Team.git')).not.toThrow();
    expect(() => assertBindable(config, 'other', 'github.com/acme/other')).not.toThrow();
    expect(() => assertBindable(config, 'other', 'git@github.com:acme/team.git')).toThrow('already configured as team t');
    expect(() => assertBindable(config, 't', 'github.com/acme/other')).toThrow(/configured for github\.com\/acme\/team, not github\.com\/acme\/other/);
  });
describe('explainGhFailure', () => {
  it('names the missing or logged-out gh, and stays silent when gh itself is fine', async () => {
    expect(await explainGhFailure(noGhRunner)).toContain('not installed');
    expect(await explainGhFailure(ghOnlyRunner(fakeGh('me', {}, false)))).toContain('gh auth login');
    expect(await explainGhFailure(ghOnlyRunner(fakeGh('me')))).toBeNull();
  });
});

});
