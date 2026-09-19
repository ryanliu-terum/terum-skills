import { packageRoot } from './package-root.js';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editHookEntry, installEventHook, removeEventHook, eventHookInstalled, type HookTarget } from './hook.js';
import { Prompter } from './prompt.js';

/**
 * The PostToolUse(Write|Edit) hook script: the one thing in this package that speaks at the moment a
 * skill is edited. It ships inside the package (bundled by `scripts/bundle-skill.mjs` into
 * dist/claude/hooks/ from assets/claude/hooks/terum-skills-edit.mjs) and is placed under the state
 * root by `setup`, on the same contract as the session hook and the `/terum-skills` manual: one
 * offer with its own y/N, a marker the tool recognises as its own, an in-place refresh of that copy
 * without a second question, removal on machine uninstall, and anything else at that path left alone.
 *
 * It is placed as a FILE and run as `node <path>`, not through npx, because a PostToolUse hook runs
 * on every Write and Edit the agent makes anywhere. The script itself explains the rest.
 *
 * Why it exists at all: passive availability does not produce invocations. Measured 2026-09-14 on
 * the author's machine, the `terum-skills` skill had 0 model-initiated invocations across 7,158
 * session transcripts, while the same team's earlier edit-time routing lifted three previously
 * never-invoked skills off zero. The moment of exposure is the lever; the description is not.
 */
export const EDIT_HOOK_FILE = 'terum-skills-edit.mjs';
/** The first line of our copy. Anything at that path without it belongs to someone else. */
export const EDIT_HOOK_MARKER = '// terum-skills managed hook';
/** Where `npm run build` puts the bundled copy, resolved from the package root for dist/lib, a bundled entry, and a checkout. */
export const BUNDLED_EDIT_HOOK = join(packageRoot() ?? fileURLToPath(new URL('../../', import.meta.url)), 'dist', 'claude', 'hooks', EDIT_HOOK_FILE);

export interface EditHookOptions { storeRoot: string; source?: string; settingsFile?: string; backupDir?: string; }
export type ResolvedEditHookOptions = Required<EditHookOptions>;

export function defaultEditHookOptions(storeRoot: string, home = homedir()): ResolvedEditHookOptions {
  return { storeRoot, source: BUNDLED_EDIT_HOOK, settingsFile: join(home, '.claude', 'settings.json'), backupDir: join(storeRoot, 'backups') };
}

export function editHookDestination(storeRoot: string): string { return join(storeRoot, 'hooks', EDIT_HOOK_FILE); }

/**
 * What goes in settings.json. Double-quoted because Claude Code runs the command through a shell
 * and a home directory may contain spaces; the path is ours, so there is nothing else to escape.
 * It carries the package name so hook.ts's own-entry matcher recognises it as this tool's.
 */
export function editHookCommand(storeRoot: string): string { return `node "${editHookDestination(storeRoot)}"`; }

export function isManagedEditHook(raw: string): boolean { return raw.startsWith(EDIT_HOOK_MARKER); }

export type EditHookPresence = { kind: 'absent' } | { kind: 'managed'; raw: string } | { kind: 'foreign'; why: string };

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

/** What sits at the destination, judged without following links — the repo's rule everywhere: refuse, never follow. */
export async function inspectEditHook(storeRoot: string): Promise<EditHookPresence> {
  const path = editHookDestination(storeRoot);
  let details;
  try { details = await lstat(path); } catch (error) { if (isMissing(error)) return { kind: 'absent' }; throw error; }
  if (details.isSymbolicLink()) return { kind: 'foreign', why: 'it is a symbolic link' };
  if (!details.isFile()) return { kind: 'foreign', why: 'it is not a regular file' };
  const raw = await readFile(path, 'utf8');
  return isManagedEditHook(raw) ? { kind: 'managed', raw } : { kind: 'foreign', why: 'it is a different script' };
}

/** The bundled copy, or null when this copy of the package was not built with it (a source checkout, a test run from src/). */
async function readBundled(source: string): Promise<string | null> {
  let raw: string;
  try { raw = await readFile(source, 'utf8'); } catch (error) { if (isMissing(error)) return null; throw error; }
  return isManagedEditHook(raw) ? raw : null;
}

export type EditHookState = 'absent' | 'current' | 'outdated' | 'foreign' | 'unavailable';

/** The script's own state. The settings.json entry is tracked separately, by hook.ts. */
export async function editHookState(options: ResolvedEditHookOptions): Promise<EditHookState> {
  const bundled = await readBundled(options.source);
  if (bundled === null) return 'unavailable';
  const presence = await inspectEditHook(options.storeRoot);
  if (presence.kind === 'absent') return 'absent';
  if (presence.kind === 'foreign') return 'foreign';
  return presence.raw === bundled ? 'current' : 'outdated';
}

