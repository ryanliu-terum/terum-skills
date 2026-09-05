import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Prompter } from './prompt.js';

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
    await rename(temporary, path);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

export async function installHook(options: Required<HookOptions>): Promise<'installed' | 'replaced'> {
  const { value, source } = await readSettings(options.settingsFile);
  const hooks = (value.hooks ??= {}) as Settings;
  const sessionStart = (hooks.SessionStart ??= []) as unknown[];
  const index = sessionStart.findIndex(matchingEntry);
  const outcome = index < 0 ? 'installed' : 'replaced';
  if (index < 0) sessionStart.push(HOOK_ENTRY); else sessionStart[index] = HOOK_ENTRY;
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
