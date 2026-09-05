import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { create, WORKFLOW } from '../team.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, exists, fakeGh, git, mappedRunner, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';

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
    expect((await readdir(pathJoin(store.root, 'teams'))).filter((name) => name.includes('bootstrap'))).toEqual([]);
    const config = await store.read();
    expect(config.teams['new-team']).toEqual({ remote: 'git.example/new-team', token: null, handle: 'me' });
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

  it('refuses to rebind a configured team name or an already-configured remote, and never carries a token across', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    await store.update((config) => { config.teams.alpha = { remote: 'github.com/acme/alpha', token: 'ghp_alpha', handle: 'me' }; config.teams.beta = { remote: 'git.example/beta', token: null, handle: null }; });
    const io = () => new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']);
    expect(await create({ name: 'alpha', remote: 'https://git.example/other.git', config: store, runner: mappedRunner('https://git.example/other.git', bare) }, io())).toMatchObject({ ok: false, error: expect.stringContaining('already configured for github.com/acme/alpha') });
    expect(await create({ name: 'gamma', remote: 'https://git.example/beta.git', config: store, runner: mappedRunner('https://git.example/beta.git', bare) }, io())).toMatchObject({ ok: false, error: expect.stringContaining('already configured as team beta') });
    const after = await store.read();
    expect(after.teams.alpha).toEqual({ remote: 'github.com/acme/alpha', token: 'ghp_alpha', handle: 'me' });
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

  it('on GitHub, creates the repo through gh, resolves the owner from gh rather than guessing, and stores no token', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://github.com/octocat/new-team.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner(publicRemote, bare, fakeGh('octocat', {
      'repo create new-team --private': { code: 0, stdout: 'https://github.com/octocat/new-team\n', stderr: '' },
      'repo view new-team --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'octocat/new-team\n', stderr: '' },
    }));
    const result = await create({ name: 'new-team', config: store, runner }, new ScriptedPrompter(['', 'ryan', 'Ryan', 'ryan@example.com']));
    if (!result.ok) throw new Error(result.error);
    expect(result.value.remote).toBe('https://github.com/octocat/new-team.git');
    expect((await store.read()).teams['new-team']).toEqual({ remote: 'github.com/octocat/new-team', token: null, handle: 'ryan' });
    expect(await git(['ls-tree', '--name-only', 'main:people'], bare)).toContain('ryan.json');
    expect(runner.calls.some((call) => call.command === 'gh' && call.args.join(' ').startsWith('repo create'))).toBe(true);
  });

  it('with gh logged out, the PAT reaches gh via GH_TOKEN and git via the env credential helper, and is stored 0600', async () => {
    const { root, bare } = await emptyBare();
    const publicRemote = 'https://github.com/octocat/pat-team.git';
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner(publicRemote, bare, fakeGh('octocat', {
      'repo create acme/pat-team --private': { code: 0, stdout: '', stderr: '' },
      'repo view acme/pat-team --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'octocat/pat-team\n', stderr: '' },
    }, false));
    const result = await create({ name: 'pat-team', org: 'acme', config: store, runner }, new ScriptedPrompter(['ghp_secret', '', 'ryan', 'Ryan', 'ryan@example.com']));
    if (!result.ok) throw new Error(result.error);
    const repoCreate = runner.calls.find((call) => call.command === 'gh' && call.args[0] === 'repo' && call.args[1] === 'create');
    expect(repoCreate?.env?.GH_TOKEN).toBe('ghp_secret');
    const push = runner.calls.find((call) => call.command === 'git' && call.args[0] === 'push');
    // Appended after whatever GIT_CONFIG_* the environment already carried (vitest sets one entry).
    const inherited = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? '0', 10) || 0;
    expect(push?.env?.GIT_CONFIG_COUNT).toBe(String(inherited + 2));
    expect(push?.env?.[`GIT_CONFIG_KEY_${inherited}`]).toBe('credential.https://github.com.helper');
    expect(push?.env?.[`GIT_CONFIG_KEY_${inherited + 1}`]).toBe('credential.https://github.com.helper');
    expect(push?.env?.GH_TOKEN).toBe('ghp_secret');
    const probes = runner.calls.filter((call) => call.command === 'gh' && call.args.join(' ') === 'api user -q .login');
    expect(probes).toHaveLength(1);
    expect(probes.every((call) => call.env?.GH_TOKEN === 'ghp_secret')).toBe(true);
    expect(runner.calls.every((call) => !call.args.includes('ghp_secret'))).toBe(true);
    expect((await store.read()).teams['pat-team']?.token).toBe('ghp_secret');
    expect(((await stat(pathJoin(store.root, 'config.json'))).mode & 0o777).toString(8)).toBe('600');
  });

  it('without gh, a GitHub create fails before creating anything and names the alternatives', async () => {
    const { root, bare } = await emptyBare();
    const store = createConfigStore(pathJoin(root, 'local'));
    const runner = mappedRunner('https://github.com/x/y.git', bare);
    const result = await create({ name: 'y', config: store, runner }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com']));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/GitHub CLI \(gh\)[\s\S]*--remote/) });
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
});
