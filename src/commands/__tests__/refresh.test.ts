import { chmod, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { HOOK_COMMAND, installedHookCommand, stampedAt, stampIsFresh } from '../../lib/hook.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { systemRunner, type RunOptions } from '../../lib/runner.js';
import { bareTeam, pushFromSeed, cloneWithIdentity, git, holdCloneLock, denyingRunner, fakeGh, ScriptedPrompter, clean, exists, wrapRunner, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { nonInteractiveGitEnv, run, REFRESH_DEADLINE_MS, SUCCESSOR_CACHE_MS } from '../refresh.js';
import { run as evalReport } from '../evalReport.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ids = ['20260907T010000Z', '20260907T020000Z'];
const skill = `---\nname: sample\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nbody\n`;
function receipt(version: string, run_id: string) {
  return receiptSchema.parse({
    schema_version: 1, skill_id: ID, skill_name: 'sample', version, run_id,
    verdict: 'PASS', attribution: 'test', execution_status: 'complete', expected_rows: 1, scored_rows: 1,
    comparisons: {}, arm_scores: {}, triggers: null, efficiency: {}, future: { retained: true },
    provenance: { engine_version: '0.1.7', engine_commit: 'unknown', cc_version: 'stub', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-09-07T00:00:00Z', runner_handle: 'seed' },
  });
}
async function setup(names = ['team']) {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill);
  // §3.4: receipts are filed under the version FOLDER, not a tree hash.
  const tree = 'v1';
  const store = createConfigStore(join(fixture.root, 'state'));
  for (const name of names) {
    await cloneWithIdentity(fixture.bare, store.teamClone(name));
    await store.update(c => { c.teams[name] = { remote: fixture.bare, handle: 'seed' }; });
  }
  return { ...fixture, store, tree, clone: store.teamClone(names[0]!) };
}
function recordingRunner() {
  const calls: { args: readonly string[]; options: RunOptions | undefined }[] = [];
  const runner = wrapRunner(systemRunner, async (_command, args, options, next) => { calls.push({ args: [...args], options }); return next(); });
  return { runner, calls };
}

describe('refresh', () => {
  it('fetches the clone so receipts a teammate committed after the last write become visible (W-08)', async () => {
    const { store, seed, tree } = await setup(); const io = new ScriptedPrompter();
    for (const id of ids) await pushFromSeed(seed, `evals/${ID}/${tree}/${id}.json`, JSON.stringify(receipt(tree, id)));
    expect(await evalReport({ ref: 'sample', config: store }, io)).toMatchObject({ ok: true, value: { latestState: 'none', history: [], versions: { teamCurrent: tree } } });
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { changed: true, teams: [{ team: 'team', state: 'refreshed', changed: true }] } });
    const report = await evalReport({ ref: 'sample', config: store }, io);
    expect(report).toMatchObject({ ok: true, value: { latestState: 'ok', versions: { teamCurrent: tree } } });
    expect(report.value?.history.map(row => row.run_id)).toEqual([...ids].reverse());
    expect(io.lines).toEqual([]);
  });
  it('is idempotent: a second run reports changed false and the same head', async () => {
    const { store, clone, seed } = await setup();
    await pushFromSeed(seed, 'update.txt', 'new');
    const first = await run({ config: store }, new ScriptedPrompter());
    const second = await run({ config: store }, new ScriptedPrompter());
    expect(first.value?.changed).toBe(true);
    expect(second).toMatchObject({ ok: true, value: { changed: false, teams: [{ changed: false, head: first.value?.teams[0]?.head }] } });
    expect(second.value?.teams[0]?.head).toBe((await git(['rev-parse', 'HEAD'], clone)).trim());
  });
  it('stamps each successfully fetched clone without changing config', async () => {
    const { store } = await setup();
    expect(await stampedAt(store.root, 'team')).toBeNull();
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await stampedAt(store.root, 'team')).not.toBeNull();
    expect(await stampIsFresh(store.root, 'team')).toBe(true);
    expect(await exists(join(store.root, 'run'))).toBe(true);
  });
  it('asks nothing and does not rewrite config.json', async () => {
    const { store } = await setup(); const io = new ScriptedPrompter();
    const before = await readFile(join(store.root, 'config.json'), 'utf8');
    expect((await run({ config: store }, io)).ok).toBe(true);
    expect(io.asked).toEqual([]);
    expect(await readFile(join(store.root, 'config.json'), 'utf8')).toBe(before);
  });
  it('prints one line per team that did not refresh on a terminal', async () => {
    const { store } = await setup(['a', 'b']); await clean(store.teamClone('b')); const io = new ScriptedPrompter();
    expect((await run({ config: store }, io)).ok).toBe(true);
    expect(io.lines).toEqual(['b: not refreshed (no-clone) — no clone for this team on this machine']);
  });
  it('in hook mode keeps stdout to the reload directive and carries the per-team lines as notices (the bin routes them to stderr)', async () => {
    const { store } = await setup(['a', 'b']); await clean(store.teamClone('b')); const io = new ScriptedPrompter();
    const outcome = await run({ config: store, hook: true }, io);
    expect(io.lines).toEqual(['{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}']);
    expect(outcome).toMatchObject({ ok: true, value: { notices: ['b: not refreshed (no-clone) — no clone for this team on this machine'] } });
    expect(Object.getOwnPropertyDescriptor(outcome.value, 'hook')).toMatchObject({ value: true, enumerable: false });
  });
  it('prints nothing when a program is on the other end', async () => {
    const { store } = await setup(['a', 'b']); await clean(store.teamClone('b'));
    const io = Object.assign(new ScriptedPrompter(), { channel: 'frames' as const });
    const outcome = await run({ config: store }, io);
    expect(io.lines).toEqual([]);
    expect(outcome).toMatchObject({ ok: true, value: { teams: [{ team: 'a', state: 'refreshed' }, { team: 'b', state: 'no-clone', detail: 'no clone for this team on this machine' }] } });
  });
  it('reports busy without moving the clone when another process holds the writer lock', async () => {
    const { store, clone, seed } = await setup(); const before = await git(['rev-parse', 'HEAD'], clone);
    await pushFromSeed(seed, 'new.txt', 'new');
    const release = await holdCloneLock(clone);
    try {
      expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: false, teams: [{ state: 'busy', changed: false }] } });
      expect(await git(['rev-parse', 'HEAD'], clone)).toBe(before);
    } finally { await release(); }
  }, 15_000);
  it('classifies a recognised remote access failure as unreachable and still refreshes the other team', async () => {
    const { store, seed } = await setup(['a', 'b']); await pushFromSeed(seed, 'new.txt', 'new');
    const stderr = "fatal: repository '/gone.git' not found";
    const runner = denyingRunner([
      { command: 'git', argsPrefix: ['fetch', 'origin'], respond: (args, options) => options?.cwd === store.teamClone('a') ? { code: 128, stdout: '', stderr } : systemRunner.run('git', args, options) },
      { command: 'git', argsPrefix: [] },
    ], systemRunner);
    const outcome = await run({ config: store, runner }, new ScriptedPrompter());
    expect(outcome).toMatchObject({ ok: true, value: { changed: true, teams: [{ team: 'a', state: 'unreachable', changed: false }, { team: 'b', state: 'refreshed', changed: true }] } });
    expect(outcome.value?.teams[0]?.detail).toContain(stderr);
    expect(outcome.value?.teams[0]?.detail).toContain('Access is managed on that host; ask a team admin to grant you access, then retry.');
  });
  it('reports an unrecognised fetch failure as error with the git stderr in detail', async () => {
    const { store, clone, root } = await setup(); const remote = join(root, 'nope.git');
    await git(['remote', 'set-url', 'origin', remote], clone);
    // Match the configured remote so describeClone reaches fetch instead of correctly reporting a foreign clone.
    await store.update(c => { c.teams.team!.remote = remote; });
    const outcome = await run({ config: store }, new ScriptedPrompter());
    expect(outcome).toMatchObject({ ok: true, value: { changed: false, teams: [{ state: 'error', changed: false, detail: expect.stringContaining('does not appear to be a git repository') }] } });
  });
  it('reports no-clone for a missing clone and never re-clones it', async () => {
    const { store, clone } = await setup(); await clean(clone);
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { teams: [{ state: 'no-clone', head: null, detail: 'no clone for this team on this machine' }] } });
    expect(await exists(clone)).toBe(false);
  });
  it('reports no-clone for a folder that clones a different remote', async () => {
    const { store, clone } = await setup(); const other = await bareTeam();
    await git(['remote', 'set-url', 'origin', other.bare], clone);
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { teams: [{ state: 'no-clone', detail: expect.stringMatching(/^the folder is a clone of /) }] } });
  });
  it('discards a local commit in the clone: the clone is disposable state', async () => {
    const { store, clone } = await setup(); const stray = join(clone, 'stray.txt');
    await writeFile(stray, 'stray'); await git(['add', 'stray.txt'], clone); await git(['commit', '-qm', 'local'], clone);
    const before = await git(['rev-parse', 'HEAD'], clone);
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: true } });
    expect(await exists(stray)).toBe(false);
    expect(await git(['rev-parse', 'HEAD'], clone)).not.toBe(before);
    expect(await git(['rev-parse', 'HEAD'], clone)).toBe(await git(['rev-parse', 'origin/main'], clone));
  });
  it('reports changed when a hard reset restores a tracked file that was deleted locally', async () => {
    const { store, clone } = await setup(); const path = join(clone, 'skills/sample/v1/SKILL.md'); const before = await git(['rev-parse', 'HEAD'], clone);
    await clean(path);
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: true, teams: [{ state: 'refreshed', changed: true }] } });
    expect(await readFile(path, 'utf8')).toBe(skill); expect(await git(['rev-parse', 'HEAD'], clone)).toBe(before);
  });
  it('does not report changed for an untracked file the reset leaves alone', async () => {
    const { store, clone } = await setup(); const path = join(clone, 'stray.txt'); await writeFile(path, 'stray');
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: false, teams: [{ state: 'refreshed', changed: false }] } });
    expect(await readFile(path, 'utf8')).toBe('stray');
  });
  it('--team selects one team, a bare run refreshes every configured team, and an unknown --team fails', async () => {
    const { store } = await setup(['a', 'b']);
    expect((await run({ config: store, team: 'a' }, new ScriptedPrompter())).value?.teams.map(row => row.team)).toEqual(['a']);
    expect((await run({ config: store }, new ScriptedPrompter())).value?.teams.map(row => row.team)).toEqual(['a', 'b']);
    expect(await run({ config: store, team: 'nope' }, new ScriptedPrompter())).toEqual({ ok: false, error: 'Team nope is not configured.' });
  });
  it('refreshes nothing and touches git not at all when no team is configured', async () => {
    const store = createConfigStore(await temporaryDirectory());
    expect(await run({ config: store, runner: denyingRunner([]) }, new ScriptedPrompter())).toEqual({ ok: true, value: { changed: false, teams: [], notices: [] } });
  });
  it('passes the fetch deadline to the runner for the fetch step only, and never for the reset', async () => {
    const { store } = await setup(); const { runner, calls } = recordingRunner();
    expect((await run({ config: store, runner, deadlineMs: 1234 }, new ScriptedPrompter())).ok).toBe(true);
    expect(calls.find(c => c.args.join(' ') === 'fetch origin')?.options?.deadlineMs).toBe(1234);
    expect(calls.find(c => c.args.join(' ') === 'reset --hard origin/main')?.options?.deadlineMs).toBeUndefined();
    calls.length = 0;
    await run({ config: store, runner }, new ScriptedPrompter());
    expect(calls.find(c => c.args.join(' ') === 'fetch origin')?.options?.deadlineMs).toBe(REFRESH_DEADLINE_MS);
    expect(calls.filter(c => c.options?.deadlineMs !== undefined).map(c => c.args)).toEqual([['fetch', 'origin']]);
  });
  it('a fetch killed at its deadline settles as an error rather than hanging', async () => {
    const { store } = await setup();
    const runner = denyingRunner([{ command: 'git', argsPrefix: ['fetch', 'origin'], respond: () => ({ code: 124, stdout: '', stderr: 'terum-skills: git fetch exceeded 0.05 s' }) }, { command: 'git', argsPrefix: [] }], systemRunner);
    expect(await run({ config: store, runner }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: false, teams: [{ state: 'error', detail: expect.stringContaining('exceeded') }] } });
  });
  it('runs git without a terminal prompt and without an interactive credential helper', async () => {
    const { store } = await setup(); const { runner, calls } = recordingRunner();
    await run({ config: store, runner }, new ScriptedPrompter());
    // §4.2 supplies the non-interactive env through refreshClone; local HEAD/status/origin probes do not contact credentials.
    const refreshCalls = calls.filter(c => c.args[0] === 'fetch' || c.args[0] === 'reset');
    expect(refreshCalls.map(c => c.args[0])).toEqual(['fetch', 'reset']);
    // The pair index follows whatever GIT_CONFIG_* the test process itself carries, so the expectation is the producer's own answer plus the pair being present.
    for (const call of refreshCalls) { expect(call.options?.env).toEqual(nonInteractiveGitEnv()); expect(Object.entries(call.options?.env ?? {}).filter(([key, value]) => key.startsWith('GIT_CONFIG_KEY_') && value === 'credential.interactive')).toHaveLength(1); }
  });
  it('reports an empty head as null rather than guessing', async () => {
    const { store } = await setup();
    const runner = denyingRunner([{ command: 'git', argsPrefix: ['rev-parse', 'HEAD'], respond: () => ({ code: 128, stdout: '', stderr: 'no HEAD' }) }, { command: 'git', argsPrefix: [] }], systemRunner);
    expect(await run({ config: store, runner }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { teams: [{ state: 'refreshed', head: null }] } });
  });
  it('reports incomplete clones without repairing them', async () => {
    const { store, clone } = await setup(); await clean(join(clone, 'team.json'));
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { teams: [{ state: 'no-clone', detail: 'the clone is incomplete (no-team-json)' }] } });
    expect(await exists(join(clone, 'team.json'))).toBe(false);
  });
  it('fails the query when config cannot be read', async () => {
    const root = await temporaryDirectory(); const store = createConfigStore(join(root, 'state')); await mkdir(store.root);
    await writeFile(join(store.root, 'config.json'), '{');
    expect(await run({ config: store, runner: denyingRunner([]) }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('config.json') });
  });
});

