import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { acquireTeamLock, stampIsFresh, TeamLockOptions } from '../lib/hook.js';
import { inspect, lockTarget, place, quarantineDrift, remove, snapshotIfPresent } from '../lib/placer.js';
import { NonInteractivePrompter, Prompter, PromptClosedError } from '../lib/prompt.js';
import { normalizeRemote } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { allowedTools, parseJson, personSchema, sameScope } from '../lib/schema.js';
import { endorsedCandidates, findSkill, readPerson, readTeam, skillRecords } from '../lib/skills.js';
import { snapshotSkillDirectory } from '../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { CloneBusy, openTeamRepo, refreshClone, treeText } from '../lib/teamRepo.js';
import { materializeVersion } from '../lib/version.js';
import { reconcileShared } from './share.js';
import { installOne, skillAtSource } from './install.js';
import { uninstallOne } from './uninstall.js';

export interface SyncArgs {
  hook?: boolean; prune?: boolean; config?: ConfigStore; runner?: Runner; cwd?: string;
  /** Test knob: the clone lock's stale window for refreshClone. */
  lockStale?: number;
  /** Test knobs for the §8 rate limit and mutex (hook mode only). */
  now?: () => number; lock?: TeamLockOptions;
}
export interface SyncResult { placed: number; deferred: string[]; notices: string[]; changed: boolean; hook: boolean; }

