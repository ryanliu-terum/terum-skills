import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMUNITY_URL } from '../../lib/community.js';
import { createConfigStore } from '../../lib/config.js';
import { failure, success } from '../../lib/result.js';
import { offerHook } from '../../lib/hook.js';
import { bareTeam, cloneWithIdentity, exists, fakeGh, git, mappedRunner, person, pushFromSeed, ScriptedPrompter, wrapperFor, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { Prompter, PromptClosedError } from '../../lib/prompt.js';
import { run } from '../setup.js';

const hookFor = (root: string) => ({ settingsFile: join(root, 'settings.json'), backupDir: join(root, 'backups') });
const githubRemote = (owner: string, repository: string) => `https://github.com/${owner}/${repository}.git`;

async function skillUnder(home: string, name = 'starter'): Promise<void> {
  const directory = join(home, '.claude', 'skills', name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\nmetadata:\n  terum-category: testing\n---\n`);
}

class AnsweringPrompter implements Prompter {
  readonly events: string[] = [];
  readonly interactive = true; // connect's picker only prompts on an interactive channel (issue 9)
  constructor(private readonly answers: Record<string, string>, private readonly confirms: Record<string, boolean>) {}
  private answer(question: string): string {
    if (/invite/i.test(question)) return this.answers.invite ?? '';
    const key = Object.keys(this.answers).find((fragment) => question.startsWith(fragment));
    if (key === undefined) throw new PromptClosedError(question, 'closed');
    return this.answers[key]!;
  }
  async text(question: string, defaultValue?: string): Promise<string> { this.events.push(`ask:${question}`); return this.answer(question) || (defaultValue ?? ''); }
  async select(question: string, choices: readonly string[]): Promise<string> {
    this.events.push(`ask:${question}`);
    const chosen = this.answer(question);
    if (!choices.includes(chosen)) throw new Error(`${question}: ${chosen} is not one of ${choices.join(', ')}`);
    return chosen;
  }
  async confirm(question: string): Promise<boolean> {
    this.events.push(`ask:${question}`);
    const key = Object.keys(this.confirms).find((fragment) => question.startsWith(fragment));
    if (key === undefined) throw new PromptClosedError(question, 'closed');
    return this.confirms[key]!;
  }
  print(line: string): void { this.events.push(`print:${line}`); }
  at(test: (event: string) => boolean): number { return this.events.findIndex(test); }
}

async function freshCreator() {
  const fixture = await bareTeam();
  const bare = join(fixture.root, 'empty.git'); await git(['init', '-q', '--bare', bare]);
  const root = join(fixture.root, 'invite-first'); const home = join(root, 'home'); await skillUnder(home);
  const store = createConfigStore(join(root, 'state')); const remote = githubRemote('alice', 'alpha-repo');
  const runner = mappedRunner(remote, bare, fakeGh('alice', {
    'repo create alpha-repo --private': { code: 0, stdout: '', stderr: '' },
    'repo view alpha-repo --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'alice/alpha-repo\n', stderr: '' },
    'api -X PUT --include repos/alice/alpha-repo/collaborators/bob': { code: 0, stdout: 'HTTP/2 201\n', stderr: '' },
  }));
  return { config: store, home, runner, hook: hookFor(root), communityUrl: '' };
}

async function configuredCreator(handlers: Parameters<typeof fakeGh>[1], owner = 'alice') {
  const fixture = await bareTeam(); const root = join(fixture.root, 'configured');
  const store = createConfigStore(join(root, 'state')); const remote = githubRemote(owner, 'team');
  await store.update((config) => { config.teams.team = { remote, handle: 'alice' }; });
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  const runner = mappedRunner(remote, fixture.bare, fakeGh('alice', handlers));
  let hookOffers = 0;
  return {
    args: { config: store, home: join(root, 'home'), runner, hook: hookFor(root), communityUrl: '', verbs: {
      offerHook: async () => { hookOffers += 1; return 'present' as const; },
    } },
    runner,
    hookOffers: () => hookOffers,
  };
}

describe('setup (§6.1)', () => {
  it('11 offers a joiner two project skills while excluding endorsed placements', async () => {
    const fixture = await bareTeam(); const remote = 'https://git.example/team.git'; const home = join(fixture.root, 'home'); const cwd = join(fixture.root, 'project');
    await mkdir(join(cwd, '.git'), { recursive: true });
    await skillUnder(cwd, 'alpha'); await skillUnder(cwd, 'beta'); await skillUnder(cwd, 'endorsed');
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => {
      config.teams.team = { remote: 'git.example/team', handle: 'seed' }; config.display_name = 'Seed'; config.email = 'seed@example.com';
      config.placements[join(cwd, '.claude', 'skills', 'endorsed')] = { id: '33333333-3333-4333-8333-333333333333', team: 'team', scope: { kind: 'project', project: cwd }, version: null, fingerprint: '', placed_at: '' };
    });
    const io = new ScriptedPrompter(['Connect alpha', 'Connect beta'], [true, true], true);
    const result = await run({ target: remote, config: store, home, cwd, runner: mappedRunner(remote, fixture.bare, fakeGh('seed')), verbs: { offerHook: async () => 'present' } }, io);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, value: { role: 'joiner', steps: { actions: 'done', invite: 'skipped' } } });
    expect(io.offered).toEqual([['Connect alpha', 'Connect beta', 'Skip'], ['Connect beta', 'Done']]);
    expect(io.asked).toEqual(['Connect a local skill folder to team team?', 'Connect alpha?', 'Connect a local skill folder to team team?', 'Connect beta?']);
    expect(Object.values((await store.read()).shared).map((entry) => entry.source)).toEqual(['alpha', 'beta'].map((name) => join(cwd, '.claude', 'skills', name)));
  });

  it('12 quiet alone still offers connect; offerConnect false skips without asking', async () => {
    const fixture = await bareTeam(); const remote = 'https://git.example/team.git'; const home = join(fixture.root, 'home'); await skillUnder(home);
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: 'git.example/team', handle: 'seed' }; });
    const args = { target: remote, quiet: true, config: store, home, runner: mappedRunner(remote, fixture.bare, fakeGh('seed')), verbs: { offerHook: async () => 'present' as const } };
    const offered = new ScriptedPrompter(['Skip'], [], true);
    const result = await run(args, offered);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, value: { steps: { actions: 'skipped' } } });
    expect(offered.offered).toEqual([['Connect starter', 'Skip']]);
    const suppressed = new ScriptedPrompter([], [], true);
    expect(await run({ ...args, offerConnect: false }, suppressed)).toMatchObject({ ok: true, value: { steps: { actions: 'skipped' } } });
    expect(suppressed.asked).toEqual([]);
  });

  it.each([undefined, 'bare'] as const)('hands a target-less joiner back to the owner without any calls or local writes (form=%s)', async (form) => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'handoff');
    const store = createConfigStore(join(root, 'state'));
    const runner = mappedRunner('https://github.com/me/team.git', fixture.bare, fakeGh('me', {}, false));
    const calls = { team: 0, connect: 0, invite: 0, offerHook: 0, ensureRoot: 0, update: 0 };
    const io = new ScriptedPrompter(['Join an existing team']);
    const result = await run({ form, config: { ...store,
      ensureRoot: async () => { calls.ensureRoot += 1; return store.ensureRoot(); },
      update: async (mutate) => { calls.update += 1; return store.update(mutate); },
    }, home: join(root, 'home'), runner, hook: hookFor(root), verbs: {
      team: async () => { calls.team += 1; throw new Error('unexpected team'); },
      connect: async () => { calls.connect += 1; throw new Error('unexpected connect'); },
      invite: async () => { calls.invite += 1; throw new Error('unexpected invite'); },
      offerHook: async () => { calls.offerHook += 1; throw new Error('unexpected hook'); },
    } }, io);
    expect.soft(result).toMatchObject({ ok: true, value: { role: 'joiner', team: '', remote: '', steps: { welcome: 'printed', role: 'done', team: 'printed' } } });
    expect.soft(result.value?.steps.github).toBeUndefined();
    expect.soft(io.asked).toEqual(['Create a team or join one?']);
    expect.soft(io.lines.slice(3)).toEqual([
      'Creating a new team creates a private GitHub repository under your account.',
      'Ask the team owner to invite you, then run the command they send you.',
      'It may look like:',
      '  npx -y terum-skills@latest setup <org>/<repo>',
      "If you already have access, use that setup command with your team's repository.",
      'No changes were made.',
    ]);
    expect.soft(runner.calls).toEqual([]);
    expect.soft(calls).toEqual({ team: 0, connect: 0, invite: 0, offerHook: 0, ensureRoot: 0, update: 0 });
    expect.soft(await exists(join(root, 'state'))).toBe(false);
    expect.soft(await exists(hookFor(root).settingsFile)).toBe(false);
    expect.soft(await exists(hookFor(root).backupDir)).toBe(false);
  });

  it('asks for teammates right after the team exists, prints the block the owner sends, and only then offers a skill and the hints', async () => {
    const args = await freshCreator();
    const io = new AnsweringPrompter(
      { 'Create a team or join one?': 'Create a new team', 'Team name': 'alpha', 'GitHub login': '', 'Team handle': '', 'Your name': 'Alice', 'Your email': 'alice@example.com', 'GitHub repository name': 'alpha-repo', invite: 'bob', 'Connect a local skill folder to team alpha?': 'Connect starter' },
      { 'Connect starter?': true, 'Install the Claude Code session-start hook': false },
    );
    const result = await run(args, io);
    if (!result.ok) throw new Error(result.error);
    const created = io.at((e) => e.startsWith('print:Created team alpha at'));
    const asked = io.at((e) => e.startsWith('ask:') && /invite/i.test(e));
    const invited = io.at((e) => e === 'print:Invited @bob.');
    const block = io.at((e) => e.includes('npx -y terum-skills@latest setup alice/alpha-repo'));
    const connect = io.at((e) => e === 'ask:Connect a local skill folder to team alpha?');
    const hints = io.at((e) => e === 'print:Next, from any terminal:');
    const order = [created, asked, invited, block, connect, hints];
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(result.value.steps).toMatchObject({ team: 'done', invite: 'done', actions: 'done', hook: 'skipped', done: 'printed' });
  });

  it('uses the agreed invitation wording and no longer the old one', async () => {
    const args = await freshCreator();
    const io = new ScriptedPrompter(['Create a new team', 'alpha', '', '', 'Alice', 'alice@example.com', 'alpha-repo', 'bob', 'Connect starter'], [true, false], true);
    const result = await run(args, io);
    expect.soft(io.asked).toContain('Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)');
    expect.soft(io.askedAbout('GitHub logins to invite')).toBe(false);
    expect.soft(io.lines).toContain('This wizard helps you create a team, join an existing team, or resume setup. It checks GitHub, sets up your team, invites teammates, offers your local skills to connect, and offers the session hook and the /terum-skills Claude Code skill; re-run it any time to continue, and leave the invitation question blank to skip it.');
    expect(result.ok).toBe(true);
  });

  it('stops on a collected API failure before actions and hook, retaining the invite error and block', async () => {
    const fixture = await configuredCreator({ 'api -X PUT --include repos/alice/team/collaborators/bob': { code: 1, stdout: 'HTTP/2 403\n', stderr: 'gh: Resource not accessible (HTTP 403)' } });
    const io = new ScriptedPrompter(['bob']);
    const result = await run(fixture.args, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Could not invite @bob (GitHub status 403)'), value: { steps: { team: 'skipped' } } });
    expect(result.value?.steps.invite).toBeUndefined();
    expect(result.value?.steps.actions).toBeUndefined();
    expect(fixture.hookOffers()).toBe(0);
    expect(io.lines.join('\n')).toContain('Could not invite @bob');
    expect(io.lines.join('\n')).toContain('npx -y terum-skills@latest setup alice/team');
    expect(io.lines).not.toContain('Members:');
  });

  it('stops on invalid syntax after an earlier invitation without pretending that success was undone', async () => {
    const fixture = await configuredCreator({ 'api -X PUT --include repos/alice/team/collaborators/bob': { code: 0, stdout: 'HTTP/2 201\n', stderr: '' } });
    const io = new ScriptedPrompter(['bob @carol']);
    const result = await run(fixture.args, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Invalid GitHub login'), value: { steps: { team: 'skipped' } } });
    expect(fixture.runner.calls.filter((call) => call.command === 'gh' && call.args.join(' ').includes('collaborators/')).map((call) => call.args.at(-1))).toEqual(['repos/alice/team/collaborators/bob']);
    expect(io.lines).toContain('Invited @bob.');
    expect(io.lines.join('\n')).not.toContain('Send this to your teammate:');
    expect(result.value?.steps.invite).toBeUndefined();
    expect(fixture.hookOffers()).toBe(0);
  });

  it('recovers on a configured run when the invitation answer is blank', async () => {
    const fixture = await configuredCreator({});
    const io = new ScriptedPrompter(['']);
    const result = await run(fixture.args, io);
    expect(result).toMatchObject({ ok: true, value: { steps: { team: 'skipped', invite: 'skipped', actions: 'skipped', hook: 'skipped', done: 'printed' } } });
    expect(fixture.runner.calls.filter((call) => call.command === 'gh' && call.args.join(' ').includes('collaborators/'))).toEqual([]);
    expect(fixture.hookOffers()).toBe(1);
    expect(io.lines).toContain('Members:');
  });

  it('records all-204 invitations as done and continues through the hook and summary', async () => {
    const fixture = await configuredCreator({
      'api -X PUT --include repos/alice/team/collaborators/bob': { code: 0, stdout: 'HTTP/2.0 204 No Content\r\n', stderr: '' },
      'api -X PUT --include repos/alice/team/collaborators/carol': { code: 0, stdout: 'HTTP/2.0 204 No Content\r\n', stderr: '' },
    });
    const io = new ScriptedPrompter(['bob, carol']);
    const result = await run(fixture.args, io);
    expect(result).toMatchObject({ ok: true, value: { steps: { team: 'skipped', invite: 'done' } } });
    expect(io.lines).toEqual(expect.arrayContaining(['@bob already has access.', '@carol already has access.', 'Members:']));
    expect(io.lines.join('\n')).toContain('npx -y terum-skills@latest setup alice/team');
    expect(fixture.hookOffers()).toBe(1);
  });

  it('stops when GitHub refuses a configured non-admin or org invitation', async () => {
    const fixture = await configuredCreator({ 'api -X PUT --include repos/acme-org/team/collaborators/dave': { code: 1, stdout: 'HTTP/2 403\n', stderr: 'gh: Must have admin rights to Repository. (HTTP 403)' } }, 'acme-org');
    const io = new ScriptedPrompter(['dave']);
    const result = await run(fixture.args, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Could not invite @dave (GitHub status 403)'), value: { steps: { team: 'skipped' } } });
    expect(result.ok ? '' : result.error).toContain('admin rights');
    expect(result.value?.steps.invite).toBeUndefined();
    expect(fixture.hookOffers()).toBe(0);
    expect(io.askedAbout('Connect a skill')).toBe(false);
  });


  it('resumes an already configured creator without a team-repository write and forwards the original prompter', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const seen: unknown[] = [];
    const io = new ScriptedPrompter();
    const result = await run({ config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
      offerHook: async (received) => { seen.push(received); return 'present'; },
    } }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps).toMatchObject({ welcome: 'printed', github: 'done', team: 'skipped', actions: 'skipped', invite: 'skipped', community: 'skipped', hook: 'skipped', done: 'printed' });
    expect(seen).toEqual([io]);
    expect(io.lines.join('\n')).not.toMatch(/\bui\b/i);
    expect(io.lines).toContain('  npx -y terum-skills@latest eval <skill>             — evaluate a shared skill locally before publishing');
    expect(io.lines.join('\n')).not.toContain('Feedback and requests:');
    expect(io.lines).toContain('Resuming setup for team team. To join another team, run the setup command its owner sent you.');
    expect(io.askedAbout('Create a team or join one?')).toBe(false);
  });

  it('re-clones a configured team whose clone is gone — with the git identity — before it prompts for anything else, and the run completes (R8)', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    const home = join(fixture.root, 'home');
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    let hookOffers = 0;
    const result = await run({ config: store, home, runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
      offerHook: async () => { hookOffers += 1; return 'present'; },
    } }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps).toMatchObject({ team: 'done', actions: 'skipped', invite: 'skipped', hook: 'skipped', done: 'printed' });
    const clone = store.teamClone('team');
    expect(await readFile(join(clone, 'team.json'), 'utf8')).toContain('"name"');
    expect((await git(['config', 'user.name'], clone)).trim()).toBe('Me');
    expect((await git(['config', 'user.email'], clone)).trim()).toBe('me@example.com');
    expect(io.lines).toContain(`Team team's clone at ${clone} is missing; re-cloning it from ${fixture.bare}.`);
    expect(io.lines).toContain('Members:');
    expect(hookOffers).toBe(1);
    expect(io.asked).toEqual([]);
  });

  it('a re-clone that fails is the run\'s failure, before any prompt or hook offer', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    const missing = join(fixture.root, 'nowhere.git');
    await store.update((config) => { config.teams.team = { remote: missing, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    let hookOffers = 0;
    const result = await run({ config: store, home: join(fixture.root, 'home'), runner: mappedRunner(missing, missing, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
      offerHook: async () => { hookOffers += 1; return 'present'; },
    } }, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Could not clone') });
    expect(hookOffers).toBe(0);
    expect(io.asked).toEqual([]);
    expect(io.lines).not.toContain('Members:');
  });

  it.each([undefined, 'bare'] as const)('a folder with team.json but no repository — an interrupted leave, a restore that skipped dotfiles — is incomplete, not set up (R9) (form=%s)', async (form) => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await rm(join(clone, '.git'), { recursive: true, force: true });
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    const result = await run({ form, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
      offerHook: async () => 'present',
    } }, io);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(`${clone} exists and is not a complete clone`);
    expect(result.ok ? '' : result.error).toContain('move it aside');
    expect(result.ok ? '' : result.error).toContain(`run \`${form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest'} team join '${fixture.bare}'\` to restore it`);
    expect(io.lines).not.toContain('Members:');
  });

  it.each([undefined, 'bare'] as const)('refuses a clone of a different remote the way team join does, naming the origin (R9) (form=%s)', async (form) => {
    const fixture = await bareTeam(); const other = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(other.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    const result = await run({ form, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
      offerHook: async () => 'present',
    } }, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`${clone} is a clone of`) });
    expect(result.ok ? '' : result.error).toContain('move it aside');
    expect(result.ok ? '' : result.error).toContain(`run \`${form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest'} team join '${fixture.bare}'\` to restore it`);
    expect(io.lines).not.toContain('Members:');
  });

  it.each([undefined, 'bare'] as const)('names the move-aside repair when the clone directory survives without team.json (form=%s)', async (form) => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    // An interrupted `team leave` dies inside its rm -rf, so the directory survives; ensureClone
    // refuses that state, so setup must not name a bare `team join` as the whole repair.
    await rm(join(clone, 'team.json'), { force: true });
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    const result = await run({ form, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
      offerHook: async () => 'present',
    } }, io);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(`${clone} exists and is not a complete clone`);
    expect(result.ok ? '' : result.error).toContain('move it aside');
    expect(result.ok ? '' : result.error).toContain(`run \`${form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest'} team join '${fixture.bare}'\` to restore it`);
    expect(io.lines).not.toContain('Members:');
  });

  it('prints no member header and keeps the repository links when only the roster cannot be read', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    // team.json still parses; only the roster read fails, so the header must not print alone.
    await rm(join(clone, 'people'), { recursive: true, force: true });
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    const result = await run({ config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
      offerHook: async () => 'present',
    } }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps).toMatchObject({ team: 'skipped', done: 'printed' });
    expect(io.lines).not.toContain('Members:');
    expect(io.lines.join('\n')).toContain('the team details could not be read');
    // The repository links come from the configured remote, not the clone, so they survive.
    expect(io.lines).toContain(`Repository: ${fixture.bare}`);
    expect(io.lines).toContain(`README: ${fixture.bare}`);
  });

  it('onboards a GitHub creator end to end without taking any credential input', async () => {
    const fixture = await bareTeam();
    // The creator path needs an empty remote; the bare fixture is reset here solely as its host.
    await git(['init', '-q', '--bare', join(fixture.root, 'empty.git')]);
    const bare = join(fixture.root, 'empty.git');
    const root = join(fixture.root, 'creator');
    const home = join(root, 'home');
    await skillUnder(home);
    const store = createConfigStore(join(root, 'state'));
    const remote = githubRemote('alice', 'alpha-repo');
    const runner = mappedRunner(remote, bare, fakeGh('alice', {
      'repo create alpha-repo --private': { code: 0, stdout: '', stderr: '' },
      'repo view alpha-repo --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'alice/alpha-repo\n', stderr: '' },
      'api -X PUT --include repos/alice/alpha-repo/collaborators/bob': { code: 0, stdout: 'HTTP/2 201\n', stderr: '' },
      'api -X PUT --include repos/alice/alpha-repo/collaborators/carol': { code: 0, stdout: 'HTTP/2 201\n', stderr: '' },
    }));
    const io = new ScriptedPrompter(['Create a new team', 'alpha', '', '', 'Alice', 'alice@example.com', 'alpha-repo', 'bob carol', 'Connect starter'], [true, true, true], true);
    const result = await run({ config: store, home, runner, hook: hookFor(root), wrapper: wrapperFor(home), communityUrl: 'https://example.test/community' }, io);
    if (!result.ok) throw new Error(result.error);

    expect(result.value).toMatchObject({ role: 'creator', team: 'alpha', remote, steps: { welcome: 'printed', github: 'done', team: 'done', actions: 'done', invite: 'done', community: 'printed', hook: 'done', wrapper: 'done', done: 'printed' } });
    expect(io.asked).toEqual([
      'Create a team or join one?', 'Team name', 'GitHub login (- for none)', 'Team handle', 'Your name', 'Your email', 'GitHub repository name',
      'Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)', 'Connect a local skill folder to team alpha?', 'Connect starter?',
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(root).settingsFile})`,
      `Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ${join(home, '.claude', 'skills', 'terum-skills')})`,
    ]);
    expect(io.lines).toEqual(expect.arrayContaining([
      'Welcome to terum-skills.', "Your team's skills live in one private git repository the team controls; each member installs what they want, edits flow back on sync, and the team endorses the ones everyone should have.",
      'This wizard helps you create a team, join an existing team, or resume setup. It checks GitHub, sets up your team, invites teammates, offers your local skills to connect, and offers the session hook and the /terum-skills Claude Code skill; re-run it any time to continue, and leave the invitation question blank to skip it.',
      'Creating a new team creates a private GitHub repository under your account.',
      'GitHub: gh is logged in.', 'Next, from any terminal:',
      '  npx -y terum-skills@latest install alpha/<skill>   — install a shared skill (add @<version> to pin it)',
      '  npx -y terum-skills@latest ls [--local]             — list members and shared skills; --local lists your own',
      '  npx -y terum-skills@latest search <term>            — find a skill by name, description, or category',
      '  npx -y terum-skills@latest sync                     — pull updates and finish pending work',
      '  npx -y terum-skills@latest publish <skill> — endorse a skill already connected to the team',
      '  npx -y terum-skills@latest eval <skill>             — evaluate a shared skill locally before publishing',
      'Feedback and requests: https://example.test/community', 'Members:', '  @alice — Alice',
      'Repository: https://github.com/alice/alpha-repo', 'README: https://github.com/alice/alpha-repo/blob/main/README.md',
    ]));
    expect(io.lines.join('\n')).not.toMatch(/\bui\b/i);
    expect(io.lines).toContain('  npx -y terum-skills@latest eval <skill>             — evaluate a shared skill locally before publishing');
    expect(runner.calls.filter((call) => call.command === 'gh' && call.args.join(' ').includes('collaborators/')).map((call) => call.args.at(-1))).toEqual(['repos/alice/alpha-repo/collaborators/bob', 'repos/alice/alpha-repo/collaborators/carol']);
    expect(JSON.parse(await readFile(hookFor(root).settingsFile, 'utf8')).hooks.SessionStart).toHaveLength(1);
    expect(await readFile(join(home, '.claude', 'skills', 'terum-skills', 'SKILL.md'), 'utf8')).toBe(await readFile(wrapperFor(home).source, 'utf8'));
    expect(io.lines).toContain(`Installed the /terum-skills Claude Code skill at ${join(home, '.claude', 'skills', 'terum-skills')}.`);
    expect(await git(['ls-tree', '--name-only', 'main:skills'], bare)).toContain('starter');
  });

  it('resumes after team creation without creating a second repository', async () => {
    const fixture = await bareTeam();
    const bare = join(fixture.root, 'empty.git'); await git(['init', '-q', '--bare', bare]);
    const root = join(fixture.root, 'resume'); const home = join(root, 'home'); await skillUnder(home);
    const store = createConfigStore(join(root, 'state')); const remote = githubRemote('alice', 'resume-repo');
    const runner = mappedRunner(remote, bare, fakeGh('alice', {
      'repo create resume-repo --private': { code: 0, stdout: '', stderr: '' },
      'repo view resume-repo --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'alice/resume-repo\n', stderr: '' },
      'api -X PUT --include repos/alice/resume-repo/collaborators/bob': { code: 0, stdout: 'HTTP/2 201\n', stderr: '' },
    }));
    const first = new ScriptedPrompter(['Create a new team', 'resume', '', '', 'Alice', 'alice@example.com', 'resume-repo', 'bob']);
    const interrupted = await run({ config: store, home, runner, hook: hookFor(root), verbs: { invite: async () => { throw new Error('stop after team'); } } }, first);
    expect(interrupted).toMatchObject({ ok: false, error: 'stop after team', value: { steps: { team: 'done' } } });
    const second = new ScriptedPrompter(['bob', 'Connect starter'], [true, true], true);
    const resumed = await run({ config: store, home, runner, hook: hookFor(root) }, second);
    if (!resumed.ok) throw new Error(resumed.error);
    expect(second.askedAbout('Create a team or join one?')).toBe(false);
    expect(second.lines).toContain('Resuming setup for team resume. To join another team, run the setup command its owner sent you.');
    expect(resumed.value.steps).toMatchObject({ team: 'skipped', actions: 'done', invite: 'done', community: 'printed', hook: 'done', done: 'printed' });
    expect(runner.calls.filter((call) => call.command === 'gh' && call.args.join(' ') === 'repo create resume-repo --private')).toHaveLength(1);
    expect((await git(['ls-tree', '--name-only', 'main:people'], bare)).split('\n').filter(Boolean)).toEqual(['alice.json']);
  });

  it('resumes a join after its people file lands and offers the hook only once', async () => {
    const fixture = await bareTeam();
    const root = join(fixture.root, 'joiner'); const store = createConfigStore(join(root, 'state'));
    const remote = 'https://git.example/team.git'; const runner = mappedRunner(remote, fixture.bare, fakeGh('bob'));
    let failHook = true;
    const hook = async (io: Parameters<typeof offerHook>[0], options: Parameters<typeof offerHook>[1]) => {
      if (failHook) { failHook = false; throw new Error('stop before hook'); }
      return offerHook(io, options);
    };
    const first = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com']);
    const interrupted = await run({ target: remote, config: store, runner, hook: hookFor(root), communityUrl: 'https://example.test/community', verbs: { offerHook: hook } }, first);
    expect(interrupted).toMatchObject({ ok: false, error: 'stop before hook', value: { steps: { team: 'done', community: 'printed' } } });
    const second = new ScriptedPrompter([], [true]);
    const resumed = await run({ target: remote, config: store, runner, hook: hookFor(root), communityUrl: 'https://example.test/community', verbs: { offerHook: hook } }, second);
    if (!resumed.ok) throw new Error(resumed.error);
    expect(resumed.value.steps).toMatchObject({ team: 'skipped', invite: 'skipped', hook: 'done', done: 'printed' });
    expect((await git(['ls-tree', '--name-only', 'main:people'], fixture.bare)).split('\n').filter(Boolean).sort()).toEqual(['bob.json', 'seed.json']);
    expect(first.countAsked('Install the Claude Code session-start hook') + second.countAsked('Install the Claude Code session-start hook')).toBe(1);
  });

  it('quiet mode (the §6 install bootstrap) suppresses every print-only step and keeps every prompt', async () => {
    const fixture = await bareTeam();
    const root = join(fixture.root, 'quiet'); const store = createConfigStore(join(root, 'state'));
    const remote = 'https://git.example/team.git'; const runner = mappedRunner(remote, fixture.bare, fakeGh('bob'));
    const io = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com'], [true, true]);
    const home = join(root, 'home');
    const result = await run({ target: remote, quiet: true, offerConnect: false, config: store, runner, home, hook: hookFor(root), wrapper: wrapperFor(home), communityUrl: 'https://example.test/community' }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps).toEqual({ welcome: 'skipped', github: 'done', team: 'done', actions: 'skipped', invite: 'skipped', community: 'skipped', hook: 'done', wrapper: 'done', done: 'skipped' });
    expect(io.countAsked('Install the Claude Code session-start hook')).toBe(1);
    expect(io.countAsked('Install the /terum-skills Claude Code skill')).toBe(1);
    expect(await exists(join(home, '.claude', 'skills', 'terum-skills', 'SKILL.md'))).toBe(true);
    const printed = io.lines.join('\n');
    for (const line of ['Welcome to terum-skills', 'GitHub: gh', 'Next, from any terminal', 'Feedback and requests', 'Repository:', 'README:']) expect(printed, line).not.toContain(line);
    expect(JSON.parse(await git(['show', 'main:people/bob.json'], fixture.bare)).email).toBe('bob@example.com');
  });

  it('keeps setup as an orchestrator: real verbs ask every consent question themselves', async () => {
    const source = await readFile(new URL('../setup.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('io.confirm(');
    expect([...source.matchAll(/io\.(?:confirm|select|text)\(/g)].map((match) => match[0])).toEqual(['io.select(', 'io.text(']);

    const fixture = await bareTeam(); const root = join(fixture.root, 'real'); const home = join(root, 'home'); await skillUnder(home);
    const bare = join(fixture.root, 'empty.git'); await git(['init', '-q', '--bare', bare]);
    const remote = githubRemote('alice', 'questions');
    const runner = mappedRunner(remote, bare, fakeGh('alice', {
      'repo create questions --private': { code: 0, stdout: '', stderr: '' },
      'repo view questions --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'alice/questions\n', stderr: '' },
    }));
    const io = new ScriptedPrompter(['Create a new team', 'questions', '', '', 'Alice', 'alice@example.com', 'questions', '', 'Connect starter'], [true, false, true], true);
    const created = await run({ config: createConfigStore(join(root, 'state')), home, runner, hook: hookFor(root), wrapper: wrapperFor(home), communityUrl: '' }, io);
    if (!created.ok) throw new Error(created.error);
    const joinFixture = await bareTeam();
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await pushFromSeed(joinFixture.seed, 'skills/tool/SKILL.md', `---\nname: tool\ndescription: tool\nlicense: UNLICENSED\nallowed-tools: Bash(ls)\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(joinFixture.seed, 'team.json', JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [id], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }));
    const joinRoot = join(joinFixture.root, 'real-join'); const joinHome = join(joinRoot, 'home');
    const joinedIo = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com'], [true, true, false, false]);
    const joined = await run({ target: 'https://git.example/team.git', config: createConfigStore(join(joinRoot, 'state')), home: joinHome, runner: mappedRunner('https://git.example/team.git', joinFixture.bare, fakeGh('bob')), hook: hookFor(joinRoot), wrapper: wrapperFor(joinHome), communityUrl: '' }, joinedIo);
    if (!joined.ok) throw new Error(joined.error);
    expect([...io.asked, ...joinedIo.asked]).toEqual(expect.arrayContaining([
      'Connect a local skill folder to team questions?', 'Connect starter?', 'Install 1 team-endorsed skill(s)?', 'Approve these tools for tool?',
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(root).settingsFile})`,
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(joinRoot).settingsFile})`,
      `Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ${join(home, '.claude', 'skills', 'terum-skills')})`,
      `Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ${join(joinHome, '.claude', 'skills', 'terum-skills')})`,
    ]));
  });

  it.each([undefined, 'bare'] as const)('skips invitations for a configured generic-git creator and prints the host handoff (form=%s)', async (form) => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'generic'); const store = createConfigStore(join(root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter([], [false]);
    const result = await run({ form, config: store, home: join(root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed')), hook: hookFor(root) }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps.invite).toBe('skipped');
    expect(io.askedAbout('Invite teammates')).toBe(false);
    expect(io.lines.join('\n')).toContain(`Access to ${fixture.bare} is managed on the host; grant it there`);
  });

  it('uses the default community URL and never asks a joiner to invite anyone', async () => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'joiner-default'); const store = createConfigStore(join(root, 'state'));
    const remote = 'https://git.example/team.git'; const io = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com'], [false]);
    const result = await run({ target: remote, config: store, runner: mappedRunner(remote, fixture.bare, fakeGh('bob')), hook: hookFor(root) }, io);
    if (!result.ok) throw new Error(result.error);
    expect(io.asked).toEqual([
      'GitHub login (- for none)', 'Team handle', 'Your name', 'Your email',
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(root).settingsFile})`,
    ]);
    expect(result.value.steps).toMatchObject({ invite: 'skipped', community: 'printed', wrapper: 'skipped' });
    expect(io.lines.join('\n')).toContain('The /terum-skills Claude Code skill is not bundled in this copy of terum-skills');
    expect(io.lines).toContain(`Feedback and requests: ${COMMUNITY_URL}`);
    expect(io.lines.join('\n')).not.toMatch(/\bui\b/i);
    expect(io.lines).toContain('  npx -y terum-skills@latest eval <skill>             — evaluate a shared skill locally before publishing');
  });

  it('stops before team creation when a non-interactive creator is logged out', async () => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'logged-out');
    const runner = mappedRunner('https://github.com/me/team.git', fixture.bare, fakeGh('me', {}, false));
    const io = new ScriptedPrompter(['Create a new team'], [], false);
    const result = await run({ config: createConfigStore(join(root, 'state')), home: join(root, 'home'), runner, hook: hookFor(root) }, io);
    expect(io.asked).toEqual(['Create a team or join one?']);
    expect(result).toMatchObject({ ok: false, error: 'GitHub authentication is required to create a team: run `gh auth login` and retry, or create the team against an existing empty remote with `npx -y terum-skills@latest team create <name> --remote <url>`.' });
    expect(result.value?.steps.team).toBeUndefined();
    expect(runner.calls.filter((call) => call.command === 'git' && call.args[0] === 'push')).toEqual([]);
  });
});

it('setup prints roster in handle order and diagnoses a filename mismatch instead of listing its declared handle', async () => {
  const fixture = await bareTeam();
  for (const handle of ['a-b', 'a', 'a0', 'b']) await pushFromSeed(fixture.seed, `people/${handle}.json`, JSON.stringify(person(handle)));
  await pushFromSeed(fixture.seed, 'people/old.json', JSON.stringify(person('new')));
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const io = new ScriptedPrompter();
  const result = await run({ config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed')), communityUrl: '', verbs: { offerHook: async () => 'present' } }, io);
  expect(result.ok).toBe(true);
  expect(io.lines.filter((line) => line.startsWith('  @'))).toEqual(['a', 'a-b', 'a0', 'b', 'seed'].map((handle) => `  @${handle} — ${handle}`));
  expect(io.lines.some((line) => /^  people\/old\.json: .+/.test(line))).toBe(true);
  expect(io.lines).toContain(`README: ${fixture.bare}`);
});

it('the creator picker omits name-mismatched folders and reports the skipped count', async () => {
  const fixture = await bareTeam();
  const bare = join(fixture.root, 'empty.git');
  await git(['init', '-q', '--bare', bare]);
  const root = join(fixture.root, 'creator');
  const home = join(root, 'home');
  await skillUnder(home);
  await skillUnder(home, 'skip');
  await skillUnder(home, 'placed');
  await skillUnder(home, 'gsd-x');
  await writeFile(join(home, '.claude', 'skills', 'gsd-x', 'SKILL.md'), '---\nname: gsd:x\ndescription: GSD skill\n---\n');
  const store = createConfigStore(join(root, 'state'));
  await store.update((config) => { config.placements[join(home, '.claude', 'skills', 'placed')] = { id: '33333333-3333-4333-8333-333333333333', team: 'other', version: null, scope: { kind: 'global' }, fingerprint: '', placed_at: '' }; });
  const remote = githubRemote('alice', 'alpha-repo');
  const runner = mappedRunner(remote, bare, fakeGh('alice', {
    'repo create alpha-repo --private': { code: 0, stdout: '', stderr: '' },
    'repo view alpha-repo --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'alice/alpha-repo\n', stderr: '' },
  }));
  const io = new ScriptedPrompter(['Create a new team', 'alpha', '', '', 'Alice', 'alice@example.com', 'alpha-repo', '', 'Connect starter', 'Done'], [true, false], true);
  const result = await run({ config: store, home, runner, hook: hookFor(root), communityUrl: '' }, io);
  if (!result.ok) throw new Error(result.error);
  expect(io.offered).toEqual([['Create a new team', 'Join an existing team'], ['Connect skip', 'Connect starter', 'Skip'], ['Connect skip', 'Done']]);
  expect(io.lines).toContain('Skipped 1 local folders that cannot be connected. Run `npx -y terum-skills@latest ls --local` for paths and reasons.');
});


describe('issue 9 setup delegation', () => {
  it.each(['skipped', 'done', 'failed'] as const)('forwards the same io and home and records %s', async (outcome) => {
    const fixture = await bareTeam(); const home = join(fixture.root, 'home'); const cwd = join(fixture.root, 'project');
    const store = createConfigStore(join(fixture.root, 'state')); const remote = githubRemote('alice', 'team');
    const runner = mappedRunner(remote, fixture.bare, fakeGh('alice'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote, handle: 'seed' }; });
    const io = new ScriptedPrompter([''], [], true); let calls = 0;
    const result = await run({ config: store, home, cwd, runner, communityUrl: '', verbs: {
      connect: async (args, received) => {
        calls += 1; expect(received).toBe(io); expect(args).toEqual({ team: 'team', home, cwd, config: store, runner });
        return outcome === 'failed' ? failure('connect failed') : success(outcome === 'done' ? { id: 'id', name: 'sample' } : undefined);
      }, offerHook: async () => 'present',
    } }, io);
    expect(calls).toBe(1);
    if (outcome === 'failed') { expect(result).toMatchObject({ ok: false, error: 'connect failed' }); expect(result.value?.steps.actions).toBeUndefined(); expect(io.asked).toEqual(['Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)']); }
    else { expect(result).toMatchObject({ ok: true, value: { steps: { actions: outcome, invite: 'skipped', done: 'printed' } } }); expect(io.asked).toEqual(['Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)']); }
  });

  it.each([false, true])('continues to invite after empty inventory or Skip (candidate: %s)', async (hasCandidate) => {
    const fixture = await bareTeam(); const home = join(fixture.root, 'home');
    if (hasCandidate) await skillUnder(home);
    const store = createConfigStore(join(fixture.root, 'state')); const remote = githubRemote('alice', 'team');
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote, handle: 'seed' }; });
    const io = new ScriptedPrompter(hasCandidate ? ['', 'Skip'] : [''], [], true);
    const result = await run({ config: store, home, runner: mappedRunner(remote, fixture.bare, fakeGh('alice')), communityUrl: '', verbs: { offerHook: async () => 'present' } }, io);
    expect(result).toMatchObject({ ok: true, value: { steps: { actions: 'skipped', invite: 'skipped', done: 'printed' } } });
    expect(io.asked).toEqual(['Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)', ...(hasCandidate ? ['Connect a local skill folder to team team?'] : [])]);
    expect(io.lines).toContain(hasCandidate ? 'Nothing connected.' : `No local candidates to connect under ${join(home, '.claude', 'skills')}. Skills elsewhere can be connected by passing their folder path.`);
    expect(io.lines).toContain('  npx -y terum-skills@latest connect      — connect your local skills to the team (asks which)');
  });
});

it('setup joiner prints the conditional gh notice and propagates the clone access explanation (issue 11)', async () => {
  const fixture = await bareTeam();
  const store = createConfigStore(join(fixture.root, 'state'));
  const remote = githubRemote('acme', 'team');
  const base = mappedRunner(remote, fixture.bare, fakeGh('me', {
    'api user/repository_invitations': { code: 0, stdout: JSON.stringify([{ id: 42, repository: { full_name: 'acme/team' } }]), stderr: '' },
    'api --method PATCH user/repository_invitations/42': { code: 0, stdout: '{}', stderr: '' },
  }));
  const runner = wrapRunner(base, async (command, args, _options, next) => command === 'git' && args[0] === 'clone' ? { code: 128, stdout: '', stderr: 'remote: Repository not found.' } : next());
  const io = new ScriptedPrompter(['', 'me', 'Me', 'me@example.com']);
  const result = await run({ target: 'acme/team', config: store, home: join(fixture.root, 'home'), hook: hookFor(fixture.root), runner }, io);
  expect.soft(result).toMatchObject({ ok: false, error: expect.stringContaining(`Git could not access ${remote}.`) });
  expect(io.lines).toContain('GitHub: gh is logged in. For an owner/repository target, setup will try to accept a matching invitation; Git access uses your configured Git credentials.');
  expect(base.calls.filter((call) => call.args.join(' ') === 'api --method PATCH user/repository_invitations/42')).toHaveLength(1);
  expect(base.calls.some((call) => call.args.includes('setup-git') || call.args.includes('ls-remote'))).toBe(false);
});


it.each([undefined, 'bare'] as const)('threads %s from creator setup to connect omission hints and every epilogue line', async (form) => {
  const fixture = await configuredCreator({});
  const home = fixture.args.home;
  await skillUnder(home, 'candidate');
  const rejected = join(home, '.claude/skills/rejected'); await mkdir(rejected);
  await writeFile(join(rejected, 'SKILL.md'), 'not frontmatter');
  const io = new ScriptedPrompter(['', 'Skip'], [], true);
  const result = await run({ ...fixture.args, form }, io);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const prefix = form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest';
  expect(io.lines).toContain(`Skipped 1 local folders that cannot be connected. Run \`${prefix} ls --local\` for paths and reasons.`);
  const start = io.lines.indexOf('Next, from any terminal:');
  expect(start).toBeGreaterThan(-1);
  const lines = io.lines.slice(start+1, start+8);
  expect(lines).toHaveLength(7);
  for (const line of lines) expect(line.startsWith(`  ${prefix} `)).toBe(true);
  expect(lines.map((line) => line.slice(prefix.length+3).split(' ')[0])).toEqual(['install', 'ls', 'search', 'sync', 'publish', 'eval', 'connect']);
});
