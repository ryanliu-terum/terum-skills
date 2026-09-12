import { mapWithConcurrency } from './concurrency.js';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { FRONTMATTER, type Config, type LibraryProject } from './schema.js';
import { AGENT_PATHS } from './placer/agent-paths.js';
import { assertNotInsideStateRoot, inspectSkillSource, scanSkillFolder, type SourceProblem } from './skill-source.js';

/** Per-folder scans overlap: on a UNC/9P root the cost is latency, not CPU (W-02). */
const LOCAL_SCAN_CONCURRENCY = 8;

export interface PlacementRef { id: string; team: string; version: string | null; }
export type Inspection =
  | { kind: 'candidate'; description: string; privileged: boolean }
  | { kind: 'rejected'; reason: SourceProblem; detail: string; description?: string }
  | { kind: 'failed'; reason: string };
export interface LocalEntry { frontmatter: string | null; skillId: string | null; name: string; path: string; placement?: PlacementRef; placementFingerprint?: string; characters?: number; category: string | null; inspection: Inspection; }
export interface LocalInventory {
  root: string;
  scope: 'global' | 'project';
  rootState: 'scanned' | 'absent' | 'unreadable';
  entries: LocalEntry[];
  problems: { path: string; reason: string }[];
}
/**
 * §7.2: a project root is here because the user added it, so there is no `detected` any more — the
 * two things that produced it (the cwd-detected root and `ls`'s ledger-inferred `extraRoots`) were
 * the app adding a project by itself. `label` is the user-facing name carried on `config.projects`.
 */
export interface LocalRoot { root: string; scope: 'global' | 'project'; repoRoot?: string; registered: boolean; label?: string; }

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

export async function localSkillRoots(home: string, projects: readonly LibraryProject[] = []): Promise<{ roots: LocalRoot[]; problems: { path: string; reason: string }[] }> {
  const roots: LocalRoot[] = [{ root: AGENT_PATHS['claude-code'].global(home), scope: 'global', registered: false }];
  const problems: { path: string; reason: string }[] = [];
  const canonicalHome = await realpath(home).catch(() => resolve(home));
  const seenRepos = new Set([canonicalHome]);
  const seenSkills = new Set([await realpath(roots[0]!.root).catch(() => resolve(roots[0]!.root))]);
  // A root the user added stays visible even when it is unreadable: hiding it would make the Library
  // disagree with the list the user can see in Settings, which is the opposite of what it is for.
  const append = async (dir: string, label: string): Promise<void> => {
    const canonical = await realpath(dir).catch(() => resolve(dir));
    const project = AGENT_PATHS['claude-code'].project(dir);
    const projectPath = await realpath(project).catch(() => AGENT_PATHS['claude-code'].project(canonical));
    if (seenRepos.has(canonical) || seenSkills.has(projectPath)) return;
    seenRepos.add(canonical); seenSkills.add(projectPath);
    roots.push({ root: project, scope: 'project', repoRoot: dir, registered: true, label });
  };
  for (const project of projects) await append(project.root, project.label);
  return { roots, problems };
}

/** §7.1: the label the user chose the project by. `basename` remains the fallback for a root with no stored label. */
export function localRootLabel(root: LocalRoot): string { return root.repoRoot === undefined ? 'Global' : root.label ?? basename(root.repoRoot); }

export async function canonicalLedger(config: Pick<Config, 'placements'>) {
  const placementPaths = await Promise.all(Object.entries(config.placements).map(async ([target, ref]) => ({ target, ref, canonical: await canonicalParentPath(resolve(target)) })));
  return { placementPaths };
}

/** Canonicalize only the parent: a child symlink must remain a distinct, rejected entry. */
export async function canonicalParentPath(path: string): Promise<string | undefined> {
  try { return join(await realpath(dirname(path)), basename(path)); }
  catch { return undefined; }
}

function entryProvenance(path: string, canonical: string | undefined, { placementPaths }: Awaited<ReturnType<typeof canonicalLedger>>) {
  const placement = placementPaths.find(({ target, canonical: reference }) => resolve(target) === path || (canonical !== undefined && reference === canonical))?.ref;
  return { placement };
}

