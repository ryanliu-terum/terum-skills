import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Config } from './schema.js';
import { AGENT_PATHS } from './placer/agent-paths.js';
import { assertNotInsideStateRoot, inspectSkillSource, scanSkillFolder, type SourceProblem } from './skill-source.js';

export interface SharedRef { id: string; team: string; }
export interface PlacementRef { id: string; team: string; version: string | null; }
export type Inspection =
  | { kind: 'candidate'; description: string; privileged: boolean }
  | { kind: 'rejected'; reason: SourceProblem; detail: string; description?: string }
  | { kind: 'failed'; reason: string };
export interface LocalEntry { skillId: string | null; name: string; path: string; shared: SharedRef[]; placement?: PlacementRef; placementFingerprint?: string; characters?: number; inspection: Inspection; }
export interface LocalInventory {
  root: string;
  scope: 'global' | 'project';
  rootState: 'scanned' | 'absent' | 'unreadable';
  entries: LocalEntry[];
  problems: { path: string; reason: string }[];
}
export interface LocalRoot { root: string; scope: 'global' | 'project'; repoRoot?: string; registered: boolean; detected: boolean; }

/**
 * Discovery is filesystem-only: the nearest .git file or directory selects the project root.
 * install's currentRepoRoot and sync's matchingProjectRoot are git+remote-validated PLACEMENT
 * resolvers (§5.2); they deliberately remain separate from this read-only discovery operation.
 */
