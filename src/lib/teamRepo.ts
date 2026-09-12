import { packageRoot } from './package-root.js';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, realpath, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { packageVersion } from './package.js';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import lockfile from 'proper-lockfile';
import { mkdirPrivate } from './fs.js';
import { guard, GuardContext, GuardError, GuardTree } from './guard.js';
import { explainGitAccessFailure, isGitHubRemote, normalizeRemote, remoteToGitUrl, stripRemoteCredentials } from './remote.js';
import { CommandResult, Runner, systemRunner } from './runner.js';
import { regenerateReadmeInTree } from './readme.js';
import { parseVersionFolder, type SkillVersion } from './versions.js';

/**
 * §6.0: every write to the team repo goes through `safeWrite()` — a re-apply model, not a rebase.
 * fetch → hard-reset to origin/main → re-run the PURE mutation on the tree it is handed → guard
 * the result → write and stage exactly the paths it changed → prove the staged diff equals those
 * paths → commit → push to refs/heads/<branch> only → on a lost race retry with full-jitter
 * backoff until a 30-second deadline. Waiting for the clone's writer lock is bounded separately by
 * `lockWaitMs` (`acquireCloneLock`): the 30-second budget starts once the lock is held, so a long
 * wait can never spend the push loop's time before the first attempt. A `finally` step resets the
 * clone to origin/main and removes the untracked paths this operation created, whether the loop
 * succeeded, failed, or threw.
 */
export interface MutableTree extends GuardTree {
  set(path: string, content: string | Buffer): void;
  remove(path: string): void;
  /** Tracked paths in the freshly reset tree. Needed to make a skill-folder update a true mirror. */
  paths(prefix?: string): readonly string[];
  /** Executable Git entries in the freshly reset pre-image; mutations remain pure. */
  executablePaths(prefix?: string): ReadonlySet<string>;
}
export type Mutate<R = void> = (tree: MutableTree) => R;

export interface SafeWriteOptions extends GuardContext {
  /** Destination ref. Defaults to `main`; PR-policy `publish` passes a fresh `publish/<name>-<handle>-<id8>` (§6.0 step 4). A non-main branch is created, never replaced. */
  branch?: string;
  /** Commit message; defaults to `<handle>: <action>`. */
  message?: string;
  deadlineMs?: number;
  backoff?: (attempt: number) => number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Test knob: the lock's stale window in ms (proper-lockfile floors it at 2000 and checks the lock every half window). */
  lockStale?: number;
  /** What a lock failure names. Absent means the clone path, which is what every caller but eval wants. */
  label?: string;
  /** How long to wait for the clone lock, and what to say while waiting (lib/teamRepo.ts lockWait). */
  lockWaitMs?: number;
  onWaiting?: (info: { label: string; elapsedMs: number }) => void;
}

export interface SafeWriteResult<R = void> { changed: boolean; pushedTo: string; returned: R; }

/** Shared contract for the refresh batches; this batch does not wire or implement these options. */
export interface RefreshOptions { lockWaitMs?: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void; deadlineMs?: number }

export interface TeamRepo {
  readonly root: string;
  readonly remote: string;
  safeWrite<R = void>(mutate: Mutate<R>, options: SafeWriteOptions): Promise<SafeWriteResult<R>>;
}

/** The deadline passed while the remote kept moving ahead (§6.0 step 5). */
export class SafeWriteExhausted extends Error {
  constructor(message: string) { super(message); this.name = 'SafeWriteExhausted'; }
}
/** The remote refused the push for a reason a retry cannot fix (permissions, protection, auth). */
export class PushRefused extends Error {
  constructor(message: string) { super(message); this.name = 'PushRefused'; }
}
/** Another terum-skills process holds this clone's writer lock. A per-team caller (sync) skips the team and continues; a single-clone verb (publish) fails. */
export class CloneBusy extends Error {
  constructor(message: string) { super(message); this.name = 'CloneBusy'; }
}

/** A classified refresh fetch failure. Sync skips this team; single-team callers retain the full error. */
export class RemoteAccessError extends Error {
  constructor(message: string, readonly origin: string, readonly stderr: string, readonly explanation: string) {
    super(`${message}\n${explanation}`);
    this.name = 'RemoteAccessError';
  }
}

