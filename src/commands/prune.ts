import { readdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createConfigStore, type ConfigStore } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, type Result, success } from '../lib/result.js';

export interface PruneArgs extends WithForm { config?: ConfigStore; }
export interface PruneResult { deleted: number; declined: boolean; }

export function underQuarantine(root: string, path: string, separator: string = sep): boolean {
  return path.startsWith(root + separator);
}

/** The only command that permanently removes quarantine output. */
export async function run(args: PruneArgs, io: Prompter): Promise<Result<PruneResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const root = resolve(store.root, 'quarantine');
    let entries: string[];
    try { entries = await readdir(root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { io.print('Quarantine is empty.'); return success({ deleted: 0, declined: false }); }
      throw error;
    }
    const paths = entries.map((entry) => resolve(root, entry)).filter((path) => underQuarantine(root, path));
    if (!paths.length) { io.print('Quarantine is empty.'); return success({ deleted: 0, declined: false }); }
    for (const path of paths) io.print(path);
    if (!(await io.confirm(`Delete ${paths.length} quarantined item(s)?`))) { io.print('Prune cancelled; nothing deleted.'); return success({ deleted: 0, declined: true }); }
    for (const path of paths) await rm(path, { recursive: true, force: false });
    io.print(`Deleted ${paths.length} quarantined item(s).`);
    return success({ deleted: paths.length, declined: false });
  } catch (error) { return fromError(error); }
}
