import * as estimates from '../../lib/evals/estimate.js';
import * as tty from '../../lib/tty.js';
import * as promptModule from '../../lib/prompt.js';
import * as packageModule from '../../lib/package.js';
import * as platformModule from '../../lib/platform.js';
import { readEvalQueue } from '../../lib/evals/queue.js';
import { estimateFromReceipts, estimateLine } from '../../lib/evals/estimate.js';
import { createExecute } from '../../lib/execute.js';
import { frameChannel, type Frame, type ResultOutcome } from '../../lib/frames.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { COMMUNITY_URL } from '../../lib/community.js';
import { createConfigStore } from '../../lib/config.js';
import { failure, success } from '../../lib/result.js';
import { offerHook } from '../../lib/hook.js';
import { bareTeam, cloneWithIdentity, exists, fakeGh, git, mappedRunner, person, pushFromSeed, NonInteractivePrompter, ScriptedPrompter, temporaryDirectory, wrapperFor, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { seedPending, pendingReceipt, pendingSkill, measuredReceipt } from './pending-eval-fixtures.js';
import { Prompter, PromptClosedError } from '../../lib/prompt.js';
import type { EvalArgs } from '../eval.js';
import { evalsQuestion, expandTilde, JOIN_CHOICE, PROJECTS_QUESTION, PROJECTS_WHERE_QUESTION, ROLE_QUESTION, run } from '../setup.js';
import { APP_OFFER, APP_QUESTION } from '../app.js';

const hookFor = (root: string) => ({ settingsFile: join(root, 'settings.json'), backupDir: join(root, 'backups') });
const githubRemote = (owner: string, repository: string) => `https://github.com/${owner}/${repository}.git`;
/**
 * Wrapper options for the cases that are not about the wrapper: a bundled source that cannot exist, so
 * `offerWrapper` reports 'unavailable', prints one line and asks nothing. Explicit because the default source
 * (BUNDLED_WRAPPER) is resolved from the package root, so whether it exists depends on whether this checkout
 * happens to have been built — a fixture must never depend on that. `skillsRoot` is left to
 * defaultWrapperOptions(home): an unavailable source is reported before anything reads it.
 */
const noBundledWrapper = { source: join(tmpdir(), `terum-skills-unbundled-${randomUUID()}`, 'SKILL.md') };

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
  return { app: false, config: store, home, runner, hook: hookFor(root), wrapper: noBundledWrapper, communityUrl: '' };
}

async function configuredCreator(handlers: Parameters<typeof fakeGh>[1], owner = 'alice') {
  const fixture = await bareTeam(); const root = join(fixture.root, 'configured');
  const store = createConfigStore(join(root, 'state')); const remote = githubRemote(owner, 'team');
  await store.update((config) => { config.teams.team = { remote, handle: 'alice' }; });
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  const runner = mappedRunner(remote, fixture.bare, fakeGh('alice', handlers));
  let hookOffers = 0;
  return {
    args: { app: false, config: store, home: join(root, 'home'), runner, hook: hookFor(root), wrapper: noBundledWrapper, communityUrl: '', verbs: {
      offerHook: async () => { hookOffers += 1; return 'present' as const; },
    } },
    runner,
    hookOffers: () => hookOffers,
  };
}

