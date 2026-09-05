import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AGENT_PATHS, SupportedAgent } from './placer/agent-paths.js';
import { acquireSkillTargetLock } from './placer/vendor/skillhub/skill-target-lock.js';
import { SkillSnapshot, snapshotSkillDirectory } from './placer/vendor/skillhub/skill-fingerprint.js';
import { Runner, systemRunner } from './runner.js';

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

/** Acquire one non-waiting lock per target skills root; callers own the returned release. */
export async function lockTarget(targetRoot: string, name: string): Promise<() => Promise<void>> {
  await mkdir(targetRoot, { recursive: true });
  return acquireSkillTargetLock(targetRoot, name);
}

/**
 * Copy into a sibling staging directory then rename. Existing destinations are only replaced
 * after the caller verified ledger ownership; the displaced generated copy is removed after the
 * new copy has become visible, so no partial source is ever exposed.
 */
export async function place(source: string, targetRoot: string, name: string, options: { replace?: boolean; projectRoot?: string; runner?: Runner } = {}): Promise<{ path: string; snapshot: SkillSnapshot; notices: string[] }> {
  const destination = join(targetRoot, name);
  const temporary = join(targetRoot, `.${name}.terum-${randomUUID()}.tmp`);
  const displaced = join(targetRoot, `.${name}.terum-${randomUUID()}.old`);
  await mkdir(targetRoot, { recursive: true });
  try {
    await assertNoSymlinks(source);
    await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (!options.replace || !isExistingDestination(error)) throw error;
      await rename(destination, displaced);
      await rename(temporary, destination);
      await rm(displaced, { recursive: true, force: true });
    }
    const result = { path: destination, snapshot: await snapshotSkillDirectory(destination), notices: [] as string[] };
    if (options.projectRoot) await appendExclude(options.projectRoot, `.claude/skills/${name}`, options.runner).catch((error: unknown) => {
      result.notices.push(`Placed ${destination} but could not add .claude/skills/${name} to .git/info/exclude: ${error instanceof Error ? error.message : String(error)}`);
    });
    return result;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    // A failure after moving the existing target back into staging must not orphan it.
    try { await lstat(destination); } catch (missing) {
      if (isMissing(missing)) {
        try { await lstat(displaced); await rename(displaced, destination); } catch (displacedMissing) { if (!isMissing(displacedMissing)) throw displacedMissing; }
      }
    }
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** A deletion is valid only for a ledger-owned path directly underneath this scope's skills root. */
export async function remove(targetRoot: string, path: string, expectedFingerprint: string, quarantineRoot: string): Promise<{ quarantined?: string }> {
  const root = resolve(targetRoot);
  const destination = resolve(path);
  if (dirname(destination) !== root || !isAbsolute(destination)) {
    throw new Error(`Refusing to remove unowned placement ${path}`);
  }
  try {
    const current = await snapshotSkillDirectory(destination);
    if (current.fingerprint !== expectedFingerprint) return { quarantined: await moveToQuarantine(destination, quarantineRoot, basename(destination)) };
  } catch (error) { if (!isMissing(error)) throw error; }
  await rm(destination, { recursive: true, force: true });
  return {};
}

export async function moveToQuarantine(path: string, quarantineRoot: string, name: string): Promise<string> {
  const directory = join(quarantineRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  const destination = join(directory, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await rename(path, destination);
  return destination;
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
