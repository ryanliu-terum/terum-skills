import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AGENT_PATHS, isSkillsRoot, SupportedAgent } from './placer/agent-paths.js';
import { acquireSkillTargetLock } from './placer/vendor/skillhub/skill-target-lock.js';
import { SkillSnapshot, snapshotSkillDirectory } from './placer/vendor/skillhub/skill-fingerprint.js';
import { Runner, systemRunner } from './runner.js';

/** The one seam placer.test.ts needs to make a rename fail between the two moves of a replace, cross a volume (mirrors hook.ts), fail the removal of a displaced copy or of the staging folder, or fail the probe for a displaced copy with something other than ENOENT. */
// `lstat` is wrapped rather than passed through raw: its overloads make the bare binding awkward to restub from a test.
export const fsForTests = { rename, rm, lstat: (path: string) => lstat(path) };

export type PlacementScope = { kind: 'global' } | { kind: 'project'; project: string };
export type Inspection = { kind: 'absent'; path: string } | { kind: 'ours'; path: string } | { kind: 'foreign'; path: string };

export interface PlacerOptions { home?: string; agent?: SupportedAgent; }

/** Resolve only the explicitly selected agent; phase 1 never auto-detects an agent. */
export function resolveTarget(agent: SupportedAgent, scope: PlacementScope, repoRoot?: string, home = homedir()): string {
  const paths = AGENT_PATHS[agent];
  if (!paths) throw new Error(`Unsupported agent ${agent}`);
  if (scope.kind === 'global') return paths.global(home);
  if (!repoRoot) throw new Error(`Project scope ${scope.project} needs the current project repository root.`);
  return paths.project(repoRoot);
}

/** Collision detection is deliberately target-local: callers pass the exact resolved destination. */
export async function inspect(dir: string, owned: boolean): Promise<Inspection> {
  try {
    const details = await lstat(dir);
    if (!details.isDirectory()) return { kind: 'foreign', path: dir };
    return { kind: owned ? 'ours' : 'foreign', path: dir };
  } catch (error) {
    if (isMissing(error)) return { kind: 'absent', path: dir };
    throw error;
  }
}

/** Acquire one non-waiting lock per target skills root; callers own the returned release, which reports a lock another process reclaimed (R3). `options.stale` is a test knob. */
export async function lockTarget(targetRoot: string, name: string, options: { stale?: number } = {}): Promise<() => Promise<void>> {
  await mkdir(targetRoot, { recursive: true });
  return acquireSkillTargetLock(targetRoot, name, options);
}

/**
 * Copy into a sibling staging directory then rename. Existing destinations are only replaced
 * after the caller verified ledger ownership; the displaced generated copy is removed after the
 * new copy has become visible, so no partial source is ever exposed.
 */
