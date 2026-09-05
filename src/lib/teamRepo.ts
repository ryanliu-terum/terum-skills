import { readFileSync } from 'node:fs';
import { lstat, mkdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import lockfile from 'proper-lockfile';
import { gitAuthEnv } from './auth.js';
import { mkdirPrivate } from './fs.js';
import { guard, GuardContext, GuardError, GuardTree } from './guard.js';
import { isGitHubRemote, normalizeRemote, remoteToGitUrl } from './remote.js';
import { CommandResult, Runner, systemRunner } from './runner.js';
import { regenerateReadmeInTree } from './readme.js';

/**
 * §6.0: every write to the team repo goes through `safeWrite()` — a re-apply model, not a rebase.
 * fetch → hard-reset to origin/main → re-run the PURE mutation on the tree it is handed → guard
 * the result → write and stage exactly the paths it changed → prove the staged diff equals those
 * paths → commit → push to refs/heads/<branch> only → on a lost race retry with full-jitter
 * backoff until a 30-second deadline. A `finally` step resets the clone to origin/main and removes
 * the untracked paths this operation created, whether the loop succeeded, failed, or threw.
 */
export interface MutableTree extends GuardTree {
  set(path: string, content: string | Buffer): void;
  remove(path: string): void;
  /** Tracked paths in the freshly reset tree. Needed to make a skill-folder update a true mirror. */
  paths(prefix?: string): readonly string[];
}
export type Mutate = (tree: MutableTree) => void;

export interface SafeWriteOptions extends GuardContext {
  /** Destination ref. Defaults to `main`; PR-policy `publish` passes `publish/<name>` (§6.0 step 4). */
  branch?: string;
  /** Commit message; defaults to `<handle>: <action>`. */
  message?: string;
  /** Per-team PAT for git auth (§5.4); ambient credentials when null. */
  token?: string | null;
  deadlineMs?: number;
  backoff?: (attempt: number) => number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface SafeWriteResult { changed: boolean; pushedTo: string; }

export interface TeamRepo {
  readonly root: string;
  readonly remote: string;
  safeWrite(mutate: Mutate, options: SafeWriteOptions): Promise<SafeWriteResult>;
}

/** The deadline passed while the remote kept moving ahead (§6.0 step 5). */
export class SafeWriteExhausted extends Error {
  constructor(message: string) { super(message); this.name = 'SafeWriteExhausted'; }
}
/** The remote refused the push for a reason a retry cannot fix (permissions, protection, auth). */
export class PushRefused extends Error {
  constructor(message: string) { super(message); this.name = 'PushRefused'; }
}

export const DEFAULT_DEADLINE_MS = 30_000;
const defaultBackoff = (attempt: number): number => Math.floor(Math.random() * Math.min(1_000, 25 * 2 ** attempt));
const wait = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));
/** git's non-fast-forward vocabulary: the only push failures a retry can fix. */
const RETRYABLE = /fetch first|non-fast-forward|cannot lock ref|failed to lock|stale info|incorrect old value|remote ref updated since checkout/i;
const STALE_LEASE = /stale info/i;

type Git = (args: readonly string[]) => Promise<CommandResult>;

export function openTeamRepo(root: string, remote: string, runner: Runner = systemRunner): TeamRepo {
  return { root, remote, safeWrite: (mutate, options) => safeWrite(root, remote, runner, mutate, options) };
}

