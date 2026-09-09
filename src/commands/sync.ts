import type { WithForm } from '../lib/invocation.js';
import type { Launch } from '../lib/launch.js';
import { packageVersion } from '../lib/package.js';
import { createReleaseState, maintainReleaseState, ProbePolicy, probePolicy, recordRunningAndRegistry, ReleaseStateStore } from '../lib/update.js';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { mkdirPrivate } from '../lib/fs.js';
import { acquireTeamLock, lockPath, stampIsFresh, stampPath, TeamLockOptions } from '../lib/hook.js';
import { inspect, lockTarget, place, quarantineDrift, remove, snapshotIfPresent } from '../lib/placer.js';
import { NonInteractivePrompter, Prompter, PromptClosedError } from '../lib/prompt.js';
import { normalizeRemote } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { allowedTools, parseJson, personSchema, sameScope } from '../lib/schema.js';
import { endorsedCandidates, findSkill, readPerson, readTeam, skillRecords } from '../lib/skills.js';
import { snapshotSkillDirectory } from '../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { CloneBusy, openTeamRepo, refreshClone, RemoteAccessError, treeText } from '../lib/teamRepo.js';
import { materializeVersion } from '../lib/version.js';
import { reconcileShared } from './connect.js';
import { installOne, skillAtSource } from './install.js';
import { uninstallOne } from './uninstall.js';

export interface SyncArgs extends WithForm {
  launch?: Launch; noUpdateCheck?: boolean; probe?: ProbePolicy; upstream?: string; state?: ReleaseStateStore;
  hook?: boolean; prune?: boolean; config?: ConfigStore; runner?: Runner; cwd?: string;
  /** Test knob: the clone lock's stale window for refreshClone. */
  lockStale?: number;
  /** Test knobs for the §8 rate limit (hook mode only) and the team mutex (every mode, R4). */
  now?: () => number; lock?: TeamLockOptions;
}
export interface PlacementCounts { placed: number; updated: number; renamed: number; removed: number; unchanged: number; adopted: number; declined: number; }
export interface SharedCounts { pushed: number; pulled: number; renamed: number; repaired: number; }
export type TeamOutcome =
  | { team: string; state: 'complete'; counts: PlacementCounts; shared: SharedCounts }
  | { team: string; state: 'incomplete'; counts: PlacementCounts; shared: SharedCounts; review: string[]; blocked: string[]; pendingLeft: number }
  | { team: string; state: 'skipped'; reason: 'unreachable' | 'locked' | 'busy' | 'error' | 'fresh'; detail: string }
  | { team: string; state: 'gone' };
export interface SyncResult { placed: number; deferred: string[]; notices: string[]; changed: boolean; hook: boolean; teams: TeamOutcome[]; }

/** The returned result is complete and every team lock is released before release maintenance. */
export function run(args: SyncArgs & { hook: true }, io: NonInteractivePrompter): Promise<Result<SyncResult>>;
export function run(args: SyncArgs, io: Prompter): Promise<Result<SyncResult>>;
export async function run(args: SyncArgs, io: Prompter | NonInteractivePrompter): Promise<Result<SyncResult>> {
  // The body already handles print-only shapes conservatively; do not infer --hook from I/O.
  const result = await runSync(args, io as Prompter);
  const store = args.config ?? createConfigStore();
  const state = args.state ?? createReleaseState(store.root, args.upstream);
  const observation = { state, launch: args.launch, running: packageVersion(), now: args.now };
  const interactive = !args.hook && !args.prune && io.interactive && 'confirm' in io;
  try {
    if (interactive && !args.noUpdateCheck) {
      // RELEASE_PROBE_POLICY (constants.ts) decides who may probe; `args.probe` is a test override.
      const probe = probePolicy(await store.read(), args.probe);
      await maintainReleaseState({ ...observation, runner: args.runner ?? systemRunner, upstream: args.upstream, probe });
    } else await recordRunningAndRegistry(observation);
  } catch { /* Automatic discovery and local observation are best-effort and silent. */ }
  return result;
}