export const DEFAULT_DEADLINE_MS = 30_000;
const defaultBackoff = (attempt: number): number => Math.floor(Math.random() * Math.min(1_000, 25 * 2 ** attempt));
const wait = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));
/** git's non-fast-forward vocabulary: the only `main` push failures a retry can fix. */
const RETRYABLE = /fetch first|non-fast-forward|cannot lock ref|failed to lock|stale info|incorrect old value|remote ref updated since checkout/i;
/** The lease (CAS) vocabulary: the named ref moved since we read it — never retried against the same ref. */
const STALE_LEASE = /stale info|incorrect old value|remote ref updated since checkout/i;
/** Server-side ref-lock contention: transient, and the lease still stands, so the same ref is retried. */
const REF_LOCK = /cannot lock ref|failed to lock/i;
const lostLock = (root: string): string => `Lost the safeWrite lock on ${root} to another process; nothing was pushed — retry the command.`;

/** How long a caller waits for another process's clone lock before failing: today's ladder, for anything nobody is watching. */
export const LOCK_WAIT_MS = 4_000;
/**
 * A person is on the other end (a TTY, or a program over frames): outwait any legitimate holder — a
 * safeWrite holds this lock across its whole 30-second deadline loop — and any lock a hard-killed
 * holder left behind, which proper-lockfile clears only after its 60-second stale window.
 */
export const INTERACTIVE_LOCK_WAIT_MS = 75_000;
/** Poll cadence while waiting, plus full jitter, so two waiters that arrived together stop colliding on the same tick. */
const WAIT_POLL_MS = 250;
const WAIT_POLL_JITTER_MS = 150;
/** Nothing is said for the first second: a lock that frees within a poll or two is not worth a line. */
const WAIT_NOTICE_AFTER_MS = 1_000;
/** Then at most one line every five seconds, so a 75-second wait is a handful of lines, not seventy-five. */
const WAIT_NOTICE_INTERVAL_MS = 5_000;
/**
 * Staleness is a bare mtime compare against the wall clock (node_modules/proper-lockfile/lib/lockfile.js:84-86),
 * so a lock stamped further than this into this machine's future never goes stale and no wait can clear it: a
 * clock that jumped back, or a store on a mount with a clock of its own. Same tolerance, for the same reason,
 * as the sync stamp's (lib/hook.ts:151).
 */
const LOCK_FUTURE_SKEW_MS = 60_000;

