import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { Prompter } from '../lib/prompt.js';
import { stripRemoteCredentials } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { parseOrExplain, teamNameSchema } from '../lib/schema.js';
import { removePlacements } from './uninstall.js';

export interface LeaveArgs { name: string; config?: ConfigStore; }
export interface LeaveResult { team: string; remote: string; handle: string | null; removed: number; cloneRemoved: boolean; }

/** Leave only this machine: no team-repository mutation and no git invocation. */
export async function run(args: LeaveArgs, io: Prompter): Promise<Result<LeaveResult>> {
  try {
    const name = parseOrExplain(teamNameSchema, args.name, 'team name');
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const binding = config.teams[name];
    if (!binding) throw new Error(`Team ${name} is not configured.`);

    const matching = Object.entries(config.placements).filter(([, entry]) => entry.team === name);
    const shared = Object.values(config.shared).filter((entry) => entry.team === name);
    const pending = config.pending.filter((entry) => entry.team === name);
    const clone = store.teamClone(name);
    const cloneRemoved = await access(clone).then(() => true, () => false);
    if (matching.length) io.print(`${matching.length} placed skill(s) will be removed.`);
    if (cloneRemoved) io.print(`Local clone at ${clone} will be removed.`);
    if (shared.length) io.print(`${shared.length} shared skill record(s) will be removed.`);
    if (pending.length) io.print(`${pending.length} pending operation(s) will be removed.`);
    const remote = stripRemoteCredentials(binding.remote);
    if (!(await io.confirm(`Leave ${name}? This removes ${matching.length} placed skill(s) and the local clone; your membership in ${remote} is unchanged.`))) {
      throw new Error('Leave was cancelled.');
    }

    const removed = await removePlacements(store, matching, io);
    await Promise.all([
      rm(clone, { recursive: true, force: true }),
      rm(join(store.root, 'cache', name), { recursive: true, force: true }),
      rm(join(store.root, 'run', `${name}.stamp`), { force: true }),
      rm(join(store.root, 'teams', `.${name}.safewrite.lock`), { recursive: true, force: true }),
    ]);
    await store.update((fresh) => {
      delete fresh.teams[name];
      for (const [id, entry] of Object.entries(fresh.shared)) if (entry.team === name) delete fresh.shared[id];
      fresh.pending = fresh.pending.filter((entry) => entry.team !== name);
      for (const [path, entry] of Object.entries(fresh.placements)) if (entry.team === name) delete fresh.placements[path];
    });
    io.print(`Left ${name}. You are still an active member of ${remote}; an admin archives membership with team remove ${binding.handle ?? '<handle>'}.`);
    return success({ team: name, remote, handle: binding.handle, removed, cloneRemoved });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}