/** Overloads keep the hook caller compiler-restricted to print-only I/O (§3). */
export function run(args: SyncArgs & { hook: true }, io: NonInteractivePrompter): Promise<Result<SyncResult>>;
export function run(args: SyncArgs, io: Prompter): Promise<Result<SyncResult>>;
export async function run(args: SyncArgs, io: Prompter | NonInteractivePrompter): Promise<Result<SyncResult>> {
  const notices: string[] = [];
  const deferred: string[] = [];
  const releases: Array<() => Promise<void>> = [];
  let placed = 0;
  let changed = false;
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const interactive = !args.hook && io.interactive && 'confirm' in io;
    const notice = (line: string) => { notices.push(line); if (!args.hook) io.print(line); };
    // Every verb sync runs on the user's behalf (a pending replay, the endorsed batch, shared-source
    // reconciliation) prints through this channel: in hook mode the lines ride SyncResult.notices to
    // stderr (§8), so stdout carries the reload directive alone; interactively they print as before.
    const childIo: Prompter = {
      interactive: 'confirm' in io ? io.interactive : false,
      print: notice,
      confirm: (question) => ('confirm' in io ? io.confirm(question) : Promise.resolve(false)),
      text: (question, defaultValue) => ('text' in io ? io.text(question, defaultValue) : Promise.reject(new Error('sync --hook cannot prompt'))),
      select: (question, choices) => ('select' in io ? io.select(question, choices) : Promise.reject(new Error('sync --hook cannot prompt'))),
    };
    if (args.prune) {
      if (!interactive) throw new Error('sync prune needs an interactive terminal.');
      await prune(store, io as Prompter);
      return success({ placed: 0, deferred: [], notices: [], changed: true, hook: false });
    }
    const config = await store.read();
    // A team this run cannot work on costs exactly that team: it is left alone — not refreshed,
    // not read, not stamped fresh — and every other team still syncs, so the SessionStart hook
    // still exits 0. Three reasons: another process holds the clone's writer lock (reported), or,
    // in hook mode only (§8), the team synced within the hour or another hook holds its mutex —
    // both silent, because another window is doing, or has just done, the work.
    const skipped = new Set<string>();
    for (const team of Object.keys(config.teams)) {
      const clone = store.teamClone(team);
      if (args.hook) {
        if (await stampIsFresh(store.root, team, args.now)) { skipped.add(team); continue; }
        const release = await acquireTeamLock(store.root, team, args.lock);
        if (!release) { skipped.add(team); continue; }
        releases.push(release);
      }
      try {
        await refreshClone(runner, clone, { label: team, env: args.hook ? { GIT_TERMINAL_PROMPT: '0' } : {}, lockStale: args.lockStale });
      } catch (error) {
        if (!(error instanceof CloneBusy)) throw error;
        // Reported through `notices` alone, which the hook already writes to stderr: `deferred` is
        // rendered as a count of SKILLS needing review (execute.ts), so a team never belongs on it.
        notice(error.message); skipped.add(team); continue;
      }
      await skillRecords(clone, team, { onProblem: (problem) => notice(`Skipping ${team}/${problem.name}: ${problem.message}`) });
      // Pending is intent, never inferred from the filesystem. A replay uses the same command
      // primitive; an unapproved hook replay is deferred rather than silently completed.
      for (const pending of (await store.read()).pending.filter((entry) => entry.team === team)) {
        try {
          // An uninstall replay works from the placement ledger and the people file alone, so it is
          // never gated on the clone: gating it wedged the entry (and the people-file record) forever
          // once the author deleted the skill upstream. Only the install path needs the record.
          if (pending.op === 'uninstall') { await uninstallOne({ team, id: pending.id, scope: pending.scope, store, runner, cwd: args.cwd }, childIo); changed = true; continue; }
          const skill = await findSkill(clone, team, pending.id);
          if (!skill) { deferred.push(`${pending.id.slice(0, 8)} is no longer in ${team}`); continue; }
          const version = 'version' in pending && typeof pending.version === 'string' ? pending.version : undefined;
          const source = version ? await materializeVersion(store, team, clone, skill.name, version, runner) : skill.directory;
          const placedSkill = await skillAtSource(source, skill);
          if (!approved((await store.read()), skill.id, placedSkill.grants) && !interactive) { deferred.push(skill.name); continue; }
          await installOne({ team, id: pending.id, scope: pending.scope, version, store, runner, cwd: args.cwd }, childIo);
          placed++; changed = true;
        } catch (error) {
          if (error instanceof PromptClosedError) throw error; // the channel is gone, not this entry
          const message = error instanceof Error ? error.message : String(error);
          deferred.push(pending.scope.kind === 'project' && message.includes('no matching project context') ? `${pending.id.slice(0, 8)} needs a checkout for project ${pending.scope.project}` : pending.id.slice(0, 8));
          notice(`Deferred pending ${pending.op} for ${pending.id.slice(0, 8)}: ${message}`);
        }
      }
    }
    // Reconciliation never prompts, but it reports — through the same notice channel.
    await reconcileShared(store, runner, childIo, skipped);
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
        if (!skill) { notice(`Blocked ${path}: its skill is no longer in the repository.`); continue; }
        // §6 blocked, second sub-case: the ledger pins a tree the clone does not have (placed from a
        // newer or rewritten history). The tool must not resolve that alone: report, touch nothing.
        if (entry.version && (await runner.run('git', ['cat-file', '-e', `${entry.version}^{tree}`], { cwd: clone })).code !== 0) {
          notice(`Blocked ${path}: pinned version ${entry.version.slice(0, 8)} is not in the team repository (newer than this clone, or rewritten); leaving it untouched.`);
          continue;
        }
        const source = entry.version ? await materializeVersion(store, entry.team, clone, skill.name, entry.version, runner) : skill.directory;
        const grants = (await skillAtSource(source, skill)).grants;
        if (!approved((await store.read()), skill.id, grants)) {
          if (!grants.ok) { notice(`Blocked ${skill.name}: allowed-tools is malformed.`); continue; }
          if (!interactive) { deferred.push(skill.name); continue; }
          (io as Prompter).print(`allowed-tools changed for ${skill.name}:\n${grants.normalized}`);
          if (!(await (io as Prompter).confirm(`Approve updated tools for ${skill.name}?`))) { deferred.push(skill.name); continue; }
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
        if (placedNow?.fingerprint === entry.fingerprint && repoSnapshot.fingerprint === entry.fingerprint) continue;
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
          if (collision.kind === 'foreign') { notice(`Blocked ${path}: ${destination} already exists and is not a placement this tool owns; leaving both untouched.`); continue; }
          // A placed copy that no longer matches its ledger fingerprint is moved to quarantine, never
          // deleted — the same helper install uses when it re-places over an owned target.
          const drift = await quarantineDrift(path, entry.fingerprint, join(store.root, 'quarantine'));
          const current = drift.current;
          if (drift.quarantined) { notice(`Local changes at ${path} moved to ${drift.quarantined}.`); changed = true; }
          if (current?.fingerprint === entry.fingerprint && repoSnapshot.fingerprint === entry.fingerprint) continue;
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
        } finally { await release(); }
        placed++; changed = true;
      } catch (error) {
        if (error instanceof PromptClosedError) throw error; // the channel is gone, not this placement
        notice(`Blocked ${path}: ${error instanceof Error ? error.message : String(error)}`);
        deferred.push(basename(path));
      }
    }
    {
      // Newly endorsed global skills are an opt-in batch. Per-skill tool approval remains inside
      // installOne, so the batch question cannot answer a consent prompt on the user's behalf.
      for (const [team, binding] of Object.entries((await store.read()).teams)) {
        if (!binding.handle || skipped.has(team)) continue;
        const candidates = await endorsedCandidates(store.teamClone(team), team, binding.handle, { onProblem: (problem) => notice(`Skipping ${team}/${problem.name}: ${problem.message}`) });
        if (!candidates.length) continue;
        if (!interactive) {
          deferred.push(...candidates.map((skill) => skill.name));
          continue;
        }
        if (await (io as Prompter).confirm(`Install ${candidates.length} newly endorsed skill(s) from ${team}?`)) {
          // One candidate that cannot be placed (a foreign folder at its target, a busy lock) is
          // deferred by name; the others still land, and the orphan pass and the stamps still run.
          for (const skill of candidates) {
            try { await installOne({ team, id: skill.id, store, runner, cwd: args.cwd }, childIo); placed++; changed = true; }
            catch (error) {
              if (error instanceof PromptClosedError) throw error; // the channel is gone, not this candidate
              deferred.push(skill.name); notice(`Deferred endorsed ${skill.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
    }
    await reconcileOrphans(store, runner, interactive ? io as Prompter : undefined, deferred, notice, skipped);
    if (changed && !args.hook) (io as { print(line: string): void }).print('Skills synchronized.');
    if (args.hook && placed) (io as { print(line: string): void }).print('{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}');
    // §8: the stamp is written only after a sync that fully succeeded — a failed run throws past
    // this line and leaves the old stamp, so the next session retries instead of waiting an hour.
    for (const team of Object.keys((await store.read()).teams)) if (!skipped.has(team)) await writeStamp(store, team);
    return success({ placed, deferred, notices, changed, hook: Boolean(args.hook) });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error), args.hook ? { placed, deferred, notices, changed, hook: true } : undefined); }
  finally { for (const release of releases) await release().catch(() => undefined); }
}

function approved(config: Awaited<ReturnType<ConfigStore['read']>>, id: string, grants: ReturnType<typeof allowedTools>): boolean {
  return grants.ok && (grants.normalized === 'none' || config.approvals[id]?.grants === grants.hash);
}
async function reconcileOrphans(store: ConfigStore, runner: Runner, io: Prompter | undefined, deferred: string[], notice: (line: string) => void, skipTeams: ReadonlySet<string>): Promise<void> {
  const config = await store.read();
  for (const [path, placement] of Object.entries(config.placements)) {
    // A clone this run could not refresh may be mid-write by the process that holds it: its roster
    // is not evidence of an orphan, and a decline written against it would be wrong.
    if (skipTeams.has(placement.team)) continue;
    if (config.pending.some((entry) => entry.id === placement.id && entry.team === placement.team && sameScope(entry.scope, placement.scope))) continue;
    const binding = config.teams[placement.team];
    if (!binding?.handle) continue;
    const person = await actorPerson(store, placement.team, binding.handle);
    if (!person) continue;
    if (person.declined.includes(placement.id)) continue;
    if (person.installed.some((entry) => entry.id === placement.id && sameScope(entry.scope, placement.scope))) continue;
    if (!io) { deferred.push(basename(path)); continue; }
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
    }
  }
}
async function actorPerson(store: ConfigStore, team: string, handle: string) {
  try { return await readPerson(store.teamClone(team), handle); } catch { return undefined; }
}
async function writeStamp(store: ConfigStore, team: string): Promise<void> { const run = join(store.root, 'run'); await mkdir(run, { recursive: true, mode: 0o700 }); await writeFile(join(run, `${team}.stamp`), new Date().toISOString(), 'utf8'); }

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
async function prune(store: ConfigStore, io: Prompter): Promise<void> {
  const root = resolve(store.root, 'quarantine');
  let entries: string[];
  try { entries = await readdir(root); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { io.print('Quarantine is empty.'); return; } throw error; }
  const paths = entries.map((entry) => resolve(root, entry)).filter((path) => path.startsWith(`${root}/`));
  if (!paths.length) { io.print('Quarantine is empty.'); return; }
  for (const path of paths) io.print(path);
  if (!(await io.confirm(`Delete ${paths.length} quarantined item(s)?`))) return;
  for (const path of paths) await rm(path, { recursive: true, force: false });
}