/** What a caller may say about waiting for the clone lock. Accepted by refreshClone, withCloneLock and safeWrite alike. */
export interface LockWaitOptions {
  /** Milliseconds to wait for the lock before failing. Default: LOCK_WAIT_MS. */
  lockWaitMs?: number;
  /** Called while waiting: after the first second, then at most every five. The caller turns it into one printed line. */
  onWaiting?: (info: { label: string; elapsedMs: number }) => void;
  /** Test knobs for the wait loop only (the same convention SafeWriteOptions uses for its push loop). */
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const waitingLine = (info: { label: string; elapsedMs: number }): string => `Waiting for another terum-skills operation on ${info.label} to finish… (${Math.round(info.elapsedMs / 1000)} s)`;

/**
 * The one lock-wait policy. A person on the other end (a TTY, or a shell over frames) outwaits the
 * holder and is told that it is waiting; anything else — the session hook, a piped script — keeps the
 * short budget and stays silent, because there is nobody to read the line and a script wants to fail fast.
 */
export function lockWait(io: { readonly interactive: boolean; print(line: string): void }, waitMs?: number): { lockWaitMs: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void } {
  if (!io.interactive) return { lockWaitMs: waitMs ?? LOCK_WAIT_MS };
  return { lockWaitMs: waitMs ?? INTERACTIVE_LOCK_WAIT_MS, onWaiting: (info) => io.print(waitingLine(info)) };
}

type Git = (args: readonly string[]) => Promise<CommandResult>;

export function openTeamRepo(root: string, remote: string, runner: Runner = systemRunner): TeamRepo {
  return { root, remote, safeWrite: <R = void>(mutate: Mutate<R>, options: SafeWriteOptions) => safeWrite(root, remote, runner, mutate, options) };
}

async function safeWrite<R = void>(root: string, remote: string, runner: Runner, mutate: Mutate<R>, options: SafeWriteOptions): Promise<SafeWriteResult<R>> {
  const git: Git = (args) => runner.run('git', args, { cwd: root });
  const origin = await assertOrigin(root, remote, git);
  const requireGit = async (args: readonly string[]) => {
    const result = await git(args);
    if (result.code !== 0) {
      const copy = args[0] === 'fetch' ? explainGitAccessFailure(origin, result.stderr) : null;
      throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}${copy ? `\n${copy}` : ''}`);
    }
    return result;
  };

  const realRoot = await realpath(root);

  const now = options.now ?? Date.now;
  const budgetMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const branch = options.branch ?? 'main';
  const created = new Set<string>();
  let attempt = 0;
  let lastError = 'push rejected';

  // One writer per clone per machine; a second process waits briefly, then fails rather than racing.
  // A lock lost after the stale window (another process took it) is recorded and aborts the attempt
  // before anything is pushed, instead of two writers reset-and-committing over one working tree.
  let compromised = false;
  // A main push commits every created path and leaves local main at the pushed commit. Its cleanup
  // would be a no-op network round trip; PR branches and every other outcome still need the reset.
  let pushedToMain = false;
  const release = await acquireCloneLock(root, { lockStale: options.lockStale, label: options.label, lockWaitMs: options.lockWaitMs, onWaiting: options.onWaiting, onCompromised: () => { compromised = true; } });
  // The push budget starts now, with the lock held: the wait above has its own bound (`lockWaitMs`),
  // and charging it here made a long wait fail the write it had just won the lock for.
  const deadline = now() + budgetMs;
  let pushed = false;
  try {
    while (now() <= deadline) {
      if (compromised) throw new Error(lostLock(root));
      await requireGit(['fetch', 'origin']);
      await requireGit(['reset', '--hard', 'origin/main']);
      const index = (await requireGit(['ls-files', '--stage', '-z'])).stdout.split('\0').filter(Boolean);
      const tracked = new Set<string>(); const executable = new Set<string>();
      for (const entry of index) {
        const tab = entry.indexOf('\t'); const path = tab < 0 ? undefined : entry.slice(tab + 1);
        if (path === undefined) continue;
        tracked.add(path);
        if (entry.startsWith('100755 ')) executable.add(path);
      }
      const tree = makeTree(root, tracked, executable);
      const returned = mutate(tree);
      // Authorize the caller's own pure mutation before deriving any files from it. This keeps a
      // forbidden skill write from being reported as a frontmatter/README generation error.
      if (tree.changedPaths.length === 0) return { changed: false, pushedTo: branch, returned };
      guard(tree, options);
      // §9: Actions own GitHub README commits; generic remotes regenerate as a derived safeWrite path.
      // §6.0's eval exception is narrower: its receipt is immutable testimony and its commit must
      // touch exactly that one new file. GitHub teams still regenerate on the existing Action.
      let changed = tree.changedPaths;
      for (const path of changed) if (!tracked.has(path) && tree.after(path) !== undefined) created.add(path);
      await applyTree(root, realRoot, tree, changed);
      await requireGit(['add', '-A', '--', ...changed]);
      if (!isGitHubRemote(remote) && options.action !== 'eval') {
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
      if (compromised) throw new Error(lostLock(root));
      pushed = true;
      const outcome = await push(git, branch);
      if (outcome.ok) { pushedToMain = outcome.pushedTo === 'main'; return { changed: true, pushedTo: outcome.pushedTo, returned }; }
      if (!outcome.retryable) {
        const copy = explainGitAccessFailure(origin, outcome.error);
        throw new PushRefused(`The remote refused the push: ${outcome.error.trim()}${copy ? `\n${copy}` : ''}`);
      }
      lastError = outcome.error;
      if (now() >= deadline) break;
      await (options.sleep ?? wait)((options.backoff ?? defaultBackoff)(attempt++));
    }
    // Name only what was measured: a budget that ran out before any push (a zero budget, a clock jump)
    // saw no remote movement, so it must not claim one.
    if (!pushed) throw new SafeWriteExhausted(`safeWrite ran out of its ${budgetMs} ms budget before it could attempt a push; nothing was committed or pushed.`);
    throw new SafeWriteExhausted(`safeWrite deadline exhausted after ${attempt + 1} attempt(s); the remote kept moving ahead: ${lastError.trim()}`);
  } finally {
    // Cleanup can never change the outcome: the next safeWrite fetches and hard-resets anyway. A
    // compromised lock means another writer owns this clone now; resetting it would rewind THAT
    // writer's commit and turn its push into a no-op, so then only the lock is released.
    if (!compromised && !pushedToMain) {
      try {
        await git(['fetch', 'origin']);
        await git(['reset', '--hard', 'origin/main']);
        for (const path of created) {
          const tracked = await git(['ls-files', '--error-unmatch', '--', path]);
          if (tracked.code !== 0) await removeCreated(root, realRoot, path);
        }
      } catch {
        // swallowed on purpose; see above
      }
    }
    // A compromised lock rejects on release ('Lock is already released'); cleanup never replaces the real outcome.
    await release().catch(() => undefined);
  }
}

async function assertOrigin(root: string, remote: string, git: Git): Promise<string> {
  const origin = await git(['remote', 'get-url', 'origin']);
  if (origin.code !== 0) throw new Error(`Clone at ${root} has no origin remote`);
  const actual = origin.stdout.trim();
  if (normalizeRemote(actual) !== normalizeRemote(remote)) {
    throw new Error(`Clone at ${root} points at ${stripRemoteCredentials(actual)}, not ${stripRemoteCredentials(remote)}; refusing to write to the wrong repository`);
  }
  return actual;
}

/**
 * Push to exactly the named ref — with `--no-verify`, because the guard above has already run on
 * the exact tree being committed and the clone's own pre-push hook (installPushGuard) would only
 * repeat it through an npx round trip. `main` is a plain push. A derived branch — publish's fresh
 * `publish/<name>-<handle>-<id8>` — is CREATED, never replaced: the push carries a lease of "must
 * not exist" (an empty expectation), so a name already on the remote is refused with git's own
 * message and nothing is overwritten, ours or anyone's. No fallback name, no force: one publish is
 * one fresh branch and one fresh PR, and competing PRs are two PRs that GitHub's conflict badge
 * arbitrates (rulings walk R2, 2026-09-06). Ref-lock contention is transient and the name still
 * must not exist, so it is retried; a stale lease means the name now exists — terminal.
 */
async function push(git: Git, branch: string): Promise<{ ok: true; pushedTo: string } | { ok: false; retryable: boolean; error: string }> {
  if (branch === 'main') {
    const result = await git(['push', '-q', '--no-verify', 'origin', 'HEAD:refs/heads/main']);
    if (result.code === 0) return { ok: true, pushedTo: 'main' };
    const error = result.stderr || result.stdout || 'push rejected';
    return { ok: false, retryable: RETRYABLE.test(error), error };
  }
  const result = await git(['push', '-q', '--no-verify', `--force-with-lease=refs/heads/${branch}:`, 'origin', `HEAD:refs/heads/${branch}`]);
  if (result.code === 0) return { ok: true, pushedTo: branch };
  const error = result.stderr || result.stdout || 'push rejected';
  return { ok: false, retryable: REF_LOCK.test(error) && !STALE_LEASE.test(error), error };
}

/** Repo-relative POSIX paths only: no absolute paths, no `..`, no `.git` anywhere (any case, NTFS short names included), no empty segments. */
export function assertSafePath(path: string): void {
  const segments = path.split('/');
  const gitLike = (segment: string) => segment.toLowerCase() === '.git' || /^git~\d+$/i.test(segment);
  const bad = path === '' || path.startsWith('/') || path.includes('\\') || segments.some((segment) => segment === '' || segment === '.' || segment === '..' || gitLike(segment)) || posix.normalize(path) !== path;
  if (bad) throw new GuardError(`Refusing to write unsafe path ${JSON.stringify(path)}`);
}

/** The tree handed to a mutation: lazy reads of the reset checkout plus an overlay of its edits. */
function makeTree(root: string, tracked: ReadonlySet<string>, executable: ReadonlySet<string> = new Set()): MutableTree {
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
    executablePaths(prefix = '') { return new Set([...executable].filter((path) => treePaths(path) && path.startsWith(prefix))); },
  };

  function treePaths(path: string): boolean { return (!overlay.has(path) || overlay.get(path) !== undefined) && tracked.has(path); }
}

function sameContent(left: string | Buffer | undefined, right: string | Buffer | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (Buffer.isBuffer(left) && Buffer.isBuffer(right)) return left.equals(right);
  if (typeof left === 'string' && typeof right === 'string') return left === right;
  return Buffer.isBuffer(left) ? left.equals(Buffer.from(right as string)) : Buffer.from(left).equals(right as Buffer);
}

/** Decode a tree value only at a text consumer; binary paths stay byte-for-byte in the tree. */
export function treeText(value: string | Buffer): string { return Buffer.isBuffer(value) ? value.toString('utf8') : value; }

/**
 * A published skill's version folders, newest first (spec §3.2). The fs-using half of the version
 * vocabulary: it lives here rather than in `src/lib/versions.ts` so that leaf stays import-free for
 * the desktop bundle.
 *
 * `readdir`, not git: the clone is always a full non-bare checkout that `refreshClone()` hard-resets,
 * so the working tree is authoritative and a readdir is cheaper than a process spawn. A missing skill
 * folder is `[]`, not a throw — an unpublished name is an ordinary answer, not an error.
 *
 * **Sorted descending by the parsed integer, never lexicographically** — it shares `versionsInTree`'s
 * parser and sorter, because `['v10','v2'].sort()` would pin every skill past its tenth publish to
 * the wrong version.
 */
export async function listVersions(clone: string, skillName: string): Promise<SkillVersion[]> {
  const entries = await readdir(join(clone, 'skills', skillName), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ folder: entry.name, n: parseVersionFolder(entry.name) }))
    .filter((entry): entry is SkillVersion => entry.n !== null)
    .sort((left, right) => right.n - left.n);
}

/** Public read-only wrapper around the batched tree reader; never exposes the private Git seam. */
export async function skillVersions(runner: Runner, clone: string, ref = 'HEAD'): Promise<Map<string, string>> {
  const git: Git = async (args) => {
    const result = await runner.run('git', args, { cwd: clone });
    // git uses the same missing-object diagnostic for an absent skills tree and an invalid ref.
    // Verify the ref only on that exceptional path; a normal listing is exactly one child.
    if (result.code !== 0 && result.stderr.includes(`Not a valid object name ${ref}:skills`)) {
      const exists = await runner.run('git', ['rev-parse', '--verify', ref], { cwd: clone });
      if (exists.code === 0) return { code: 0, stdout: '', stderr: '' };
    }
    return result;
  };
  return skillTrees(git, ref);
}

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

/** Clone a team repo into a private directory, checking out `main` explicitly so a bare remote whose HEAD points elsewhere still yields a working tree, and arm the clone-local push guard. */
export async function cloneTeam(remote: string, destination: string, runner: Runner = systemRunner): Promise<void> {
  await mkdirPrivate(dirname(destination));
  const clone = await runner.run('git', ['clone', '-q', '--branch', 'main', '--', remoteToGitUrl(remote), destination]);
  if (clone.code !== 0) {
    const copy = explainGitAccessFailure(remoteToGitUrl(remote), clone.stderr);
    throw new Error(`Could not clone ${stripRemoteCredentials(remote)}: ${(clone.stderr || clone.stdout).trim()}${copy ? `\n${copy}` : ''}`);
  }
  await installPushGuard(destination, runner);
}

/** How the clone-local hook launches the guard: the node binary and the CLI entry that armed the clone. */
export interface PushGuardLauncher { node: string; entry: string; }

/**
 * The CLI entry resolved from the package root, for dist/lib, the bundled entry, or TypeScript
 * sources (where an absent dist/index.js still returns null). A hook
 * armed with an absolute path needs no registry on git's blocking path and runs the rules that
 * armed it, not whatever was published last.
 */
export function localPushGuardLauncher(): PushGuardLauncher | null {
  const root = packageRoot();
  if (root === null) return null;
  const entry = join(root, 'dist', 'index.js');
  return existsSync(entry) ? { node: process.execPath, entry } : null;
}

/** POSIX-shell single quoting: a HOME with a space or a quote is still one word. */
export function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

/**
 * The pre-push hook body. It checks that its launcher still exists before running it, and exits 0
 * with one warning line when it does not (an npx cache pruned, a node upgraded away): the guard
 * prevents accidents, not abuse, and `--no-verify` bypasses it anyway, so a push blocked by
 * infrastructure would buy no safety — but a push that was NOT checked must say so. Once the CLI
 * itself is entered, a non-zero exit is always the guard speaking — a refusal, or its declining to
 * permit what it could not evaluate — never a bare internal error: guardPush.run re-voices anything
 * else and names the same attributed bypass. git hands the pushed refs to the hook on stdin, and
 * the CLI reads stdin nowhere outside the Prompter (§3), so the hook turns them into arguments.
 * Without a built entry the fallback is `npx` pinned to this package's version — never `@latest`.
 * That fallback is the one exception to the invariant above: it `exec`s npx, so a version npx
 * cannot resolve (offline, a proxy, a registry outage) exits as npm, not as the guard, and blocks
 * the push. Only a source run arms it: a built install ships dist/index.js, this package's `bin`.
 */
export function pushGuardHook(launcher: PushGuardLauncher | null): string {
  const check = launcher ? `[ -x ${shellQuote(launcher.node)} ] && [ -f ${shellQuote(launcher.entry)} ]` : 'command -v npx >/dev/null 2>&1';
  const launch = launcher ? `${shellQuote(launcher.node)} ${shellQuote(launcher.entry)} guard-push` : `npx -y ${shellQuote(`terum-skills@${packageVersion() ?? 'latest'}`)} guard-push`;
  const warning = `terum-skills push guard: ${launcher ? launcher.entry : 'npx'} is gone, so this push was NOT checked. Re-run \`npx -y terum-skills@latest team join <remote>\` to re-arm it.`;
  return [
    '#!/bin/sh',
    '# terum-skills: the D12 ownership guard for a raw push from this clone. Regenerated on every join; do not edit.',
    `if ! { ${check}; }; then`,
    `  echo ${shellQuote(warning)} >&2`,
    '  exit 0',
    'fi',
    'set -- "$1" "$2" $(cat)',
    `exec ${launch} "$@"`,
    '',
  ].join('\n');
}

/**
 * D12's clone-local half: a raw `git push` from a team clone runs the CLI's ownership rules
 * through the hidden `guard-push` verb. Accidents, not abuse — `--no-verify` bypasses it and is
 * attributed. Idempotent, and run on every clone AND every join of an existing clone, so an
 * arming that never finished is repaired by the command the failure advice names.
 */
export async function installPushGuard(clone: string, runner: Runner = systemRunner, launcher: PushGuardLauncher | null = localPushGuardLauncher()): Promise<void> {
  const hooks = join(clone, '.git', 'hooks');
  await mkdir(hooks, { recursive: true });
  const hook = join(hooks, 'pre-push');
  await writeFile(hook, pushGuardHook(launcher), { encoding: 'utf8', mode: 0o700 });
  await chmod(hook, 0o700);
  // A machine-wide core.hooksPath (a repo-hooks convention on this machine) would hide .git/hooks; this clone is ours.
  const configured = await runner.run('git', ['config', 'core.hooksPath', '.git/hooks'], { cwd: clone });
  if (configured.code !== 0) throw new Error(`Could not arm the push guard in ${clone}: ${(configured.stderr || configured.stdout).trim()}`);
}

/** The normalized origin of an existing clone, or null when the directory is not a clone. */
export async function cloneOrigin(root: string, runner: Runner = systemRunner): Promise<string | null> {
  const probe = await probeOrigin(root, runner);
  return probe.state === 'ok' ? probe.origin : null;
}

export type CloneState = { state: 'absent' } | { state: 'incomplete'; reason: 'not-a-repository' | 'no-team-json' | 'unverifiable'; error?: string } | { state: 'foreign'; origin: string } | { state: 'ok'; origin: string };

/** One origin probe for both callers, retaining why verification failed without another git call. */
async function probeOrigin(root: string, runner: Runner): Promise<Extract<CloneState, { state: 'ok' | 'incomplete' }>> {
  try {
    const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: root });
    return origin.code === 0 ? { state: 'ok', origin: normalizeRemote(origin.stdout.trim()) } : { state: 'incomplete', reason: 'not-a-repository' };
  } catch (error) { return { state: 'incomplete', reason: 'unverifiable', error: error instanceof Error ? error.message : String(error) }; }
}