async function safeWrite(root: string, remote: string, runner: Runner, mutate: Mutate, options: SafeWriteOptions): Promise<SafeWriteResult> {
  const env = gitAuthEnv(options.token);
  const git: Git = (args) => runner.run('git', args, { cwd: root, env });
  const requireGit = async (args: readonly string[]) => {
    const result = await git(args);
    if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
    return result;
  };

  await assertOrigin(root, remote, git);
  const realRoot = await realpath(root);

  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const branch = options.branch ?? 'main';
  const created = new Set<string>();
  let attempt = 0;
  let lastError = 'push rejected';

  // One writer per clone per machine; a second process waits briefly, then fails rather than racing.
  const release = await lockfile.lock(root, {
    lockfilePath: join(dirname(root), `.${basename(root)}.safewrite.lock`),
    realpath: false,
    stale: 60_000,
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
    onCompromised: () => undefined,
  });
  try {
    while (now() <= deadline) {
      await requireGit(['fetch', 'origin']);
      await requireGit(['reset', '--hard', 'origin/main']);
      const tracked = new Set((await requireGit(['ls-files', '-z'])).stdout.split('\0').filter(Boolean));
      const tree = makeTree(root, tracked);
      mutate(tree);
      // Authorize the caller's own pure mutation before deriving any files from it. This keeps a
      // forbidden skill write from being reported as a frontmatter/README generation error.
      if (tree.changedPaths.length === 0) return { changed: false, pushedTo: branch };
      guard(tree, options);
      // §9: Actions own GitHub README commits; generic remotes regenerate as a derived safeWrite path.
      let changed = tree.changedPaths;
      for (const path of changed) if (!tracked.has(path) && tree.after(path) !== undefined) created.add(path);
      await applyTree(root, realRoot, tree, changed);
      await requireGit(['add', '-A', '--', ...changed]);
      if (!isGitHubRemote(remote)) {
        // The index is the exact tree about to be committed, including the caller's mutation.
        // Resolve every skill version from it in one git call before deriving README.md.
        const writtenTree = (await requireGit(['write-tree'])).stdout.trim();
        const latestBySkill = await skillTrees(git, writtenTree);
        await regenerateReadmeInTree(tree, remote, runner, root, latestBySkill);
        changed = tree.changedPaths;
        for (const path of changed) if (!tracked.has(path) && tree.after(path) !== undefined) created.add(path);
        const readmeChanged = changed.filter((path) => path === 'README.md');
        if (readmeChanged.length) {
          await applyTree(root, realRoot, tree, readmeChanged);
          await requireGit(['add', '-A', '--', ...readmeChanged]);
        }
      }
      const staged = (await requireGit(['diff', '--cached', '--name-only', '--no-renames', '-z'])).stdout.split('\0').filter(Boolean).sort();
      if (JSON.stringify(staged) !== JSON.stringify([...changed].sort())) {
        throw new GuardError(`Staged diff [${staged.join(', ')}] does not match the mutation [${changed.join(', ')}]`);
      }
      await requireGit(['commit', '-q', '-m', options.message ?? `${options.handle}: ${options.action}`]);
      const outcome = await push(git, branch);
      if (outcome.ok) return { changed: true, pushedTo: outcome.pushedTo };
      if (!outcome.retryable) throw new PushRefused(`The remote refused the push: ${outcome.error.trim()}`);
      lastError = outcome.error;
      if (now() >= deadline) break;
      await (options.sleep ?? wait)((options.backoff ?? defaultBackoff)(attempt++));
    }
    throw new SafeWriteExhausted(`safeWrite deadline exhausted after ${attempt + 1} attempt(s); the remote kept moving ahead: ${lastError.trim()}`);
  } finally {
    // Cleanup can never change the outcome: the next safeWrite fetches and hard-resets anyway.
    try {
      await git(['fetch', 'origin']);
      await git(['reset', '--hard', 'origin/main']);
      for (const path of created) {
        const tracked = await git(['ls-files', '--error-unmatch', '--', path]);
        if (tracked.code !== 0) await removeCreated(root, realRoot, path);
      }
    } catch {
      // swallowed on purpose; see above
    } finally {
      await release();
    }
  }
}

async function assertOrigin(root: string, remote: string, git: Git): Promise<void> {
  const origin = await git(['remote', 'get-url', 'origin']);
  if (origin.code !== 0) throw new Error(`Clone at ${root} has no origin remote`);
  const actual = origin.stdout.trim();
  if (normalizeRemote(actual) !== normalizeRemote(remote)) {
    throw new Error(`Clone at ${root} points at ${actual}, not ${remote}; refusing to write to the wrong repository`);
  }
}

/**
 * Push to exactly the named ref. `main` is a plain push. A derived branch (`publish/<name>`) is
 * replaced under a lease; only a genuinely stale lease falls back to `<branch>-2`, once. Any
 * other refusal is terminal and carries git's own message.
 */
async function push(git: Git, branch: string): Promise<{ ok: true; pushedTo: string } | { ok: false; retryable: boolean; error: string }> {
  if (branch === 'main') {
    const result = await git(['push', '-q', 'origin', 'HEAD:refs/heads/main']);
    if (result.code === 0) return { ok: true, pushedTo: 'main' };
    const error = result.stderr || result.stdout || 'push rejected';
    return { ok: false, retryable: RETRYABLE.test(error), error };
  }
  let lastError = '';
  for (const target of [branch, `${branch}-2`]) {
    const result = await git(['push', '-q', '--force-with-lease', 'origin', `HEAD:refs/heads/${target}`]);
    if (result.code === 0) return { ok: true, pushedTo: target };
    lastError = result.stderr || result.stdout || 'push rejected';
    if (!STALE_LEASE.test(lastError)) return { ok: false, retryable: false, error: lastError };
  }
  return { ok: false, retryable: true, error: lastError };
}

/** Repo-relative POSIX paths only: no absolute paths, no `..`, no `.git` anywhere (any case, NTFS short names included), no empty segments. */
export function assertSafePath(path: string): void {
  const segments = path.split('/');
  const gitLike = (segment: string) => segment.toLowerCase() === '.git' || /^git~\d+$/i.test(segment);
  const bad = path === '' || path.startsWith('/') || path.includes('\\') || segments.some((segment) => segment === '' || segment === '.' || segment === '..' || gitLike(segment)) || posix.normalize(path) !== path;
  if (bad) throw new GuardError(`Refusing to write unsafe path ${JSON.stringify(path)}`);
}