describe('setup (§6.1)', () => {

  it.each([undefined, 'bare'] as const)('hands a target-less joiner back to the owner without any calls or local writes (form=%s)', async (form) => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'handoff');
    const store = createConfigStore(join(root, 'state'));
    const runner = mappedRunner('https://github.com/me/team.git', fixture.bare, fakeGh('me', {}, false));
    const calls = { team: 0, invite: 0, offerHook: 0, ensureRoot: 0, update: 0 };
    const io = new ScriptedPrompter(['Join an existing team']);
    const result = await run({ app: false, form, config: { ...store,
      ensureRoot: async () => { calls.ensureRoot += 1; return store.ensureRoot(); },
      update: async (mutate) => { calls.update += 1; return store.update(mutate); },
    }, home: join(root, 'home'), runner, hook: hookFor(root), verbs: {
      team: async () => { calls.team += 1; throw new Error('unexpected team'); },
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
    expect.soft(calls).toEqual({ team: 0, invite: 0, offerHook: 0, ensureRoot: 0, update: 0 });
    expect.soft(await exists(join(root, 'state'))).toBe(false);
    expect.soft(await exists(hookFor(root).settingsFile)).toBe(false);
    expect.soft(await exists(hookFor(root).backupDir)).toBe(false);
  });

  it('asks for teammates right after the team exists, prints the block the owner sends, and then prints the hints', async () => {
    const args = await freshCreator();
    const io = new AnsweringPrompter(
      { 'Create a team or join one?': 'Create a new team', 'Team name': 'alpha', 'GitHub login': '', 'Team handle': '', 'Your name': 'Alice', 'Your email': 'alice@example.com', 'GitHub repository name': 'alpha-repo', invite: 'bob' },
      { 'Install the Claude Code session-start hook': false },
    );
    const result = await run(args, io);
    if (!result.ok) throw new Error(result.error);
    const created = io.at((e) => e.startsWith('print:Created team alpha at'));
    const asked = io.at((e) => e.startsWith('ask:') && /invite/i.test(e));
    const invited = io.at((e) => e === 'print:Invited @bob.');
    const block = io.at((e) => e.includes('npx -y terum-skills@latest setup alice/alpha-repo'));
    const hints = io.at((e) => e === 'print:Next, from any terminal:');
    const order = [created, asked, invited, block, hints];
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(result.value.steps).toMatchObject({ team: 'done', invite: 'done', hook: 'skipped', done: 'printed' });
  });

  it('uses the agreed invitation wording and no longer the old one', async () => {
    const args = await freshCreator();
    // Discovery no, eval select Skip, hook no.
    const io = new ScriptedPrompter(['Create a new team', 'alpha', '', '', 'Alice', 'alice@example.com', 'alpha-repo', 'bob', 'Skip'], [false, false], true);
    const result = await run(args, io);
    expect.soft(io.asked).toContain('Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)');
    expect.soft(io.askedAbout('GitHub logins to invite')).toBe(false);
    expect.soft(io.lines).toContain('This wizard helps you create a team, join one, invite teammates, and offer the session hook and the /terum-skills Claude Code skill; re-run it any time to continue, and leave the invitation question blank to skip it.');
    expect(result.ok).toBe(true);
  });

  it('stops on a collected API failure before actions and hook, retaining the invite error and block', async () => {
    const fixture = await configuredCreator({ 'api -X PUT --include repos/alice/team/collaborators/bob': { code: 1, stdout: 'HTTP/2 403\n', stderr: 'gh: Resource not accessible (HTTP 403)' } });
    const io = new ScriptedPrompter(['bob']);
    const result = await run(fixture.args, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Could not invite @bob (GitHub status 403)'), value: { steps: { team: 'skipped' } } });
    expect(result.value?.steps.invite).toBeUndefined();
    expect(fixture.hookOffers()).toBe(0);
    expect(io.lines.join('\n')).toContain('Could not invite @bob');
    expect(io.lines.join('\n')).toContain('npx -y terum-skills@latest setup alice/team');
    expect(io.lines).not.toContain('Members:');
  });

  it('stops on invalid syntax before sending any invitation (the batch is validated up front)', async () => {
    const fixture = await configuredCreator({ 'api -X PUT --include repos/alice/team/collaborators/bob': { code: 0, stdout: 'HTTP/2 201\n', stderr: '' } });
    const io = new ScriptedPrompter(['bob @carol']);
    const result = await run(fixture.args, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Invalid GitHub login'), value: { steps: { team: 'skipped' } } });
    expect(fixture.runner.calls.filter((call) => call.command === 'gh' && call.args.join(' ').includes('collaborators/'))).toEqual([]);
    expect(io.lines).not.toContain('Invited @bob.');
    expect(result.ok ? '' : result.error).toContain('@carol');
    expect(io.lines.join('\n')).not.toContain('Send this to your teammate:');
    expect(result.value?.steps.invite).toBeUndefined();
    expect(fixture.hookOffers()).toBe(0);
  });

  it('recovers on a configured run when the invitation answer is blank', async () => {
    const fixture = await configuredCreator({});
    const io = new ScriptedPrompter(['']);
    const result = await run(fixture.args, io);
    expect(result).toMatchObject({ ok: true, value: { steps: { team: 'skipped', invite: 'skipped', hook: 'skipped', done: 'printed' } } });
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
    const result = await run({ app: false, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), wrapper: noBundledWrapper, communityUrl: '', verbs: {
      offerHook: async (received) => { seen.push(received); return 'present'; },
    } }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps).toMatchObject({ welcome: 'printed', github: 'done', team: 'skipped', invite: 'skipped', community: 'skipped', hook: 'skipped', done: 'printed' });
    expect(seen).toEqual([io]);
    expect(io.lines.join('\n')).not.toMatch(/\bui\b/i);
    expect(io.lines).toContain('  npx -y terum-skills@latest eval <skill>             — evaluate a shared skill locally before publishing');
    expect(io.lines.join('\n')).not.toContain('Feedback and requests:');
    expect(io.lines).toContain('Resuming setup for team team. Terum Skills keeps one team per machine; to move this machine to another team run `npx -y terum-skills@latest team leave \'team\'` first.');
    expect(io.askedAbout('Create a team or join one?')).toBe(false);
  });

  it('re-clones a configured team whose clone is gone — with the git identity — before it prompts for anything else, and the run completes (R8)', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    const home = join(fixture.root, 'home');
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    let hookOffers = 0;
    const result = await run({ app: false, config: store, home, runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), wrapper: noBundledWrapper, communityUrl: '', verbs: {
      offerHook: async () => { hookOffers += 1; return 'present'; },
    } }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps).toMatchObject({ team: 'done', invite: 'skipped', hook: 'skipped', done: 'printed' });
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
    const result = await run({ app: false, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(missing, missing, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
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
    const result = await run({ app: false, form, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
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
    const result = await run({ app: false, form, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
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
    const result = await run({ app: false, form, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
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
    const result = await run({ app: false, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), wrapper: noBundledWrapper, communityUrl: '', verbs: {
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
    // Discovery no, then hook and wrapper installation.
    const io = new ScriptedPrompter(['Create a new team', 'alpha', '', '', 'Alice', 'alice@example.com', 'alpha-repo', 'bob carol'], [false, true, true], true);
    const result = await run({ app: false, config: store, home, runner, hook: hookFor(root), wrapper: wrapperFor(home), communityUrl: 'https://example.test/community' }, io);
    if (!result.ok) throw new Error(result.error);

    expect(result.value).toMatchObject({ role: 'creator', team: 'alpha', remote, steps: { welcome: 'printed', github: 'done', team: 'done', invite: 'done', community: 'printed', hook: 'done', wrapper: 'done', done: 'printed' } });
    expect(io.asked).toEqual([
      'Create a team or join one?', 'Team name', 'GitHub login (- for none)', 'Team handle', 'Your name', 'Your email', 'GitHub repository name',
      'Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)',
      PROJECTS_QUESTION,
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(root).settingsFile})`,
      `Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ${join(home, '.claude', 'skills', 'terum-skills')})`,
    ]);
    expect(io.lines).toEqual(expect.arrayContaining([
      'Welcome to terum-skills.', "Your team's skills live in one private git repository the team controls; each member installs what they want and publishes local skills explicitly.",
      'This wizard helps you create a team, join one, invite teammates, and offer the session hook and the /terum-skills Claude Code skill; re-run it any time to continue, and leave the invitation question blank to skip it.',
      'Creating a new team creates a private GitHub repository under your account.',
      'GitHub: gh is logged in.', 'Next, from any terminal:',
      '  npx -y terum-skills@latest install alpha/<skill>   — install a shared skill (add @<version> to pin it)',
      '  npx -y terum-skills@latest ls [--local]             — list members and shared skills; --local lists your own',
      '  npx -y terum-skills@latest search <term>            — find a skill by name, description, or category',
      '  npx -y terum-skills@latest sync                     — fetch the team clone',
      '  npx -y terum-skills@latest publish <skill>          — publish a local skill explicitly',
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
    // D20 deleted setup's `actions` step, whose only body offered `connect`, so onboarding now
    // uploads nothing. `skills/` still holds the scaffold's own `.gitkeep` (team.ts writes it), so
    // pinning the exact listing is what proves no local skill was published.
    expect((await git(['ls-tree', '--name-only', 'main:skills'], bare)).trim()).toBe('.gitkeep');
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
    const interrupted = await run({ app: false, config: store, home, runner, hook: hookFor(root), wrapper: noBundledWrapper, verbs: { invite: async () => { throw new Error('stop after team'); } } }, first);
    expect(interrupted).toMatchObject({ ok: false, error: 'stop after team', value: { steps: { team: 'done' } } });
    // Discovery no, eval select Skip, hook yes.
    const second = new ScriptedPrompter(['bob', 'Skip'], [false, true], true);
    const resumed = await run({ app: false, config: store, home, runner, hook: hookFor(root), wrapper: noBundledWrapper }, second);
    if (!resumed.ok) throw new Error(resumed.error);
    expect(second.askedAbout('Create a team or join one?')).toBe(false);
    expect(second.lines).toContain('Resuming setup for team resume. Terum Skills keeps one team per machine; to move this machine to another team run `npx -y terum-skills@latest team leave \'resume\'` first.');
    expect(resumed.value.steps).toMatchObject({ team: 'skipped', invite: 'done', community: 'printed', hook: 'done', done: 'printed' });
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
    const interrupted = await run({ app: false, target: remote, config: store, runner, hook: hookFor(root), wrapper: noBundledWrapper, communityUrl: 'https://example.test/community', verbs: { offerHook: hook } }, first);
    expect(interrupted).toMatchObject({ ok: false, error: 'stop before hook', value: { steps: { team: 'done', community: 'printed' } } });
    const second = new ScriptedPrompter([], [true]);
    const resumed = await run({ app: false, target: remote, config: store, runner, hook: hookFor(root), wrapper: noBundledWrapper, communityUrl: 'https://example.test/community', verbs: { offerHook: hook } }, second);
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
    const result = await run({ app: false, target: remote, quiet: true, config: store, runner, home, hook: hookFor(root), wrapper: wrapperFor(home), communityUrl: 'https://example.test/community' }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps).toEqual({ welcome: 'skipped', app: 'skipped', github: 'done', team: 'done', invite: 'skipped', projects: 'skipped', evals: 'skipped', community: 'skipped', hook: 'done', wrapper: 'done', done: 'skipped' });
    expect(io.countAsked('Install the Claude Code session-start hook')).toBe(1);
    expect(io.countAsked('Install the /terum-skills Claude Code skill')).toBe(1);
    expect(await exists(join(home, '.claude', 'skills', 'terum-skills', 'SKILL.md'))).toBe(true);
    const printed = io.lines.join('\n');
    for (const line of ['Welcome to terum-skills', 'GitHub: gh', 'Next, from any terminal', 'Feedback and requests', 'Repository:', 'README:']) expect(printed, line).not.toContain(line);
    expect(JSON.parse(await git(['show', 'main:people/bob.json'], fixture.bare)).email).toBe('bob@example.com');
  });

  it('keeps setup as an orchestrator: real verbs ask every consent question themselves', async () => {
    const source = await readFile(new URL('../setup.ts', import.meta.url), 'utf8');
    // setup still delegates every DURABLE consent question to the real verb that performs the write. The only
    // confirms it owns are the two optional trailing steps, which belong to no verb: the project offer and
    // its folder question (D13 replaced the scan's three further prompts with one picker), and the eval
    // mode, batch size and continuation questions (f-wizard D2). This list is exhaustive and ordered, so
    // any further prompt added to setup.ts fails here and has to be argued for.
    expect([...source.matchAll(/io\.(?:confirm|select|text)\(/g)].map((match) => match[0]))
      .toEqual(['io.select(', 'io.text(', 'io.confirm(', 'io.text(', 'io.select(', 'io.text(', 'io.confirm(']);

    const fixture = await bareTeam(); const root = join(fixture.root, 'real'); const home = join(root, 'home'); await skillUnder(home);
    const bare = join(fixture.root, 'empty.git'); await git(['init', '-q', '--bare', bare]);
    const remote = githubRemote('alice', 'questions');
    const runner = mappedRunner(remote, bare, fakeGh('alice', {
      'repo create questions --private': { code: 0, stdout: '', stderr: '' },
      'repo view questions --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'alice/questions\n', stderr: '' },
    }));
    // Discovery no, eval select Skip, hook no, wrapper yes. (joinedIo below is non-interactive, so
    // it is never offered either optional step.)
    const io = new ScriptedPrompter(['Create a new team', 'questions', '', '', 'Alice', 'alice@example.com', 'questions', '', 'Skip'], [false, false, true], true);
    const created = await run({ app: false, config: createConfigStore(join(root, 'state')), home, runner, hook: hookFor(root), wrapper: wrapperFor(home), communityUrl: '' }, io);
    if (!created.ok) throw new Error(created.error);
    const joinFixture = await bareTeam();
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await pushFromSeed(joinFixture.seed, 'skills/tool/v1/SKILL.md', `---\nname: tool\ndescription: tool\nlicense: UNLICENSED\nallowed-tools: Bash(ls)\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(joinFixture.seed, 'team.json', JSON.stringify({ layout_version: 3, name: 'team', categories: [], projects: { Global: { remotes: [], skills: [id] } }, archived: [], policy: { skill_license: 'UNLICENSED' } }));
    const joinRoot = join(joinFixture.root, 'real-join'); const joinHome = join(joinRoot, 'home');
    const joinedIo = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com'], [true, true, false, false]);
    const joined = await run({ app: false, target: 'https://git.example/team.git', config: createConfigStore(join(joinRoot, 'state')), home: joinHome, runner: mappedRunner('https://git.example/team.git', joinFixture.bare, fakeGh('bob')), hook: hookFor(joinRoot), wrapper: wrapperFor(joinHome), communityUrl: '' }, joinedIo);
    if (!joined.ok) throw new Error(joined.error);
    expect([...io.asked, ...joinedIo.asked]).toEqual(expect.arrayContaining([
      'Install 1 team-endorsed skill(s)?', 'Approve these tools for tool?',
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
    const result = await run({ app: false, form, config: store, home: join(root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed')), hook: hookFor(root), wrapper: noBundledWrapper }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps.invite).toBe('skipped');
    expect(io.askedAbout('Invite teammates')).toBe(false);
    expect(io.lines.join('\n')).toContain(`Access to ${fixture.bare} is managed on the host; grant it there`);
  });

  it('uses the default community URL and never asks a joiner to invite anyone', async () => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'joiner-default'); const store = createConfigStore(join(root, 'state'));
    const remote = 'https://git.example/team.git'; const io = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com'], [false]);
    const result = await run({ app: false, target: remote, config: store, runner: mappedRunner(remote, fixture.bare, fakeGh('bob')), hook: hookFor(root), wrapper: noBundledWrapper }, io);
    if (!result.ok) throw new Error(result.error);
    expect(io.asked).toEqual([
      'GitHub login (- for none)', 'Team handle', 'Your name', 'Your email',
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(root).settingsFile})`,
    ]);
    expect(result.value.steps).toMatchObject({ invite: 'skipped', community: 'printed', wrapper: 'skipped' });
    expect(io.lines.join('\n')).toContain('The /terum-skills Claude Code skill is not bundled in this copy of terum-skills');
    expect(COMMUNITY_URL).toBe('https://discord.gg/8tnRrxRM3Z');
    expect(io.lines).toContain(`Feedback and requests: ${COMMUNITY_URL}`);
    expect(io.lines.join('\n')).not.toMatch(/\bui\b/i);
    expect(io.lines).toContain('  npx -y terum-skills@latest eval <skill>             — evaluate a shared skill locally before publishing');
  });

  it('stops before team creation when a non-interactive creator is logged out', async () => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'logged-out');
    const runner = mappedRunner('https://github.com/me/team.git', fixture.bare, fakeGh('me', {}, false));
    const io = new ScriptedPrompter(['Create a new team'], [], false);
    const result = await run({ app: false, config: createConfigStore(join(root, 'state')), home: join(root, 'home'), runner, hook: hookFor(root) }, io);
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
  const result = await run({ app: false, config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed')), wrapper: noBundledWrapper, communityUrl: '', verbs: { offerHook: async () => 'present' } }, io);
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
  // Discovery no, hook no, wrapper unavailable.
  const io = new ScriptedPrompter(['Create a new team', 'alpha', '', '', 'Alice', 'alice@example.com', 'alpha-repo', ''], [false, false], true);
  const result = await run({ app: false, config: store, home, runner, hook: hookFor(root), wrapper: noBundledWrapper, communityUrl: '' }, io);
  if (!result.ok) throw new Error(result.error);
  expect(io.offered).toEqual([['Create a new team', 'Join an existing team']]);
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
  const result = await run({ app: false, target: 'acme/team', config: store, home: join(fixture.root, 'home'), hook: hookFor(fixture.root), runner }, io);
  expect.soft(result).toMatchObject({ ok: false, error: expect.stringContaining(`Git could not access ${remote}.`) });
  expect(io.lines).toContain('GitHub: gh is logged in. For an owner/repository target, setup will try to accept a matching invitation; Git access uses your configured Git credentials.');
  expect(base.calls.filter((call) => call.args.join(' ') === 'api --method PATCH user/repository_invitations/42')).toHaveLength(1);
  expect(base.calls.some((call) => call.args.includes('setup-git') || call.args.includes('ls-remote'))).toBe(false);
});


it.each([undefined, 'bare'] as const)('threads %s through every setup epilogue line', async (form) => {
  const fixture = await configuredCreator({});
  const home = fixture.args.home;
  await skillUnder(home, 'candidate');
  const rejected = join(home, '.claude/skills/rejected'); await mkdir(rejected);
  await writeFile(join(rejected, 'SKILL.md'), 'not frontmatter');
  const io = new ScriptedPrompter(['', 'Skip'], [], true);
  const result = await run({ ...fixture.args, form }, io);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const prefix = form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest';
  const start = io.lines.indexOf('Next, from any terminal:');
  expect(start).toBeGreaterThan(-1);
  const lines = io.lines.slice(start+1, start+7);
  expect(lines).toHaveLength(6);
  for (const line of lines) expect(line.startsWith(`  ${prefix} `)).toBe(true);
  expect(lines.map((line) => line.slice(prefix.length+3).split(' ')[0])).toEqual(['install', 'ls', 'search', 'sync', 'publish', 'eval']);
});

describe('the desktop app hand-off (D4/D5 2026-09-08; auto-launch, Teddy 2026-09-09)', () => {
  const mac = { platform: 'darwin' as const, arch: 'arm64' };
  const linux = { platform: 'linux' as const, arch: 'x64', procVersion: 'Linux 6.8' };
  const appOk = (calls: unknown[]) => (async (args: { offer?: boolean; config: ReturnType<typeof createConfigStore> }, io: Prompter) => {
    if (args.offer) {
      for (const line of APP_OFFER) io.print(line);
      if (!(await io.confirm(APP_QUESTION))) { await args.config.update((config) => { config.app = { choice: 'declined', at: 'now' }; }); return success({ platform: 'darwin-arm64' as const, version: '0.1.6', action: 'declined' as const, appPath: null, statePath: null }); }
    }
    calls.push(args);
    return success({ platform: 'darwin-arm64' as const, version: '0.1.6', action: 'launched' as const, appPath: '/Applications/Terum Skills.app', statePath: '/tmp/app.json' });
  }) as never;
  class SP extends ScriptedPrompter { constructor(answers: string[] = [], confirms: boolean[] = []) { super(answers, confirms, true); } }

  it('passes live environment to app availability detection and preserves injected evidence', async () => {
    const detect = vi.spyOn(platformModule, 'detectPlatform').mockReturnValue('win32-arm64');
    try {
      const calls: unknown[] = [];
      const config = createConfigStore(join(await temporaryDirectory(), 'state'));
      expect(await run({ config, verbs: { app: appOk(calls) } }, new SP())).toMatchObject({ ok: true, value: { steps: { app: 'done' } } });
      expect(detect.mock.calls[0]?.[0].env).toBe(process.env);
      await run({ config, evidence: mac, verbs: { app: appOk(calls) } }, new SP());
      expect(detect.mock.calls[1]?.[0]).toBe(mac);
      expect(mac).not.toHaveProperty('env');
      expect(calls).toHaveLength(2);
    } finally { detect.mockRestore(); }
  });

  it('opens the app without asking where one exists, and a failed hand-off is printed and the wizard continues', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'state'));
    const calls: unknown[] = [];
    const io = new SP([], []);
    const result = await run({ config: store, evidence: mac, verbs: { app: appOk(calls) } }, io);
    expect(result).toMatchObject({ ok: true, value: { steps: { welcome: 'printed', app: 'done' } } });
    expect(io.asked).toEqual([]);
    expect(io.lines).not.toContain(APP_OFFER[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ offer: false, intent: 'setup' });
    // The app could not be installed (offline, no gh): the reason is printed and the terminal wizard goes on.
    const failing = new SP([JOIN_CHOICE], []);
    const failed = await run({ config: store, evidence: mac, verbs: { app: (async () => failure('Could not reach GitHub to download the desktop app; you appear to be offline.')) as never } }, failing);
    expect(failed).toMatchObject({ ok: true, value: { steps: { app: 'skipped', role: 'done' } } });
    expect(failing.lines).toContain('Could not reach GitHub to download the desktop app; you appear to be offline.');
    expect(failing.asked).toEqual([ROLE_QUESTION]);
  });

  it('the hand-off ends setup in the app; with a target the person is told to join in the app', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'state'));
    const calls: unknown[] = [];
    const io = new SP([], []);
    const result = await run({ config: store, evidence: mac, form: 'bare', verbs: { app: appOk(calls) } }, io);
    expect(result).toMatchObject({ ok: true, value: { steps: { welcome: 'printed', app: 'done' } } });
    expect(result.ok && result.value.steps.role).toBeUndefined();
    expect(io.lines.at(-1)).toBe('Continuing in the app.');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ form: 'bare', evidence: mac, offer: false, intent: 'setup' });
    const joiner = new SP([], []);
    await run({ target: 'alice/team', config: store, evidence: mac, verbs: { app: appOk(calls) } }, joiner);
    expect(joiner.lines.at(-1)).toBe('Continuing in the app. Join alice/team there.');
    expect(calls[1]).toMatchObject({ target: 'alice/team', intent: 'setup' });
  });

  it('a remembered yes and --app still hand off without asking; --no-app skips the app entirely', async () => {
    const store = createConfigStore(join(await temporaryDirectory(), 'state'));
    await store.update((config) => { config.app = { choice: 'opted-in', at: '2026-09-08T00:00:00Z' }; });
    const calls: unknown[] = [];
    const remembered = new SP([], []);
    expect(await run({ config: store, evidence: mac, verbs: { app: appOk(calls) } }, remembered)).toMatchObject({ ok: true, value: { steps: { app: 'done' } } });
    expect(remembered.asked).toEqual([]);
    const fresh = createConfigStore(join(await temporaryDirectory(), 'state'));
    const forced = new SP([], []);
    expect(await run({ config: fresh, evidence: mac, app: true, verbs: { app: appOk(calls) } }, forced)).toMatchObject({ ok: true, value: { steps: { app: 'done' } } });
    expect(forced.asked).toEqual([]);
    const never = new SP([JOIN_CHOICE], []);
    await run({ config: fresh, evidence: mac, app: false, verbs: { app: appOk(calls) } }, never);
    expect(never.asked).toEqual([ROLE_QUESTION]);
    expect(calls).toHaveLength(2);
  });

  it('is skipped over frames, over a pipe, on a machine with no app, and in install\'s quiet bootstrap', async () => {
    const calls: unknown[] = [];
    const frames: Prompter = { interactive: true, channel: 'frames', confirm: async () => { throw new Error('asked over frames'); }, text: async () => '', select: async () => JOIN_CHOICE, print: () => undefined };
    expect(await run({ config: createConfigStore(join(await temporaryDirectory(), 'state')), evidence: mac, verbs: { app: appOk(calls) } }, frames)).toMatchObject({ ok: true, value: { steps: { app: 'skipped', role: 'done' } } });
    const piped = new ScriptedPrompter([JOIN_CHOICE], []);
    expect(await run({ config: createConfigStore(join(await temporaryDirectory(), 'state')), evidence: mac, verbs: { app: appOk(calls) } }, piped)).toMatchObject({ ok: true, value: { steps: { app: 'skipped', role: 'done' } } });
    expect(piped.asked).toEqual([ROLE_QUESTION]);
    const onLinux = new SP([JOIN_CHOICE], []);
    expect(await run({ config: createConfigStore(join(await temporaryDirectory(), 'state')), evidence: linux, verbs: { app: appOk(calls) } }, onLinux)).toMatchObject({ ok: true, value: { steps: { app: 'skipped' } } });
    expect(onLinux.asked).toEqual([ROLE_QUESTION]);
    expect(calls).toEqual([]);
  });

  it('a failed hand-off is printed and the terminal wizard continues', async () => {
    const failing = (async (_args: unknown, io: Prompter) => { await io.confirm(APP_QUESTION); return failure('Could not reach GitHub to download the desktop app; you appear to be offline. Everything works from the terminal.'); }) as never;
    const io = new SP([JOIN_CHOICE], [true]);
    const result = await run({ config: createConfigStore(join(await temporaryDirectory(), 'state')), evidence: mac, verbs: { app: failing } }, io);
    expect(result).toMatchObject({ ok: true, value: { steps: { app: 'skipped', role: 'done' } } });
    expect(io.lines.some((line) => line.startsWith('Could not reach GitHub'))).toBe(true);
    expect(io.asked).toEqual([APP_QUESTION, ROLE_QUESTION]);
  });
});

it.each([undefined,'alice/team'])('preserves a delegated team cancellation (target=%s)',async target=>{
 const store=createConfigStore(join(await temporaryDirectory(),'state'));
 const io=new ScriptedPrompter(target?[]:['Create a new team']);
 const result=await run({app:false,config:store,runner:mappedRunner('/unused/remote','/unused/bare',fakeGh('alice')),...(target?{target}:{}),verbs:{team:async()=>({...failure('Team was declined.'),cancelled:true})}},io);
 expect(result).toMatchObject({ok:false,error:'Team was declined.',cancelled:true,value:{role:target?'joiner':'creator',team:''}});
});

it('refuses another setup target before app, prompts, gh or clone and preserves config bytes', async () => {
  const fixture = await configuredCreator({});
  const store = fixture.args.config;
  const before = await readFile(join(store.root, 'config.json'), 'utf8');
  let appCalls = 0;
  const io = new AnsweringPrompter({}, {});
  const result = await run({ ...fixture.args, app: undefined, target: 'other/repo', verbs: { ...fixture.args.verbs, app: async () => { appCalls++; return failure('unexpected app'); } } }, io);
  expect(result).toMatchObject({ ok: false, refused: true, error: expect.stringContaining('One team per machine'), value: { role: 'joiner', steps: { welcome: 'printed' } } });
  expect(appCalls).toBe(0);
  expect(fixture.runner.calls).toEqual([]);
  expect(io.events.some(event => event.startsWith('ask:'))).toBe(false);
  expect(await exists(store.teamClone('repo'))).toBe(false);
  expect(await readFile(join(store.root, 'config.json'), 'utf8')).toBe(before);
});

it('resumes setup for a raw-stored spelling of the same remote', async () => {
  const fixture = await configuredCreator({});
  const io = new ScriptedPrompter();
  const result = await run({ ...fixture.args, target: 'alice/team', verbs: { ...fixture.args.verbs, offerWrapper: async () => 'present' } }, io);
  expect(result.ok).toBe(true);
  expect(io.lines).toContain('Team team is already configured on this machine.');
});

it('bare setup refuses legacy teams before app, gh and prompts', async () => {
  const fixture = await configuredCreator({});
  await fixture.args.config.update(config => { config.teams.other = { remote: 'github.com/other/repo', handle: 'alice' }; });
  const io = new ScriptedPrompter();
  expect(await run(fixture.args, io)).toMatchObject({ ok: false, refused: true, error: expect.stringContaining('configured for teams team, other') });
  expect(fixture.runner.calls).toEqual([]);
  expect(io.asked).toEqual([]);
});

it('setup refusal survives createExecute with exit 1 and its partial value', async () => {
  const fixture = await configuredCreator({});
  const frames: ResultOutcome[] = [];
  const codes: number[] = [];
  const execute = createExecute({ io: new ScriptedPrompter(), stderr: () => {}, setExitCode: code => codes.push(code), result: outcome => frames.push(outcome) });
  await execute(io => run({ ...fixture.args, target: 'other/repo' }, io), { verb: 'setup', notices: false });
  expect(codes).toEqual([1]);
  expect(frames).toEqual([expect.objectContaining({ ok: false, refused: true, exitCode: 1, value: expect.objectContaining({ role: 'joiner' }) })]);
  expect(frames[0]).not.toHaveProperty('cancelled');
});

async function optionalSetup(count = 0) {
  const fixture = await configuredCreator({}); const args = { ...fixture.args, verbs: { ...fixture.args.verbs, offerWrapper: async () => 'present' as const } };
  await mkdir(args.home, { recursive: true }); if (count) await seedPending(args.config.teamClone('team'), count);
  return args;
}
function optionalAnswers(confirms: Record<string, boolean> = {}, answers: Record<string, string> = {}) {
  return new AnsweringPrompter({ 'Evaluate the ': 'Skip', ...answers }, { [PROJECTS_QUESTION]: false, ...confirms });
}
/** §9.2 / D13: one folder picker, skippable, and the Library adds the second and third project. */
describe('setup projects', () => {
  it('offers the step, adds the chosen folder, and records steps.projects done', async () => {
    const args = await optionalSetup(); const a = join(args.home, 'a'); await skillUnder(a);
    const io = optionalAnswers({ [PROJECTS_QUESTION]: true }, { [PROJECTS_WHERE_QUESTION]: a });
    expect(await run(args, io)).toMatchObject({ ok: true, value: { steps: { projects: 'done' } } });
    expect((await args.config.read()).projects).toMatchObject([{ root: a, label: 'a' }]);
    expect(io.events).toContain("print:Terum will track the skills in that project's .claude folder.");
  });
  it('declining the offer adds nothing, records skipped, and never asks for a folder', async () => {
    const args = await optionalSetup(); const io = optionalAnswers();
    expect(await run(args, io)).toMatchObject({ ok: true, value: { steps: { projects: 'skipped' } } });
    expect((await args.config.read()).projects).toBeUndefined();
    expect(io.events).not.toContain(`ask:${PROJECTS_WHERE_QUESTION}`);
  });
  // Blank means "take the offered default", as it does for every other text question. Declining is
  // the confirm above — the Skip half of the §9.2 control — not an empty answer.
  it('a blank answer takes the offered default', async () => {
    const args = await optionalSetup();
    const io = optionalAnswers({ [PROJECTS_QUESTION]: true }, { [PROJECTS_WHERE_QUESTION]: '' });
    expect(await run(args, io)).toMatchObject({ ok: true, value: { steps: { projects: 'done' } } });
    expect((await args.config.read()).projects).toMatchObject([{ root: await realpath(process.cwd()) }]);
  });
  it.each([{ quiet: true }, { projects: false }])('%j never asks about projects', async options => {
    const args = await optionalSetup(); const io = optionalAnswers();
    expect(await run({ ...args, ...options }, io)).toMatchObject({ ok: true, value: { steps: { projects: 'skipped' } } });
    expect(io.events).not.toContain(`ask:${PROJECTS_QUESTION}`);
  });
  it('a non-interactive channel skips both new steps', async () => {
    const args = await optionalSetup(); const io = new NonInteractivePrompter();
    // A generic remote has no invite question, so this channel can reach the optional steps.
    const remote = 'https://git.example/team.git'; const clone = args.config.teamClone('team');
    await args.config.update(c => { c.teams.team!.remote = remote; });
    const runner = wrapRunner(args.runner, async (command, argv, options, next) => {
      const result = await next();
      if (command === 'git' && options?.cwd === clone && argv.join(' ') === 'remote get-url origin') return { ...result, stdout: remote + '\n' };
      return result;
    });
    expect(await run({ ...args, runner }, io)).toMatchObject({ ok: true, value: { steps: { projects: 'skipped', evals: 'skipped' } } }); expect(io.asked).toEqual([]);
  });
  // The desktop's prompt dialog has no shell, so a typed ~ arrives literally; without expansion it would
  // resolve under cwd and name a folder that does not exist.
  it.each(['~', '~/'])('a typed %s answer is expanded against home, not resolved under cwd', async prefix => {
    const args = await optionalSetup();
    const io = optionalAnswers({ [PROJECTS_QUESTION]: true }, { [PROJECTS_WHERE_QUESTION]: prefix });
    expect((await run(args, io)).ok).toBe(true);
    // Home itself is refused as a project (it is the Global root). Reaching that refusal is the proof
    // of expansion: unexpanded, `~` would resolve under cwd and fail as a missing folder instead.
    expect((await args.config.read()).projects).toBeUndefined();
    expect(io.events).toContainEqual(expect.stringContaining('Could not add that project: '));
    expect(io.events).toContainEqual(expect.stringContaining('is the Global home root'));
  });
  it('a typed ~/<sub> answer adds that folder under home', async () => {
    const args = await optionalSetup(); const nested = join(args.home, 'work'); await mkdir(nested, { recursive: true });
    const io = optionalAnswers({ [PROJECTS_QUESTION]: true }, { [PROJECTS_WHERE_QUESTION]: '~/work' });
    expect((await run(args, io)).ok).toBe(true);
    expect((await args.config.read()).projects).toMatchObject([{ root: await realpath(nested), label: 'work' }]);
  });
  it('expandTilde leaves an absolute path, a relative path and ~otheruser alone', () => {
    const home = join('/tmp', 'home-of-someone');
    expect(expandTilde('~', home)).toBe(home);
    expect(expandTilde('~/x', home)).toBe(join(home, 'x'));
    expect(expandTilde('~\\x', home)).toBe(join(home, 'x'));
    // No password database here, so ~bob stays a literal folder name rather than a guess.
    expect(expandTilde('~bob/x', home)).toBe('~bob/x');
    expect(expandTilde('/abs/x', home)).toBe('/abs/x');
    expect(expandTilde('rel/x', home)).toBe('rel/x');
  });
  it('a failure to add is printed and setup still succeeds', async () => {
    const args = await optionalSetup(); const missing = join(args.home, 'nope');
    const io = optionalAnswers({ [PROJECTS_QUESTION]: true }, { [PROJECTS_WHERE_QUESTION]: missing });
    expect(await run(args, io)).toMatchObject({ ok: true, value: { steps: { projects: 'skipped' } } });
    expect(io.events).toContainEqual(expect.stringMatching(/^print:Could not add that project: .*does not exist/));
    const file = join(args.home, 'file'); await writeFile(file, 'not a directory');
    const notFolder = optionalAnswers({ [PROJECTS_QUESTION]: true }, { [PROJECTS_WHERE_QUESTION]: file });
    expect(await run(args, notFolder)).toMatchObject({ ok: true, value: { steps: { projects: 'skipped' } } });
    expect(notFolder.events).toContainEqual(expect.stringMatching(/^print:Could not add that project: /));
  });
});
const successfulEval = async () => success({ team: 'team', id: 'test', name: 'sample', runDir: '/test/run', ccVersion: 'test', executionStatus: 'complete' as const });
describe('setup batch evals', () => {
  it('setup offers the eval batch only for shared skills with no receipt at the current version', async () => {
    const args = await optionalSetup(2); await pendingReceipt(args.config.teamClone('team')); const io = optionalAnswers();
    expect((await run(args, io)).ok).toBe(true); expect(io.events).toContain(`ask:${evalsQuestion(1)}`); expect(io.events).not.toContain(`ask:${evalsQuestion(2)}`);
  });
  it('accepting runs eval once per candidate and reports the summary', async () => {
    const args = await optionalSetup(2); const evaluate = vi.fn(successfulEval); const io = Object.assign(optionalAnswers({}, { 'Evaluate the ': 'Now' }), {channel:'frames' as const});
    const result = await run({ ...args, preflight: async () => success({ ccVersion: 'test' }), verbs: { ...args.verbs, eval: evaluate } }, io);
    expect(evaluate).toHaveBeenCalledTimes(2); for (const name of ['alpha', 'beta']) expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ ref: name, team: 'team', preflight: expect.any(Function), lockWaitMs: 300_000 }), expect.objectContaining({ interactive: io.interactive, channel: io.channel, print: expect.any(Function) }));
    expect(io.events).toContain('print:Evaluating 2 skills, 4 at a time…'); expect(io.events).toContain('print:Evaluated 2 of 2; 0 failed.'); expect(result).toMatchObject({ ok: true, value: { steps: { evals: 'done' } } });
  });
  it('a failed eval is printed and the batch continues', async () => {
    const args = await optionalSetup(2); const evaluate = vi.fn<typeof import('../eval.js').run>().mockResolvedValueOnce(failure('eval failed')).mockImplementation(successfulEval);
    const io = optionalAnswers({}, { 'Evaluate the ': 'Now' });
    expect(await run({ ...args, preflight: async () => success({ ccVersion: 'test' }), verbs: { ...args.verbs, eval: evaluate } }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'done' } } });
    expect(evaluate).toHaveBeenCalledTimes(2); expect(io.events).toContain('print:✗ alpha: eval failed'); expect(io.events).toContain('print:Evaluated 1 of 2; 1 failed.');
  });
  it('declining the eval offer runs no eval', async () => {
    const args = await optionalSetup(2); const evaluate = vi.fn(successfulEval), preflight = vi.fn(async () => success({ ccVersion: 'test' })); const io = optionalAnswers();
    expect(await run({ ...args, preflight, verbs: { ...args.verbs, eval: evaluate } }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'skipped' } } }); expect(evaluate).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled();
  });
  // The probe is on the verb table as well as the args knob, so a test that stubs `verbs` at all can never
  // reach the real `claude`; production still resolves to the same systemPreflight default.
  it('the probe is taken from the injected verb table when args.preflight is absent', async () => {
    const args = await optionalSetup(2); const preflight = vi.fn(async () => success({ ccVersion: 'stubbed' })); const evaluate = vi.fn(successfulEval);
    const io = optionalAnswers({}, { 'Evaluate the ': 'Now' });
    expect(await run({ ...args, verbs: { ...args.verbs, eval: evaluate, preflight } }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'done' } } });
    expect(preflight).toHaveBeenCalledTimes(1); expect(evaluate).toHaveBeenCalledTimes(2);
  });
  it('a team that shares nothing is told so, not that everything is already receipted', async () => {
    const args = await optionalSetup(); const io = optionalAnswers();
    expect(await run(args, io)).toMatchObject({ ok: true, value: { steps: { evals: 'skipped' } } });
    expect(io.events).toContain('print:The team has no shared skills yet; nothing to evaluate.');
    expect(io.events).not.toContain('print:Every shared skill already has an eval receipt for its current version.');
  });
  it('a failed version reader is reported instead of an already-receipted claim', async () => {
    const args = await optionalSetup(2); const clone = args.config.teamClone('team'); const io = optionalAnswers();
    const runner = wrapRunner(args.runner, async (command, argv, options, next) => {
      if (command === 'git' && options?.cwd === clone && argv[0] === 'ls-tree') throw new Error('git unavailable');
      return next();
    });
    expect(await run({ ...args, runner }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'skipped' } } });
    expect(io.events).toContain('print:Could not read the current skill versions, so no shared skill could be checked for a receipt.');
    expect(io.events).not.toContain('print:Every shared skill already has an eval receipt for its current version.');
    expect(io.events.some(e => e.startsWith('ask:Evaluate the '))).toBe(false);
  });
  it.each([{ quiet: true }, { evals: false }])('quiet setup and --no-evals never ask (%j)', async options => {
    const args = await optionalSetup(2); const io = optionalAnswers();
    expect(await run({ ...args, ...options }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'skipped' } } }); expect(io.events.some(e => e.startsWith('ask:Evaluate the '))).toBe(false);
  });
  it('a failing preflight after the yes is printed and the step is skipped', async () => {
    const args = await optionalSetup(2); const evaluate = vi.fn(successfulEval); const io = optionalAnswers({}, { 'Evaluate the ': 'Now' });
    expect(await run({ ...args, preflight: async () => failure('claude is not runnable'), verbs: { ...args.verbs, eval: evaluate } }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'skipped' } } });
    expect(evaluate).not.toHaveBeenCalled(); expect(io.events).toContain('print:Skipping the evals: claude is not runnable');
  });
  it('the agent probe runs exactly once for the whole batch', async () => {
    const args = await optionalSetup(2); const probe = success({ ccVersion: 'test' }); const preflight = vi.fn(async () => probe); const io = optionalAnswers({}, { 'Evaluate the ': 'Now' });
    const evaluate = vi.fn(async (args: EvalArgs) => { expect(await args.preflight?.()).toBe(probe); return successfulEval(); });
    expect((await run({ ...args, preflight, verbs: { ...args.verbs, eval: evaluate } }, io)).ok).toBe(true); expect(preflight).toHaveBeenCalledTimes(1); expect(evaluate).toHaveBeenCalledTimes(2);
  });
  it('a skill whose only receipt is for an older version is still a candidate', async () => {
    const args = await optionalSetup(1); await pendingReceipt(args.config.teamClone('team'), { older: true }); const io = optionalAnswers();
    expect((await run(args, io)).ok).toBe(true); expect(io.events).toContain(`ask:${evalsQuestion(1)}`);
  });
  it('a skill with a schema-invalid newest receipt is excluded with a warning', async () => {
    const args = await optionalSetup(1); await pendingReceipt(args.config.teamClone('team'), { invalid: true }); const io = optionalAnswers();
    expect(await run(args, io)).toMatchObject({ ok: true, value: { steps: { evals: 'skipped' } } });
    expect(io.events).toContainEqual(expect.stringContaining('the newest receipt for the current version is invalid')); expect(io.events).toContain('print:Every shared skill already has an eval receipt for its current version.'); expect(io.events.some(e => e.startsWith('ask:Evaluate the '))).toBe(false);
  });
  it('a machine with no joined handle skips the eval step', async () => {
    const args = await optionalSetup(1); const io = optionalAnswers(); const config = await args.config.read(); config.teams.team!.handle = '';
    // Persisted config rejects an absent handle; model an unavailable handle at the step's read seam.
    const read = vi.spyOn(args.config, 'read'); const confirm = io.confirm.bind(io);
    io.confirm = async question => { const answer = await confirm(question); if (question === PROJECTS_QUESTION) read.mockResolvedValueOnce(config); return answer; };
    try {
      expect(await run(args, io)).toMatchObject({ ok: true, value: { steps: { evals: 'skipped' } } }); expect(io.events).toContain('print:Skipping the eval offer: this machine has no joined handle for the team yet.'); expect(io.events.some(e => e.startsWith('ask:Evaluate the '))).toBe(false);
    } finally { read.mockRestore(); }
  });
  it('progress frames name the evals step with current and total', async () => {
    const args = await optionalSetup(2); const input = new PassThrough(), output = new PassThrough(); const frames: Frame[] = [];
    output.on('data', (data: Buffer) => { const frame = JSON.parse(data.toString()) as Frame; frames.push(frame); if (frame.t === 'ask') input.write(JSON.stringify({ t: 'answer', id: frame.id, value: frame.kind === 'select' && frame.question.startsWith('Evaluate the ') ? 'Now' : frame.kind === 'confirm' ? false : '' }) + '\n'); });
    const channel = frameChannel({ input, output });
    expect((await run({ ...args, preflight: async () => success({ ccVersion: 'test' }), verbs: { ...args.verbs, eval: successfulEval } }, channel.io)).ok).toBe(true);
    channel.result({ verb: 'setup', ok: true, exitCode: 0 });
    expect(frames.filter(f => f.t === 'progress')).toEqual([{ t: 'progress', step: 'evals', current: 1, total: 2 }, { t: 'progress', step: 'evals', current: 2, total: 2 }]);
    expect(frames.find(f=>f.t==='ask'&&f.question.startsWith('Evaluate the '))).toMatchObject({
      t:'ask',kind:'select',question:'Evaluate the 2 shared skills that have no receipt yet? This runs Claude on each one and records results locally.',default:'Skip',choices:['Now','In batches','Overnight','Skip'],
      detail:["Evaluating 2 skills, 4 at a time: no earlier runs to estimate from; each eval runs the skill's cases against a baseline on this machine and bills your Claude account."],
      descriptions:['Runs all 2, 4 at a time, in this terminal.','Asks how many at a time and checks in between batches.','Queues them; the app runs them between 01:00 and 05:00 while it is open and idle.','Evaluate any skill later with `npx -y terum-skills@latest eval <skill>`.'],
    });
  });
});