/**
 * The one definition of "a complete clone of this team" (rulings walk R9, 2026-09-06), which `team join`
 * and `setup` both decide from — two hand-written copies had drifted, and setup's accepted a folder
 * with team.json but no repository. `absent`: nothing at the path. `incomplete`: present but not a git
 * repository, without team.json (an interrupted `team leave`, a restore that skipped dotfiles), or
 * unverifiable because the origin probe threw; its reason retains that distinction for read-only status.
 * `foreign`: a clone of a different remote. `ok`: this team's clone, with its normalized origin.
 */
export async function describeClone(root: string, normalized: string, runner: Runner = systemRunner): Promise<CloneState> {
  if (!existsSync(root)) return { state: 'absent' };
  const probe = await probeOrigin(root, runner);
  if (probe.state === 'incomplete') return probe;
  if (!existsSync(join(root, 'team.json'))) return { state: 'incomplete', reason: 'no-team-json' };
  if (probe.origin !== normalized) return { state: 'foreign', origin: probe.origin };
  return probe;
}

/** The per-clone writer lock's path — the one safeWrite holds; `team leave` takes it before removing the clone. */
/**
 * Cross-batch contract C1: the optional trailing options `refreshClone` accepts. `lockWaitMs`/`onWaiting` bound
 * and report the wait for the per-clone writer lock; `deadlineMs` bounds the fetch. A field a caller does not
 * use is accepted and ignored. Never change the positional parameters.
 */
