import { expectTypeOf, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { access, chmod, cp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { acquireTeamLock, lockPath, removeRunArtifacts, stampPath } from '../../lib/hook.js';
import { approved, run } from '../sync.js';
import { allowedTools, emptyConfig } from '../../lib/schema.js';
import { run as connect } from '../connect.js';
import { createExecute } from '../../lib/execute.js';
import { run as install } from '../install.js';
import { NonInteractivePrompter } from '../../lib/prompt.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, holdCloneLock, mappedRunner, person, pushFromSeed, ScriptedPrompter, temporaryDirectory, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { lockTarget } from '../../lib/placer.js';
import { snapshotSkillDirectory } from '../../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { systemRunner } from '../../lib/runner.js';
import { canonicalDigest } from '../../lib/skills.js';
import { cloneLockPath } from '../../lib/teamRepo.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (args[0] === (globalThis as { terumPruneFailurePath?: string }).terumPruneFailurePath) throw new Error('deliberately undeletable');
      return actual.rm(...args);
    },
  };
});

const ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
/** §8: a hook run within an hour of a successful sync is a no-op, so a hook run that follows an interactive sync in one test is clocked past the hour. */
const later = () => Date.now() + 2 * 3_600_000;
const skill = (description: string) => `---\nname: sample\ndescription: ${description}\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${description}\n`;
const toolSkill = (description: string, tools: string[]) => `---\nname: sample\ndescription: ${description}\nlicense: UNLICENSED\nallowed-tools:\n${tools.map((tool) => `  - ${tool}`).join('\n')}\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${description}\n`;

async function configuredSkill() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('old'));
  const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  return { fixture, store, clone };
}

async function sharedSyncFixture() {
  const fixture = await bareTeam();
  const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const source = join(fixture.root, 'sample');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), skill('shared source'));
  const connected = await connect({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [true]));
  if (!connected.ok) throw new Error(connected.error);
  return { fixture, store, clone, source };
}