describe('f-wizard cost and run choices', () => {
  it('prints the measured medians across skills and versions before the unchanged question', async () => {
    const args = await optionalSetup(2);
    const samples = [{ cost_usd: 1, duration_ms: 60_000 }, { cost_usd: 2, duration_ms: 120_000 }, { cost_usd: 90, duration_ms: 300_000 }, { cost_usd: null, duration_ms: null }];
    for (const [index, efficiency] of samples.entries()) {
      const dir = join(args.config.teamClone('team'), 'evals', `historical-${index}`, String(index).repeat(40));
      await mkdir(dir, { recursive: true }); await writeFile(join(dir, '20260909T000000Z.json'), JSON.stringify(measuredReceipt(efficiency.cost_usd, efficiency.duration_ms)));
    }
    const io = optionalAnswers(); await run(args, io);
    const line = 'print:Evaluating 2 skills, 4 at a time: about $4.00 and 2 min on this machine, from 3 earlier runs (median $2.00 · 2 min each).';
    expect(io.events).toContain(line); expect(io.events.indexOf(line)).toBeLessThan(io.events.indexOf(`ask:${evalsQuestion(2)}`));
  });
  it('ignores receipts with null arm measurements', async () => {
    const args = await optionalSetup(1);
    for (let i = 0; i < 3; i++) {
      const dir = join(args.config.teamClone('team'), 'evals', 'historical', String(i).repeat(40)); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, '20260909T000000Z.json'), JSON.stringify(measuredReceipt(null, 2000)));
    }
    expect(await estimateFromReceipts(args.config.teamClone('team'))).toBeNull();
    const io = optionalAnswers(); await run(args, io);
    expect(io.events).toContain("print:Evaluating 1 skill, 4 at a time: no earlier runs to estimate from; each eval runs the skill's cases against a baseline on this machine and bills your Claude account.");
  });
  it('uses seconds for short runs and averages the middle pair for an even median', async () => {
    const args = await optionalSetup();
    for (const [index, cost] of [1, 2, 4, 99].entries()) {
      const dir = join(args.config.teamClone('team'), 'evals', 'historical', String(index).repeat(40)); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'run.json'), JSON.stringify(measuredReceipt(cost, cost * 1000)));
    }
    const estimate = await estimateFromReceipts(args.config.teamClone('team'));
    expect(estimate).toEqual({ runs: 4, costUsd: 3, durationMs: 3000 }); expect(estimateLine(2, estimate)).toContain('$6.00 and 3 s');
  });
  it('fewer than three runs and invalid JSON produce no numeric estimate', async () => {
    const args = await optionalSetup(); const dir = join(args.config.teamClone('team'), 'evals', 'historical', 'a'.repeat(40)); await mkdir(dir, { recursive: true });
    for (const name of ['one', 'two']) await writeFile(join(dir, `${name}.json`), JSON.stringify(measuredReceipt(1, 2000)));
    await writeFile(join(dir, 'invalid.json'), '{broken');
    expect(await estimateFromReceipts(args.config.teamClone('team'))).toBeNull();
  });
  it('Overnight queues all without probing or evaluating and prints the runtime invocation', async () => {
    const args = await optionalSetup(2), evaluate = vi.fn(successfulEval), preflight = vi.fn();
    const io = optionalAnswers({}, { 'Evaluate the ': 'Overnight' });
    expect(await run({ ...args, form: 'bare', preflight, verbs: { ...args.verbs, eval: evaluate } }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'queued' } } });
    expect(evaluate).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled();
    expect((await readEvalQueue(args.config.root)).items).toMatchObject([{ team: 'team', skill: 'alpha', window: 'overnight' }, { team: 'team', skill: 'beta', window: 'overnight' }]);
    expect(io.events).toContain('print:Queued 2 evals for overnight: the app runs them in parallel between 01:00 and 05:00 while it is open and idle. Run them now with `terum-skills eval --drain`.');
  });
  it.each([true, false])('batches continue=%s, preserving remaining work when stopped', async more => {
    const args = await optionalSetup(2), evaluate = vi.fn(successfulEval), preflight = vi.fn(async () => success({ ccVersion: 'test' }));
    const io = optionalAnswers({ 'Continue with the next ': more }, { 'Evaluate the ': 'In batches', 'How many at a time?': '1' });
    expect(await run({ ...args, preflight, verbs: { ...args.verbs, eval: evaluate } }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'batched' } } });
    expect(evaluate).toHaveBeenCalledTimes(more ? 2 : 1); expect(preflight).toHaveBeenCalledTimes(1);
    expect(io.events).toContain('ask:Continue with the next 1? (1 of 2 done, 1 left)');
    expect((await readEvalQueue(args.config.root)).items).toHaveLength(more ? 0 : 1);
    if (!more) expect((await readEvalQueue(args.config.root)).items[0]).toMatchObject({ skill: 'beta', window: 'later' });
  });
  it.each(['0', '-1', '1.5', 'no', '9007199254740992'])('rejects invalid batch size %s before probing and offers a default of four', async invalid => {
    const args = await optionalSetup(2), evaluate = vi.fn(successfulEval); const io = optionalAnswers({}, { 'Evaluate the ': 'In batches' });
    const answers = [invalid, '3']; const original = io.text.bind(io);
    io.text = async (question, defaultValue) => { if (question !== 'How many at a time?') return original(question, defaultValue); expect(defaultValue).toBe('4'); return answers.shift()!; };
    expect(await run({ ...args, preflight: async () => success({ ccVersion: 'test' }), verbs: { ...args.verbs, eval: evaluate } }, io)).toMatchObject({ ok: true, value: { steps: { evals: 'batched' } } });
    expect(io.events.filter(line => line === 'print:Enter a whole number of at least 1.')).toHaveLength(1); expect(evaluate).toHaveBeenCalledTimes(2);
  });
  it('frames preserve the undecorated print transcript byte for byte', async () => {
    const fixture = await optionalSetup(2); const args = {...fixture,preflight:async()=>success({ccVersion:'test'}),verbs:{...fixture.verbs,eval:async(arg:EvalArgs,io:Prompter)=>{io.print(`Context for ${arg.ref}`);return arg.ref==='alpha'?successfulEval():failure('Could not evaluate beta\nTry again later');}}};
    const frames = Object.assign(optionalAnswers({}, {'Evaluate the ':'Now'}), { channel: 'frames' as const });
    const plain = optionalAnswers({}, {'Evaluate the ':'Now'});
    vi.stubEnv('NO_COLOR', undefined); vi.stubEnv('TERM', 'xterm');
    try {
      await run(args, frames); vi.stubEnv('NO_COLOR', '1'); await run(args, plain);
      expect(frames.events).toEqual(plain.events);expect(frames.events).toContain('print:── alpha ──');expect(frames.events).toContain('print:✓ alpha');expect(frames.events).toContain('print:✗ beta: Could not evaluate beta');expect(frames.events).toContain('print:Try again later'); expect(frames.events.join('\n')).not.toMatch(/── Step|@@@@|╭|\x1b\[/);
    } finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); }
  });
  it.each([{ quiet: true }, { noColor: true }, { dumb: true }])('suppresses furniture for %j', async options => {
    const args = await optionalSetup(); const io = optionalAnswers();
    vi.stubEnv('NO_COLOR', options.noColor ? '1' : undefined); vi.stubEnv('TERM', options.dumb ? 'dumb' : 'xterm');
    try { await run({ ...args, quiet: options.quiet }, io); expect(io.events.join('\n')).not.toMatch(/── Step|@@@@|╭|\x1b\[/); }
    finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); }
  });
  it('decorates interactive terminal sections and the closing summary', async () => {
    vi.spyOn(tty, 'terminalOutputIsTTY').mockReturnValue(true);
    const args = await optionalSetup(); const io = optionalAnswers();
    vi.stubEnv('NO_COLOR', undefined); vi.stubEnv('TERM', 'xterm');
    try { await run(args, io); expect(io.events).toContainEqual(expect.stringContaining('Welcome to ')); expect(io.events).toContainEqual(expect.stringContaining('Evals')); expect(io.events).toContainEqual(expect.stringMatching(/^print:╭─/)); expect(io.events).toContainEqual(expect.stringContaining('@seed')); }
    finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); }
  });
});


