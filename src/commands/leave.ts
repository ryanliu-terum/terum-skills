import type { WithForm } from '../lib/invocation.js';
import { access, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { acquireTeamLock, defaultHookOptions, HookOptions, lockPath, removeHook, removeRunArtifacts } from '../lib/hook.js';
import { moveDirectory } from '../lib/placer.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { Prompter } from '../lib/prompt.js';
import { stripRemoteCredentials } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { parseOrExplain, teamNameSchema } from '../lib/schema.js';
import { withCloneLock } from '../lib/teamRepo.js';
import { removePlacements } from './uninstall.js';

export interface LeaveArgs extends WithForm { name: string; config?: ConfigStore; hook?: HookOptions; runner?: Runner; }
export interface LeaveResult { team: string; remote: string; handle: string | null; removed: number; cloneRemoved: boolean; kept: string[]; }

/** Leave only this machine: no team-repository mutation; git only inventories local work. */
export async function run(args: LeaveArgs, io: Prompter): Promise<Result<LeaveResult>> {
  try {
    const name = parseOrExplain(teamNameSchema, args.name, 'team name');
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const binding = Object.hasOwn(config.teams, name) ? config.teams[name] : undefined;
    if (!binding) throw new Error(`Team ${name} is not configured.`);

    const matching = Object.entries(config.placements).filter(([, entry]) => entry.team === name);
    const shared = Object.values(config.shared).filter((entry) => entry.team === name);
    const pending = config.pending.filter((entry) => entry.team === name);
    const clone = store.teamClone(name);
    const clonePresent = await access(clone).then(() => true, () => false);
    if (matching.length) io.print(`${matching.length} placed skill(s) will be removed.`);
    if (clonePresent) io.print(`Local clone at ${clone} will be removed.`);
    if (shared.length) io.print(`${shared.length} connected skill record(s) will be removed.`);
    if (pending.length) io.print(`${pending.length} pending operation(s) will be removed.`);
    const remote = stripRemoteCredentials(binding.remote);
    if (!(await io.confirm(`Leave ${name}? This removes ${matching.length} placed skill(s) and the local clone; your membership in ${remote} is unchanged.`))) {
      throw new Error('Leave was cancelled.');
    }

    const { removedPaths, cloneRemoved, kept } = await teardownTeam(store, name, io, args.runner);
    const lastTeam = Object.keys((await store.read()).teams).length === 0;
    if (lastTeam) {
      const options = { ...defaultHookOptions(store.root), ...args.hook };
      // The local cleanup above already happened; an unreadable settings.json must not turn it into a failure.
      try { if (await removeHook(options) === 'removed') io.print(`Removed the session hook from ${options.settingsFile}.`); }
      catch (error) { io.print(`Left the session hook in place: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const removed = removedPaths.length;
    io.print(`Left ${name}. You are still an active member of ${remote}; an admin archives membership with team remove ${binding.handle ?? '<handle>'}.`);
    return success({ team: name, remote, handle: binding.handle, removed, cloneRemoved, kept });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}


/**
 * Shared, machine-local teardown. Refusals propagate so callers can report partial cleanup.
 * `protectedSources` lets a caller that tears down several teams keep every authoring source safe
 * for the whole run: this team's teardown drops its own `shared` records, so a later team's
 * placement at one of those paths would otherwise no longer be recognised as a source.
 */
export async function teardownTeam(store: ConfigStore, name: string, io: Pick<Prompter, 'print'>, runner: Runner = systemRunner, protectedSources?: readonly string[]): Promise<{ removedPaths: string[]; cloneRemoved: boolean; kept: string[] }> {
  const releaseTeam = await acquireTeamLock(store.root, name);
  if (!releaseTeam) throw new Error(`Another terum-skills sync holds the session lock on ${name} (${lockPath(store.root, name)}); retry when it finishes, or remove that file if no session is syncing.`);
  const kept: string[] = [];
  const removedPaths: string[] = [];
  let cloneRemoved = false;
  try {
    // The confirmation is an inventory, not authority to delete stale paths: re-read under the mutex.
    const config = await store.read();
    const current = Object.entries(config.placements).filter(([, entry]) => entry.team === name);
    const remaining: typeof current = [];
    const sources = protectedSources ?? Object.values(config.shared).map((entry) => entry.source);
    for (const [path, entry] of current) {
      const placement = resolve(path);
      const shared = sources.find((source) => {
        const authoring = resolve(source);
        return placement === authoring || placement.startsWith(authoring + sep) || authoring.startsWith(placement + sep);
      });
      if (shared === undefined) { remaining.push([path, entry]); continue; }
      await store.update((fresh) => { delete fresh.placements[path]; });
      io.print(`${path} is also the authoring source of ${basename(shared)}; left in place.`);
      kept.push(path); removedPaths.push(path);
    }
    removedPaths.push(...await removePlacements(store, remaining, io));
    const clone = store.teamClone(name);
    await withCloneLock(clone, async (assertHeld) => {
      const present = await access(clone).then(() => true, () => false);
      if (present) {
        // A failed read is not evidence of a clean clone. Preserve it even when git is unavailable.
        const [status, ahead] = await Promise.all([
          runner.run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: clone }).catch(() => null),
          runner.run('git', ['rev-list', '--count', 'origin/main..HEAD'], { cwd: clone }).catch(() => null),
        ]);
        assertHeld();
        if (status?.code === 0 && !status.stdout.trim() && ahead?.code === 0 && ahead.stdout.trim() === '0') {
          await rm(clone, { recursive: true, force: true });
          cloneRemoved = true;
        } else {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const destination = join(store.root, 'quarantine', stamp, `teams-${name}`);
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await moveDirectory(clone, destination);
          io.print(`Local clone ${clone} has uncommitted or unpushed work; moved to ${destination}.`);
          kept.push(destination);
        }
      }
      await Promise.all([
        rm(join(store.root, 'cache', name), { recursive: true, force: true }),
        removeRunArtifacts(store.root, name),
      ]);
    });
    await store.update((fresh) => {
      delete fresh.teams[name];
      for (const [id, entry] of Object.entries(fresh.shared)) if (entry.team === name) delete fresh.shared[id];
      fresh.pending = fresh.pending.filter((entry) => entry.team !== name);
      for (const path of removedPaths) delete fresh.placements[path];
    });
    return { removedPaths, cloneRemoved, kept };
  } finally { await releaseTeam().catch(() => undefined); } // Preserve the original refusal if release fails.
}
