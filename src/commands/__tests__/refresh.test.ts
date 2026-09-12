import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { stampedAt, stampIsFresh } from '../../lib/hook.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { systemRunner, type RunOptions } from '../../lib/runner.js';
import { bareTeam, pushFromSeed, cloneWithIdentity, git, holdCloneLock, denyingRunner, ScriptedPrompter, clean, exists, wrapRunner, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { run, REFRESH_DEADLINE_MS } from '../refresh.js';
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
    for (const call of refreshCalls) expect(call.options?.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.interactive', GIT_CONFIG_VALUE_0: 'false' });
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
