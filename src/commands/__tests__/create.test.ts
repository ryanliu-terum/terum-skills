import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { create, WORKFLOW } from '../team.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, exists, fakeGh, git, mappedRunner, ScriptedPrompter, temporaryDirectory, wrapRunner } from '../../lib/__tests__/fixtures.js';

async function emptyBare(): Promise<{ root: string; bare: string }> {
  const root = await temporaryDirectory();
  const bare = pathJoin(root, 'empty.git');
  await git(['init', '-q', '--bare', bare]);
  return { root, bare };
}

describe('team create (§6)', () => {
  it('scaffolds a least-privilege, executable README and publish-comment workflow', () => {
    expect(WORKFLOW.split('\n').find((line) => line.includes('--jq'))).toBe('          existing=$(gh api "repos/${{ github.repository }}/issues/$PR/comments" --paginate --jq \'.[] | select(.body | contains("<!-- terum-skills:pr-comment -->")) | .id\' | head -n 1)');
    const workflow = YAML.parse(WORKFLOW) as { jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps: Array<{ run?: string; with?: Record<string, unknown> }> }> };
    expect(Object.keys(workflow.jobs)).toEqual(['readme', 'publish-comment']);
    expect(workflow.jobs.readme?.if).toBe("github.event_name == 'push'");
    expect(workflow.jobs.readme?.permissions).toEqual({ contents: 'write' });
    expect(workflow.jobs.readme?.steps.some((step) => step.run?.includes('chore: regenerate skills README'))).toBe(true);
    expect(workflow.jobs['publish-comment']?.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(workflow.jobs['publish-comment']?.steps[0]?.with?.['persist-credentials']).toBe(false);
    expect(WORKFLOW).toContain('npx -y terum-skills@latest');
  });

  it('scaffolds the §4.1 tree into an empty generic-git remote, records the team, and leaves the clone ready', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://git.example/new-team.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner(publicRemote, bare);
    const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
    const result = await create({ name: 'new-team', remote: publicRemote, config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    const clone = store.teamClone('new-team');
    expect(JSON.parse(await readFile(pathJoin(clone, 'team.json'), 'utf8'))).toMatchObject({ layout_version: 2, name: 'new-team', global: [], archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } });
    expect(JSON.parse(await readFile(pathJoin(clone, 'people', 'me.json'), 'utf8'))).toMatchObject({ handle: 'me', display_name: 'Me', email: 'me@example.com' });
    expect(await readFile(pathJoin(clone, 'README.md'), 'utf8')).toContain('<!-- terum-skills:begin -->');
    expect(await readFile(pathJoin(clone, '.github', 'workflows', 'terum-skills.yml'), 'utf8')).toContain('name: terum-skills');
    expect((await git(['ls-tree', '--name-only', '-r', 'main'], bare)).split('\n').filter(Boolean).sort()).toEqual(['.github/workflows/terum-skills.yml', 'README.md', 'evals/.gitkeep', 'people/me.json', 'skills/.gitkeep', 'team.json']);
    expect((await git(['log', '-1', '--format=%s %an <%ae>', 'main'], bare)).trim()).toBe('me: create team new-team Me <me@example.com>');
    expect((await git(['config', 'user.email'], clone)).trim()).toBe('me@example.com');
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
    expect(await readdir(pathJoin(store.root, 'teams'))).toEqual(['new-team']);
    const config = await store.read();
    expect(config.teams['new-team']).toEqual({ remote: 'git.example/new-team', handle: 'me' });
    expect(config).toMatchObject({ default_handle: 'me', display_name: 'Me', email: 'me@example.com', github: 'me' });
    expect(((await stat(pathJoin(store.root, 'config.json'))).mode & 0o777).toString(8)).toBe('600');
    expect(((await stat(store.root)).mode & 0o777).toString(8)).toBe('700');
    expect(((await stat(pathJoin(store.root, 'teams'))).mode & 0o777).toString(8)).toBe('700');
    expect(io.askedAbout('PAT')).toBe(false);
    expect(io.lines.at(-1)).toContain('Created team new-team');
  });

  it('accepts the canonical host/path form for --remote and hands git a fetchable URL', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner('https://git.example/team/canon.git', bare);
    const result = await create({ name: 'canon', remote: 'git.example/team/canon', config: store, runner }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']));
    if (!result.ok) throw new Error(result.error);
    expect(runner.calls.some((call) => call.args.includes('https://git.example/team/canon.git'))).toBe(true);
    expect((await store.read()).teams.canon?.remote).toBe('git.example/team/canon');
  });

  it('refuses to rebind a configured team name or an already-configured remote, and leaves the other entries untouched', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    await store.update((config) => { config.teams.alpha = { remote: 'github.com/acme/alpha', handle: 'me' }; config.teams.beta = { remote: 'git.example/beta', handle: 'someone' }; });
    const io = () => new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
    expect(await create({ name: 'alpha', remote: 'https://git.example/other.git', config: store, runner: mappedRunner('https://git.example/other.git', bare) }, io())).toMatchObject({ ok: false, error: expect.stringContaining('already configured for github.com/acme/alpha') });
    expect(await create({ name: 'gamma', remote: 'https://git.example/beta.git', config: store, runner: mappedRunner('https://git.example/beta.git', bare) }, io())).toMatchObject({ ok: false, error: expect.stringContaining('already configured as team beta') });
    const after = await store.read();
    expect(after.teams.alpha).toEqual({ remote: 'github.com/acme/alpha', handle: 'me' });
    expect(Object.keys(after.teams).sort()).toEqual(['alpha', 'beta']);
  });

  it('refuses a non-empty remote before pushing anything, and refuses an invalid name', async () => {
    const fixture = await bareTeam();
    const publicRemote = 'https://git.example/team.git';
    const store = createConfigStore(pathJoin(fixture.root, 'local'));
    const before = (await git(['rev-parse', 'main'], fixture.bare)).trim();
    const result = await create({ name: 'team', remote: publicRemote, config: store, runner: mappedRunner(publicRemote, fixture.bare) }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('already has branches') });
    expect((await git(['rev-parse', 'main'], fixture.bare)).trim()).toBe(before);
    expect(await exists(store.teamClone('team'))).toBe(false);
    expect((await store.read()).teams).toEqual({});
    expect(await create({ name: '../evil', remote: publicRemote, config: store, runner: mappedRunner(publicRemote, fixture.bare) }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('team name') });
  });

  it('on GitHub, creates the repo through gh and resolves the owner from gh rather than guessing', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://github.com/octocat/new-team.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner(publicRemote, bare, fakeGh('octocat', {
      'repo create new-team --private': { code: 0, stdout: 'https://github.com/octocat/new-team\n', stderr: '' },
      'repo view new-team --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'octocat/new-team\n', stderr: '' },
    }));
    const io = new ScriptedPrompter(['', 'ryan', 'Ryan', 'ryan@example.com', '']);
    const result = await create({ name: 'new-team', config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(io.asked.at(-1)).toBe('GitHub repository name');
    expect(result.value.remote).toBe('https://github.com/octocat/new-team.git');
    expect((await store.read()).teams['new-team']).toEqual({ remote: 'github.com/octocat/new-team', handle: 'ryan' });
    expect(await git(['ls-tree', '--name-only', 'main:people'], bare)).toContain('ryan.json');
    expect(runner.calls.some((call) => call.command === 'gh' && call.args.join(' ').startsWith('repo create'))).toBe(true);
  });

  it('without gh, a GitHub create fails before creating anything and names the alternatives', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner('https://github.com/x/y.git', bare);
    const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
    const result = await create({ name: 'y', config: store, runner }, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/GitHub CLI \(gh\)[\s\S]*--remote/) });
    expect(io.asked).toEqual([]);
    expect(await create({ name: '../evil', config: store, runner }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid team name: /) });
    expect(runner.calls.filter((call) => call.command === 'git')).toEqual([]);
  });

  it('refuses to create over an existing clone directory or a configured team, before touching the remote', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://git.example/dup.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const io = () => new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
    await store.ensureRoot();
    await mkdir(store.teamClone('dup'), { recursive: true });
    const runner = mappedRunner(publicRemote, bare);
    expect(await create({ name: 'dup', remote: publicRemote, config: store, runner }, io())).toMatchObject({ ok: false, error: expect.stringContaining('already exists') });
    expect(runner.calls).toEqual([]);
    await rm(store.teamClone('dup'), { recursive: true });
    expect((await create({ name: 'dup', remote: publicRemote, config: store, runner: mappedRunner(publicRemote, bare) }, io())).ok).toBe(true);
    expect(await create({ name: 'dup', remote: publicRemote, config: store, runner: mappedRunner(publicRemote, bare) }, io())).toMatchObject({ ok: false, error: expect.stringContaining('already configured') });
  });

  it('refuses an option-shaped or helper-shaped --remote before running any git command', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    // The last two carry `user:pass@`: scrubbed before validation they would become `z.com/p` and `evil.example/p`.
    for (const remote of ['--upload-pack=touch:pwned', 'ext::sh -c id', '--upload-pack=x:y@z.com/p', 'ext::sh:x@evil.example/p']) {
      const runner = mappedRunner(remote, bare);
      expect(await create({ name: 'evil', remote, config: store, runner }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com'])), remote).toMatchObject({ ok: false, error: expect.stringContaining('Unsupported remote') });
      expect(runner.calls.filter((call) => call.command === 'git'), remote).toEqual([]);
    }
    expect((await store.read()).teams).toEqual({});
  });

  it('a credential pasted into --remote (with `@` in the password and leading whitespace) never reaches git argv, config, the clone, or a message; the user is told once; every remote sits behind --', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://git.example/new-team.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner(publicRemote, bare);
    const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
    const result = await create({ name: 'new-team', remote: ' https://me:gh@p_leak@git.example/new-team.git', config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.remote).toBe(publicRemote);
    const everything = JSON.stringify([runner.calls, io.lines, await store.read()]);
    expect(everything).not.toContain('p_leak');
    expect(everything).not.toContain('gh@');
    expect(io.lines.filter((line) => line.includes('Ignored the credential'))).toHaveLength(1);
    expect((await git(['remote', 'get-url', 'origin'], store.teamClone('new-team'))).trim()).toBe(bare);
    const positional = runner.calls.filter((call) => call.command === 'git' && call.args.includes(publicRemote));
    expect(positional.length).toBeGreaterThanOrEqual(2);
    for (const call of positional) expect(call.args[call.args.indexOf(publicRemote) - 1], call.args.join(' ')).toBe('--');
  });
  it('asks for the team name when the argument is omitted, re-asking an invalid answer with the rule', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://git.example/prompted.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const io = new ScriptedPrompter(['../bad', 'prompted-team', 'me', 'me', 'Me', 'me@example.com']);
    const result = await create({ remote: publicRemote, config: store, runner: mappedRunner(publicRemote, bare) }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.team).toBe('prompted-team');
    expect(io.countAsked('Team name')).toBe(2);
    expect(io.lines.some((line) => line.includes('Invalid team name'))).toBe(true);
    expect(JSON.parse(await readFile(pathJoin(store.teamClone('prompted-team'), 'team.json'), 'utf8')).name).toBe('prompted-team');
    expect(Object.keys((await store.read()).teams)).toEqual(['prompted-team']);
  });

  it('the repository name defaults to the team name, --repo overrides it without a question, and team.json keeps the team name (Decision 5)', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner('https://github.com/octocat/skills-repo.git', bare, fakeGh('octocat', {
      'repo create skills-repo --private': { code: 0, stdout: '', stderr: '' },
      'repo view skills-repo --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'octocat/skills-repo\n', stderr: '' },
    }));
    const io = new ScriptedPrompter(['', 'ryan', 'Ryan', 'ryan@example.com']);
    const result = await create({ name: 'acme', repo: 'skills-repo', config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(io.askedAbout('repository name')).toBe(false);
    expect(result.value).toEqual({ team: 'acme', remote: 'https://github.com/octocat/skills-repo.git' });
    expect(JSON.parse(await readFile(pathJoin(store.teamClone('acme'), 'team.json'), 'utf8')).name).toBe('acme');
    expect((await store.read()).teams.acme).toEqual({ remote: 'github.com/octocat/skills-repo', handle: 'ryan' });
  });

  it('re-asks the repository name when GitHub says it is taken, and fails after three tries without creating anything', async () => {
    const { root, bare } = await emptyBare();
    const taken = { code: 1, stdout: '', stderr: 'GraphQL: Name already exists on this account (createRepository)' };
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner('https://github.com/octocat/free.git', bare, fakeGh('octocat', {
      'repo create acme/taken --private': taken,
      'repo create acme/free --private': { code: 0, stdout: '', stderr: '' },
      'repo view acme/free --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'octocat/free\n', stderr: '' },
    }));
    const io = new ScriptedPrompter(['', 'ryan', 'Ryan', 'ryan@example.com', 'taken', 'free']);
    const result = await create({ name: 'acme', org: 'acme', config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.remote).toBe('https://github.com/octocat/free.git');
    expect(io.countAsked('GitHub repository name')).toBe(2);
    expect(io.lines.some((line) => line.includes('acme/taken is already taken'))).toBe(true);
    expect(JSON.parse(await readFile(pathJoin(store.teamClone('acme'), 'team.json'), 'utf8')).name).toBe('acme');

    const exhausted = createConfigStore(pathJoin(root, 'local2'));
    const always = mappedRunner('https://github.com/octocat/never.git', bare, fakeGh('octocat', { 'repo create a --private': taken, 'repo create b --private': taken, 'repo create c --private': taken }));
    const io2 = new ScriptedPrompter(['', 'ryan', 'Ryan', 'ryan@example.com', 'a', 'b', 'c']);
    const failed = await create({ name: 'never', config: exhausted, runner: always }, io2);
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining('already exists') });
    expect(always.calls.filter((call) => call.command === 'gh' && call.args[0] === 'repo' && call.args[1] === 'create')).toHaveLength(3);
    expect(always.calls.some((call) => call.args[1] === 'view')).toBe(false);
    expect(always.calls.filter((call) => call.command === 'git')).toEqual([]);
    expect((await exhausted.read()).teams).toEqual({});
    expect(await exists(exhausted.teamClone('never'))).toBe(false);
    // Any other gh failure is terminal on the first try.
    const other = mappedRunner('https://github.com/octocat/x.git', bare, fakeGh('octocat', { 'repo create x --private': { code: 1, stdout: '', stderr: 'HTTP 403: rate limited' } }));
    const io3 = new ScriptedPrompter(['', 'ryan', 'Ryan', 'ryan@example.com', '']);
    expect(await create({ name: 'x', config: createConfigStore(pathJoin(root, 'local3')), runner: other }, io3)).toMatchObject({ ok: false, error: expect.stringContaining('rate limited') });
    expect(io3.countAsked('GitHub repository name')).toBe(1);
  });

  it('with gh logged out and the login offer declined, a GitHub create stops before creating anything and never asks for a token', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner('https://github.com/octocat/y.git', bare, fakeGh('octocat', {}, false));
    const io = new ScriptedPrompter(['', 'me', 'me', 'Me', 'me@example.com'], [false], true);
    expect(await create({ name: 'y', config: store, runner }, io)).toMatchObject({ ok: false, error: expect.stringContaining('GitHub authentication is required') });
    expect(io.countAsked('gh auth login')).toBe(1);
    expect(io.asked.some((question) => /PAT|token/i.test(question))).toBe(false);
    expect(runner.calls.some((call) => call.args[0] === 'repo')).toBe(false);
    expect((await store.read()).teams).toEqual({});
  });

  it('a failed scaffold push leaves no staging directory and says the remote holds no scaffold; a failure after the push says to team join instead', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://git.example/boot.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const refused = wrapRunner(mappedRunner(publicRemote, bare), async (command, args, _options, next) => command === 'git' && args[0] === 'push' ? { code: 1, stdout: '', stderr: 'remote: Permission denied' } : next());
    const result = await create({ name: 'boot', remote: publicRemote, config: store, runner: refused }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Permission denied[\s\S]*holds no scaffold[\s\S]*team create boot --remote https:\/\/git\.example\/boot\.git/) });
    expect(await readdir(pathJoin(store.root, 'teams'))).toEqual([]);
    expect((await store.read()).teams).toEqual({});
    expect((await git(['ls-remote', '--heads', bare])).trim()).toBe('');
    // The push lands but git reports failure afterwards: the remote is scaffolded, so the advice is team join, and staging is still cleaned up.
    const afterPush = wrapRunner(mappedRunner(publicRemote, bare), async (command, args, _options, next) => { const result = await next(); return command === 'git' && args[0] === 'push' ? { code: 1, stdout: '', stderr: 'hung up unexpectedly' } : result; });
    const later = await create({ name: 'boot', remote: publicRemote, config: store, runner: afterPush }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']));
    expect(later).toMatchObject({ ok: false, error: expect.stringMatching(/hung up unexpectedly[\s\S]*run `team join https:\/\/git\.example\/boot\.git`/) });
    expect(await readdir(pathJoin(store.root, 'teams'))).toEqual([]);
    expect((await git(['ls-remote', '--heads', bare])).trim()).toContain('refs/heads/main');
  });

  it('refuses --repo or --org together with --remote, and an invalid --org, before asking anything', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner('https://git.example/x.git', bare);
    for (const extra of [{ repo: 'skills' }, { org: 'acme' }]) {
      const io = new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
      expect(await create({ name: 'x', remote: 'https://git.example/x.git', ...extra, config: store, runner }, io)).toMatchObject({ ok: false, error: expect.stringContaining('--repo and --org apply only') });
      expect(io.asked).toEqual([]);
    }
    expect(await create({ name: 'x', org: 'bad/org', config: store, runner }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid GitHub organization/) });
    expect(runner.calls).toEqual([]);
  });

  it('re-checks under the config lock: a remote bound by another process while the scaffold pushed is not bound twice', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://git.example/raced.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = wrapRunner(mappedRunner(publicRemote, bare), async (command, args, _options, next) => {
      const result = await next();
      if (command === 'git' && args[0] === 'push') await store.update((config) => { config.teams.other = { remote: 'git.example/raced', handle: 'someone' }; });
      return result;
    });
    const result = await create({ name: 'raced', remote: publicRemote, config: store, runner }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('already configured as team other') });
    expect(Object.keys((await store.read()).teams)).toEqual(['other']);
    expect((await git(['ls-remote', '--heads', bare])).trim()).toContain('refs/heads/main');
  });

  it('a failed post-push re-probe admits it could not tell, and points at both recoveries', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://git.example/dark.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    let pushed = false;
    const dark = wrapRunner(mappedRunner(publicRemote, bare), async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push') { pushed = true; return { code: 1, stdout: '', stderr: 'hung up unexpectedly' }; }
      // The network dies with the push: the preflight probe worked, the post-push re-probe does not.
      if (pushed && command === 'git' && args[0] === 'ls-remote') return { code: 128, stdout: '', stderr: 'Could not read from remote repository.' };
      return next();
    });
    const result = await create({ name: 'dark', remote: publicRemote, config: store, runner: dark }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/hung up unexpectedly[\s\S]*Could not determine whether the scaffold reached[\s\S]*team join https:\/\/git\.example\/dark\.git[\s\S]*team create dark --remote/) });
    expect(await readdir(pathJoin(store.root, 'teams'))).toEqual([]);
  });

});