export interface RefreshOptions { lockWaitMs?: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void; deadlineMs?: number }
/**
 * Bring a clone to `origin/main` the way safeWrite does — fetch, then hard reset. The clone is
 * disposable state (§4.2), so a local `main` that drifted (a process killed between safeWrite's
 * commit and its reset) heals here instead of wedging every later verb behind a fast-forward
 * failure. Verb preflights (`publish`, `sync`) share this; `pull --ff-only` is never the right
 * refresh for a clone we own (D5b, 2026-09-05 close-out walk).
 */
export async function refreshClone(runner: Runner, clone: string, options: { label?: string; env?: NodeJS.ProcessEnv; lockStale?: number } & RefreshOptions = {}): Promise<void> {
  // Under the same writer lock safeWrite and `team leave` hold: a hard reset while another process
  // sits between its commit and its push would rewind that commit, and its `push HEAD` would then
  // report "everything up-to-date" for a write that never left the machine. The lock is re-checked
  // before the reset: a fetch that outlives the stale window can lose the lock to a second writer,
  // whose commit the reset would otherwise rewind.
  await withCloneLock(clone, async (assertHeld) => {
    for (const args of [['fetch', 'origin'], ['reset', '--hard', 'origin/main']]) {
      assertHeld();
      // A hung fetch must not hold a child slot or the writer lock; the local reset needs no deadline.
      const result = await runner.run('git', args, { cwd: clone, env: options.env, ...(args[0] === 'fetch' ? { deadlineMs: options.deadlineMs } : {}) });
      if (result.code !== 0) {
        const stderr = (result.stderr || result.stdout).trim();
        const message = `Could not refresh ${options.label ?? clone}: ${stderr}`;
        if (args[0] === 'fetch') {
          const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: clone, env: options.env });
          const copy = origin.code === 0 ? explainGitAccessFailure(origin.stdout.trim(), result.stderr) : null;
          if (copy) throw new RemoteAccessError(message, stripRemoteCredentials(origin.stdout), stderr, copy);
        }
        throw new Error(message);
      }
    }
  }, { lockStale: options.lockStale, label: options.label, lockWaitMs: options.lockWaitMs, onWaiting: options.onWaiting });
}