describe('refresh when the team repository no longer exists (2026-09-13: terum-shared-skills → shared-skills)', () => {
  const NOT_FOUND = "remote: Repository not found.\nfatal: repository 'https://github.com/acme/team.git/' not found";
  const successor = { ownerRepo: 'acme/team-2', source: 'invitation' as const, invitationId: 5, teamName: null, at: '2026-09-13T22:25:29Z' };
  /** A GitHub-looking remote whose fetch answers "not found"; the clone itself is the local bare fixture. */
  async function gone(successors: (runner: unknown, remote: string) => Promise<{ successors: typeof successor[]; reason?: string }>) {
    const { store, ...rest } = await setup();
    await git(['remote', 'set-url', 'origin', 'https://github.com/acme/team.git'], store.teamClone('team'));
    await store.update(c => { c.teams.team!.remote = 'https://github.com/acme/team.git'; });
    const runner = denyingRunner([
      { command: 'git', argsPrefix: ['fetch', 'origin'], respond: () => ({ code: 128, stdout: '', stderr: NOT_FOUND }) },
      { command: 'git', argsPrefix: [] },
    ], systemRunner);
    const asked: string[] = [];
    const lookup = async (r: unknown, remote: string) => { asked.push(remote); return successors(r, remote); };
    return { store, runner, asked, lookup, ...rest };
  }

  it('marks the team missing, looks up a successor, and carries the facts in the result for a program', async () => {
    const { store, runner, asked, lookup } = await gone(async () => ({ successors: [successor] }));
    const io = new ScriptedPrompter(); (io as { channel?: 'frames' }).channel = 'frames';
    const outcome = await run({ config: store, runner, successors: lookup }, io);
    expect(outcome).toMatchObject({ ok: true, value: { teams: [{ team: 'team', state: 'unreachable', missing: true, successors: [successor], summary: expect.stringContaining('acme/team no longer exists on GitHub') }] } });
    expect(outcome.value?.teams[0]?.lookup).toBeUndefined();
    expect(asked).toEqual(['https://github.com/acme/team.git']);
    expect(io.asked).toEqual([]); expect(io.lines).toEqual([]);
  });

  it('offers the move to a person at a terminal and performs it when they pick the replacement', async () => {
    const { store, runner, lookup } = await gone(async () => ({ successors: [successor] }));
    const io = new ScriptedPrompter(['acme/team-2'], [], true);
    let moved: unknown;
    // The move itself is exercised in teamMove.test.ts; here it is intercepted at the runner: gh is a fake that reports
    // no invitation, and the join's clone of acme/team-2 is where the run is stopped.
    const gh = fakeGh('me', { 'api user/repository_invitations': { code: 0, stdout: '[]', stderr: '' } });
    const intercepting = { run: async (command: 'git' | 'gh', args: readonly string[], options?: object) => { if (command === 'gh') return gh(args, options); if (command === 'git' && args[0] === 'clone') { moved = args; return { code: 1, stdout: '', stderr: 'stop here' }; } return runner.run(command, args, options); } };
    const outcome = await run({ config: store, runner: intercepting, successors: lookup }, io);
    expect(io.lines).toContain("team's repository acme/team no longer exists on GitHub. A replacement from the same owner is available: acme/team-2 (you were invited to it on 2026-09-13).");
    expect(io.asked).toContain('Move this machine from team to the replacement?');
    expect(io.offered[0]).toEqual(['acme/team-2', 'Not now']); expect(io.offeredDefaults[0]).toBe('acme/team-2');
    expect(moved).toBeDefined();
    // The refresh facts survive a failed move: the result carries them beside the error.
    expect(outcome.ok).toBe(false); expect(outcome.value?.teams[0]?.missing).toBe(true);
    expect(Object.keys((await store.read()).teams)).toEqual([]); // the old team was left; the join is what failed
  });

  it('respects "Not now", prints the command for a pipe, and says why nothing could be found', async () => {
    const { store, runner, lookup } = await gone(async () => ({ successors: [successor] }));
    const later = new ScriptedPrompter(['Not now'], [], true);
    expect((await run({ config: store, runner, successors: lookup }, later)).value?.moved).toBeUndefined();
    expect(Object.keys((await store.read()).teams)).toEqual(['team']);
    const piped = new ScriptedPrompter();
    await run({ config: store, runner, successors: lookup }, piped);
    expect(piped.asked).toEqual([]);
    expect(piped.lines).toContain("To follow it, run `npx -y terum-skills@latest team move 'acme/team-2'`.");
    const { store: store2, runner: runner2 } = await gone(async () => ({ successors: [], reason: 'gh is logged out.' }));
    const nothing = new ScriptedPrompter([], [], true);
    const outcome = await run({ config: store2, runner: runner2, successors: async () => ({ successors: [], reason: 'gh is logged out.' }) }, nothing);
    expect(outcome.value?.teams[0]).toMatchObject({ missing: true, successors: [], lookup: 'gh is logged out.' });
    expect(nothing.asked).toEqual([]);
    expect(nothing.lines).toContain("team's repository acme/team no longer exists on GitHub. gh is logged out.");
  });

  it('caches the lookup for a program (the app refreshes on every focus) for ten minutes, keyed on the remote, and never for a person at a terminal', async () => {
    const { store, runner, asked, lookup } = await gone(async () => ({ successors: [successor] }));
    const frames = () => { const io = new ScriptedPrompter(); (io as { channel?: 'frames' }).channel = 'frames'; return io; };
    let clock = 1_000_000;
    const now = () => clock;
    await run({ config: store, runner, successors: lookup, now }, frames());
    await run({ config: store, runner, successors: lookup, now }, frames());
    expect(asked).toHaveLength(1);
    expect(JSON.parse(await readFile(join(store.root, 'run', 'team.successors.json'), 'utf8'))).toMatchObject({ remote: 'https://github.com/acme/team.git', at: clock, search: { successors: [successor] } });
    clock += SUCCESSOR_CACHE_MS;
    const later = await run({ config: store, runner, successors: lookup, now }, frames());
    expect(asked).toHaveLength(2);
    expect(later.value?.teams[0]?.successors).toEqual([successor]);
    // A person is about to act on the answer: always fresh. A "Not now" leaves the cache for the app.
    await run({ config: store, runner, successors: lookup, now }, new ScriptedPrompter(['Not now'], [], true));
    expect(asked).toHaveLength(3);
    // A cache written for another remote is ignored.
    await writeFile(join(store.root, 'run', 'team.successors.json'), JSON.stringify({ remote: 'https://github.com/acme/elsewhere.git', at: clock, search: { successors: [] } }));
    await run({ config: store, runner, successors: lookup, now }, frames());
    expect(asked).toHaveLength(4);
    // Garbage in the cache file is not an error either.
    await writeFile(join(store.root, 'run', 'team.successors.json'), '{not json');
    expect((await run({ config: store, runner, successors: lookup, now }, frames())).ok).toBe(true);
    expect(asked).toHaveLength(5);
  });

  it('never looks anything up in hook mode, for a non-GitHub remote, or for an access failure that is not "not found"', async () => {
    const { store, runner, asked, lookup } = await gone(async () => ({ successors: [successor] }));
    const hook = await run({ config: store, runner, successors: lookup, hook: true }, new ScriptedPrompter());
    expect(hook.value?.teams[0]).toMatchObject({ state: 'unreachable' }); expect(hook.value?.teams[0]?.missing).toBeUndefined();
    expect(asked).toEqual([]);
    const { store: generic, seed } = await setup(); await pushFromSeed(seed, 'x.txt', 'x');
    const genericRunner = denyingRunner([{ command: 'git', argsPrefix: ['fetch', 'origin'], respond: () => ({ code: 128, stdout: '', stderr: "fatal: repository '/gone.git' not found" }) }, { command: 'git', argsPrefix: [] }], systemRunner);
    const outcome = await run({ config: generic, runner: genericRunner, successors: lookup }, new ScriptedPrompter([], [], true));
    expect(outcome.value?.teams[0]).toMatchObject({ state: 'unreachable' }); expect(outcome.value?.teams[0]?.missing).toBeUndefined();
    const { store: denied, runner: deniedRunner } = await gone(async () => ({ successors: [successor] }));
    const deniedOutcome = await run({ config: denied, runner: denyingRunner([{ command: 'git', argsPrefix: ['fetch', 'origin'], respond: () => ({ code: 128, stdout: '', stderr: 'remote: Permission to acme/team.git denied to me.' }) }, { command: 'git', argsPrefix: [] }], systemRunner), successors: lookup }, new ScriptedPrompter([], [], true));
    expect(deniedOutcome.value?.teams[0]?.missing).toBeUndefined();
    expect(asked).toEqual([]);
    void deniedRunner;
  });

  it('appends its credential pair after the GIT_CONFIG_* pairs the caller passed, and clears every askpass route', () => {
    expect(nonInteractiveGitEnv({})).toEqual({ GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.interactive', GIT_CONFIG_VALUE_0: 'false' });
    expect(nonInteractiveGitEnv({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.proxy', GIT_CONFIG_VALUE_0: 'http://proxy:3128', GIT_CONFIG_KEY_1: 'http.extraHeader', GIT_CONFIG_VALUE_1: 'X-A: b', GIT_ASKPASS: '/usr/bin/some-gui-askpass' }))
      .toEqual({ GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never', GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_2: 'credential.interactive', GIT_CONFIG_VALUE_2: 'false' });
    // A count git itself would reject is treated as none, so the pair is still reachable.
    for (const bogus of ['-1', '1.5', 'many', '']) expect(nonInteractiveGitEnv({ GIT_CONFIG_COUNT: bogus })).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.interactive' });
  });
  it('removes a git lock file older than ten minutes and fetches; a young one is reported by path and never deleted', async () => {
    const { store, clone, seed } = await setup(); await pushFromSeed(seed, 'update.txt', 'new');
    const lock = join(clone, '.git', 'index.lock'); await writeFile(lock, ''); const old = new Date(Date.now() - 20 * 60_000); await utimes(lock, old, old);
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: true, teams: [{ team: 'team', state: 'refreshed', changed: true }] } });
    expect(await exists(lock)).toBe(false);
    await pushFromSeed(seed, 'update2.txt', 'newer'); await writeFile(lock, '');
    const young = await run({ config: store }, new ScriptedPrompter());
    expect(young).toMatchObject({ ok: true, value: { changed: false, teams: [{ team: 'team', state: 'error', changed: false, detail: expect.stringContaining(`The lock ${lock} is `) }] } });
    expect(young.value?.teams[0]?.detail).toContain('delete it and sync again');
    expect(await exists(lock)).toBe(true);
  });
  it('reports a fetch that landed as refreshed even when the stamp cannot be written, with a notice instead', async () => {
    const { store, seed } = await setup(); await pushFromSeed(seed, 'update.txt', 'new');
    const runDir = join(store.root, 'run'); await mkdir(runDir, { recursive: true }); await chmod(runDir, 0o500);
    try {
      const result = await run({ config: store }, new ScriptedPrompter());
      expect(result).toMatchObject({ ok: true, value: { changed: true, teams: [{ team: 'team', state: 'refreshed', changed: true }] } });
      expect(result.value?.notices).toEqual([expect.stringMatching(/^team: fetched, but the fetch stamp could not be written \(.+\); status may call the clone stale until the next sync\.$/)]);
      expect(await stampedAt(store.root, 'team')).toBeNull();
    } finally { await chmod(runDir, 0o700); }
  });
  it('--hook re-points its own SessionStart entry from the pre-0.21 @latest spelling at this copy, once, with a notice; a machine with no entry of ours gets none', async () => {
    const { store } = await setup();
    const settings = { settingsFile: join(store.root, 'settings.json'), backupDir: join(store.root, 'backups') };
    const other = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo keep' }] };
    await writeFile(settings.settingsFile, JSON.stringify({ hooks: { SessionStart: [other, { matcher: 'startup', hooks: [{ type: 'command', command: 'npx -y terum-skills@latest sync --hook', async: true, timeout: 60 }] }] } }));
    const first = await run({ config: store, hook: true, settings }, new ScriptedPrompter());
    expect(first).toMatchObject({ ok: true, value: { notices: [`Pinned your session hook to this copy of terum-skills (${HOOK_COMMAND}); it no longer fetches the newest release at session start. Re-run \`npx -y terum-skills@latest setup\` after an update to move it.`] } });
    expect(await installedHookCommand(settings.settingsFile)).toBe(HOOK_COMMAND);
    expect(JSON.parse(await readFile(settings.settingsFile, 'utf8')).hooks.SessionStart[0]).toEqual(other);
    expect(await run({ config: store, hook: true, settings }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { notices: [] } });
    // A plain sync never touches the entry, and hook mode installs nothing where the offer was declined.
    await writeFile(settings.settingsFile, JSON.stringify({ hooks: { SessionStart: [other] } }));
    expect(await run({ config: store, settings }, new ScriptedPrompter())).toMatchObject({ ok: true });
    expect(await run({ config: store, hook: true, settings }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { notices: [] } });
    expect(JSON.parse(await readFile(settings.settingsFile, 'utf8'))).toEqual({ hooks: { SessionStart: [other] } });
    // An unreadable settings file is reported, not fatal.
    await writeFile(settings.settingsFile, '{not json');
    expect(await run({ config: store, hook: true, settings }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { notices: [`Could not pin the session hook in ${settings.settingsFile}: Cannot read ${settings.settingsFile}: it is not valid JSON.`] } });
  });
  it('--hook leaves a clone fetched within the hour alone and reports it as fresh; a plain sync still fetches', async () => {
    const { store, clone, seed } = await setup();
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { teams: [{ state: 'refreshed' }] } });
    const head = (await git(['rev-parse', 'HEAD'], clone)).trim();
    await pushFromSeed(seed, 'update.txt', 'new');
    const hook = new ScriptedPrompter();
    expect(await run({ config: store, hook: true }, hook)).toMatchObject({ ok: true, value: { changed: false, teams: [{ team: 'team', state: 'fresh', changed: false, head }] } });
    expect(hook.lines).toEqual(['{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}']);
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).toBe(head);
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: true, teams: [{ state: 'refreshed', changed: true }] } });
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).not.toBe(head);
  });
});
