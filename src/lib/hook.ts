import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { Prompter } from './prompt.js';

/** The one seam hook.test.ts needs to simulate a crash between the temp write and the rename. */
export const fsForTests = { rename };

export const HOOK_COMMAND = 'npx -y terum-skills@latest sync --hook';
export const HOOK_ENTRY = { matcher: 'startup', hooks: [{ type: 'command', command: HOOK_COMMAND, async: true, timeout: 60 }] } as const;
export interface HookOptions { settingsFile?: string; backupDir?: string; }

export function defaultHookOptions(storeRoot: string, home = homedir()): Required<HookOptions> {
  return { settingsFile: join(home, '.claude', 'settings.json'), backupDir: join(storeRoot, 'backups') };
}

type Settings = Record<string, unknown>;
const invalidSettings = (path: string): Error => new Error(`Cannot edit ${path}: it is not valid JSON. Fix it by hand or move it aside, then re-run.`);

function matchingEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const hooks = (value as Record<string, unknown>).hooks;
  return Array.isArray(hooks) && hooks.some((hook) => {
    if (!hook || typeof hook !== 'object') return false;
    const command = (hook as Record<string, unknown>).command;
    return typeof command === 'string' && command.includes('terum-skills');
  });
}

function parseSettings(source: string, path: string): Settings {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw invalidSettings(path); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidSettings(path);
  const value = parsed as Settings;
  if ('hooks' in value && (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks))) throw invalidSettings(path);
  const sessionStart = (value.hooks as Settings | undefined)?.SessionStart;
  if (sessionStart !== undefined && !Array.isArray(sessionStart)) throw invalidSettings(path);
  return value;
}

async function readSettings(path: string): Promise<{ value: Settings; source?: string }> {
  try { const source = await readFile(path, 'utf8'); return { value: parseSettings(source, path), source }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { value: {} }; throw error; }
}

export async function hookInstalled(settingsFile: string): Promise<boolean> {
  const { value, source } = await readSettings(settingsFile);
  const sessionStart = (value.hooks as Settings | undefined)?.SessionStart;
  return source !== undefined && Array.isArray(sessionStart) && sessionStart.some(matchingEntry);
}

