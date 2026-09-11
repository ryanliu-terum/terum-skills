import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { underCheckout, checkoutPath } from './checkouts.js';
import { canonicalLedger, localSkillCounts, localSkills } from './local-skills.js';
import type { Config } from './schema.js';

export const DEFAULT_MAX_DEPTH = 4;
export const DEFAULT_BUDGET_MS = 20_000;
/** A progress report costs a frame; one every quarter second is enough for a person to see motion. */
export const PROGRESS_INTERVAL_MS = 250;
/** How many directories are read at once. Mirrors the chunk size ls uses for skill records. */
export const SCAN_CONCURRENCY = 8;
/** Folder names never worth walking, lowercased. Dot-directories are skipped; .claude is only probed. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', '.cache', '.npm', '.pnpm', '.yarn', '.venv', 'venv',
  '__pycache__', '.terum', '.vscode', '.idea', 'library', 'appdata', 'snap', '.trash', '$recycle.bin',
  'system volume information',
]);

export interface DiscoverCandidate {
  /** The folder that holds `.claude/skills`, resolved but never realpath'd away. */
  path: string;
  /** Same count as checkout list (localSkills + localSkillCounts). */
  skillFolders: number;
  /** Its canonical path is already in config.checkouts. */
  registered: boolean;
  /** It has a .git entry (file or directory). */
  repoRoot: boolean;
}
export interface DiscoverProblem { path: string; reason: string }
export interface DiscoverResult {
  candidates: DiscoverCandidate[];
  scanned: number;
  truncated: boolean;
  problems: DiscoverProblem[];
}
export interface DiscoverOptions {
  under: readonly string[];
  home: string;
  checkouts: readonly string[];
  stateRoot: string;
  config: Pick<Config, 'shared' | 'placements'>;
  maxDepth?: number;
  budgetMs?: number;
  onProgress?: (progress: { scanned: number; found: number; current: string }) => void;
  signal?: AbortSignal;
  /** Test knob for the clock, like EvalArgs.now. */
  now?: () => number;
}

export async function discoverSkillRoots(options: DiscoverOptions): Promise<DiscoverResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const ledger = await canonicalLedger(options.config);
  const registered = new Set(await Promise.all(options.checkouts.map(checkoutPath)));
  const canonicalHome = await checkoutPath(options.home);
  const stateRoot = resolve(options.stateRoot);
  const frontier = [...new Set(options.under.map((dir) => resolve(dir)))].map((dir) => ({ dir, depth: 0 }));
  const seen = new Set(frontier.map((entry) => entry.dir));
  const candidates: DiscoverCandidate[] = [];
  const problems: DiscoverProblem[] = [];
  let scanned = 0;
  let truncated = false;
  let lastProgress = started;
  const problem = (path: string, error: unknown): void => { problems.push({ path, reason: error instanceof Error ? error.message : String(error) }); };
  function maybeProgress(current: string): void {
    if (now() - lastProgress >= PROGRESS_INTERVAL_MS) {
      options.onProgress?.({ scanned, found: candidates.length, current });
      lastProgress = now();
    }
  }
  async function hasSkillFolder(skillsRoot: string): Promise<boolean> {
    let entries;
    try { entries = await readdir(skillsRoot, { withFileTypes: true }); }
    catch (error) {
      // A `.claude` that holds no `skills/` (or holds a `skills` file) is the ordinary shape of a project
      // folder, not something a person needs told about. Anything else — EACCES, EIO — is still a problem.
      // The SKILL.md stat below already filters exactly these two codes.
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) problem(skillsRoot, error);
      return false;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(skillsRoot, entry.name, 'SKILL.md');
      try { if ((await stat(path)).isFile()) return true; }
      catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) problem(path, error);
      }
    }
    return false;
  }
  async function visit({ dir, depth }: { dir: string; depth: number }): Promise<void> {
    // Explicit roots must honour the same exclusion as children — but an explicit root that is refused
    // says so, the way registerCheckout's assertNotInsideStateRoot does; a child is dropped silently (D8).
    if (underCheckout(dir, stateRoot)) {
      if (depth === 0) problems.push({ path: dir, reason: 'inside the terum state directory; not searched' });
      return;
    }
    if (options.signal?.aborted || now() - started >= budgetMs) { truncated = true; return; }
    scanned += 1;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { problem(dir, error); return; }
    const repoRoot = entries.some((entry) => entry.name === '.git');
    if (entries.some((entry) => entry.name === '.claude' && entry.isDirectory()) &&
        resolve(dir) !== resolve(options.home) && await checkoutPath(dir) !== canonicalHome) {
      const skillsRoot = join(dir, '.claude', 'skills');
      if (await hasSkillFolder(skillsRoot)) {
        const inventory = await localSkills(skillsRoot, options.config, { scope: 'project', stateRoot: options.stateRoot, ledger });
        const skillFolders = localSkillCounts(inventory).skillFolders;
        candidates.push({ path: resolve(dir), skillFolders, registered: registered.has(await checkoutPath(dir)), repoRoot });
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.claude' || entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      const child = join(dir, entry.name);
      if (depth + 1 > maxDepth || seen.has(child) || underCheckout(child, stateRoot)) continue;
      seen.add(child);
      frontier.push({ dir: child, depth: depth + 1 });
    }
    maybeProgress(dir);
  }
  while (frontier.length > 0) {
    if (options.signal?.aborted || now() - started >= budgetMs) { truncated = true; break; }
    const chunk = frontier.splice(0, SCAN_CONCURRENCY);
    await Promise.all(chunk.map(visit));
    if (truncated) break;
  }
  options.onProgress?.({ scanned, found: candidates.length, current: '' });
  candidates.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  problems.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { candidates, scanned, truncated, problems };
}