async function threePending() {
 const args=await optionalSetup(2),clone=args.config.teamClone('team');
 await pendingSkill(clone,'gamma','33333333-3333-4333-8333-333333333333');await git(['add','--all'],clone);await git(['commit','-qm','third candidate'],clone);return args;
}
it.each(['Now','In batches'])('runs %s concurrently and queues declined remaining batches',async choice=>{
 const args=await threePending(),io=optionalAnswers({'Continue with the next ':false},{'Evaluate the ':choice,'How many at a time?':'2'});
 let active=0,peak=0;const releases:(()=>void)[]=[];
 const evaluate=vi.fn(async (args:EvalArgs)=>{expect(args.lockWaitMs).toBe(300_000);peak=Math.max(peak,++active);await new Promise<void>(resolve=>releases.push(resolve));active--;return successfulEval();});
 const running=run({...args,preflight:async()=>success({ccVersion:'test'}),verbs:{...args.verbs,eval:evaluate}},io);
 await vi.waitFor(()=>expect(releases).toHaveLength(choice==='Now'?3:2));for(const release of releases)release();
 expect((await running).ok).toBe(true);expect(peak).toBe(choice==='Now'?3:2);
 expect(io.events.filter(event=>event.startsWith('ask:Continue with the next '))).toHaveLength(choice==='Now'?0:1);
 expect((await readEvalQueue(args.config.root)).items.map(item=>item.skill)).toEqual(choice==='Now'?[]:['gamma']);
});
it('snapshots a decorated creator Overnight transcript and emits only headers for sections that print',async()=>{
 const fixture=await optionalSetup(2),configured=await fixture.config.read();await fixture.config.update(config=>{config.teams={};});
 const createTeam = async (command:import('../team.js').TeamArgs,io:Prompter) => {
  if(command.kind!=='create')throw new Error('This creator fixture only accepts team create.');
  await fixture.config.update(config=>{config.teams=configured.teams;});io.print('Created team team at https://github.com/alice/team.');return success({team:'team',remote:'https://github.com/alice/team.git'});
 };
 const args={...fixture,verbs:{...fixture.verbs,team:createTeam as typeof import('../team.js').run}}; // Fixture implements create only and explicitly rejects all other overloads.

 vi.spyOn(tty,'terminalOutputIsTTY').mockReturnValue(true);vi.stubEnv('NO_COLOR',undefined);vi.stubEnv('TERM','xterm');
 // The session box prints the running version and the box is padded to its widest line, so the real version
 // would re-record this snapshot on every release. Pin it here; the box's own formatting is covered in banner.test.ts.
 vi.spyOn(packageModule,'packageVersion').mockReturnValue('9.9.9');
 const input=new PassThrough(),output=new PassThrough();let transcript='';output.on('data',(chunk:Buffer)=>{transcript+=chunk.toString();});
 const terminal=promptModule.terminalPrompter({input,output,interactive:true});
 const io:Prompter={...terminal,
  confirm:(q,o)=>{const result=terminal.confirm(q,o);queueMicrotask(()=>input.write('n\n'));return result;},
  text:(q,d,o)=>{const result=terminal.text(q,d,o);queueMicrotask(()=>input.write('\n'));return result;},
  select:(q,c,d,o)=>{const result=terminal.select(q,c,d,o);queueMicrotask(()=>input.write(q.startsWith('Evaluate the ')?'3\n':'1\n'));return result;},
 };
  try {expect(await run(args,io)).toMatchObject({ok:true,value:{steps:{evals:'queued'}}});expect(transcript).toContain('>_ terum-skills (v9.9.9)');
  const titles=transcript.split('\n').filter(line=>line.startsWith('> \x1b[1m')).map(line=>line.replace(/\x1b\[[0-9]+m/g,''));
  expect(titles).toEqual(['> Role','> GitHub','> Team','> Invite','> Projects','> Evals','> Done']);expect(transcript).not.toMatch(/Step \d|of 12/);expect(transcript.replace(/\x1b\[[0-9]+m/g,'')).not.toContain('> Welcome');
 }finally{vi.restoreAllMocks();vi.unstubAllEnvs();}
});
it('omits the Invite header on a decorated joiner without numbering or empty sections',async()=>{
 const args=await optionalSetup(),io=optionalAnswers();vi.spyOn(tty,'terminalOutputIsTTY').mockReturnValue(true);vi.stubEnv('NO_COLOR',undefined);vi.stubEnv('TERM','xterm');
 try{expect((await run({...args,target:'alice/team'},io)).ok).toBe(true);expect(io.events.join('\n')).not.toContain('> \x1b[1mInvite');expect(io.events.join('\n')).not.toMatch(/Step \d/);}finally{vi.restoreAllMocks();vi.unstubAllEnvs();}
});

it('pins the singular eval question byte for byte',()=>{expect(evalsQuestion(1)).toBe('Evaluate the 1 shared skill that has no receipt yet? This runs Claude on each one and records results locally.');});
it('retains the eval offer when historical receipt I/O fails',async()=>{
 const args=await optionalSetup(2),io=optionalAnswers({}, {'Evaluate the ':'Overnight'});const spy=vi.spyOn(estimates,'estimateFromReceipts').mockRejectedValue(new Error('EACCES'));
 try{expect(await run(args,io)).toMatchObject({ok:true,value:{steps:{evals:'queued'}}});expect(io.events).toContain(`ask:${evalsQuestion(2)}`);expect(io.events.join('\n')).toContain('Could not estimate eval cost: EACCES');expect((await readEvalQueue(args.config.root)).items).toHaveLength(2);}finally{spy.mockRestore();}
});
it('bounds invalid batch-size attempts without probing or billing',async()=>{
 const args=await optionalSetup(2),io=optionalAnswers({}, {'Evaluate the ':'In batches','How many at a time?':'bad'}),preflight=vi.fn(),evaluate=vi.fn(successfulEval);
 expect(await run({...args,preflight,verbs:{...args.verbs,eval:evaluate}},io)).toMatchObject({ok:true,value:{steps:{evals:'skipped'}}});expect(io.events.filter(line=>line==='ask:How many at a time?')).toHaveLength(3);expect(preflight).not.toHaveBeenCalled();expect(evaluate).not.toHaveBeenCalled();
});
it('keeps cumulative progress and one run-wide summary across batches, including an earlier failure',async()=>{
 const args=await threePending(),io=Object.assign(optionalAnswers({'Continue with the next ':true},{'Evaluate the ':'In batches','How many at a time?':'2'}),{channel:'frames' as const,progress:vi.fn()});
 const clone=args.config.teamClone('team');await pendingSkill(clone,'delta','44444444-4444-4444-8444-444444444444');await git(['add','--all'],clone);await git(['commit','-qm','fourth candidate'],clone);
 const measured=vi.spyOn(estimates,'estimateFromReceipts').mockResolvedValue({runs:3,costUsd:2,durationMs:60000});
 try{expect(await run({...args,preflight:async()=>success({ccVersion:'test'}),verbs:{...args.verbs,eval:async(arg:EvalArgs)=>arg.ref==='alpha'?failure('first batch failed'):successfulEval()}},io)).toMatchObject({ok:true,value:{steps:{evals:'batched'}}});}finally{measured.mockRestore();}
 expect(io.progress.mock.calls.map(([frame])=>frame)).toEqual([1,2,3,4].map(current=>({step:'evals',current,total:4})));
 expect(io.events.filter(line=>line.startsWith('print:Evaluated '))).toEqual(['print:Evaluated 3 of 4; 1 failed.']);expect(io.events.filter(line=>/^print:Evaluating .*…$/.test(line))).toEqual(['print:Evaluating 4 skills, 2 at a time…']);
 expect(io.events).toContain('print:Evaluating 4 skills, 2 at a time: about $8.00 and 2 min on this machine, from 3 earlier runs (median $2.00 · 1 min each).');expect(io.events).not.toContain('print:Evaluated in batches');
});