async function hasBackup(directory: string): Promise<boolean> {
  try { return (await readdir(directory)).some((entry) => /^settings\..+\.json$/.test(entry)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function backupOnce(options: Required<HookOptions>, source: string | undefined): Promise<boolean> {
  if (source === undefined || await hasBackup(options.backupDir)) return false;
  await mkdir(options.backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(options.backupDir, `settings.${stamp}.json`), source, { encoding: 'utf8', mode: 0o600 });
  return true;
}

async function writeAtomically(path: string, value: Settings, existing: boolean): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.settings.json.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    if (existing) await chmod(temporary, (await stat(path)).mode);
    await fsForTests.rename(temporary, path);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

export async function installHook(options: Required<HookOptions>): Promise<'installed' | 'replaced'> {
  const { value, source } = await readSettings(options.settingsFile);
  const hooks = (value.hooks ??= {}) as Settings;
  const sessionStart = (hooks.SessionStart ??= []) as unknown[];
  const index = sessionStart.findIndex(matchingEntry);
  const outcome = index < 0 ? 'installed' : 'replaced';
  if (index < 0) sessionStart.push(HOOK_ENTRY);
  else {
    // Replace the first match in place; every further match (a hand-edited duplicate, an older
    // install under another spelling) goes, so the file never carries two of our entries.
    hooks.SessionStart = sessionStart.flatMap((element, position) => (position === index ? [HOOK_ENTRY] : matchingEntry(element) ? [] : [element]));
  }
  await backupOnce(options, source);
  await writeAtomically(options.settingsFile, value, source !== undefined);
  return outcome;
}

export async function removeHook(options: Required<HookOptions>): Promise<'removed' | 'absent'> {
  const { value, source } = await readSettings(options.settingsFile);
  if (source === undefined) return 'absent';
  const hooks = value.hooks as Settings | undefined;
  const sessionStart = hooks?.SessionStart;
  if (!Array.isArray(sessionStart) || !sessionStart.some(matchingEntry)) return 'absent';
  hooks!.SessionStart = sessionStart.filter((entry) => !matchingEntry(entry));
  if ((hooks!.SessionStart as unknown[]).length === 0) delete hooks!.SessionStart;
  if (Object.keys(hooks!).length === 0) delete value.hooks;
  await backupOnce(options, source);
  await writeAtomically(options.settingsFile, value, true);
  return 'removed';
}

export async function offerHook(io: Prompter, options: Required<HookOptions>): Promise<'installed' | 'replaced' | 'declined' | 'present'> {
  if (await hookInstalled(options.settingsFile)) { io.print(`Session hook already installed in ${options.settingsFile}.`); return 'present'; }
  if (!(await io.confirm(`Install the Claude Code session-start hook so team skills sync automatically? (edits ${options.settingsFile})`))) {
    io.print('Skipped the session hook; re-run setup to install it later.');
    return 'declined';
  }
  const tookBackup = (await existsFile(options.settingsFile)) && !(await hasBackup(options.backupDir));
  const outcome = await installHook(options);
  io.print(`Installed the session hook in ${options.settingsFile}${tookBackup ? ` (backup in ${options.backupDir}).` : '.'}`);
  return outcome;
}

async function existsFile(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

// --- §8 mutex and rate limit (`sync --hook` only) -------------------------------------------

/** §8: a hook run within an hour of the team's last fully successful sync is a no-op. */
export const STAMP_FRESH_MS = 60 * 60_000;
/** §8: a lock older than this is stale whoever holds it — a crashed process must not disable sync forever. */
export const LOCK_STALE_MS = 10 * 60_000;

export interface TeamLockOptions { now?: () => number; host?: string; pidAlive?: (pid: number) => boolean; }

export function stampPath(storeRoot: string, team: string): string { return join(storeRoot, 'run', `${team}.stamp`); }
export function lockPath(storeRoot: string, team: string): string { return join(storeRoot, 'run', `${team}.lock`); }

/** True when `run/<team>.stamp` was written within the last hour. Only `sync --hook` consults it; an interactive sync always runs. */
export async function stampIsFresh(storeRoot: string, team: string, now: () => number = Date.now): Promise<boolean> {
  try { return now() - (await stat(stampPath(storeRoot, team))).mtimeMs < STAMP_FRESH_MS; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/**
 * §8 mutex: one lock per team — so unrelated teams never serialize — created with O_CREAT|O_EXCL
 * (atomic on every platform we target) and holding `{pid, host, started}`. Returns the release
 * function, or null when another live holder has it: the caller exits 0 in silence, because
 * another window is already doing the work and a queue of blocked startup hooks is the failure
 * this lock exists to prevent. A stale lock — started more than ten minutes ago, or held by a dead
 * pid on this host — is removed and the acquire retried exactly once; a live lock from another
 * host is always respected. Release in a `finally`, on every exit path.
 */
export async function acquireTeamLock(storeRoot: string, team: string, options: TeamLockOptions = {}): Promise<(() => Promise<void>) | null> {
  const now = options.now ?? Date.now;
  const host = options.host ?? hostname();
  const pidAlive = options.pidAlive ?? isPidAlive;
  const path = lockPath(storeRoot, team);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify({ pid: process.pid, host, started: new Date(now()).toISOString() })}\n`, 'utf8'); }
      finally { await handle.close(); }
      return async () => { await rm(path, { force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt > 0 || !(await lockIsStale(path, host, now, pidAlive))) return null;
      await rm(path, { force: true });
    }
  }
  return null;
}

async function lockIsStale(path: string, host: string, now: () => number, pidAlive: (pid: number) => boolean): Promise<boolean> {
  let raw: string; let details: { mtimeMs: number };
  try { [raw, details] = await Promise.all([readFile(path, 'utf8'), stat(path)]); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; } // gone already: the retry finds it free
  let record: { pid?: unknown; host?: unknown; started?: unknown } = {};
  try { record = JSON.parse(raw) as typeof record; } catch { /* judged by age below */ }
  // A record that cannot be read — a holder caught between its open and its write, or a crash
  // mid-write — is judged by the file's age alone, so a racing holder is never mistaken for a crash.
  const started = typeof record.started === 'string' ? Date.parse(record.started) : Number.NaN;
  if (now() - (Number.isFinite(started) ? started : details.mtimeMs) > LOCK_STALE_MS) return true;
  if (record.host !== host) return false;
  return typeof record.pid === 'number' && !pidAlive(record.pid);
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } // alive but not ours; ESRCH is dead
}