export function cloneLockPath(root: string): string {
  return join(dirname(root), `.${basename(root)}.safewrite.lock`);
}

/**
 * The one acquisition of the per-clone writer lock. A second process waits for `lockWaitMs` — long
 * enough for a person to keep their run, short enough for a session hook to stay a fast no-op — and
 * then fails rather than racing. proper-lockfile reports contention as ELOCKED, and every acquisition
 * site classifies it into the same CloneBusy message here — the contract the CloneBusy class promises
 * — so no caller leaks the raw "Lock file is already being held". `retries: 0` moves the waiting into
 * the loop below, where it can be reported; it does not weaken the stale reclaim, which
 * proper-lockfile performs inside a single attempt (lockfile.js:56-81).
 */
async function acquireCloneLock(root: string, options: { lockStale?: number; label?: string; onCompromised: () => void } & LockWaitOptions): Promise<() => Promise<void>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const started = now();
  const deadline = started + (options.lockWaitMs ?? LOCK_WAIT_MS);
  let announced: number | undefined;
  let stamped = false;
  for (;;) {
    try {
      return await lockfile.lock(root, { lockfilePath: cloneLockPath(root), realpath: false, stale: options.lockStale ?? 60_000, retries: 0, onCompromised: options.onCompromised });
    } catch (error) {
      // Only contention waits. EACCES on the store, ENOTDIR from a path that is not a directory, a
      // read-only volume: each is what it says it is, and is raised on the first attempt exactly as before.
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') throw error;
      if (!stamped) { stamped = true; await refuseUnusableLock(root, options.label); }
      const elapsed = now() - started;
      if (now() >= deadline) throw new CloneBusy(`Another terum-skills operation holds the write lock on ${options.label ?? root}; retry when it finishes.`);
      if (options.onWaiting && elapsed >= WAIT_NOTICE_AFTER_MS && (announced === undefined || elapsed - announced >= WAIT_NOTICE_INTERVAL_MS)) {
        announced = elapsed;
        options.onWaiting({ label: options.label ?? root, elapsedMs: elapsed });
      }
      await sleep(WAIT_POLL_MS + Math.floor(Math.random() * WAIT_POLL_JITTER_MS));
    }
  }
}