describe('sync --hook (§3, §6)', () => {
  it('is callable with the print-only prompter and has silent empty output', async () => {
    expectTypeOf(run).toBeFunction();
    const io: NonInteractivePrompter = { interactive: false, print: () => undefined };
    const result = await run({ hook: true, config: createConfigStore(await temporaryDirectory()) }, io);
    expect(result).toMatchObject({ ok: true, value: { placed: 0 } });
  });

  it('keeps a pinned placement on its cached tree when HEAD changes', async () => {
    const { fixture, store, clone } = await configuredSkill();
    const home = join(fixture.root, 'home');
    const tree = (await systemRunner.run('git', ['rev-parse', 'HEAD:skills/sample'], { cwd: clone })).stdout.trim();
    expect((await install({ ref: `sample@${tree}`, config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample', 'SKILL.md');
    const fingerprint = Object.values((await store.read()).placements)[0]!.fingerprint;
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toContain('description: old');
    expect(Object.values((await store.read()).placements)[0]!.fingerprint).toBe(fingerprint);
  });

  it('defers newly endorsed global skills in hook mode without prompting or placing', async () => {
    const { fixture, store } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [ID], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ hook: true, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { deferred: ['sample'], placed: 0 } });
    expect(io.lines).toEqual([]);
    expect((await store.read()).placements).toEqual({});
    void fixture;
  });

  it('a clone removed mid-run costs that team\'s endorsed batch alone: the run still succeeds and every other team is stamped', async () => {
    const { fixture, store } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [ID], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    // `team leave team` in another window: it removes the clone before it deletes the ledger entry, so
    // the endorsed batch — which walks the start-of-run snapshot — can reach a clone that is gone.
    let fetches = 0;
    const midRun = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2) await rm(store.teamClone('team'), { recursive: true, force: true });
      return next();
    });
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: store, runner: midRun }, io)).toMatchObject({ ok: true, value: { deferred: [], notices: expect.arrayContaining([expect.stringContaining('Skipping endorsed batch for team')]) } });
    await expect(access(stampPath(store.root, 'other'))).resolves.toBeUndefined();
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a malformed allowed-tools value blocks the placement, is counted for review, and leaves the stamp unwritten', async () => {
    const { fixture, store, home } = await configuredToolSkill();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: broken grants\nlicense: UNLICENSED\nallowed-tools:\n  a: 1\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nbroken grants\n`);
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(io.lines).toContain('Blocked sample: allowed-tools is malformed.');
    expect(await readFile(join(home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: old');
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stamps every team the run did complete: one team\'s deferral never withholds another\'s stamp (§8)', async () => {
    const { fixture, store } = await configuredSkill();
    // `team` has an endorsed candidate this hook run cannot ask about, so it defers; `other` has nothing to do.
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [ID], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: store }, io)).toMatchObject({ ok: true, value: { deferred: ['sample'] } });
    // Neither stamp existed before this run, so `other`'s can only have been written by it.
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stampPath(store.root, 'other'))).resolves.toBeUndefined();
  });


  it.each([false, true])('skips a classified fetch failure, preserves its state, completes healthy teams, and fails (hook=%s)', async (hook) => {
    const { fixture, store, clone } = await configuredSkill();
    const home = join(fixture.root, 'home');
    const local = mappedRunner(fixture.bare, fixture.bare);
    expect((await install({ ref: 'sample', config: store, home, runner: local }, new ScriptedPrompter())).ok).toBe(true);
    const placedPath = join(home, '.claude', 'skills', 'sample');
    await writeFile(join(placedPath, 'SKILL.md'), skill('hand edit'));
    const orphan = join(home, '.claude', 'skills', 'orphan');
    await cp(placedPath, orphan, { recursive: true });
    await store.update((config) => {
      config.placements[orphan] = { id: '33333333-3333-4333-8333-333333333333', team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-09-04', fingerprint: 'sha256:orphan' };
      config.shared[ID] = { source: join(fixture.root, 'gone'), team: 'team', baseline: 'sha256:0' };
      config.pending.push({ op: 'uninstall', id: ID, team: 'team', scope: { kind: 'global' }, started: '2026-09-04T00:00:00Z' });
      config.teams.team!.remote = 'github.com/acme/team';
    });
    const other = await bareTeam();
    const otherSkill = (description: string) => skill(description).replace('name: sample', 'name: elsewhere').replace(ID, SECOND_ID);
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', otherSkill('old healthy'));
    const otherClone = await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    expect((await install({ ref: 'other/elsewhere', config: store, home, runner: local }, new ScriptedPrompter())).ok).toBe(true);
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', otherSkill('healthy updated'));
    const before = await store.read();
    const head = await git(['rev-parse', 'HEAD'], clone);
    const otherHead = await git(['rev-parse', 'HEAD'], otherClone);
    await mkdir(join(store.root, 'run'), { recursive: true });
    await writeFile(stampPath(store.root, 'team'), 'old');
    const remote = 'https://github.com/acme/team.git';
    const runner = wrapRunner(mappedRunner(remote, fixture.bare), async (command, args, options, next) => command === 'git' && args[0] === 'fetch' && options?.cwd === clone ? { code: 128, stdout: '', stderr: 'remote: Repository not found.' } : next());
    const io = new ScriptedPrompter([], [], !hook);
    const result = await run({ hook, config: store, runner, now: later }, io);
    expect.soft(result).toMatchObject({ ok: false, error: 'Sync finished with 1 team(s) skipped: team. See the notices above.' });
    const errors: string[] = [];
    const exitCodes: number[] = [];
    await createExecute({ io, stderr: (line) => errors.push(line), setExitCode: (code) => exitCodes.push(code) })(async () => result, { verb: 'sync', notices: false });
    expect(exitCodes).toEqual([1]);
    expect(errors.at(-1)).toBe('Sync finished with 1 team(s) skipped: team. See the notices above.');
    if (hook) expect(errors[0]).toContain('Skipping team: could not fetch');
    const notices = hook ? result.value?.notices : io.lines;
    expect.soft(notices?.join('\n')).toContain(`Skipping team: could not fetch ${remote}: remote: Repository not found.\nGit could not access ${remote}.`);
    expect(await git(['rev-parse', 'HEAD'], otherClone)).not.toBe(otherHead);
    await expect(access(stampPath(store.root, 'other'))).resolves.toBeUndefined();
    expect(await readFile(join(home, '.claude', 'skills', 'elsewhere', 'SKILL.md'), 'utf8')).toContain('healthy updated');
    expect(await readFile(stampPath(store.root, 'team'), 'utf8')).toBe('old');
    expect(await git(['rev-parse', 'HEAD'], clone)).toBe(head);
    expect(await readFile(join(placedPath, 'SKILL.md'), 'utf8')).toBe(skill('hand edit'));
    expect(await readFile(join(orphan, 'SKILL.md'), 'utf8')).toBe(skill('hand edit'));
    const after = await store.read();
    expect(after.placements[placedPath]).toEqual(before.placements[placedPath]);
    expect(after.placements[orphan]).toEqual(before.placements[orphan]);
    expect(after.shared).toEqual(before.shared);
    expect(after.pending).toEqual(before.pending);
    expect(io.asked).toEqual([]);
    for (const team of ['team', 'other']) {
      await expect(access(lockPath(store.root, team))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(cloneLockPath(store.teamClone(team)))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    if (hook) {
      expect(result.value).toMatchObject({ placed: 1, hook: true });
      expect(io.lines).toEqual(['{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}']);
    }
  });

  it('writes a stamp after interactive success but leaves an old stamp after a failed pull', async () => {
    const { fixture, store } = await configuredSkill();
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    const stamp = join(store.root, 'run', 'team.stamp');
    await expect(access(stamp)).resolves.toBeUndefined();
    await writeFile(stamp, 'old');
    const failing = wrapRunner(systemRunner, async (command, args, _options, next) => command === 'git' && args[0] === 'fetch' ? { code: 1, stdout: '', stderr: 'failed' } : next());
    expect((await run({ config: store, runner: failing }, new ScriptedPrompter())).ok).toBe(false);
    expect(await readFile(stamp, 'utf8')).toBe('old');
    void fixture;
  });

  it('skips a team whose clone another operation is writing to — not refreshed, not read, not stamped, no pass touches its placements, shares, endorsements or orphans — and still syncs every other team', async () => {
    const { fixture, store, clone } = await configuredSkill(); const home = join(fixture.root, 'home');
    // Give every busy-skip guard something to skip: a drifted placement, a shared source, an endorsed
    // candidate, and an orphaned placement — each of which would prompt, move or write if it ran.
    await pushFromSeed(fixture.seed, 'skills/second/SKILL.md', skill('second').replace('name: sample', 'name: second').replace(ID, SECOND_ID));
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [SECOND_ID], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const placedPath = join(home, '.claude', 'skills', 'sample');
    await writeFile(join(placedPath, 'SKILL.md'), skill('hand edit'));
    const orphan = join(home, '.claude', 'skills', 'second');
    await cp(join(clone, 'skills', 'second'), orphan, { recursive: true });
    await store.update((config) => {
      config.placements[orphan] = { id: SECOND_ID, team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-09-04', fingerprint: 'sha256:orphan' };
      config.shared[ID] = { source: join(fixture.root, 'gone'), team: 'team', baseline: 'sha256:0' };
    });
    const other = await bareTeam();
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', skill('other team').replace('name: sample', 'name: elsewhere'));
    const otherClone = await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', skill('other team moved').replace('name: sample', 'name: elsewhere'));
    const head = (await git(['rev-parse', 'HEAD'], clone)).trim();
    const otherHead = (await git(['rev-parse', 'HEAD'], otherClone)).trim();
    const release = await holdCloneLock(clone);
    try {
      // Interactive with nothing scripted: any pass that reached a prompt for the busy team would close the channel and fail the run.
      const io = new ScriptedPrompter([], [], true);
      expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, deferred: [], notices: [expect.stringMatching(/write lock on team/)] } });
      expect(io.asked).toEqual([]);
      expect(await readFile(join(placedPath, 'SKILL.md'), 'utf8')).toContain('description: hand edit');
      await expect(access(join(store.root, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(orphan, 'SKILL.md'), 'utf8')).toContain('description: second');
      expect((await git(['rev-parse', 'HEAD'], clone)).trim()).toBe(head);
      expect((await git(['rev-parse', 'HEAD'], otherClone)).trim()).not.toBe(otherHead);
      await expect(access(join(store.root, 'run', 'team.stamp'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(store.root, 'run', 'other.stamp'))).resolves.toBeUndefined();
    } finally { await release(); }
    // Once the clone is free the team syncs; what this noninteractive-shaped run cannot ask about (the
    // endorsed candidate, the orphan) is deferred, and a deferral leaves the stamp for the next session (§8).
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { deferred: expect.arrayContaining(['second']) } });
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).not.toBe(head);
    await expect(access(join(store.root, 'run', 'team.stamp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a clone lock lost mid-fetch costs exactly that team as well: the sync continues and the other team lands', async () => {
    const { fixture, store, clone } = await configuredSkill();
    const other = await bareTeam();
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', skill('other team').replace('name: sample', 'name: elsewhere'));
    const otherClone = await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', skill('other team moved').replace('name: sample', 'name: elsewhere'));
    const head = (await git(['rev-parse', 'HEAD'], clone)).trim();
    const otherHead = (await git(['rev-parse', 'HEAD'], otherClone)).trim();
    const lock = cloneLockPath(clone);
    // Steal team's lock during its fetch; proper-lockfile notices on its next 1000 ms tick (its floor), so the wait clears a full tick plus slack.
    const stealing = wrapRunner(systemRunner, async (command, args, options, next) => {
      const result = await next();
      if (command === 'git' && args[0] === 'fetch' && options?.cwd === clone) { await rm(lock, { recursive: true, force: true }); await new Promise((done) => setTimeout(done, 3_000)); }
      return result;
    });
    expect(await run({ config: store, runner: stealing, lockStale: 2_000 }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { deferred: [], notices: [expect.stringMatching(/Lost the safeWrite lock/)] } });
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).toBe(head);
    expect((await git(['rev-parse', 'HEAD'], otherClone)).trim()).not.toBe(otherHead);
    await expect(access(join(store.root, 'run', 'team.stamp'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(store.root, 'run', 'other.stamp'))).resolves.toBeUndefined();
  });

  it('an up-to-date placement never contends: a held target lock over it is neither a block nor a review count', async () => {
    const { fixture, store } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const release = await lockTarget(join(home, '.claude', 'skills'), 'sample');
    try {
      const io = new ScriptedPrompter();
      expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, deferred: [] } });
      expect(io.lines.filter((line) => line.startsWith('Blocked'))).toEqual([]);
    } finally { await release(); }
  });

  it('a plain file at the ledger path is still the foreign collision the lock reports, not a read that fails', async () => {
    const { fixture, store } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    await rm(path, { recursive: true, force: true }); await writeFile(path, 'user-owned, not a placement');
    const io = new ScriptedPrompter();
    // Under §8's completeness rule a foreign collision is undone work — deferred, and the team's stamp
    // withheld — so the load-bearing assertion is the exact line: the collision notice, not a read error.
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(io.lines.filter((line) => line === `Blocked ${path}: ${path} already exists and is not a placement this tool owns; leaving both untouched.`)).toHaveLength(1);
    expect(await readFile(path, 'utf8')).toBe('user-owned, not a placement');
  });

  it('a symlink at the ledger path is refused, never followed, even when it points at an identical tree', async () => {
    const { fixture, store } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample'); const mirror = join(home, 'mirror');
    await cp(path, mirror, { recursive: true }); await rm(path, { recursive: true, force: true }); await symlink(mirror, path);
    const io = new ScriptedPrompter();
    // Deferred under §8's completeness rule (see the plain-file case above); the exact line is the assertion.
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(io.lines.filter((line) => line === `Blocked ${path}: ${path} already exists and is not a placement this tool owns; leaving both untouched.`)).toHaveLength(1);
    expect(await readFile(join(mirror, 'SKILL.md'), 'utf8')).toContain('description: old');
  });

  it('an interactive sync takes the §8 team mutex too: a team another process holds is skipped with a reason and left untouched, and syncs once the lock is released', async () => {
    const { fixture, store } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    // `team leave` holds this while it removes the team's placements; before R4 a typed sync ignored it.
    const release = await acquireTeamLock(store.root, 'team');
    expect(release).not.toBeNull();
    try {
      const io = new ScriptedPrompter();
      expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, deferred: [] } });
      expect(io.lines.filter((line) => line === `Skipping team: another terum-skills sync holds its session lock (${lockPath(store.root, 'team')}); retry when it finishes.`)).toHaveLength(1);
      expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('description: old');
    } finally { await release!(); }
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { placed: 1 } });
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('description: new');
  });

  it('reports a placement whose target lock another process holds as blocked and leaves it untouched', async () => {
    const { fixture, store } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    const release = await lockTarget(join(home, '.claude', 'skills'), 'sample');
    try {
      const io = new ScriptedPrompter();
      expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
      expect(io.lines.filter((line) => line.startsWith(`Blocked ${path}: `) && line.includes('busy'))).toHaveLength(1);
      expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('description: old');
    } finally { await release(); }
    expect(await run({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { placed: 1 } });
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('description: new');
  });

  it('defers one endorsed candidate that cannot be placed, still installs the rest, and leaves the stamp unwritten so the next session retries', async () => {
    const { fixture, store } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'skills/second/SKILL.md', skill('second').replace('name: sample', 'name: second').replace(ID, SECOND_ID));
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [ID, SECOND_ID], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    // sync's endorsed batch places under the store's own home; a stranger's folder sits at the first candidate's target.
    const stranger = join(store.root, '.claude', 'skills', 'sample');
    await mkdir(stranger, { recursive: true }); await writeFile(join(stranger, 'SKILL.md'), 'user-owned, not a placement');
    const io = new ScriptedPrompter([], [true], true);
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 1, deferred: ['sample'] } });
    expect(io.lines.filter((line) => line.startsWith('Deferred endorsed sample: '))).toHaveLength(1);
    expect(await readFile(join(store.root, '.claude', 'skills', 'second', 'SKILL.md'), 'utf8')).toContain('description: second');
    expect(await readFile(join(stranger, 'SKILL.md'), 'utf8')).toBe('user-owned, not a placement');
    await expect(access(join(store.root, 'run', 'team.stamp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a closed prompt channel is one failure, never a damaged placement per remaining entry', async () => {
    const setup = await configuredToolSkill();
    await pushFromSeed(setup.fixture.seed, 'skills/sample/SKILL.md', toolSkill('widened', ['Bash(*)']));
    // Interactive, but nothing scripted: the channel closes at the first consent question.
    const io = new ScriptedPrompter([], [], true);
    expect(await run({ config: setup.store }, io)).toMatchObject({ ok: false, error: expect.stringMatching(/Input ended before/) });
    expect(io.lines.filter((line) => line.startsWith('Blocked '))).toEqual([]);
    expect(await readFile(join(setup.home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: old');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports one unreadable placement as blocked, still refreshes the others, and leaves the stamp unwritten (§8: a partial run is retried next session)', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    await pushFromSeed(fixture.seed, 'skills/second/SKILL.md', skill('second').replace('name: sample', 'name: second').replace(ID, SECOND_ID));
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    expect((await install({ ref: 'second', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const broken = join(home, '.claude', 'skills', 'sample'); const healthy = join(home, '.claude', 'skills', 'second');
    await chmod(join(broken, 'SKILL.md'), 0o000);
    await pushFromSeed(fixture.seed, 'skills/second/SKILL.md', skill('second updated').replace('name: sample', 'name: second').replace(ID, SECOND_ID));
    await rm(join(store.root, 'run'), { recursive: true, force: true });
    const io = new ScriptedPrompter();
    try { expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 1, deferred: ['sample'] } }); }
    finally { await chmod(join(broken, 'SKILL.md'), 0o644); }
    expect(io.lines.filter((line) => line.startsWith(`Blocked ${broken}: `))).toHaveLength(1);
    expect(await readFile(join(healthy, 'SKILL.md'), 'utf8')).toContain('description: second updated');
    await expect(access(join(store.root, 'run', 'team.stamp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('heals a clone whose local main drifted instead of failing to fast-forward', async () => {
    const { store, clone } = await configuredSkill();
    await writeFile(join(clone, 'stray.txt'), 'local'); await git(['add', '--all'], clone); await git(['commit', '-q', '-m', 'local-only'], clone);
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).toBe((await git(['rev-parse', 'origin/main'], clone)).trim());
  });

  it('blocks a placement whose pinned version is not in the clone and touches nothing', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', team: 'team', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const [path] = Object.keys((await store.read()).placements);
    const before = await snapshotSkillDirectory(path!);
    const unknown = '0123456789abcdef0123456789abcdef01234567';
    await store.update((config) => { config.placements[path!]!.version = unknown; });
    const io = new ScriptedPrompter();
    expect((await run({ config: store }, io)).ok).toBe(true);
    expect(io.lines.join('\n')).toContain(`Blocked ${path}: pinned version 01234567`);
    expect((await snapshotSkillDirectory(path!)).fingerprint).toBe(before.fingerprint);
    expect((await store.read()).placements[path!]!.version).toBe(unknown);
    // A blocked placement is undone work: the team is not stamped as fully synced (§8).
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('adopts or declines orphans interactively and only defers them in hook mode', async () => {
    const adopt = await orphanedPlacement();
    expect((await run({ config: adopt.store }, new ScriptedPrompter([], [true], true))).ok).toBe(true);
    expect(JSON.parse(await readFile(join(adopt.clone, 'people', 'seed.json'), 'utf8')).installed).toHaveLength(1);
    expect(Object.keys((await adopt.store.read()).placements)).toHaveLength(1);

    const decline = await orphanedPlacement();
    expect((await run({ config: decline.store }, new ScriptedPrompter([], [false], true))).ok).toBe(true);
    expect(await readFile(join(decline.path, 'SKILL.md'), 'utf8')).toContain('description: old');
    expect(Object.keys((await decline.store.read()).placements)).toEqual([decline.path]);
    expect(JSON.parse(await readFile(join(decline.clone, 'people', 'seed.json'), 'utf8')).declined).toContain(ID);
    const declinedBefore = await readFile(join(decline.path, 'SKILL.md'), 'utf8');
    const ledgerBefore = JSON.stringify((await decline.store.read()).placements);
    const interactive = new ScriptedPrompter();
    expect(await run({ config: decline.store }, interactive)).toMatchObject({ ok: true, value: { placed: 0, deferred: [] } });
    expect(interactive.asked).toEqual([]);
    const declinedHook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: decline.store, now: later }, declinedHook)).toMatchObject({ ok: true, value: { placed: 0, deferred: [] } });
    expect(declinedHook.lines).toEqual([]);
    expect(await readFile(join(decline.path, 'SKILL.md'), 'utf8')).toBe(declinedBefore);
    expect(JSON.stringify((await decline.store.read()).placements)).toBe(ledgerBefore);
    expect((await install({ ref: 'sample', config: decline.store, home: decline.home }, new ScriptedPrompter())).ok).toBe(true);
    expect(JSON.parse(await readFile(join(decline.clone, 'people', 'seed.json'), 'utf8')).declined).not.toContain(ID);

    const hook = await orphanedPlacement();
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: hook.store }, io)).toMatchObject({ ok: true, value: { deferred: ['sample'] } });
    await expect(access(hook.path)).resolves.toBeUndefined();
    expect(io.lines).toEqual([]);
  });

  it('offers adoption for an orphan before considering a changed repository copy, leaving its bytes untouched', async () => {
    const orphan = await orphanedPlacement();
    const before = await readFile(join(orphan.path, 'SKILL.md'), 'utf8');
    await pushFromSeed(orphan.fixture.seed, 'skills/sample/SKILL.md', skill('upstream changed'));
    const io = new ScriptedPrompter([], [false], true);
    expect((await run({ config: orphan.store }, io)).ok).toBe(true);
    expect(io.asked).toEqual([`Adopt orphaned placement at ${orphan.path}?`]);
    expect(await readFile(join(orphan.path, 'SKILL.md'), 'utf8')).toBe(before);
    expect((await orphan.store.read()).placements[orphan.path]).toBeDefined();
    expect(JSON.parse(await readFile(join(orphan.clone, 'people', 'seed.json'), 'utf8')).declined).toContain(ID);
  });

  it('follows an upstream skill rename with exactly one new placement and re-keyed provenance', async () => {
    const { fixture, store, clone } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const oldPath = join(home, '.claude', 'skills', 'sample'); const newPath = join(home, '.claude', 'skills', 'renamed');
    await git(['fetch', '-q', 'origin'], fixture.seed); await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    await cp(join(fixture.seed, 'skills', 'sample'), join(fixture.seed, 'skills', 'renamed'), { recursive: true });
    await rm(join(fixture.seed, 'skills', 'sample'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'renamed', 'SKILL.md'), skill('renamed').replace('name: sample', 'name: renamed'));
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'rename sample'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(newPath, 'SKILL.md'), 'utf8')).toContain('name: renamed');
    const ledger = await store.read(); expect(Object.keys(ledger.placements)).toEqual([newPath]);
    const fingerprint = (await snapshotSkillDirectory(join(clone, 'skills', 'renamed'))).fingerprint;
    expect(ledger.placements[newPath]!.fingerprint).toBe(fingerprint);
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(Object.keys((await store.read()).placements)).toEqual([newPath]);
  });

  it('refuses to follow a rename onto a folder it does not own, leaving the stranger and the old placement untouched', async () => {
    const { fixture, store } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const oldPath = join(home, '.claude', 'skills', 'sample'); const stranger = join(home, '.claude', 'skills', 'renamed');
    await mkdir(stranger, { recursive: true }); await writeFile(join(stranger, 'SKILL.md'), 'user-owned, not a placement');
    await git(['fetch', '-q', 'origin'], fixture.seed); await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    await cp(join(fixture.seed, 'skills', 'sample'), join(fixture.seed, 'skills', 'renamed'), { recursive: true });
    await rm(join(fixture.seed, 'skills', 'sample'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'renamed', 'SKILL.md'), skill('renamed').replace('name: sample', 'name: renamed'));
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'rename sample'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0 } });
    expect(await readFile(join(stranger, 'SKILL.md'), 'utf8')).toBe('user-owned, not a placement');
    expect(await readFile(join(oldPath, 'SKILL.md'), 'utf8')).toContain('description: old');
    expect(Object.keys((await store.read()).placements)).toEqual([oldPath]);
    expect(io.lines.filter((line) => line.startsWith(`Blocked ${oldPath}: ${stranger} already exists`))).toHaveLength(1);
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a rename onto a stranger before anything moves: a hand-edited old placement stays put, unquarantined, and the ledger still keys it', async () => {
    const { fixture, store } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const oldPath = join(home, '.claude', 'skills', 'sample'); const stranger = join(home, '.claude', 'skills', 'renamed');
    await mkdir(stranger, { recursive: true }); await writeFile(join(stranger, 'SKILL.md'), 'user-owned, not a placement');
    await writeFile(join(oldPath, 'SKILL.md'), skill('hand edit'));
    await git(['fetch', '-q', 'origin'], fixture.seed); await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    await cp(join(fixture.seed, 'skills', 'sample'), join(fixture.seed, 'skills', 'renamed'), { recursive: true });
    await rm(join(fixture.seed, 'skills', 'sample'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'renamed', 'SKILL.md'), skill('renamed').replace('name: sample', 'name: renamed'));
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'rename sample'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    // Twice: the second run must find the same state and report the same block, not a wedged ledger.
    for (const attempt of [1, 2]) {
      const io = new ScriptedPrompter();
      expect(await run({ config: store }, io), `attempt ${attempt}`).toMatchObject({ ok: true, value: { placed: 0 } });
      expect(io.lines.filter((line) => line.startsWith(`Blocked ${oldPath}: ${stranger} already exists`)), `attempt ${attempt}`).toHaveLength(1);
      expect(await readFile(join(oldPath, 'SKILL.md'), 'utf8')).toContain('description: hand edit');
      expect(await readFile(join(stranger, 'SKILL.md'), 'utf8')).toBe('user-owned, not a placement');
      await expect(access(join(store.root, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(Object.keys((await store.read()).placements)).toEqual([oldPath]);
    }
  });

  it('defers consent for a noninteractive-shaped interactive call without emitting hook stdout', async () => {
    const setup = await configuredToolSkill();
    await pushFromSeed(setup.fixture.seed, 'skills/sample/SKILL.md', toolSkill('widened', ['Bash(*)']));
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ config: setup.store }, io as never);
    expect(result).toMatchObject({ ok: true, value: { hook: false, deferred: ['sample'], placed: 0 } });
    expect(io.lines.join('\n')).not.toContain('hookSpecificOutput');
    expect(io.lines.join('\n')).toContain('1 skills need review');
    expect(await readFile(join(setup.home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: old');
  });

  it('returns local-change notices in hook mode while keeping stdout limited to reload output', async () => {
    const orphan = await orphanedPlacement(true);
    await writeFile(join(orphan.path, 'SKILL.md'), skill('hand edit'));
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ hook: true, config: orphan.store }, io);
    expect(result).toMatchObject({ ok: true, value: { notices: [expect.stringContaining(orphan.path)] } });
    expect(io.lines).toEqual(['{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}']);
  });

  it('replays a pending uninstall in hook mode with its quarantine line on notices, never on stdout', async () => {
    const orphan = await orphanedPlacement(true);
    await writeFile(join(orphan.path, 'SKILL.md'), skill('hand edit'));
    await orphan.store.update((config) => { config.pending.push({ op: 'uninstall', id: ID, team: 'team', scope: { kind: 'global' }, started: '2026-09-05T00:00:00Z' }); });
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ hook: true, config: orphan.store }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.placed).toBe(0);
    expect(result.value.notices.some((line) => line.startsWith(`Local changes at ${orphan.path} moved to `))).toBe(true);
    expect(io.lines).toEqual([]);
    expect((await orphan.store.read()).pending).toEqual([]);
    expect((await orphan.store.read()).placements).toEqual({});
    expect(JSON.parse(await readFile(join(orphan.clone, 'people', 'seed.json'), 'utf8')).installed).toEqual([]);
  });

  it('replays a pending install in hook mode with its placement notice on notices, stdout holding the reload directive alone', async () => {
    const { fixture, store, clone } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { project: { remotes: [fixture.bare], skills: [ID] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    await store.update((config) => { config.pending.push({ op: 'install', id: ID, team: 'team', version: null, scope: { kind: 'project', project: 'project' }, started: '2026-09-04T00:00:00Z' }); });
    const runner = wrapRunner(systemRunner, async (command, args, _options, next) => command === 'git' && args[0] === 'rev-parse' && args.includes('info/exclude') ? { code: 1, stdout: '', stderr: 'no exclude here' } : next());
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ hook: true, config: store, runner, cwd: clone }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.placed).toBe(1);
    expect(result.value.notices.some((line) => line.includes('could not add .claude/skills/sample to .git/info/exclude') && line.includes('no exclude here'))).toBe(true);
    expect(io.lines).toEqual(['{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}']);
    expect((await store.read()).pending).toHaveLength(0);
  });

  it('leaves a project pending install deferred outside its worktree — without stamping, so the next session inside the checkout is not rate-limited — and replays it inside', async () => {
    const { fixture, store, clone } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { project: { remotes: [fixture.bare], skills: [ID] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    await store.update((config) => { config.pending.push({ op: 'install', id: ID, team: 'team', version: null, scope: { kind: 'project', project: 'project' }, started: '2026-09-04T00:00:00Z' }); });
    const outside = await temporaryDirectory();
    const hook: NonInteractivePrompter = { interactive: false, print: () => undefined };
    expect(await run({ hook: true, config: store, cwd: outside }, hook)).toMatchObject({ ok: true, value: { deferred: [expect.stringContaining('project')] } });
    expect((await store.read()).pending).toHaveLength(1);
    // §8: the deferral left the stamp unwritten, so the hook run five minutes later — in the checkout the
    // deferral was waiting for — really runs instead of being an hourly no-op.
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await run({ hook: true, config: store, cwd: clone }, hook)).toMatchObject({ ok: true, value: { placed: 1, deferred: [] } });
    expect((await store.read()).pending).toHaveLength(0);
    expect(await readFile(join(clone, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: old');
    await expect(access(stampPath(store.root, 'team'))).resolves.toBeUndefined();
  });

  it('classifies an update as available and re-places into the ledger-recorded target', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    const before = (await store.read()).placements[path]!.fingerprint;
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    const io = new ScriptedPrompter();
    const result = await run({ config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { placed: 1, changed: true } });
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('description: new');
    expect((await store.read()).placements[path]!.fingerprint).not.toBe(before);
    expect(io.lines.at(-1)).toBe('Sync complete: team — 1 updated.');
  });

  it('leaves an up-to-date placement untouched and reports that nothing needs doing', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    const fingerprint = (await store.read()).placements[path]!.fingerprint;
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, changed: false } });
    expect((await store.read()).placements[path]!.fingerprint).toBe(fingerprint);
    expect(io.lines).toEqual(['Sync complete: nothing to do (team up to date, 1 skill).']);
  });

  it('reports a deleted repository skill as blocked without touching its placement or ledger', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    const before = await readFile(join(path, 'SKILL.md'), 'utf8');
    const ledger = JSON.stringify((await store.read()).placements);
    await git(['fetch', '-q', 'origin'], fixture.seed); await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    await git(['rm', '-qr', 'skills/sample'], fixture.seed); await git(['commit', '-q', '-m', 'remove sample'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const interactive = new ScriptedPrompter();
    expect(await run({ config: store }, interactive)).toMatchObject({ ok: true, value: { placed: 0, deferred: [], notices: [expect.stringContaining('Blocked')] } });
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe(before);
    expect(JSON.stringify((await store.read()).placements)).toBe(ledger);
    // Reported, not counted: nothing a later run does can clear a skill deleted upstream, so the team is
    // not held unsynced forever and no `run sync` that cannot help is advertised.
    await expect(access(stampPath(store.root, 'team'))).resolves.toBeUndefined();
    const hook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: store, now: later }, hook)).toMatchObject({ ok: true, value: { deferred: [], notices: [expect.stringContaining('Blocked')] } });
    expect(hook.lines).toEqual([]);
  });

  it('quarantines and overwrites a hand-edited placement without losing the edit', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    await writeFile(join(path, 'SKILL.md'), skill('hand edit'));
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 1, changed: true } });
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('description: old');
    const quarantine = join(store.root, 'quarantine');
    const snapshots = await readdir(quarantine, { recursive: true });
    expect(snapshots.some((item) => item.endsWith('sample/SKILL.md'))).toBe(true);
    const copied = await Promise.all(snapshots.filter((item) => item.endsWith('sample/SKILL.md')).map((item) => readFile(join(quarantine, item), 'utf8')));
    expect(copied.join('\n')).toContain('description: hand edit');
    expect(io.lines.some((line) => line.includes('Local changes at'))).toBe(true);
  });

  it('leaves a hand-edited project placement untouched outside its checkout, then repairs it in that checkout', async () => {
    const fixture = await bareTeam();
    const product = await bareTeam();
    const id = '99999999-9999-4999-8999-999999999999';
    await pushFromSeed(fixture.seed, 'skills/projected/SKILL.md', `---\nname: projected\ndescription: projected\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [product.bare], skills: [id] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const checkoutA = await cloneWithIdentity(product.bare, join(product.root, 'checkout-a'));
    const checkoutB = await cloneWithIdentity(product.bare, join(product.root, 'checkout-b'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ kind: 'project', project: 'product', config: store, home, cwd: checkoutA }, new ScriptedPrompter())).ok).toBe(true);
    expect((await install({ kind: 'project', project: 'product', config: store, home, cwd: checkoutB }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(checkoutA, '.claude', 'skills', 'projected', 'SKILL.md');
    await writeFile(path, 'hand-edited placement');
    const ledgerBefore = JSON.stringify((await store.read()).placements);
    const outside = await temporaryDirectory('terum-unrelated-sync-');
    expect((await run({ config: store, cwd: outside }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('hand-edited placement');
    await expect(access(join(store.root, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.stringify((await store.read()).placements)).toBe(ledgerBefore);

    expect((await run({ config: store, cwd: checkoutA }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toContain('description: projected');
    expect((await readdir(join(store.root, 'quarantine'), { recursive: true })).some((entry) => entry.endsWith('projected/SKILL.md'))).toBe(true);
  });

  it('normalizes reordered grants but defers an added or widened grant in hook mode', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('old', ['Bash(ls)', 'Read(*)']));
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample', 'SKILL.md');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('reordered', ['Read(*)', 'Bash(ls)', 'Bash(ls)']));
    const reordered = new ScriptedPrompter();
    expect(await run({ config: store }, reordered)).toMatchObject({ ok: true, value: { placed: 1, deferred: [] } });
    expect(reordered.asked).toEqual([]);
    expect(await readFile(path, 'utf8')).toContain('description: reordered');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('widened', ['Bash(*)', 'Read(*)']));
    const hook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: store, now: later }, hook)).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(hook.lines).toEqual([]);
    expect(await readFile(path, 'utf8')).toContain('description: reordered');
  });

  it('reviews an added tool interactively and defers it unchanged in hook mode', async () => {
    const accepted = await configuredToolSkill();
    await pushFromSeed(accepted.fixture.seed, 'skills/sample/SKILL.md', toolSkill('added', ['Bash(ls)', 'Read(*)']));
    const approved = new ScriptedPrompter([], [true], true);
    expect(await run({ config: accepted.store }, approved)).toMatchObject({ ok: true, value: { placed: 1, deferred: [] } });
    expect(approved.lines.join('\n')).not.toContain('allowed-tools changed');
    expect(approved.details['Approve updated tools for sample?']).toEqual(['allowed-tools changed for sample:', 'Bash(ls)', 'Read(*)']);
    expect(await readFile(join(accepted.home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: added');
    expect((await accepted.store.read()).approvals[ID]!.grants).not.toBe(accepted.oldApproval);

    const declined = await configuredToolSkill();
    await pushFromSeed(declined.fixture.seed, 'skills/sample/SKILL.md', toolSkill('added', ['Bash(ls)', 'Read(*)']));
    expect(await run({ config: declined.store }, new ScriptedPrompter([], [false], true))).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(await readFile(join(declined.home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: old');
    expect((await declined.store.read()).approvals[ID]!.grants).toBe(declined.oldApproval);
    const hook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: declined.store, now: later }, hook)).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(hook.lines).toEqual([]);
  });

  it('never treats an unrelated same-name folder as provenance and prunes only quarantine entries', async () => {
    const { fixture, store } = await configuredSkill();
    const unrelated = join(fixture.root, 'home', '.claude', 'skills', 'sample');
    await mkdir(unrelated, { recursive: true }); await writeFile(join(unrelated, 'SKILL.md'), 'user-owned');
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(unrelated, 'SKILL.md'), 'utf8')).toBe('user-owned');
    const outside = join(fixture.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'precious');
    const quarantined = join(store.root, 'quarantine', 'stamp'); await mkdir(quarantined, { recursive: true }); await writeFile(join(quarantined, 'old'), 'old');
    await symlink(outside, join(store.root, 'quarantine', 'escape'));
    const io = new ScriptedPrompter([], [true], true);
    expect((await run({ prune: true, config: store }, io)).ok).toBe(true);
    expect(io.lines).toEqual(expect.arrayContaining([quarantined, join(store.root, 'quarantine', 'escape')]));
    await expect(access(quarantined)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('precious');
    expect(await readFile(join(unrelated, 'SKILL.md'), 'utf8')).toBe('user-owned');
  });

  it('reports the exact plural prune verdict and changed result after deleting two entries', async () => {
    const { store } = await configuredSkill();
    await mkdir(join(store.root, 'quarantine', 'first'), { recursive: true });
    await mkdir(join(store.root, 'quarantine', 'second'), { recursive: true });
    const io = new ScriptedPrompter([], [true], true);
    expect(await run({ prune: true, config: store }, io)).toMatchObject({ ok: true, value: { changed: true } });
    expect(io.lines.at(-1)).toBe('Deleted 2 quarantined items.');
  });

  it('reports the truthful prune verdict for an empty quarantine and a declined confirmation', async () => {
    const empty = await configuredSkill();
    const emptyIo = new ScriptedPrompter([], [], true);
    expect(await run({ prune: true, config: empty.store }, emptyIo)).toMatchObject({ ok: true, value: { changed: false } });
    expect(emptyIo.lines).toEqual(['Quarantine is empty.']);

    const declined = await configuredSkill();
    const entry = join(declined.store.root, 'quarantine', 'keep');
    await mkdir(entry, { recursive: true });
    const declinedIo = new ScriptedPrompter([], [false], true);
    expect(await run({ prune: true, config: declined.store }, declinedIo)).toMatchObject({ ok: true, value: { changed: false } });
    expect(declinedIo.lines.at(-1)).toBe('Prune cancelled; nothing deleted.');
  });

  it('continues a partial prune, reports the first failed path, and exits through execute', async () => {
    const { store } = await configuredSkill();
    const first = join(store.root, 'quarantine', 'first'); const second = join(store.root, 'quarantine', 'second');
    await mkdir(first, { recursive: true }); await mkdir(second, { recursive: true });
    (globalThis as { terumPruneFailurePath?: string }).terumPruneFailurePath = second;
    try {
      const io = new ScriptedPrompter([], [true], true);
      const result = await run({ prune: true, config: store }, io);
      expect(result).toMatchObject({ ok: false, error: `Deleted 1 of 2 quarantined item(s); could not delete ${second}: deliberately undeletable`, value: { changed: true, teams: [] } });
      const errors: string[] = []; const codes: number[] = [];
      await createExecute({ io, stderr: (line) => errors.push(line), setExitCode: (code) => codes.push(code) })(async () => result, { verb: 'sync', notices: false });
      expect(errors).toEqual([`Deleted 1 of 2 quarantined item(s); could not delete ${second}: deliberately undeletable`]);
      expect(codes).toEqual([1]);
    } finally { delete (globalThis as { terumPruneFailurePath?: string }).terumPruneFailurePath; }
  });

  it('counts a pending install once by its ledger path, whether it is new or already placed', async () => {
    const fresh = await configuredSkill();
    await fresh.store.update((config) => { config.pending.push({ op: 'install', id: ID, team: 'team', version: null, scope: { kind: 'global' }, started: '2026-09-08T00:00:00Z' }); });
    const freshResult = await run({ config: fresh.store }, new ScriptedPrompter());
    expect(freshResult).toMatchObject({ ok: true, value: { teams: [{ team: 'team', state: 'complete', counts: { placed: 1, unchanged: 0 } }] } });

    const existing = await configuredSkill();
    expect((await install({ ref: 'sample', config: existing.store }, new ScriptedPrompter())).ok).toBe(true);
    await existing.store.update((config) => { config.pending.push({ op: 'install', id: ID, team: 'team', version: null, scope: { kind: 'global' }, started: '2026-09-08T00:00:00Z' }); });
    const existingResult = await run({ config: existing.store }, new ScriptedPrompter());
    expect(existingResult).toMatchObject({ ok: true, value: { teams: [{ team: 'team', state: 'complete', counts: { updated: 1 } }] } });
  });

  it('counts pending uninstalls by the number of matching placements, including zero', async () => {
    const zero = await configuredSkill();
    await zero.store.update((config) => { config.pending.push({ op: 'uninstall', id: ID, team: 'team', scope: { kind: 'global' }, started: '2026-09-08T00:00:00Z' }); });
    expect(await run({ config: zero.store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { teams: [{ state: 'complete', counts: { removed: 0 } }] } });

    const two = await orphanedPlacement(true);
    const second = join(two.home, '.claude', 'skills', 'sample-copy');
    await cp(two.path, second, { recursive: true });
    const snapshot = await snapshotSkillDirectory(second);
    await two.store.update((config) => {
      config.placements[second] = { ...config.placements[two.path]!, fingerprint: snapshot.fingerprint };
      config.pending.push({ op: 'uninstall', id: ID, team: 'team', scope: { kind: 'global' }, started: '2026-09-08T00:00:00Z' });
    });
    expect(await run({ config: two.store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { teams: [{ state: 'complete', counts: { removed: 2 } }] } });
  });

  // legacy: two teams bound before the one-team rule (2026-09-08); reads/syncs keep working
  it('prints each healthy configured team followed by the complete summary', async () => {
    const { store } = await configuredSkill();
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { teams: [{ team: 'team', state: 'complete' }, { team: 'other', state: 'complete' }] } });
    expect(io.lines).toEqual(['team: up to date (0 skills)', 'other: up to date (0 skills)', 'Sync complete.']);
  });

  it('withholds only the deferred team stamp and uses the review cue even for one skill', async () => {
    const { fixture, store } = await configuredToolSkill();
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('widened', ['Bash(*)']));
    const io = new ScriptedPrompter([], [], false);
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { teams: [{ team: 'team', state: 'incomplete', review: ['sample'] }, { team: 'other', state: 'complete' }] } });
    expect(io.lines.at(-1)).toBe('Sync incomplete: 1 skills need review (sample).');
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stampPath(store.root, 'other'))).resolves.toBeUndefined();
  });

  it('names a skipped endorsed batch as unfinished work and leaves its stamp unwritten', async () => {
    const { fixture, store } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'team.json', '{not json}\n');
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { teams: [{ state: 'incomplete', review: [], blocked: [], pendingLeft: 0 }] } });
    expect(io.lines.at(-1)).toBe('Sync incomplete: team has unfinished work (endorsed batch skipped) — see the lines above.');
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('makes a pending install recorded after replay visible in the verdict and withholds the stamp', async () => {
    const { store } = await configuredSkill();
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    let fetches = 0;
    const runner = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2) await store.update((config) => { config.pending.push({ op: 'install', id: ID, team: 'team', version: null, scope: { kind: 'global' }, started: '2026-09-08T00:00:00Z' }); });
      return next();
    });
    const io = new ScriptedPrompter();
    const result = await run({ config: store, runner }, io);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.teams[0]).toMatchObject({ team: 'team', state: 'incomplete', pendingLeft: 1 });
    expect(io.lines.at(-1)).toBe('Sync incomplete: team still has 1 pending install; run sync again.');
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('prefixes an interactive stamp-write failure and routes it through execute', async () => {
    const { store } = await configuredSkill();
    await mkdir(stampPath(store.root, 'team'), { recursive: true });
    const result = await run({ config: store }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^Sync failed: /) });
    expect(result.value).toBeUndefined();
    if (result.ok) throw new Error('stamp write unexpectedly succeeded');
    const errors: string[] = []; const codes: number[] = [];
    await createExecute({ io: new ScriptedPrompter(), stderr: (line) => errors.push(line), setExitCode: (code) => codes.push(code) })(async () => result, { verb: 'sync', notices: false });
    expect(errors).toEqual([result.error]);
    expect(codes).toEqual([1]);
  });

  it('keeps interactive consent deferrals off hook stdout and labels a TTY decline for review', async () => {
    const nonTty = await configuredToolSkill();
    await pushFromSeed(nonTty.fixture.seed, 'skills/sample/SKILL.md', toolSkill('widened', ['Bash(*)']));
    const nonTtyIo: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ config: nonTty.store }, nonTtyIo as never)).toMatchObject({ ok: true, value: { deferred: ['sample'] } });
    expect(nonTtyIo.lines.join('\n')).not.toContain('hookSpecificOutput');
    expect(nonTtyIo.lines.join('\n')).toContain('1 skills need review');

    const tty = await configuredToolSkill();
    await pushFromSeed(tty.fixture.seed, 'skills/sample/SKILL.md', toolSkill('widened', ['Bash(*)']));
    const ttyIo = new ScriptedPrompter([], [false], true);
    expect(await run({ config: tty.store }, ttyIo)).toMatchObject({ ok: true, value: { deferred: ['sample'] } });
    expect(ttyIo.lines.join('\n')).toContain('1 skills need review');
  });

  it('ends a shared-source divergence with the incomplete verdict after its remedy line', async () => {
    const { fixture, store, source } = await sharedSyncFixture();
    await writeFile(join(source, 'SKILL.md'), (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: shared source', 'description: local'));
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: shared source', 'description: remote'));
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { teams: [{ state: 'incomplete', review: ['sample'] }] } });
    expect(io.lines.at(-2)).toContain('connect --keep-source');
    expect(io.lines.at(-2)).toContain('connect --keep-repo');
    expect(io.lines.at(-1)).toBe('Sync incomplete: 1 skills need review (sample) — see the lines above for each remedy.');
  });

  it('prints no successful verdict when one team is unreachable but another is healthy', async () => {
    const { fixture, store } = await configuredSkill();
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.team!.remote = 'github.com/acme/team'; config.teams.other = { remote: other.bare, handle: 'seed' }; });
    const remote = 'https://github.com/acme/team.git';
    const runner = wrapRunner(mappedRunner(remote, fixture.bare), async (command, args, options, next) => command === 'git' && args[0] === 'fetch' && options?.cwd === store.teamClone('team') ? { code: 128, stdout: '', stderr: 'remote: Repository not found.' } : next());
    const io = new ScriptedPrompter();
    const result = await run({ config: store, runner }, io);
    expect(result).toMatchObject({ ok: false, error: 'Sync finished with 1 team(s) skipped: team. See the notices above.' });
    expect(io.lines).toContain('other: up to date (0 skills)');
    expect(io.lines.join('\n')).not.toContain('Sync complete');
  });

  it('keeps hook stdout to reload output and never puts verdicts in shared-sync notices', async () => {
    const pushOnly = await sharedSyncFixture();
    await writeFile(join(pushOnly.source, 'SKILL.md'), (await readFile(join(pushOnly.source, 'SKILL.md'), 'utf8')).replace('description: shared source', 'description: local edit'));
    const quiet: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const quietResult = await run({ hook: true, config: pushOnly.store }, quiet);
    expect(quietResult).toMatchObject({ ok: true, value: { changed: true, teams: [{ state: 'complete', shared: { pushed: 1 } }] } });
    expect(quiet.lines).toEqual([]);
    expect(quietResult.value!.notices.filter((line) => line.startsWith('Sync '))).toEqual([]);

    const both = await sharedSyncFixture();
    expect((await install({ ref: 'sample', config: both.store }, new ScriptedPrompter())).ok).toBe(true);
    await writeFile(join(both.source, 'SKILL.md'), (await readFile(join(both.source, 'SKILL.md'), 'utf8')).replace('description: shared source', 'description: local edit'));
    const directive: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const directiveResult = await run({ hook: true, config: both.store }, directive);
    expect(directiveResult).toMatchObject({ ok: true, value: { changed: true, placed: 1, teams: [{ state: 'complete', shared: { pushed: 1 } }] } });
    expect(directive.lines).toEqual(['{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}']);
    expect(directiveResult.value!.notices.filter((line) => line.startsWith('Sync '))).toEqual([]);
  });

  it('reports a pushed shared edit as a completed, stamped interactive sync', async () => {
    const { store, source } = await sharedSyncFixture();
    await writeFile(join(source, 'SKILL.md'), (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: shared source', 'description: local edit'));
    const io = new ScriptedPrompter();
    const result = await run({ config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { changed: true, teams: [{ team: 'team', state: 'complete', shared: { pushed: 1 } }] } });
    expect(io.lines.at(-1)).toBe('Sync complete: team — 1 shared edit pushed.');
    await expect(access(stampPath(store.root, 'team'))).resolves.toBeUndefined();
  });

  it('counts interactive orphan adoption and decline as changes in their terminal categories', async () => {
    const adopted = await orphanedPlacement();
    expect(await run({ config: adopted.store }, new ScriptedPrompter([], [true], true))).toMatchObject({ ok: true, value: { changed: true, teams: [{ state: 'complete', counts: { adopted: 1 } }] } });
    const declined = await orphanedPlacement();
    expect(await run({ config: declined.store }, new ScriptedPrompter([], [false], true))).toMatchObject({ ok: true, value: { changed: true, teams: [{ state: 'complete', counts: { declined: 1 } }] } });
  });
});