export async function nearestRepoRoot(cwd: string, problems: { path: string; reason: string }[] = []): Promise<string | undefined> {
  let dir = resolve(cwd);
  for (;;) {
    const marker = join(dir, '.git');
    try {
      const entry = await lstat(marker);
      if (entry.isFile() || entry.isDirectory()) return dir;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        problems.push({ path: marker, reason: error instanceof Error ? error.message : String(error) });
        return undefined;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function localSkillRoots(home: string, cwd?: string, checkouts: readonly string[] = [], extraRoots: readonly string[] = []): Promise<{ roots: LocalRoot[]; noRepository?: string; problems: { path: string; reason: string }[] }> {
  const roots: LocalRoot[] = [{ root: AGENT_PATHS['claude-code'].global(home), scope: 'global', registered: false, detected: false }];
  const problems: { path: string; reason: string }[] = [];
  const canonicalHome = await realpath(home).catch(() => resolve(home));
  const seenRepos = new Set([canonicalHome]);
  const seenSkills = new Set([await realpath(roots[0]!.root).catch(() => resolve(roots[0]!.root))]);
  const append = async (dir: string, registered: boolean): Promise<void> => {
    const canonical = await realpath(dir).catch(() => resolve(dir));
    const project = AGENT_PATHS['claude-code'].project(dir);
    // Retain cwd discovery's permission diagnostics. Registered roots stay visible even unreadable.
    if (!registered) {
      try { await access(project, constants.R_OK | constants.X_OK); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          problems.push({ path: project, reason: error instanceof Error ? error.message : String(error) });
          return;
        }
      }
    }
    const projectPath = await realpath(project).catch(() => AGENT_PATHS['claude-code'].project(canonical));
    if (seenRepos.has(canonical) || seenSkills.has(projectPath)) return;
    seenRepos.add(canonical); seenSkills.add(projectPath);
    roots.push({ root: project, scope: 'project', repoRoot: dir, registered, detected: !registered });
  };
  for (const root of checkouts) await append(root, true);
  let noRepository: string | undefined;
  if (cwd !== undefined) {
    const before = problems.length;
    const repo = await nearestRepoRoot(cwd, problems);
    if (repo) await append(repo, false);
    else if (before === problems.length) noRepository = cwd;
  }
  for (const root of extraRoots) await append(root, false);
  return { roots, ...(noRepository === undefined ? {} : { noRepository }), problems };
}

export function localRootLabel(root: LocalRoot): string { return root.repoRoot === undefined ? 'Global' : basename(root.repoRoot); }

export async function canonicalLedger(config: Pick<Config, 'shared' | 'placements'>) {
  const [sharedPaths, placementPaths] = await Promise.all([
    Promise.all(Object.entries(config.shared).map(async ([id, ref]) => ({ id, ref, canonical: await canonicalParentPath(resolve(ref.source)) }))),
    Promise.all(Object.entries(config.placements).map(async ([target, ref]) => ({ target, ref, canonical: await canonicalParentPath(resolve(target)) }))),
  ]);
  return { sharedPaths, placementPaths };
}

/** Canonicalize only the parent: a child symlink must remain a distinct, rejected entry. */
export async function canonicalParentPath(path: string): Promise<string | undefined> {
  try { return join(await realpath(dirname(path)), basename(path)); }
  catch { return undefined; }
}

/** Direct entries only. Provenance is ledger evidence, independent of inspection success. */
export async function localSkills(root: string, config: Pick<Config, 'shared' | 'placements'>, options: { scope: LocalRoot['scope']; stateRoot: string; ledger?: Awaited<ReturnType<typeof canonicalLedger>> }): Promise<LocalInventory> {
  root = resolve(root);
  const inventory: LocalInventory = { root, scope: options.scope, rootState: 'scanned', entries: [], problems: [] };
  let names: string[];
  try { names = (await readdir(root)).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') inventory.rootState = 'absent';
    else { inventory.rootState = 'unreadable'; inventory.problems.push({ path: root, reason: error instanceof Error ? error.message : String(error) }); }
    names = [];
  }
  const { sharedPaths, placementPaths } = options.ledger ?? await canonicalLedger(config);
  const canonicalRoot = await realpath(root).catch(() => root);
  for (const { target, canonical } of placementPaths) {
    if (dirname(resolve(target)) !== root && (canonical === undefined || dirname(canonical) !== canonicalRoot)) continue;
    try { await lstat(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') inventory.problems.push({ path: target, reason: 'placement recorded in the ledger but the folder is missing' });
    }
  }
  for (const name of names) {
    const path = join(root, name);
    const canonical = await canonicalParentPath(path);
    const shared = sharedPaths.filter(({ ref, canonical: reference }) => resolve(ref.source) === path || (canonical !== undefined && reference === canonical)).map(({ id, ref }) => ({ id, team: ref.team }));
    const placement = placementPaths.find(({ target, canonical: reference }) => resolve(target) === path || (canonical !== undefined && reference === canonical))?.ref;
    const tracked = shared.length > 0 || placement !== undefined;
    const entry: LocalEntry = { skillId: null, name, path, shared, ...(placement ? { placement: { id: placement.id, team: placement.team, version: placement.version }, placementFingerprint: placement.fingerprint } : {}), inspection: { kind: 'failed', reason: '' } };
    const reject = (reason: SourceProblem, detail: string, description?: string): void => { entry.inspection = { kind: 'rejected', reason, detail, ...(description === undefined ? {} : { description }) }; };
    try {
      const details = await lstat(path);
      if (details.isSymbolicLink()) {
        reject('symlink', 'symbolic link');
        inventory.entries.push(entry);
        continue;
      }
      try { assertNotInsideStateRoot(path, options.stateRoot); }
      catch {
        reject('inside-state-root', `inside the terum-skills state directory ${options.stateRoot}`);
        inventory.entries.push(entry);
        continue;
      }
      if (!details.isDirectory()) {
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
          const raw = await readFile(join(path, 'SKILL.md'), 'utf8');
          // String.prototype.length counts UTF-16 code units, the same basis HYG6's 20,000-character
          // guideline uses; the file is already in hand, so the count costs no extra read.
          entry.characters = raw.length;
          const inspection = inspectSkillSource(raw, tracked ? undefined : name);
          if (!inspection.ok) reject(inspection.reason, inspection.detail, inspection.description);
          else {
            const scan = await scanSkillFolder(path);
            if (scan.symlink) reject('nested-symlink', `contains symlink ${scan.symlink}`);
            else { entry.skillId = inspection.id; entry.inspection = { kind: 'candidate', description: inspection.description, privileged: scan.privileged }; }
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


/** F2 wire formula: every displayed row, plus untracked folders rejected for frontmatter. */
const FRONTMATTER_PROBLEMS: ReadonlySet<SourceProblem> = new Set(['no-frontmatter', 'invalid-yaml', 'illegal-name', 'name-mismatch', 'description-missing', 'unsupported-field', 'malformed-allowed-tools', 'managed-wrapper']);
export function localSkillCounts(inventory: LocalInventory): { skillFolders: number; connectable: number } {
  const skillFolders = inventory.entries.filter(entry => entry.shared.length > 0 || entry.placement !== undefined || entry.inspection.kind === 'candidate' || (entry.inspection.kind === 'rejected' && FRONTMATTER_PROBLEMS.has(entry.inspection.reason))).length;
  return { skillFolders, connectable: candidatesOf(inventory).length };
}