/** Write the bundled copy atomically (temp file beside the target, fsync, rename). Refuses a foreign destination. */
export async function installEditHookScript(options: ResolvedEditHookOptions): Promise<'installed' | 'replaced'> {
  const bundled = await readBundled(options.source);
  if (bundled === null) throw new Error(`The terum-skills edit hook is not bundled in this copy of terum-skills (expected at ${options.source}).`);
  const target = editHookDestination(options.storeRoot);
  const presence = await inspectEditHook(options.storeRoot);
  if (presence.kind === 'foreign') throw new Error(`${target} exists and is not the bundled terum-skills edit hook (${presence.why}); move it aside and re-run.`);
  await mkdir(join(options.storeRoot, 'hooks'), { recursive: true, mode: 0o700 });
  const temporary = join(options.storeRoot, 'hooks', `.${EDIT_HOOK_FILE}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(bundled, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  return presence.kind === 'managed' ? 'replaced' : 'installed';
}

/** Remove only our own copy: the marked script, then the folder if nothing else is in it. A foreign file is left alone. */
export async function removeEditHookScript(options: Pick<ResolvedEditHookOptions, 'storeRoot'>): Promise<'removed' | 'absent' | 'foreign'> {
  const presence = await inspectEditHook(options.storeRoot);
  if (presence.kind !== 'managed') return presence.kind;
  await rm(editHookDestination(options.storeRoot));
  try { await rmdir(join(options.storeRoot, 'hooks')); }
  catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error; }
  return 'removed';
}

function hookOptions(options: ResolvedEditHookOptions): HookTarget {
  return { settingsFile: options.settingsFile, backupDir: options.backupDir };
}

/** Both halves: the script under the state root, then the PostToolUse entry that runs it. */
export async function installEditHook(options: ResolvedEditHookOptions): Promise<'installed' | 'replaced'> {
  const outcome = await installEditHookScript(options);
  await installEventHook(hookOptions(options), 'PostToolUse', editHookEntry(editHookCommand(options.storeRoot)));
  return outcome;
}

/** Both halves, in the opposite order: the entry stops firing before the script it names disappears. */
export async function removeEditHook(options: ResolvedEditHookOptions): Promise<'removed' | 'absent' | 'foreign'> {
  await removeEventHook(hookOptions(options), 'PostToolUse');
  return removeEditHookScript(options);
}

/** Installed means BOTH halves: a script nothing runs is not installed, and neither is an entry naming a missing script. */
export async function editHookInstalled(options: ResolvedEditHookOptions): Promise<boolean> {
  return (await editHookState(options)) === 'current' && await eventHookInstalled(options.settingsFile, 'PostToolUse');
}

export type EditHookOffer = 'installed' | 'replaced' | 'present' | 'declined' | 'foreign' | 'unavailable';

/**
 * Setup's offer, in the session hook's shape and with its own y/N. It is a SEPARATE question from
 * the session hook on purpose: that hook fetches on a schedule and this one reads what the agent is
 * editing, so folding this into a yes already given would install something the user never agreed
 * to. An outdated copy of our own is refreshed without asking — that consent was given when it was
 * installed, and a stale script gives wrong advice.
 */
export async function offerEditHook(io: Prompter, options: ResolvedEditHookOptions): Promise<EditHookOffer> {
  const target = editHookDestination(options.storeRoot);
  const state = await editHookState(options);
  if (state === 'unavailable') { io.print(`The terum-skills edit hook is not bundled in this copy of terum-skills (expected at ${options.source}); skipped.`); return 'unavailable'; }
  if (state === 'foreign') { io.print(`${target} exists and is not the bundled terum-skills edit hook; left alone. Move it aside and re-run setup to install it.`); return 'foreign'; }
  // `current` still checks the entry: a script the settings file no longer names never runs, and
  // that is the state a hand-edited settings.json leaves behind.
  if (state === 'current' && await eventHookInstalled(options.settingsFile, 'PostToolUse')) { io.print(`The terum-skills edit hook at ${target} is current.`); return 'present'; }
  if (state === 'outdated' || state === 'current') { await installEditHook(options); io.print(`Updated the terum-skills edit hook at ${target}.`); return 'replaced'; }
  if (!(await io.confirm(`Remind Claude Code to publish a skill after it edits one? (installs ${target} and a Write/Edit hook in ${options.settingsFile})`))) {
    io.print('Skipped the edit hook; re-run setup to install it later.');
    return 'declined';
  }
  await installEditHook(options);
  io.print(`Installed the terum-skills edit hook at ${target} and a Write/Edit hook in ${options.settingsFile}.`);
  return 'installed';
}