async function orphanedPlacement(installed = false) {
  const prepared = await configuredSkill();
  const home = join(prepared.fixture.root, 'home');
  const path = join(home, '.claude', 'skills', 'sample');
  await mkdir(join(home, '.claude', 'skills'), { recursive: true });
  await cp(join(prepared.clone, 'skills', 'sample'), path, { recursive: true });
  const snapshot = await snapshotSkillDirectory(path);
  if (installed) await pushFromSeed(prepared.fixture.seed, 'people/seed.json', `${JSON.stringify(person('seed', { installed: [{ id: ID, version: null, scope: { kind: 'global' }, since: '2026-09-04' }] }), null, 2)}\n`);
  await prepared.store.update((config) => { config.placements[path] = { id: ID, team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-09-04', fingerprint: snapshot.fingerprint }; });
  return { ...prepared, home, path };
}

async function configuredToolSkill() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('old', ['Bash(ls)']));
  const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
  return { fixture, store, home, oldApproval: (await store.read()).approvals[ID]!.grants };
}

describe('sync --hook mutex and rate limit (§8, §12 "hook mutex")', () => {
  const hookIo = (): NonInteractivePrompter & { lines: string[] } => ({ interactive: false, lines: [], print(line) { this.lines.push(line); } });
  const head = async (clone: string) => (await git(['rev-parse', 'HEAD'], clone)).trim();
  async function deadPid(): Promise<number> {
    const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
    const pid = child.pid!;
    await new Promise((done) => child.on('close', done));
    return pid;
  }

  it('a second hook racing on the same team exits 0 in silence and touches nothing; another host\'s lock is respected; a dead pid\'s lock is recovered and the sync proceeds', async () => {
    const { fixture, store, clone } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    const before = await head(clone);
    const release = await acquireTeamLock(store.root, 'team');
    expect(release).not.toBeNull();
    try {
      const io = hookIo();
      expect(await run({ hook: true, config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, deferred: [], notices: [] } });
      expect(io.lines).toEqual([]);
      expect(await head(clone)).toBe(before);
      await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(lockPath(store.root, 'team'))).resolves.toBeUndefined();
    } finally { await release!(); }
    await writeFile(lockPath(store.root, 'team'), JSON.stringify({ pid: process.pid, host: 'another-machine', started: new Date().toISOString() }));
    expect(await run({ hook: true, config: store }, hookIo())).toMatchObject({ ok: true, value: { placed: 0, notices: [] } });
    expect(await head(clone)).toBe(before);
    await writeFile(lockPath(store.root, 'team'), JSON.stringify({ pid: await deadPid(), host: hostname(), started: new Date().toISOString() }));
    expect(await run({ hook: true, config: store }, hookIo())).toMatchObject({ ok: true });
    expect(await head(clone)).not.toBe(before);
    await expect(access(lockPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stampPath(store.root, 'team'))).resolves.toBeUndefined();
  });

  // legacy: two teams bound before the one-team rule (2026-09-08); reads/syncs keep working
  it('two teams do not serialize: a held lock on one team leaves the other fully synced and stamped', async () => {
    const { fixture, store, clone } = await configuredSkill();
    const other = await bareTeam();
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', skill('other team').replace('name: sample', 'name: elsewhere'));
    const otherClone = await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', skill('other team moved').replace('name: sample', 'name: elsewhere'));
    const before = await head(clone); const otherBefore = await head(otherClone);
    const release = await acquireTeamLock(store.root, 'team');
    try {
      expect(await run({ hook: true, config: store }, hookIo())).toMatchObject({ ok: true, value: { notices: [] } });
      expect(await head(clone)).toBe(before);
      expect(await head(otherClone)).not.toBe(otherBefore);
      await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(stampPath(store.root, 'other'))).resolves.toBeUndefined();
      await expect(access(lockPath(store.root, 'other'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await release!(); }
  });

  it('is a silent no-op within an hour of the last successful sync, never rate-limits an interactive sync, and runs again after the hour', async () => {
    const { fixture, store, clone } = await configuredSkill();
    expect(await run({ hook: true, config: store }, hookIo())).toMatchObject({ ok: true });
    await expect(access(stampPath(store.root, 'team'))).resolves.toBeUndefined();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    const before = await head(clone);
    let fetches = 0;
    const counting = wrapRunner(systemRunner, async (command, args, _options, next) => { if (command === 'git' && args[0] === 'fetch') fetches++; return next(); });
    const io = hookIo();
    expect(await run({ hook: true, config: store, runner: counting }, io)).toMatchObject({ ok: true, value: { placed: 0, notices: [] } });
    expect(io.lines).toEqual([]);
    expect(fetches).toBe(0);
    expect(await head(clone)).toBe(before);
    expect((await run({ config: store, runner: counting }, new ScriptedPrompter())).ok).toBe(true);
    expect(fetches).toBe(1);
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('newer'));
    expect(await run({ hook: true, config: store, runner: counting, now: () => Date.now() + 2 * 3_600_000 }, hookIo())).toMatchObject({ ok: true });
    expect(fetches).toBe(2);
    expect(await head(clone)).not.toBe(before);
  });

  it('leaves a skipped team\'s orphans alone: neither the hourly no-op nor a held mutex reads its clone or defers', async () => {
    const orphan = await orphanedPlacement();
    expect(await run({ hook: true, config: orphan.store }, hookIo())).toMatchObject({ ok: true, value: { deferred: ['sample'] } });
    // The deferral left no stamp (§8); a stamp from a run that did finish makes the next hour a no-op —
    // the orphan pass included, so nothing is deferred and createExecute prints no "needs review" line.
    await writeFile(stampPath(orphan.store.root, 'team'), new Date().toISOString());
    expect(await run({ hook: true, config: orphan.store }, hookIo())).toMatchObject({ ok: true, value: { deferred: [], notices: [] } });
    const release = await acquireTeamLock(orphan.store.root, 'team');
    try {
      expect(await run({ hook: true, config: orphan.store, now: later }, hookIo())).toMatchObject({ ok: true, value: { deferred: [], notices: [] } });
    } finally { await release!(); }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a lock file this process cannot read costs exactly that team, reported, and the other team still syncs and stamps', async () => {
    const { fixture, store, clone } = await configuredSkill();
    const other = await bareTeam();
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', skill('other team').replace('name: sample', 'name: elsewhere'));
    const otherClone = await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    await pushFromSeed(other.seed, 'skills/elsewhere/SKILL.md', skill('other team moved').replace('name: sample', 'name: elsewhere'));
    const before = await head(clone); const otherBefore = await head(otherClone);
    await mkdir(join(store.root, 'run'), { recursive: true });
    await writeFile(lockPath(store.root, 'team'), JSON.stringify({ pid: process.pid, host: hostname(), started: new Date().toISOString() }));
    await chmod(lockPath(store.root, 'team'), 0o000);
    try {
      const io = hookIo();
      expect(await run({ hook: true, config: store }, io)).toMatchObject({ ok: true, value: { notices: [expect.stringMatching(/^Skipping team: /)] } });
      expect(io.lines).toEqual([]);
      expect(await head(clone)).toBe(before);
      expect(await head(otherClone)).not.toBe(otherBefore);
      await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(stampPath(store.root, 'other'))).resolves.toBeUndefined();
    } finally { await chmod(lockPath(store.root, 'team'), 0o600); }
  });

  it('stamps only what this run saw finish: a team bound mid-run is not stamped, and a pending entry recorded after a team\'s replay withholds its stamp', async () => {
    const { store } = await configuredSkill();
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    const late = await bareTeam();
    await cloneWithIdentity(late.bare, store.teamClone('late'));
    let fetches = 0;
    const midRun = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch') {
        fetches++;
        // During team's fetch a third team is bound; during other's fetch — team's replay is already done — an install is recorded for team.
        if (fetches === 1) await store.update((config) => { config.teams.late = { remote: late.bare, handle: 'seed' }; });
        if (fetches === 2) await store.update((config) => { config.pending.push({ op: 'install', id: ID, team: 'team', version: null, scope: { kind: 'global' }, started: new Date().toISOString() }); });
      }
      return next();
    });
    expect(await run({ hook: true, config: store, runner: midRun }, hookIo())).toMatchObject({ ok: true, value: { notices: [] } });
    await expect(access(stampPath(store.root, 'other'))).resolves.toBeUndefined();
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stampPath(store.root, 'late'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never stamps a team removed mid-run: the stamp a concurrent teardown swept is not re-created (§8)', async () => {
    const { store } = await configuredSkill();
    const other = await bareTeam();
    await cloneWithIdentity(other.bare, store.teamClone('other'));
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    await mkdir(join(store.root, 'run'), { recursive: true });
    await writeFile(stampPath(store.root, 'team'), new Date().toISOString());
    let fetches = 0;
    // A teardown that lands while the run walks its snapshot — during other's fetch, team's walk already
    // done — unbinds team and sweeps run/team.stamp. Re-creating that stamp would rate-limit the first
    // hook sync after a `team join team` into a silent no-op for the rest of the hour.
    const midRun = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2) { await store.update((config) => { delete config.teams.team; }); await removeRunArtifacts(store.root, 'team'); }
      return next();
    });
    expect((await run({ config: store, runner: midRun }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(stampPath(store.root, 'other'))).resolves.toBeUndefined();
    await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a failed hook sync releases the mutex and leaves the old stamp, so the next session retries', async () => {
    const { store } = await configuredSkill();
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    const stamp = stampPath(store.root, 'team');
    await writeFile(stamp, 'old');
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    await utimes(stamp, twoHoursAgo, twoHoursAgo);
    const failing = wrapRunner(systemRunner, async (command, args, _options, next) => (command === 'git' && args[0] === 'fetch' ? { code: 1, stdout: '', stderr: 'failed' } : next()));
    expect((await run({ hook: true, config: store, runner: failing }, hookIo())).ok).toBe(false);
    expect(await readFile(stamp, 'utf8')).toBe('old');
    await expect(access(lockPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('sync --hook keeps shared-source reconciliation off stdout (§8)', () => {
  it('reports a missing shared source through notices, never through the hook stdout', async () => {
    const { fixture, store } = await configuredSkill();
    await store.update((config) => { config.shared[ID] = { source: join(fixture.root, 'gone'), team: 'team', baseline: 'sha256:0' }; });
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ hook: true, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { notices: [expect.stringContaining('missing')] } });
    expect(io.lines).toEqual([]);
  });
});

describe('release maintenance after sync', () => {
  async function releaseFixture(remote = 'https://github.com/acme/skills.git') {
    const fixture = await bareTeam(); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote, handle: 'seed' }; });
    const { denyingRunner } = await import('../../lib/__tests__/fixtures.js');
    let probes = 0;
    const runner = denyingRunner([
      ...['fetch', 'reset', 'merge', 'rev-parse', 'status', 'config', 'ls-tree', 'show', 'diff', 'log', 'cat-file', 'symbolic-ref'].map((verb) => ({ command: 'git' as const, argsPrefix: [verb] })),
      { command: 'git', argsPrefix: ['-c', `url.${fixture.bare}.insteadOf=${fixture.bare}`, 'ls-remote', '--tags', '--', fixture.bare], respond: async () => {
        probes++; await expect(access(lockPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
        return { code: 0, stdout: `${'a'.repeat(40)}\trefs/tags/v0.1.2\n`, stderr: '' };
      } },
    ], systemRunner);
    return { fixture, store, runner, probes: () => probes };
  }
  it('probes once per day for interactive GitHub teams, only after all team locks are released', async () => {
    const f = await releaseFixture(); let now = Date.now();
    const args = { config: f.store, runner: f.runner, upstream: f.fixture.bare, probe: 'github-teams' as const, now: () => now };
    expect((await run(args, new ScriptedPrompter([], [], true))).ok).toBe(true);
    expect((await run(args, new ScriptedPrompter([], [], true))).ok).toBe(true); expect(f.probes()).toBe(1);
    now += 25 * 3600000; expect((await run(args, new ScriptedPrompter([], [], true))).ok).toBe(true); expect(f.probes()).toBe(2);
  });
  it('probes the approved upstream under the shipped default policy when no override is passed (RELEASE_PROBE_POLICY governs)', async () => {
    const { denyingRunner } = await import('../../lib/__tests__/fixtures.js');
    const { APPROVED_UPSTREAM } = await import('../../lib/package.js');
    const fixture = await bareTeam(); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: 'https://github.com/acme/skills.git', handle: 'seed' }; });
    let probes = 0;
    const runner = denyingRunner([
      ...['fetch', 'reset', 'merge', 'rev-parse', 'status', 'config', 'ls-tree', 'show', 'diff', 'log', 'cat-file', 'symbolic-ref'].map((verb) => ({ command: 'git' as const, argsPrefix: [verb] })),
      { command: 'git', argsPrefix: ['-c', `url.${APPROVED_UPSTREAM}.insteadOf=${APPROVED_UPSTREAM}`, 'ls-remote', '--tags', '--', APPROVED_UPSTREAM], respond: async () => { probes++; return { code: 0, stdout: `${'a'.repeat(40)}\trefs/tags/v0.1.2\n`, stderr: '' }; } },
    ], systemRunner);
    expect((await run({ config: store, runner }, new ScriptedPrompter([], [], true))).ok).toBe(true);
    expect(probes).toBe(1);
    expect(JSON.parse(await readFile(join(store.root, 'run/latest-version.json'), 'utf8')).advertisement).toMatchObject({ version: '0.1.2', source: 'git-tags' });
  });
  it.each(['generic', 'nobody', 'hook', 'prune', 'noninteractive', 'opt-out'])('never probes %s but still records running', async (mode) => {
    const f = await releaseFixture(mode === 'generic' ? 'https://git.example.com/acme/skills.git' : undefined);
    const io = new ScriptedPrompter([], [], mode !== 'noninteractive');
    expect((await run({ config: f.store, runner: f.runner, upstream: f.fixture.bare, hook: mode === 'hook', prune: mode === 'prune', noUpdateCheck: mode === 'opt-out', probe: mode === 'nobody' ? 'nobody' : 'github-teams' }, io)).ok).toBe(true);
    expect(f.probes()).toBe(0);
    const state = JSON.parse(await readFile(join(f.store.root, 'run/latest-version.json'), 'utf8'));
    expect(state.running.version).toBeTruthy(); if (mode === 'hook') expect(io.lines).toEqual([]);
  });
  it('records hook npx-latest evidence locally and preserves empty stdout', async () => {
    const { denyingRunner } = await import('../../lib/__tests__/fixtures.js');
    const root = await temporaryDirectory(); const store = createConfigStore(join(root, 'state')); const cacheDir = join(root, '_npx/hash'); const manifest = join(cacheDir, 'node_modules/terum-skills/package.json');
    await mkdir(join(manifest, '..'), { recursive: true }); await writeFile(manifest, JSON.stringify({ name: 'terum-skills', version: '0.1.1' }));
    await writeFile(join(cacheDir, 'package.json'), JSON.stringify({ _npx: { packages: ['terum-skills@latest'] } }));
    const lines: string[] = [];
    expect((await run({ hook: true, config: store, runner: denyingRunner([]), launch: { kind: 'npx', path: join(cacheDir, 'node_modules/terum-skills/dist/index.js'), cacheDir, request: 'terum-skills@latest' } }, { interactive: false, print: (line) => { lines.push(line); } })).ok).toBe(true);
    expect(lines).toEqual([]); expect(JSON.parse(await readFile(join(store.root, 'run/latest-version.json'), 'utf8')).registry.version).toBe('0.1.1');
  });
  it('keeps automatic probe failures silent and preserves the sync result', async () => {
    const f = await releaseFixture(); const io = new ScriptedPrompter([], [], true);
    const runner = wrapRunner(f.runner, async (_command, args, _options, next) => args.includes('ls-remote') ? { code: 1, stdout: '', stderr: 'offline' } : next());
    expect((await run({ config: f.store, runner, upstream: f.fixture.bare, probe: 'github-teams' }, io)).ok).toBe(true);
    expect(io.lines).toEqual(['Sync complete: nothing to do (team up to date, 0 skills).']);
    expect(JSON.parse(await readFile(join(f.store.root, 'run/latest-version.json'), 'utf8')).attempt).toMatchObject({ ok: false, error: 'offline' });
  });
});