export async function place(source: string, targetRoot: string, name: string, options: { replace?: boolean; projectRoot?: string; runner?: Runner; quarantineRoot?: string } = {}): Promise<{ path: string; snapshot: SkillSnapshot; notices: string[] }> {
  const destination = join(targetRoot, name);
  const temporary = join(targetRoot, `.${name}.terum-${randomUUID()}.tmp`);
  const displaced = join(targetRoot, `.${name}.terum-${randomUUID()}.old`);
  // Only a successful move-aside puts a copy at `displaced`, and the rm below takes it away again:
  // no failure path may claim a stranded copy the run never created (spec invariant 34).
  let displacedExists = false;
  await mkdir(targetRoot, { recursive: true });
  try {
    await assertNoSymlinks(source);
    await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
    try {
      await fsForTests.rename(temporary, destination);
    } catch (error) {
      if (!options.replace || !isExistingDestination(error)) throw error;
      await fsForTests.rename(destination, displaced);
      displacedExists = true;
      await fsForTests.rename(temporary, destination);
      await fsForTests.rm(displaced, { recursive: true, force: true });
      displacedExists = false;
    }
    const result = { path: destination, snapshot: await snapshotSkillDirectory(destination), notices: [] as string[] };
    if (options.projectRoot) await appendExclude(options.projectRoot, `.claude/skills/${name}`, options.runner).catch((error: unknown) => {
      result.notices.push(`Placed ${destination} but could not add .claude/skills/${name} to .git/info/exclude: ${error instanceof Error ? error.message : String(error)}`);
    });
    return result;
  } catch (error) {
    // Both staging cleanups are best-effort: this one must not abort the recovery below, and the one
    // in the finally must not replace what the recovery throws (a throw from a finally supersedes the
    // pending one) — a leftover hidden `.tmp` folder is strictly cheaper than a lost stranded-copy report.
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    // A failure after the existing target was moved aside must not orphan it: the copy goes back, or —
    // when it cannot (the destination is occupied by the new copy, or the restore failed) — to
    // quarantine (spec invariant 34: never left inside the skills root), or at the least its location
    // is named. The placement failure stays the message and the cause.
    const stranded = displacedExists ? await restoreDisplaced(destination, displaced, name, options.quarantineRoot).catch(() => displaced) : undefined;
    if (stranded !== undefined) throw new Error(`${error instanceof Error ? error.message : String(error)} — the previous ${name} could not be restored to ${destination}; it is at ${stranded}`, { cause: error });
    throw error;
  } finally {
    await fsForTests.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * After a failed replace: put the displaced copy back when the destination is empty; when it is not
 * (the new copy landed and only the cleanup failed) or the restore fails, move the copy to quarantine.
 * Returns where the copy is when it was not restored, undefined when it was (or nothing was displaced).
 */
async function restoreDisplaced(destination: string, displaced: string, name: string, quarantineRoot: string | undefined): Promise<string | undefined> {
  if (await isAbsent(displaced)) return undefined;
  if (await isAbsent(destination)) {
    try { await fsForTests.rename(displaced, destination); return undefined; }
    catch { /* fall through: quarantine, or name the hidden path */ }
  }
  if (quarantineRoot !== undefined) { try { return await moveToQuarantine(displaced, quarantineRoot, name); } catch { /* fall through: name the hidden path */ } }
  return displaced;
}

async function isAbsent(path: string): Promise<boolean> {
  try { await fsForTests.lstat(path); return false; } catch (error) { if (isMissing(error)) return true; throw error; }
}

/**
 * A deletion is valid only for a ledger-owned path directly underneath a skills root — and the
 * root itself must be a skills directory (`…/.claude/skills`): callers derive it from the ledger
 * path, so without this check a bad ledger key could name any folder on the machine.
 */
export async function remove(targetRoot: string, path: string, expectedFingerprint: string, quarantineRoot: string): Promise<{ quarantined?: string }> {
  const root = resolve(targetRoot);
  const destination = resolve(path);
  if (!isSkillsRoot(root)) throw new Error(`Refusing to remove ${path}: ${root} is not a skills directory this tool places into`);
  if (dirname(destination) !== root || !isAbsolute(destination)) {
    throw new Error(`Refusing to remove unowned placement ${path}`);
  }
  // "Already gone" is decided by quarantineDrift's single probe; every later error speaks for
  // itself. A quarantine that cannot complete propagates instead of falling through to rm, and the
  // delete happens only after the fingerprint was positively verified (spec §6: moved, never deleted).
  const drift = await quarantineDrift(destination, expectedFingerprint, quarantineRoot);
  if (drift.current === undefined) return {};
  if (drift.quarantined) return { quarantined: drift.quarantined };
  await rm(destination, { recursive: true, force: true });
  return {};
}

/**
 * The one rule for a placed copy that no longer matches its ledger fingerprint: move it to
 * quarantine and report where, never delete it. `install` (re-placing over an owned target),
 * `sync` (its ledger loop) and `remove` all go through here. `current` is absent only when the
 * path itself is gone — decided by one lstat, so an ENOENT raised mid-scan is an error, not "gone".
 */
export async function quarantineDrift(path: string, expectedFingerprint: string, quarantineRoot: string): Promise<{ current?: SkillSnapshot; quarantined?: string }> {
  const current = await snapshotIfPresent(path);
  if (current === undefined) return {};
  if (current.fingerprint === expectedFingerprint) return { current };
  return { current, quarantined: await moveToQuarantine(path, quarantineRoot, basename(path)) };
}

/** quarantineDrift's read-only half: a placed copy's snapshot, or undefined when the path itself is gone — one lstat decides that, so an ENOENT raised mid-scan is an error, not "gone". */
export async function snapshotIfPresent(path: string): Promise<SkillSnapshot | undefined> {
  try { await lstat(path); } catch (error) { if (isMissing(error)) return undefined; throw error; }
  return snapshotSkillDirectory(path);
}

export async function moveToQuarantine(path: string, quarantineRoot: string, name: string): Promise<string> {
  const directory = join(quarantineRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  const destination = join(directory, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await moveDirectory(path, destination);
  return destination;
}

/**
 * Move a directory: a rename, or — across volumes (an authoring folder outside HOME, a checkout on
 * another disk) — a copy that must exist in full at the destination before the original is removed.
 * The only place that deletes a user-owned directory after a copy; the quarantine move and share's
 * restore of a displaced folder both go through it.
 */
export async function moveDirectory(from: string, to: string): Promise<void> {
  try {
    await fsForTests.rename(from, to);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EXDEV')) throw error;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true, force: true });
  }
}

export async function appendExclude(projectRoot: string, entry: string, runner: Runner = systemRunner): Promise<void> {
  const reported = await runner.run('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: projectRoot });
  if (reported.code !== 0 || !reported.stdout.trim()) throw new Error(`Could not resolve git exclude path: ${(reported.stderr || reported.stdout).trim()}`);
  const value = reported.stdout.trim();
  const exclude = isAbsolute(value) ? value : resolve(projectRoot, value);
  let current = '';
  try { current = await readFile(exclude, 'utf8'); } catch (error) { if (!isMissing(error)) throw error; }
  if (current.split(/\r?\n/).includes(entry)) return;
  await mkdir(dirname(exclude), { recursive: true });
  await writeFile(exclude, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${entry}\n`, 'utf8');
}

export async function listDirectories(root: string): Promise<string[]> {
  try { return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name)); }
  catch (error) { if (isMissing(error)) return []; throw error; }
}

function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
export function isExistingDestination(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY');
}

async function assertNoSymlinks(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to place skill containing symlink ${path}`);
    if (entry.isDirectory()) await assertNoSymlinks(path);
  }
}
