import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMUNITY_URL } from '../../lib/community.js';
import { createConfigStore } from '../../lib/config.js';
import { offerHook } from '../../lib/hook.js';
import { bareTeam, cloneWithIdentity, fakeGh, git, mappedRunner, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../setup.js';

const hookFor = (root: string) => ({ settingsFile: join(root, 'settings.json'), backupDir: join(root, 'backups') });
const githubRemote = (owner: string, repository: string) => `https://github.com/${owner}/${repository}.git`;

async function skillUnder(home: string, name = 'starter'): Promise<void> {
  const directory = join(home, '.claude', 'skills', name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\nmetadata:\n  terum-category: testing\n---\n`);
}

describe('setup (§6.1)', () => {
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
    expect(io.lines.join('\n')).not.toMatch(/\b(eval|ui)\b/i);
    expect(io.lines.join('\n')).not.toContain('Feedback and requests:');
    expect(io.lines).toContain(`Team team is already configured on this machine.`);
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
    const io = new ScriptedPrompter(['alpha', '', '', 'Alice', 'alice@example.com', 'alpha-repo', 'starter', 'bob carol'], [true, true]);
    const result = await run({ config: store, home, runner, hook: hookFor(root), communityUrl: 'https://example.test/community' }, io);
    if (!result.ok) throw new Error(result.error);

    expect(result.value).toMatchObject({ role: 'creator', team: 'alpha', remote, steps: { welcome: 'printed', github: 'done', team: 'done', actions: 'done', invite: 'done', community: 'printed', hook: 'done', done: 'printed' } });
    expect(io.asked).toEqual([
      'Team name', 'GitHub login (- for none)', 'Team handle', 'Your name', 'Your email', 'GitHub repository name',
      'Share a skill with the team?', 'Share starter?', 'GitHub logins to invite (space or comma separated; blank to skip)',
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(root).settingsFile})`,
    ]);
    expect(io.lines).toEqual(expect.arrayContaining([
      'Welcome to terum-skills.', "Your team's skills live in one private git repository the team controls; each member installs what they want, edits flow back on sync, and the team endorses the ones everyone should have.",
      'This wizard will check GitHub, set up your team, share a first skill, invite teammates, and offer the session hook. Re-run it any time; finished steps are skipped.',
      'GitHub: gh is logged in.', 'Next, from any terminal:',
      '  terum-skills install alpha/<skill>   — install a shared skill (add @<version> to pin it)',
      '  terum-skills ls                       — list members and shared skills',
      '  terum-skills search <term>            — find a skill by name, description, or category',
      '  terum-skills sync                     — pull updates and finish pending work',
      '  terum-skills publish <skill>          — endorse a skill for the whole team',
      'Feedback and requests: https://example.test/community', 'Members:', '  @alice — Alice',
      'Repository: https://github.com/alice/alpha-repo', 'README: https://github.com/alice/alpha-repo/blob/main/README.md',
    ]));
    expect(io.lines.join('\n')).not.toMatch(/\b(eval|ui)\b/i);
    expect(runner.calls.filter((call) => call.command === 'gh' && call.args.join(' ').includes('collaborators/')).map((call) => call.args.at(-1))).toEqual(['repos/alice/alpha-repo/collaborators/bob', 'repos/alice/alpha-repo/collaborators/carol']);
    expect(JSON.parse(await readFile(hookFor(root).settingsFile, 'utf8')).hooks.SessionStart).toHaveLength(1);
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
    const first = new ScriptedPrompter(['resume', '', '', 'Alice', 'alice@example.com', 'resume-repo', 'starter']);
    const interrupted = await run({ config: store, home, runner, hook: hookFor(root), verbs: { share: async () => { throw new Error('stop after team'); } } }, first);
    expect(interrupted).toMatchObject({ ok: false, error: 'stop after team', value: { steps: { team: 'done' } } });
    const second = new ScriptedPrompter(['starter', 'bob'], [true, true]);
    const resumed = await run({ config: store, home, runner, hook: hookFor(root) }, second);
    if (!resumed.ok) throw new Error(resumed.error);
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
    const io = new ScriptedPrompter(['questions', '', '', 'Alice', 'alice@example.com', 'questions', 'starter', ''], [true, false]);
    const created = await run({ config: createConfigStore(join(root, 'state')), home, runner, hook: hookFor(root), communityUrl: '' }, io);
    if (!created.ok) throw new Error(created.error);
    const joinFixture = await bareTeam();
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await pushFromSeed(joinFixture.seed, 'skills/tool/SKILL.md', `---\nname: tool\ndescription: tool\nlicense: UNLICENSED\nallowed-tools: Bash(ls)\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(joinFixture.seed, 'team.json', JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [id], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }));
    const joinRoot = join(joinFixture.root, 'real-join'); const joinHome = join(joinRoot, 'home');
    const joinedIo = new ScriptedPrompter(['', '', 'Bob', 'bob@example.com'], [true, true, false]);
    const joined = await run({ target: 'https://git.example/team.git', config: createConfigStore(join(joinRoot, 'state')), home: joinHome, runner: mappedRunner('https://git.example/team.git', joinFixture.bare, fakeGh('bob')), hook: hookFor(joinRoot), communityUrl: '' }, joinedIo);
    if (!joined.ok) throw new Error(joined.error);
    expect([...io.asked, ...joinedIo.asked]).toEqual(expect.arrayContaining([
      'Share a skill with the team?', 'Share starter?', 'Install 1 team-endorsed skill(s)?', 'Approve these tools for tool?',
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(root).settingsFile})`,
      `Install the Claude Code session-start hook so team skills sync automatically? (edits ${hookFor(joinRoot).settingsFile})`,
    ]));
  });

  it('skips invitations for a configured generic-git creator and prints the host handoff', async () => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'generic'); const store = createConfigStore(join(root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter([], [false]);
    const result = await run({ config: store, home: join(root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed')), hook: hookFor(root) }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps.invite).toBe('skipped');
    expect(io.askedAbout('GitHub logins to invite')).toBe(false);
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
    expect(result.value.steps).toMatchObject({ invite: 'skipped', community: 'printed' });
    expect(io.lines).toContain(`Feedback and requests: ${COMMUNITY_URL}`);
    expect(io.lines.join('\n')).not.toMatch(/\b(eval|ui)\b/i);
  });

  it('stops before team creation when a non-interactive creator is logged out', async () => {
    const fixture = await bareTeam(); const root = join(fixture.root, 'logged-out');
    const runner = mappedRunner('https://github.com/me/team.git', fixture.bare, fakeGh('me', {}, false));
    const result = await run({ config: createConfigStore(join(root, 'state')), runner, hook: hookFor(root) }, new ScriptedPrompter([], [], false));
    expect(result).toMatchObject({ ok: false, error: 'GitHub authentication is required to create a team: run `gh auth login` and retry, or create the team against an existing empty remote with `team create <name> --remote <url>`.' });
    expect(result.value?.steps.team).toBeUndefined();
    expect(runner.calls.filter((call) => call.command === 'git' && call.args[0] === 'push')).toEqual([]);
  });
});