it.each([false, true])('hook mirrors an oversized edit with notices and stamps only completed teams (unrelated deferral: %s)', async (unrelated) => {
  const { fixture, store, clone } = await configuredSkill();
  const source = join(fixture.root, 'sample'); await cp(join(clone, 'skills/sample'), source, { recursive: true });
  const baseline = await canonicalDigest(source);
  await store.update((config) => {
    config.display_name = 'Seed'; config.email = 'seed@example.com';
    config.shared[ID] = { source, team: 'team', baseline };
    if (unrelated) config.shared[SECOND_ID] = { source: join(fixture.root, 'missing'), team: 'team', baseline: 'sha256:0' };
  });
  const bytes = skill('old') + 'x'.repeat(20_001); await writeFile(join(source, 'SKILL.md'), bytes);
  const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
  const result = await run({ hook: true, config: store }, io);
  expect(result).toMatchObject({ ok: true, value: { deferred: unrelated ? [SECOND_ID.slice(0, 8)] : [], notices: expect.arrayContaining([expect.stringMatching(/^warning HYG6/)]) } });
  expect(await readFile(join(clone, 'skills/sample/SKILL.md'), 'utf8')).toBe(bytes);
  expect((await store.read()).shared[ID]!.baseline).toBe(await canonicalDigest(source));
  expect(io.lines.every((line) => line === '{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}')).toBe(true);
  const errors: string[] = [];
  await createExecute({ io: new ScriptedPrompter(), stderr: (line) => errors.push(line), setExitCode: () => undefined })(async () => result, { verb: 'sync', notices: false });
  expect(errors.some((line) => line.startsWith('warning HYG6'))).toBe(true);
  if (unrelated) await expect(access(stampPath(store.root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  else {
    await expect(access(stampPath(store.root, 'team'))).resolves.toBeUndefined();
    const second = await run({ hook: true, config: store }, io);
    expect(second).toMatchObject({ ok: true, value: { deferred: [], notices: [] } });
  }
});


it('exports the unchanged normalized-grant approval predicate', () => {
  const config = emptyConfig();
  const grants = allowedTools(['Read', 'Bash']);
  if (!grants.ok) throw new Error('valid grants expected');
  expect(approved(config, 'id', grants)).toBe(false);
  config.approvals.id = { grants: grants.hash, approved_at: '2026-09-01' };
  expect(approved(config, 'id', allowedTools(['Bash', 'Read']))).toBe(true);
  expect(approved(config, 'id', allowedTools(['Bash', 'Read', 'Write']))).toBe(false);
  expect(approved(emptyConfig(), 'id', allowedTools([]))).toBe(true);
  expect(approved(config, 'id', allowedTools({ invalid: true }))).toBe(false);
});

it.each(['install', 'adopt', 'decline'] as const)('preserves role/projects byte-identically through %s', async operation => {
  const prepared = await orphanedPlacement();
  const metadata = { role: 'Platform', projects: ['terum', 'second'] };
  await pushFromSeed(prepared.fixture.seed, 'people/seed.json', JSON.stringify(person('seed', metadata)) + '\n');
  const result = operation === 'install'
    ? await install({ ref: 'sample', config: prepared.store, home: prepared.home }, new ScriptedPrompter())
    : await run({ config: prepared.store }, new ScriptedPrompter([], [operation === 'adopt'], true));
  expect(result.ok).toBe(true);
  const after = JSON.parse(await git(['show', 'main:people/seed.json'], prepared.fixture.bare)) as typeof metadata;
  expect(JSON.stringify({ role: after.role, projects: after.projects })).toBe(JSON.stringify(metadata));
});

it('forwards allowed-tools decision detail through the endorsed batch child prompter', async () => {
  const { fixture, store } = await configuredSkill();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('endorsed', ['Bash(ls)', 'Read(*)']));
  await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [ID], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
  const io = new ScriptedPrompter([], [true, true], true);
  expect(await run({ config: store, noUpdateCheck: true }, io)).toMatchObject({ ok: true, value: { placed: 1 } });
  expect(io.details['Approve these tools for sample?']).toEqual(['sample requests allowed-tools:', 'Bash(ls)', 'Read(*)']);
  expect(io.lines.join('\n')).not.toContain('sample requests allowed-tools:');
});