/** Overloads keep the hook caller compiler-restricted to print-only I/O (§3). */
function runSync(args: SyncArgs & { hook: true }, io: NonInteractivePrompter): Promise<Result<SyncResult>>;
function runSync(args: SyncArgs, io: Prompter): Promise<Result<SyncResult>>;
async function runSync(args: SyncArgs, io: Prompter | NonInteractivePrompter): Promise<Result<SyncResult>> {
  const notices: string[] = [];
  const deferred: string[] = [];
  const reviews = new Map<string, string[]>();
  const blocks = new Map<string, string[]>();
  const placements = new Map<string, Map<string, keyof PlacementCounts>>();
  const removed = new Map<string, number>();
  const shared = new Map<string, SharedCounts>();
  // §8: a team this run left work undone in is not stamped, so the next session retries instead of
  // waiting out the hour. Tracked per team: one team's deferral never withholds another's stamp.
  const incomplete = new Set<string>();
  const defer = (team: string, ...labels: string[]) => {
    deferred.push(...labels); incomplete.add(team);
    if (labels.length) (reviews.get(team) ?? reviews.set(team, []).get(team)!).push(...labels);
  };
  const recordPlacement = (team: string, path: string, kind: keyof PlacementCounts) => {
    const paths = placements.get(team) ?? (placements.set(team, new Map()), placements.get(team)!);
    if (paths.has(path)) return;
    paths.set(path, kind);
  };
  const countPlacement = (team: string): PlacementCounts => {
    const counts: PlacementCounts = { placed: 0, updated: 0, renamed: 0, removed: removed.get(team) ?? 0, unchanged: 0, adopted: 0, declined: 0 };
    for (const kind of placements.get(team)?.values() ?? []) counts[kind]++;
    return counts;
  };
  const countShared = (team: string): SharedCounts => shared.get(team) ?? { pushed: 0, pulled: 0, renamed: 0, repaired: 0 };
  const releases: Array<() => Promise<void>> = [];
  let placed = 0;
  let changed = false;
  let teams: TeamOutcome[] = [];
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const interactive = !args.hook && io.interactive && 'confirm' in io;
    const notice = (line: string) => { notices.push(line); if (!args.hook) io.print(line); };
    const verdict = (line: string) => { if (!args.hook && !args.prune) (io as { print(line: string): void }).print(line); };
    // A blocked placement is reported AND recorded as undone work, so the team is not stamped as fully synced (§8).
    const blocked = (team: string, label: string, line: string) => { notice(line); (blocks.get(team) ?? blocks.set(team, []).get(team)!).push(label); defer(team, label); };
    // Every verb sync runs on the user's behalf (a pending replay, the endorsed batch, shared-source
    // reconciliation) prints through this channel: in hook mode the lines ride SyncResult.notices to
    // stderr (§8), so stdout carries the reload directive alone; interactively they print as before.
    const childIo: Prompter = {
      interactive: 'confirm' in io ? io.interactive : false,
      print: notice,
      confirm: (question, options) => ('confirm' in io ? io.confirm(question, options) : Promise.resolve(false)),
      text: (question, defaultValue, options) => ('text' in io ? io.text(question, defaultValue, options) : Promise.reject(new Error('sync --hook cannot prompt'))),
      select: (question, choices, options) => ('select' in io ? io.select(question, choices, options) : Promise.reject(new Error('sync --hook cannot prompt'))),
    };
    if (args.prune) {
      if (!interactive) throw new Error('sync prune needs an interactive terminal.');
      const result = await prune(store, io as Prompter);
      const value = { placed: 0, deferred: [], notices: [], changed: result.deleted > 0, hook: false, teams: [] };
      return result.error ? failure(result.error, value) : success(value);
    }
    const config = await store.read();
    // A team this run cannot work on costs exactly that team: it is left alone — not refreshed,
    // not read, not stamped fresh — and every other team still syncs, so the SessionStart hook
    // can complete healthy teams. Lock/rate-limit skips still exit 0; classified fetch failures
    // produce a final failure after healthy teams finish. Lock/rate-limit reasons: a writer lock (reported);
    // another run holds the team's §8 mutex (reported, except to a hook, for which another window
    // is doing the work); or, in hook mode only, the team synced within the hour (silent).
    // EVERY sync takes the mutex, not only a hook (rulings walk R4, 2026-09-06): `team leave` holds
    // it while it removes the team's placements, so a sync typed in another terminal can no longer
    // re-place a folder seconds after leave removed it, or pull into a clone being deleted.
    const skipped = new Map<string, { reason: Extract<TeamOutcome, { state: 'skipped' }>['reason']; detail: string }>();
    const unreachable: string[] = [];
    for (const team of Object.keys(config.teams)) {
      const clone = store.teamClone(team);
      // The gate can throw — a lock file this process cannot read, a refused run/ directory — and
      // that costs this team alone, reported: the shape the CloneBusy handler below already has.
      try {
        if (args.hook && await stampIsFresh(store.root, team, args.now)) { skipped.set(team, { reason: 'fresh', detail: '' }); continue; }
        const release = await acquireTeamLock(store.root, team, args.lock);
        if (!release) {
          if (!args.hook) notice(`Skipping ${team}: another terum-skills sync holds its session lock (${lockPath(store.root, team)}); retry when it finishes.`);
          skipped.set(team, { reason: 'locked', detail: lockPath(store.root, team) }); continue;
        }
        releases.push(release);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        notice(`Skipping ${team}: ${detail}`); skipped.set(team, { reason: 'error', detail }); continue;
      }
      try {
        await refreshClone(runner, clone, { label: team, env: args.hook ? { GIT_TERMINAL_PROMPT: '0' } : {}, lockStale: args.lockStale });
      } catch (error) {
        if (error instanceof RemoteAccessError) {
          notice(`Skipping ${team}: could not fetch ${error.origin}: ${error.stderr}\n${error.explanation}`);
          skipped.set(team, { reason: 'unreachable', detail: error.origin }); unreachable.push(team); continue;
        }
        if (!(error instanceof CloneBusy)) throw error;
        // Reported through `notices` alone, which the hook already writes to stderr: `deferred` is
        // rendered as a count of SKILLS needing review (execute.ts), so a team never belongs on it.
        notice(error.message); skipped.set(team, { reason: 'busy', detail: error.message }); continue;
      }
      await skillRecords(clone, team, { onProblem: (problem) => notice(`Skipping ${team}/${problem.name}: ${problem.message}`) });
      // Pending is intent, never inferred from the filesystem. A replay uses the same command
      // primitive; an unapproved hook replay is deferred rather than silently completed.
      for (const pending of (await store.read()).pending.filter((entry) => entry.team === team)) {
        try {
          // An uninstall replay works from the placement ledger and the people file alone, so it is
          // never gated on the clone: gating it wedged the entry (and the people-file record) forever
          // once the author deleted the skill upstream. Only the install path needs the record.
          if (pending.op === 'uninstall') {
            const result = await uninstallOne({ team, id: pending.id, scope: pending.scope, store, runner, cwd: args.cwd }, childIo);
            removed.set(team, (removed.get(team) ?? 0) + result.removed);
            changed = true; continue;
          }
          const skill = await findSkill(clone, team, pending.id);
          if (!skill) { defer(team, `${pending.id.slice(0, 8)} is no longer in ${team}`); continue; }
          const version = 'version' in pending && typeof pending.version === 'string' ? pending.version : undefined;
          const source = version ? await materializeVersion(store, team, clone, skill.name, version, runner) : skill.directory;
          const placedSkill = await skillAtSource(source, skill);
          if (!approved((await store.read()), skill.id, placedSkill.grants) && !interactive) { defer(team, skill.name); continue; }
          const result = await installOne({ team, id: pending.id, scope: pending.scope, version, store, runner, cwd: args.cwd }, childIo);
          recordPlacement(team, result.path, config.placements[result.path] ? 'updated' : 'placed');
          placed++; changed = true;
        } catch (error) {
          if (error instanceof PromptClosedError) throw error; // the channel is gone, not this entry
          const message = error instanceof Error ? error.message : String(error);
          defer(team, pending.scope.kind === 'project' && message.includes('no matching project context') ? `${pending.id.slice(0, 8)} needs a checkout for project ${pending.scope.project}` : pending.id.slice(0, 8));
          notice(`Deferred pending ${pending.op} for ${pending.id.slice(0, 8)}: ${message}`);
        }
      }
    }
    // Reconciliation never prompts, but it reports — through the same notice channel.
    const sharedOutcomes = await reconcileShared(store, runner, childIo, new Set(skipped.keys()), defer, args.form);
    for (const outcome of sharedOutcomes) {
      if (outcome.kind === 'unchanged' || outcome.kind === 'deferred') continue;
      const counts = countShared(outcome.team);
      counts[outcome.kind]++;
      shared.set(outcome.team, counts);
      if (outcome.kind === 'pushed' || outcome.kind === 'pulled' || outcome.kind === 'renamed') changed = true;
    }
    // Existing ledger paths drive every later decision. A folder merely present on disk is never
    // adopted, quarantined, or deleted without a ledger entry.
    const currentConfig = await store.read();
    for (const [path, entry] of Object.entries(currentConfig.placements)) {
      // One damaged placement (an unreadable folder, a busy target lock, a failed copy) is reported
      // and skipped, and the rest of the run proceeds — the shape the pending loop above already has.
      try {
        if (skipped.has(entry.team)) continue;
        const clone = store.teamClone(entry.team);
        const projectRoot = entry.scope.kind === 'project' ? await matchingProjectRoot(clone, entry.scope.project, runner, args.cwd) : undefined;
        // Project placement is worktree-local. An unrelated session never even inspects another
        // checkout's placement, so it cannot quarantine or overwrite it.
        if (entry.scope.kind === 'project' && !projectRoot) continue;
        const binding = (await store.read()).teams[entry.team];
        const person = binding?.handle ? await actorPerson(store, entry.team, binding.handle) : undefined;
        if (person && !person.installed.some((item) => item.id === entry.id && sameScope(item.scope, entry.scope)) && !currentConfig.pending.some((pending) => pending.id === entry.id && pending.team === entry.team && sameScope(pending.scope, entry.scope))) continue;
        if (person?.declined.includes(entry.id)) continue;
        const skill = await findSkill(clone, entry.team, entry.id);
        // Reported, never recorded as undone work: the skill is gone upstream while the people file still
        // lists it, so no later run can clear this — the orphan pass skips the entry and `uninstall <ref>`
        // cannot even resolve the ref — and a stamp withheld forever would refetch at every session start
        // and advertise a `run sync` that cannot help.
        if (!skill) { notice(`Blocked ${path}: its skill is no longer in the repository.`); continue; }
        // §6 blocked, second sub-case: the ledger pins a tree the clone does not have (placed from a
        // newer or rewritten history). The tool must not resolve that alone: report, touch nothing.
        if (entry.version && (await runner.run('git', ['cat-file', '-e', `${entry.version}^{tree}`], { cwd: clone })).code !== 0) {
          blocked(entry.team, basename(path), `Blocked ${path}: pinned version ${entry.version.slice(0, 8)} is not in the team repository (newer than this clone, or rewritten); leaving it untouched.`);
          continue;
        }
        const source = entry.version ? await materializeVersion(store, entry.team, clone, skill.name, entry.version, runner) : skill.directory;
        const grants = (await skillAtSource(source, skill)).grants;
        if (!approved((await store.read()), skill.id, grants)) {
          if (!grants.ok) { blocked(entry.team, skill.name, `Blocked ${skill.name}: allowed-tools is malformed.`); continue; }
          if (!interactive) { defer(entry.team, skill.name); continue; }
          if (!(await (io as Prompter).confirm(`Approve updated tools for ${skill.name}?`, { detail: [`allowed-tools changed for ${skill.name}:`, ...grants.normalized.split('\n')] }))) { defer(entry.team, skill.name); continue; }
          await store.update((fresh) => { fresh.approvals[skill.id] = { grants: grants.hash, approved_at: new Date().toISOString().slice(0, 10) }; });
        }
        // The ledger is provenance for the exact placement, including a particular project checkout.
        // Re-resolving a global path would use this process's HOME and can update the wrong machine.
        const root = dirname(path);
        // The read-only "nothing to do" decision comes first, outside the lock: an up-to-date placement —
        // the steady state of every session-start sync — never contends for a target another run holds,
        // and never reports that run as a block. The full decision is re-taken under the lock below.
        // Two rules for that unlocked probe. Its shape is judged by the classifier the locked pass uses
        // (`true` asks about shape alone; ownership is read, and acted on, under the lock): a file or a
        // symlink at the ledger path stays the foreign collision reported below — the repo's rule for
        // symlinks everywhere is refuse, never follow — never a "nothing to do". And it is advisory: it
        // races a concurrent place()'s rename pair, so snapshotIfPresent's "an ENOENT mid-scan is an
        // error, not gone" rule does not hold here; any read failure means "undecided" and falls through
        // to the lock, where quarantineDrift re-takes the decision under that rule and a genuine failure
        // still surfaces as Blocked.
        const repoSnapshot = await snapshotSkillDirectory(source);
        const placedNow = await inspect(path, true).then((shape) => (shape.kind === 'ours' ? snapshotIfPresent(path) : undefined)).catch(() => undefined);
        if (placedNow?.fingerprint === entry.fingerprint && repoSnapshot.fingerprint === entry.fingerprint) { recordPlacement(entry.team, path, 'unchanged'); continue; }
        // The target lock is taken before anything about the destination is decided and held across
        // the collision check, the quarantine move and the placement — install's shape — so the
        // ownership reading that authorizes a destructive `replace` cannot go stale under it.
        const release = await lockTarget(root, skill.name);
        try {
          // After an upstream rename the destination is not the ledger key: `replace` is authorized by
          // what sits AT the destination (a ledger-owned placement, or nothing), never by the old path —
          // D16, the check install.ts runs. A stranger's folder at the new name is reported, and it is
          // decided BEFORE anything moves: a blocked placement is touched by nothing, quarantine included.
          const destination = join(root, skill.name);
          const collision = await inspect(destination, (await store.read()).placements[destination]?.id === skill.id);
          if (collision.kind === 'foreign') { blocked(entry.team, basename(path), `Blocked ${path}: ${destination} already exists and is not a placement this tool owns; leaving both untouched.`); continue; }
          // A placed copy that no longer matches its ledger fingerprint is moved to quarantine, never
          // deleted — the same helper install uses when it re-places over an owned target.
          const drift = await quarantineDrift(path, entry.fingerprint, join(store.root, 'quarantine'));
          const current = drift.current;
          if (drift.quarantined) { notice(`Local changes at ${path} moved to ${drift.quarantined}.`); changed = true; }
          if (current?.fingerprint === entry.fingerprint && repoSnapshot.fingerprint === entry.fingerprint) { recordPlacement(entry.team, path, 'unchanged'); continue; }
          const result = await place(source, root, skill.name, { replace: collision.kind === 'ours', projectRoot, runner, quarantineRoot: join(store.root, 'quarantine') });
          const renamed = basename(path) !== skill.name;
          await store.update((fresh) => {
            const placement = fresh.placements[path];
            if (!placement) return;
            if (renamed) { delete fresh.placements[path]; fresh.placements[result.path] = { ...placement, fingerprint: result.snapshot.fingerprint }; }
            else placement.fingerprint = result.snapshot.fingerprint;
          });
          if (renamed) {
            await remove(root, path, entry.fingerprint, join(store.root, 'quarantine'));
            notice(`Renamed placed skill ${basename(path)} to ${skill.name}.`);
          }
          for (const line of result.notices) notice(line);
          recordPlacement(entry.team, result.path, renamed ? 'renamed' : 'updated');
        } finally { await release(); }
        placed++; changed = true;
      } catch (error) {
        if (error instanceof PromptClosedError) throw error; // the channel is gone, not this placement
        blocked(entry.team, basename(path), `Blocked ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    {
      // Newly endorsed global skills are an opt-in batch. Per-skill tool approval remains inside
      // installOne, so the batch question cannot answer a consent prompt on the user's behalf.
      for (const [team, binding] of Object.entries(config.teams)) {
        if (!binding.handle || skipped.has(team)) continue;
        // The clone can vanish under this walk — `team leave` removes it BEFORE it deletes the ledger entry,
        // so a fresh read would not close the window — and endorsedCandidates reads team.json and the people
        // file straight off disk. That costs this team's batch alone, reported: the shape the pending and
        // placement loops already have. No label: `deferred` is rendered as a count of SKILLS needing review.
        const candidates = await endorsedCandidates(store.teamClone(team), team, binding.handle, { onProblem: (problem) => notice(`Skipping ${team}/${problem.name}: ${problem.message}`) })
          .catch((error: unknown) => { notice(`Skipping endorsed batch for ${team}: ${error instanceof Error ? error.message : String(error)}`); defer(team); return undefined; });
        if (!candidates?.length) continue;
        if (!interactive) {
          defer(team, ...candidates.map((skill) => skill.name));
          continue;
        }
        if (await (io as Prompter).confirm(`Install ${candidates.length} newly endorsed skill(s) from ${team}?`)) {
          // One candidate that cannot be placed (a foreign folder at its target, a busy lock) is
          // deferred by name; the others still land, and the orphan pass and the stamps still run.
          for (const skill of candidates) {
            try {
              const result = await installOne({ team, id: skill.id, store, runner, cwd: args.cwd }, childIo);
              recordPlacement(team, result.path, config.placements[result.path] ? 'updated' : 'placed');
              placed++; changed = true;
            }
            catch (error) {
              if (error instanceof PromptClosedError) throw error; // the channel is gone, not this candidate
              defer(team, skill.name); notice(`Deferred endorsed ${skill.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
    }
    await reconcileOrphans(store, runner, interactive ? io as Prompter : undefined, defer, notice, new Set(skipped.keys()), (team, path, kind) => {
      recordPlacement(team, path, kind); changed = true;
    });
    if (args.hook && placed) (io as { print(line: string): void }).print('{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}');
    // §8: the stamp means "this team is fully synced". A failed run throws past this line; a team this
    // run skipped, or left work undone in (a deferral, a blocked placement a later run can still clear), keeps its old stamp, so
    // the next session retries instead of rate-limiting the gap into an hour of silence. Only the
    // teams this run walked are stamped — a team bound meanwhile was never refreshed — and only when
    // the final ledger holds no pending work for them: an install recorded after this team's replay
    // is work this run never saw. A project placement outside its checkout is not undone work: that
    // placement belongs to another session.
    const final = await store.read();
    teams = [];
    for (const team of Object.keys(config.teams)) {
      const skip = skipped.get(team);
      if (skip) { teams.push({ team, state: 'skipped', ...skip }); continue; }
      if (!Object.hasOwn(final.teams, team)) { teams.push({ team, state: 'gone' }); continue; }
      const pendingLeft = final.pending.filter((entry) => entry.team === team).length;
      const counts = countPlacement(team);
      const sharedCounts = countShared(team);
      if (incomplete.has(team) || pendingLeft > 0) {
        teams.push({ team, state: 'incomplete', counts, shared: sharedCounts, review: reviews.get(team) ?? [], blocked: blocks.get(team) ?? [], pendingLeft });
        continue;
      }
      await writeStamp(store, team);
      teams.push({ team, state: 'complete', counts, shared: sharedCounts });
    }
    if (unreachable.length) {
      if (Object.keys(config.teams).length > 1) for (const team of teams) if (team.state === 'complete') verdict(teamLine(team));
      return failure(`Sync finished with ${unreachable.length} team(s) skipped: ${unreachable.join(', ')}. See the notices above.`, args.hook ? { placed, deferred, notices, changed, hook: true, teams } : undefined);
    }
    if (!args.hook) printVerdict(config, teams, changed, verdict);
    return success({ placed, deferred, notices, changed, hook: Boolean(args.hook), teams });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(args.hook ? message : `Sync failed: ${message}`, args.hook ? { placed, deferred, notices, changed, hook: true, teams } : undefined);
  }
  finally { for (const release of releases) await release().catch(() => undefined); }
}

export function approved(config: Awaited<ReturnType<ConfigStore['read']>>, id: string, grants: ReturnType<typeof allowedTools>): boolean {
  return grants.ok && (grants.normalized === 'none' || config.approvals[id]?.grants === grants.hash);
}
async function reconcileOrphans(store: ConfigStore, runner: Runner, io: Prompter | undefined, defer: (team: string, label: string) => void, notice: (line: string) => void, skipTeams: ReadonlySet<string>, record: (team: string, path: string, kind: 'adopted' | 'declined') => void): Promise<void> {
  const config = await store.read();
  for (const [path, placement] of Object.entries(config.placements)) {
    // A team this run skipped is left alone here too: a clone another process holds may be
    // mid-write, so its roster is not evidence of an orphan and a decline written against it would
    // be wrong; and a §8 rate-limited hook run defers nothing, so it stays a silent no-op.
    if (skipTeams.has(placement.team)) continue;
    // One failed adoption or decline (a refused push, a busy clone lock, a dropped network) costs
    // only itself, reported — the shape every other sync loop already has. The entry is deferred, so
    // its team stays unstamped (§8: a stamp means a fully completed sync) while other entries and
    // every other team's outcome and stamp still land.
    try {
      if (config.pending.some((entry) => entry.id === placement.id && entry.team === placement.team && sameScope(entry.scope, placement.scope))) continue;
      const binding = config.teams[placement.team];
      if (!binding?.handle) continue;
      const person = await actorPerson(store, placement.team, binding.handle);
      if (!person) continue;
      if (person.declined.includes(placement.id)) continue;
      if (person.installed.some((entry) => entry.id === placement.id && sameScope(entry.scope, placement.scope))) continue;
      if (!io) { defer(placement.team, basename(path)); continue; }
      const adopt = await io.confirm(`Adopt orphaned placement at ${path}?`);
      const repo = openTeamRepo(store.teamClone(placement.team), binding.remote, runner);
      if (adopt) {
        await repo.safeWrite((tree) => {
          const personPath = `people/${binding.handle}.json`;
          const raw = tree.before(personPath);
          if (!raw) throw new Error(`Missing ${personPath}.`);
          const fresh = parseJson(personSchema, treeText(raw), personPath);
          if (!fresh.installed.some((entry) => entry.id === placement.id && sameScope(entry.scope, placement.scope))) {
            fresh.installed.push({ id: placement.id, version: placement.version, scope: placement.scope, since: new Date().toISOString().slice(0, 10) });
            tree.set(personPath, `${JSON.stringify(fresh, null, 2)}\n`);
          }
        }, { action: 'install', handle: binding.handle, message: `${binding.handle}: adopt ${placement.id.slice(0, 8)}` });
        notice(`Adopted orphaned placement at ${path}.`);
        record(placement.team, path, 'adopted');
      } else {
        await repo.safeWrite((tree) => {
          const personPath = `people/${binding.handle}.json`;
          const raw = tree.before(personPath);
          if (!raw) throw new Error(`Missing ${personPath}.`);
          const fresh = parseJson(personSchema, treeText(raw), personPath);
          if (!fresh.declined.includes(placement.id)) fresh.declined.push(placement.id);
          tree.set(personPath, `${JSON.stringify(fresh, null, 2)}\n`);
        }, { action: 'uninstall', handle: binding.handle, message: `${binding.handle}: decline ${placement.id.slice(0, 8)}` });
        notice(`Declined orphaned placement at ${path}.`);
        record(placement.team, path, 'declined');
      }
    } catch (error) {
      if (error instanceof PromptClosedError) throw error; // the channel is gone, not this entry
      defer(placement.team, basename(path));
      notice(`Deferred orphaned placement at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
async function actorPerson(store: ConfigStore, team: string, handle: string) {
  try { return await readPerson(store.teamClone(team), handle); } catch { return undefined; }
}
async function writeStamp(store: ConfigStore, team: string): Promise<void> { await mkdirPrivate(dirname(stampPath(store.root, team))); await writeFile(stampPath(store.root, team), new Date().toISOString(), 'utf8'); }

async function matchingProjectRoot(clone: string, project: string, runner: Runner, cwd?: string): Promise<string | undefined> {
  const root = await runner.run('git', ['rev-parse', '--show-toplevel'], cwd ? { cwd } : undefined);
  if (root.code !== 0 || !root.stdout.trim()) return undefined;
  const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: root.stdout.trim() });
  if (origin.code !== 0) return undefined;
  const projects = (await readTeam(clone)).projects;
  const listed = Object.hasOwn(projects, project) ? projects[project] : undefined;
  return listed?.remotes.some((remote) => normalizeRemote(remote) === normalizeRemote(origin.stdout.trim())) ? root.stdout.trim() : undefined;
}

/** The only destructive operation: named entries immediately under our quarantine root. */
function plural(count: number, singular: string, pluralForm = `${singular}s`): string { return `${count} ${count === 1 ? singular : pluralForm}`; }
function countsPhrase(counts: PlacementCounts, shared: SharedCounts): string {
  const phrases: string[] = [];
  if (counts.placed) phrases.push(`${counts.placed} placed`);
  if (counts.updated) phrases.push(`${counts.updated} updated`);
  if (counts.renamed) phrases.push(`${counts.renamed} renamed`);
  if (counts.removed) phrases.push(`${counts.removed} removed`);
  if (counts.adopted) phrases.push(`${counts.adopted} adopted`);
  if (counts.declined) phrases.push(`${counts.declined} declined`);
  if (shared.pushed) phrases.push(`${plural(shared.pushed, 'shared edit')} pushed`);
  if (shared.pulled) phrases.push(`${plural(shared.pulled, 'shared edit')} pulled`);
  if (counts.unchanged) phrases.push(`${counts.unchanged} unchanged`);
  return phrases.join(', ');
}
function unique(labels: string[]): string[] { return [...new Set(labels)]; }
function incompleteClauses(team: Extract<TeamOutcome, { state: 'incomplete' }>, includeTail: boolean): string[] {
  const clauses: string[] = [];
  if (team.review.length) clauses.push(`${team.review.length} skills need review (${unique(team.review).join(', ')})`);
  if (team.blocked.length) clauses.push(`${plural(team.blocked.length, 'placement')} blocked (${unique(team.blocked).join(', ')})`);
  if (!team.review.length && !team.blocked.length && team.pendingLeft === 0) clauses.push(`${team.team} has unfinished work (endorsed batch skipped)`);
  if (team.pendingLeft) clauses.push(`${team.team} still has ${plural(team.pendingLeft, 'pending install')}; run sync again`);
  if (includeTail && (team.review.length || team.blocked.length || (!team.review.length && !team.blocked.length && team.pendingLeft === 0))) {
    clauses[clauses.length - (team.pendingLeft ? 2 : 1)] += team.review.length ? ' — see the lines above for each remedy' : ' — see the lines above';
  }
  return clauses;
}
function skippedClause(team: Extract<TeamOutcome, { state: 'skipped' }>): string | undefined {
  if (team.reason === 'fresh' || team.reason === 'unreachable') return undefined;
  if (team.reason === 'locked') return `${team.team} skipped (another sync holds its lock) — retry when it finishes`;
  return `${team.team} skipped (${team.detail})`;
}
function teamLine(team: TeamOutcome): string {
  if (team.state === 'complete') {
    const phrase = countsPhrase(team.counts, team.shared);
    return phrase ? `${team.team}: ${phrase}` : `${team.team}: up to date (${plural((team.counts.unchanged || 0), 'skill')})`;
  }
  if (team.state === 'incomplete') {
    const phrase = countsPhrase(team.counts, team.shared);
    const clauses = incompleteClauses(team, false);
    return `${team.team}: ${[phrase, ...clauses].filter(Boolean).join('; ')}`;
  }
  if (team.state === 'skipped') return team.reason === 'locked' ? `${team.team}: skipped (another sync holds its lock)` : `${team.team}: skipped (${team.detail})`;
  return `${team.team}: no longer configured`;
}
function printVerdict(config: Awaited<ReturnType<ConfigStore['read']>>, teams: TeamOutcome[], changed: boolean, verdict: (line: string) => void): void {
  const configured = Object.keys(config.teams);
  if (configured.length === 1) {
    const team = teams[0]!;
    if (team.state === 'complete') {
      const phrase = countsPhrase(team.counts, team.shared);
      if (!changed) {
        const repairs = team.shared.repaired ? `; ${plural(team.shared.repaired, 'managed-field repair')}` : '';
        verdict(`Sync complete: nothing to do (${team.team} up to date, ${plural(team.counts.unchanged, 'skill')}${repairs}).`);
      } else verdict(`Sync complete: ${team.team}${phrase ? ` — ${phrase}` : ''}.`);
      return;
    }
    const clause = team.state === 'incomplete' ? incompleteClauses(team, true).join('; ') : team.state === 'skipped' ? skippedClause(team) ?? `${team.team} skipped (${team.detail})` : `${team.team} is no longer configured`;
    const phrase = team.state === 'incomplete' ? countsPhrase(team.counts, team.shared) : '';
    verdict(`Sync incomplete: ${phrase ? `${team.team} — ${phrase}; ` : ''}${clause}.`);
    return;
  }
  for (const team of teams) verdict(teamLine(team));
  const bad = teams.filter((team) => team.state === 'incomplete' || (team.state === 'skipped' && team.reason !== 'fresh'));
  if (!bad.length) { verdict('Sync complete.'); return; }
  const clauses: string[] = [];
  for (const team of bad) {
    if (team.state === 'incomplete') clauses.push(...incompleteClauses(team, false));
    else if (team.state === 'skipped') { const clause = skippedClause(team); if (clause) clauses.push(clause); }
  }
  verdict(`Sync incomplete: ${clauses.join('; ')}.`);
}

/** Prune's roster guard: only paths strictly under the quarantine root, judged with the host separator — a hard-coded `/` left win32 prune inert. Exported with an injectable separator so the win32 shape is provable from any host. */
export function underQuarantine(root: string, path: string, separator: string = sep): boolean { return path.startsWith(root + separator); }

async function prune(store: ConfigStore, io: Prompter): Promise<{ deleted: number; declined: boolean; error?: string }> {
  const root = resolve(store.root, 'quarantine');
  let entries: string[];
  try { entries = await readdir(root); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { io.print('Quarantine is empty.'); return { deleted: 0, declined: false }; } throw error; }
  const paths = entries.map((entry) => resolve(root, entry)).filter((path) => underQuarantine(root, path));
  if (!paths.length) { io.print('Quarantine is empty.'); return { deleted: 0, declined: false }; }
  for (const path of paths) io.print(path);
  if (!(await io.confirm(`Delete ${paths.length} quarantined item(s)?`))) { io.print('Prune cancelled; nothing deleted.'); return { deleted: 0, declined: true }; }
  let deleted = 0; let firstFailure: { path: string; message: string } | undefined;
  for (const path of paths) {
    try { await rm(path, { recursive: true, force: false }); deleted++; }
    catch (error) { firstFailure ??= { path, message: error instanceof Error ? error.message : String(error) }; }
  }
  if (firstFailure) return { deleted, declined: false, error: `Deleted ${deleted} of ${paths.length} quarantined item(s); could not delete ${firstFailure.path}: ${firstFailure.message}` };
  io.print(`Deleted ${plural(deleted, 'quarantined item')}.`);
  return { deleted, declined: false };
}