/** Direct entries only. Provenance is ledger evidence, independent of inspection success. */
export async function localSkills(root: string, config: Pick<Config, 'placements'>, options: { scope: LocalRoot['scope']; stateRoot: string; ledger?: Awaited<ReturnType<typeof canonicalLedger>> }): Promise<LocalInventory> {
  root = resolve(root);
  const inventory: LocalInventory = { root, scope: options.scope, rootState: 'scanned', entries: [], problems: [] };
  let names: string[];
  try { names = (await readdir(root)).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') inventory.rootState = 'absent';
    else { inventory.rootState = 'unreadable'; inventory.problems.push({ path: root, reason: error instanceof Error ? error.message : String(error) }); }
    names = [];
  }
  const { placementPaths } = options.ledger ?? await canonicalLedger(config);
  // One realpath per call: every name is one segment beneath the resolved root.
  // Keep undefined on failure so ledger comparisons retain their exact resolve() fallback.
  const realRoot = await realpath(root).then((value) => value, () => undefined);
  const canonicalRoot = realRoot ?? root;
  for (const { target, canonical } of placementPaths) {
    if (dirname(resolve(target)) !== root && (canonical === undefined || dirname(canonical) !== canonicalRoot)) continue;
    try { await lstat(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') inventory.problems.push({ path: target, reason: 'placement recorded in the ledger but the folder is missing' });
    }
  }
  const scanned = await mapWithConcurrency(names, LOCAL_SCAN_CONCURRENCY, async (name): Promise<LocalEntry | null> => {
    const path = join(root, name);
    const canonical = realRoot === undefined ? undefined : join(realRoot, name);
    const { placement } = entryProvenance(path, canonical, { placementPaths });
    const tracked = placement !== undefined;
    const entry: LocalEntry = { frontmatter: null, skillId: null, category: null, name, path, ...(placement ? { placement: { id: placement.id, team: placement.team, version: placement.version }, placementFingerprint: placement.fingerprint } : {}), inspection: { kind: 'failed', reason: '' } };
    const reject = (reason: SourceProblem, detail: string, description?: string): void => { entry.inspection = { kind: 'rejected', reason, detail, ...(description === undefined ? {} : { description }) }; };
    try {
      const details = await lstat(path);
      if (details.isSymbolicLink()) {
        reject('symlink', 'symbolic link');
        return entry;
      }
      try { assertNotInsideStateRoot(path, options.stateRoot); }
      catch {
        reject('inside-state-root', `inside the terum-skills state directory ${options.stateRoot}`);
        return entry;
      }
      if (!details.isDirectory()) {
        if (!tracked) return null;
        reject('not-a-directory', 'not a directory');
      } else {
        let skill;
        try { skill = await stat(join(path, 'SKILL.md')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (!skill) {
          if (!tracked) return null;
          reject('skill-md-missing', 'SKILL.md missing');
        } else if (!skill.isFile()) reject('skill-md-not-a-file', 'SKILL.md is not a regular file');
        else {
          const raw = await readFile(join(path, 'SKILL.md'), 'utf8');
          // String.prototype.length counts UTF-16 code units, the same basis HYG6's 20,000-character
          // guideline uses; the file is already in hand, so the count costs no extra read.
          entry.characters = raw.length;
          entry.frontmatter = FRONTMATTER.exec(raw)?.[0].replace(/\r?\n$/, '') ?? null;
          const inspection = inspectSkillSource(raw, tracked ? undefined : name);
          entry.category = inspection.category ?? null;
          if (!inspection.ok) reject(inspection.reason, inspection.detail, inspection.description);
          else {
            const scan = await scanSkillFolder(path);
            if (scan.symlink) reject('nested-symlink', `contains symlink ${scan.symlink}`);
            else { entry.skillId = inspection.id; entry.inspection = { kind: 'candidate', description: inspection.description, privileged: scan.privileged }; }
          }
        }
      }
    } catch (error) { entry.inspection = { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }; }
    return entry;
  });
  for (const entry of scanned) if (entry !== null) inventory.entries.push(entry);
  return inventory;
}

/** The picker offers untracked candidates; privileged content needs explicit opt-in. */
export function candidatesOf(inventory: LocalInventory, allowPrivileged = false): LocalEntry[] {
  return inventory.entries.filter((entry) => !entry.placement && entry.inspection.kind === 'candidate' && (allowPrivileged || !entry.inspection.privileged));
}


/** F2 wire formula: every displayed row, plus untracked folders rejected for frontmatter. */
const FRONTMATTER_PROBLEMS: ReadonlySet<SourceProblem> = new Set(['no-frontmatter', 'invalid-yaml', 'illegal-name', 'name-mismatch', 'description-missing', 'unsupported-field', 'malformed-allowed-tools', 'managed-wrapper']);
export function localSkillCounts(inventory: LocalInventory): { skillFolders: number; connectable: number } {
  const skillFolders = inventory.entries.filter(entry => entry.placement !== undefined || entry.inspection.kind === 'candidate' || (entry.inspection.kind === 'rejected' && FRONTMATTER_PROBLEMS.has(entry.inspection.reason))).length;
  return { skillFolders, connectable: candidatesOf(inventory).length };
}

/** A run-local snapshot: discovery and each root walk happen at most once, on demand. */
export interface LibraryScan {
  roots(): Promise<LocalRoot[]>;
  inventory(root: LocalRoot, config: Pick<Config, 'placements'>): Promise<LocalInventory>;
}

export function createLibraryScan(home: string, projects: readonly LibraryProject[], stateRoot: string): LibraryScan {
  let roots: Promise<LocalRoot[]> | undefined;
  const ledgers = new WeakMap<Pick<Config, 'placements'>, ReturnType<typeof canonicalLedger>>();
  const inventories = new Map<string, Promise<LocalInventory>>();
  return {
    roots: () => roots ??= localSkillRoots(home, projects).then(discovery => discovery.roots),
    async inventory(root, config) {
      let ledger = ledgers.get(config);
      if (!ledger) { ledger = canonicalLedger(config); ledgers.set(config, ledger); }
      const previous = inventories.get(root.root);
      if (!previous) {
        const inventory = ledger.then(ledger => localSkills(root.root, config, { scope: root.scope, stateRoot, ledger }));
        inventories.set(root.root, inventory);
        return inventory;
      }
      const inventory = await previous;
      // Rebind placement provenance from the current ledger without another folder walk.
      const currentLedger = await ledger;
      const canonicalRoot = await realpath(inventory.root).then(value => value, () => undefined);
      const entries = inventory.entries.map(entry => {
        const canonical = canonicalRoot === undefined ? undefined : join(canonicalRoot, entry.name);
        const { placement } = entryProvenance(entry.path, canonical, currentLedger);
        const source = { ...entry };
        delete source.placement;
        delete source.placementFingerprint;
        return { ...source, ...(placement ? { placement: { id: placement.id, team: placement.team, version: placement.version }, placementFingerprint: placement.fingerprint } : {}) };
      });
      return { ...inventory, entries };
    },
  };
}

/**
 * How many skill folders this machine holds, for the roster's per-member total (`person.local_skills`).
 * The roots are the ones the product owns — the global root plus every registered project checkout —
 * and never a root merely discovered from the current directory, so the number does not change with
 * where a sync happened to run. The per-root formula is `localSkillCounts().skillFolders`, the same one
 * the Library prints, so a machine never reports two different totals: every displayed row plus a
 * folder rejected only over its frontmatter, because an unshareable folder is still a skill the person
 * has. An absent root contributes 0 — a machine with no global skills folder really has no skills
 * there — but an *unreadable* one makes the whole answer null: not being able to look is not the same
 * as looking and finding nothing, and the caller must leave the last known total alone rather than
 * publish a wrong zero. This is a best-effort self-report, not an audit.
 */
export async function librarySize(home: string, config: Pick<Config, 'placements' | 'projects'>, stateRoot: string, scan = createLibraryScan(home, config.projects ?? [], stateRoot)): Promise<number | null> {
  let total = 0;
  for (const root of await scan.roots()) {
    if (root.scope !== 'global' && !root.registered) continue;
    const inventory = await scan.inventory(root, config);
    if (inventory.rootState === 'unreadable') return null;
    total += localSkillCounts(inventory).skillFolders;
  }
  return total;
}