/** The tree handed to a mutation: lazy reads of the reset checkout plus an overlay of its edits. */
function makeTree(root: string, tracked: ReadonlySet<string>): MutableTree {
  const cache = new Map<string, Buffer>();
  const overlay = new Map<string, string | Buffer | undefined>();
  const before = (path: string): string | Buffer | undefined => {
    if (!tracked.has(path)) return undefined;
    let content = cache.get(path);
    if (content === undefined) { content = readFileSync(join(root, path)); cache.set(path, content); }
    return content;
  };
  return {
    before,
    after: (path) => {
      const content = overlay.has(path) ? overlay.get(path) : before(path);
      return content;
    },
    get changedPaths() {
      return [...overlay.keys()].filter((path) => !sameContent(overlay.get(path), before(path))).sort();
    },
    set(path, content) { assertSafePath(path); overlay.set(path, content); },
    remove(path) { assertSafePath(path); overlay.set(path, undefined); },
    paths(prefix = '') {
      return [...new Set([...tracked, ...overlay.keys()])]
        .filter((path) => (!overlay.has(path) || overlay.get(path) !== undefined) && path.startsWith(prefix))
        .sort();
    },
  };
}

function sameContent(left: string | Buffer | undefined, right: string | Buffer | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (Buffer.isBuffer(left) && Buffer.isBuffer(right)) return left.equals(right);
  if (typeof left === 'string' && typeof right === 'string') return left === right;
  return Buffer.isBuffer(left) ? left.equals(Buffer.from(right as string)) : Buffer.from(left).equals(right as Buffer);
}

/** Decode a tree value only at a text consumer; binary paths stay byte-for-byte in the tree. */
export function treeText(value: string | Buffer): string { return Buffer.isBuffer(value) ? value.toString('utf8') : value; }

/** Every direct child in `skills/` is a skill tree; one ls-tree call resolves all latest versions. */
async function skillTrees(git: Git, writtenTree: string): Promise<Map<string, string>> {
  const listed = await requireGitResult(git, ['ls-tree', `${writtenTree}:skills`]);
  const versions = new Map<string, string>();
  for (const line of listed.stdout.split('\n')) {
    const match = /^\d+\s+tree\s+([0-9a-f]{40})\t(.+)$/.exec(line);
    if (match) versions.set(match[2]!, match[1]!);
  }
  return versions;
}

async function requireGitResult(git: Git, args: readonly string[]): Promise<CommandResult> {
  const result = await git(args);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  return result;
}

/** Resolve the parent directory and refuse it if a symlink would carry the write outside the clone. */
async function assertInsideClone(root: string, realRoot: string, path: string): Promise<string> {
  const destination = join(root, path);
  let parent = dirname(destination);
  while (!(await exists(parent))) parent = dirname(parent);
  const realParent = await realpath(parent);
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new GuardError(`Refusing to write ${path}: its parent resolves outside the clone (${realParent})`);
  }
  try {
    if ((await lstat(destination)).isSymbolicLink()) throw new GuardError(`Refusing to write through the symlink ${path}`);
  } catch (error) {
    if (error instanceof GuardError) throw error;
  }
  return destination;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}

async function applyTree(root: string, realRoot: string, tree: MutableTree, changed: readonly string[]): Promise<void> {
  for (const path of changed) {
    const destination = await assertInsideClone(root, realRoot, path);
    const next = tree.after(path);
    if (next === undefined) await rm(destination, { force: true });
    else { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, next); }
  }
}

/** Remove a file this operation created and any now-empty parent directories below the root; never follow a symlink. */
async function removeCreated(root: string, realRoot: string, path: string): Promise<void> {
  const destination = resolve(root, path);
  const realParent = await realpath(dirname(destination)).catch(() => null);
  if (realParent === null || (realParent !== realRoot && !realParent.startsWith(realRoot + sep))) return;
  try { if ((await lstat(destination)).isSymbolicLink()) return; } catch { return; }
  await rm(destination, { force: true });
  let parent = dirname(path);
  while (parent !== '.' && parent !== '') {
    try { await rmdir(join(root, parent)); } catch { break; }
    parent = dirname(parent);
  }
}

/** Clone a team repo into a private directory, checking out `main` explicitly so a bare remote whose HEAD points elsewhere still yields a working tree. */
export async function cloneTeam(remote: string, destination: string, runner: Runner = systemRunner, token: string | null = null): Promise<void> {
  await mkdirPrivate(dirname(destination));
  const clone = await runner.run('git', ['clone', '-q', '--branch', 'main', remoteToGitUrl(remote), destination], { env: gitAuthEnv(token) });
  if (clone.code !== 0) throw new Error(`Could not clone ${remote}: ${(clone.stderr || clone.stdout).trim()}`);
}

/** The normalized origin of an existing clone, or null when the directory is not a clone. */
export async function cloneOrigin(root: string, runner: Runner = systemRunner): Promise<string | null> {
  try {
    const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: root });
    return origin.code === 0 ? normalizeRemote(origin.stdout.trim()) : null;
  } catch {
    return null;
  }
}