/**
 * A lock whose mtime is in this machine's future is not held, it is unusable: proper-lockfile will
 * never call it stale, so waiting cannot clear it and the only remedy is removing the directory. Say
 * that, once, instead of spending the whole budget on it. Everything in the sentence is measured.
 */
async function refuseUnusableLock(root: string, label: string | undefined): Promise<void> {
  const lockPath = cloneLockPath(root);
  let aheadMs: number;
  // A lock that vanished between the refusal and this stat, or one this process cannot stat, is not
  // evidence of anything: fall through and let the ordinary wait decide. Continuing is safe because
  // the very next acquisition attempt re-tests the real condition. The comparison is against the
  // wall clock the filesystem stamps, never the injectable poll clock: a test's logical clock says
  // nothing about when the directory was made.
  try { aheadMs = (await stat(lockPath)).mtimeMs - Date.now(); } catch { return; }
  if (aheadMs <= LOCK_FUTURE_SKEW_MS) return;
  throw new CloneBusy(`The write lock on ${label ?? root} is stamped ${Math.round(aheadMs / 1000)} s in this machine's future (${lockPath}), so waiting cannot clear it; remove that directory if no terum-skills command is running.`);
}

/**
 * Hold the per-clone writer lock while `action` runs; a second writer waits briefly, then fails
 * rather than racing. A lock lost after the stale window is recorded, never thrown from a timer
 * (proper-lockfile's default would crash the CLI): `action` calls `assertHeld` before each step
 * that must not run on a clone another process now owns.
 */
export async function withCloneLock<T>(root: string, action: (assertHeld: () => void) => Promise<T>, options: { lockStale?: number; label?: string } & LockWaitOptions = {}): Promise<T> {
  let compromised = false;
  const release = await acquireCloneLock(root, { ...options, onCompromised: () => { compromised = true; } });
  // The same situation as never acquiring it — another process owns this clone now — so it is the
  // same class: a per-team caller (sync) skips the team, a single-clone verb fails with the message.
  const assertHeld = (): void => { if (compromised) throw new CloneBusy(lostLock(root)); };
  try { return await action(assertHeld); } finally { await release().catch(() => undefined); }
}
