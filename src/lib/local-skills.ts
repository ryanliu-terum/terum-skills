import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Config } from './schema.js';
import { inspectSkillSource, scanSkillFolder, type SourceProblem } from './skill-source.js';

export interface SharedRef { id: string; team: string; }
export interface PlacementRef { id: string; team: string; version: string | null; }
export type Inspection =
  | { kind: 'candidate'; description: string; privileged: boolean }
  | { kind: 'rejected'; reason: SourceProblem; detail: string }
  | { kind: 'failed'; reason: string };
export interface LocalEntry { name: string; path: string; shared: SharedRef[]; placement?: PlacementRef; inspection: Inspection; }
export interface LocalInventory {
  root: string;
  scope: 'global';
  rootState: 'scanned' | 'absent' | 'unreadable';
  entries: LocalEntry[];
  problems: { path: string; reason: string }[];
}
export interface LocalCandidates { names: string[]; omitted: { name: string; reason: string }[]; unreadable: number; }

/** Direct entries only. Provenance is ledger evidence, independent of inspection success. */
export async function localSkills(root: string, config: Pick<Config, 'shared' | 'placements'>): Promise<LocalInventory> {
  root = resolve(root);
  const inventory: LocalInventory = { root, scope: 'global', rootState: 'scanned', entries: [], problems: [] };
  let names: string[];
  try { names = (await readdir(root)).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') inventory.rootState = 'absent';
    else { inventory.rootState = 'unreadable'; inventory.problems.push({ path: root, reason: error instanceof Error ? error.message : String(error) }); }
    return inventory;
  }
  for (const name of names) {
    const path = join(root, name);
    const shared = Object.entries(config.shared).filter(([, ref]) => resolve(ref.source) === path).map(([id, ref]) => ({ id, team: ref.team }));
    const placement = Object.entries(config.placements).find(([target]) => resolve(target) === path)?.[1];
    const tracked = shared.length > 0 || placement !== undefined;
    const entry: LocalEntry = { name, path, shared, ...(placement ? { placement: { id: placement.id, team: placement.team, version: placement.version } } : {}), inspection: { kind: 'failed', reason: '' } };
    const reject = (reason: SourceProblem, detail: string): void => { entry.inspection = { kind: 'rejected', reason, detail }; };
    try {
      const details = await lstat(path);
      if (details.isSymbolicLink()) reject('symlink', 'symbolic link');
      else if (!details.isDirectory()) {
        if (!tracked) continue;
        reject('not-a-directory', 'not a directory');
      } else {
        let skill;
        try { skill = await stat(join(path, 'SKILL.md')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (!skill) {
          if (!tracked) continue;
          reject('skill-md-missing', 'SKILL.md missing');
        } else if (!skill.isFile()) reject('skill-md-not-a-file', 'SKILL.md is not a regular file');
        else {
          const inspection = inspectSkillSource(await readFile(join(path, 'SKILL.md'), 'utf8'), tracked ? undefined : name);
          if (!inspection.ok) reject(inspection.reason, inspection.detail);
          else {
            const scan = await scanSkillFolder(path);
            if (scan.symlink) reject('nested-symlink', `contains symlink ${scan.symlink}`);
            else entry.inspection = { kind: 'candidate', description: inspection.description, privileged: scan.privileged };
          }
        }
      }
    } catch (error) { entry.inspection = { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }; }
    inventory.entries.push(entry);
  }
  return inventory;
}

/** The picker offers untracked candidates; privileged content needs explicit opt-in. */
export function candidatesOf(inventory: LocalInventory, allowPrivileged = false): LocalEntry[] {
  return inventory.entries.filter((entry) => !entry.shared.length && !entry.placement && entry.inspection.kind === 'candidate' && (allowPrivileged || !entry.inspection.privileged));
}

/** Issue 7's API remains a projection of the same inspection and provenance. */
export async function localSkillCandidates(root: string, config: Pick<Config, 'shared' | 'placements'>): Promise<LocalCandidates> {
  const inventory = await localSkills(root, config);
  return {
    names: candidatesOf(inventory).map((entry) => entry.name),
    omitted: inventory.entries.flatMap((entry) => !entry.shared.length && !entry.placement && entry.inspection.kind === 'rejected' ? [{ name: entry.name, reason: entry.inspection.detail }] : []),
    unreadable: inventory.problems.length + inventory.entries.filter((entry) => entry.inspection.kind === 'failed').length,
  };
}
