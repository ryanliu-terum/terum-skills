/**
 * Per-machine enable/disable, on Claude Code's own terms.
 *
 * Claude Code loads whatever sits in a skills directory, so terum-skills cannot switch a placed copy
 * off by itself without moving the folder. It does not have to: Claude Code's `skillOverrides`
 * setting ("Override skill visibility from settings", works since Claude Code 2.1.129) takes a skill
 * name to one of `on` / `name-only` / `user-invocable-only` / `off`, and `off` hides the skill from
 * the model and from the `/` menu. The `/skills` menu writes the same key. This module reads and
 * writes that key and keeps no state of its own, so the app's switch and Claude's menu can never
 * disagree — the settings file is the one source of truth (`disablePerMachine`, 2026-09-14).
 *
 * Only `off` is ours: `name-only` and `user-invocable-only` still let Claude or the user reach the
 * skill, so they read as enabled, and `enable` never removes them.
 */
import { basename, dirname, join, resolve } from 'node:path';
import { editSettings, readSettingsFile, type Settings, type SettingsAction } from './hook.js';
import { AGENT_PATHS, checkoutRootOf, isSkillsRoot } from './placer/agent-paths.js';

export interface OverrideRoot { scope: 'global' | 'project'; repoRoot?: string | undefined; }
/** `write` is where this tool records a change for that root; `read` is every file Claude Code consults for it, lowest precedence first. */
export interface OverrideFiles { write: string; read: string[]; }
export interface OverrideWrite { changed: boolean; created: boolean; }
/** The folder's skill name and the files that govern it; `repoRoot` is set for a checkout's `.claude/skills`. */
export interface OverrideTarget { name: string; repoRoot: string | undefined; files: OverrideFiles; }
export interface OverrideReader { enabled(name: string): boolean; problems: { path: string; reason: string }[]; }

export const OVERRIDE_OFF = 'off';

/**
 * Claude Code's precedence for a skill in a project checkout is user < shared project < project-local,
 * and the `/skills` menu saves to the project-local file, so that is where a project-scoped change goes.
 * A global skill is governed by the user file alone.
 */
export function overrideFilesFor(root: OverrideRoot, home: string): OverrideFiles {
  const user = join(home, '.claude', 'settings.json');
  if (root.scope === 'global' || root.repoRoot === undefined) return { write: user, read: [user] };
  const shared = join(root.repoRoot, '.claude', 'settings.json');
  const local = join(root.repoRoot, '.claude', 'settings.local.json');
  return { write: local, read: [user, shared, local] };
}

/** Which files govern one placed folder, from its path alone; undefined when the folder is not directly under a `.claude/skills` root. */
export function overrideTargetFor(path: string, home: string): OverrideTarget | undefined {
  const folder = resolve(path);
  const root = dirname(folder);
  if (!isSkillsRoot(root)) return undefined;
  const repoRoot = resolve(root) === resolve(AGENT_PATHS['claude-code'].global(home)) ? undefined : checkoutRootOf(folder);
  return { name: basename(folder), repoRoot, files: overrideFilesFor(repoRoot === undefined ? { scope: 'global' } : { scope: 'project', repoRoot }, home) };
}

/** Claude Code matches skill names ignoring case and spacing; so does this lookup, so a hand-written entry is honoured. */
const normalize = (name: string): string => name.toLowerCase().replace(/\s+/g, '');

function overridesOf(value: Settings, path: string, action: SettingsAction): Record<string, unknown> | undefined {
  const raw = value.skillOverrides;
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Cannot ${action} ${path}: "skillOverrides" is not an object.${action === 'edit' ? ' Fix it by hand or move it aside, then re-run.' : ''}`);
  return raw as Record<string, unknown>;
}

function entryKey(overrides: Record<string, unknown>, name: string): string | undefined {
  const wanted = normalize(name);
  return Object.keys(overrides).find((key) => normalize(key) === wanted);
}

/**
 * Read every file once. A file that cannot be read or parsed is a `problem` naming it and is otherwise
 * silent — a skill is never reported off on a guess. `enabled` is true unless the highest-precedence
 * readable file that names the skill says `off`.
 */
export async function loadOverrides(files: readonly string[]): Promise<OverrideReader> {
  const layers: Record<string, unknown>[] = [];
  const problems: OverrideReader['problems'] = [];
  for (const file of files) {
    try {
      const value = await readSettingsFile(file, 'read');
      if (value === undefined) continue;
      const overrides = overridesOf(value, file, 'read');
      if (overrides) layers.push(overrides);
    } catch (error) {
      problems.push({ path: file, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    problems,
    enabled(name) {
      let enabled = true;
      for (const overrides of layers) {
        const key = entryKey(overrides, name);
        if (key !== undefined) enabled = overrides[key] !== OVERRIDE_OFF;
      }
      return enabled;
    },
  };
}

/** Write `off` for the skill, or remove our `off`; every other byte of the file stays as it was. */
export async function writeSkillEnabled(options: { settingsFile: string; backupDir: string }, name: string, enabled: boolean): Promise<OverrideWrite> {
  return editSettings(options, (value) => {
    const overrides = overridesOf(value, options.settingsFile, 'edit');
    const key = (overrides && entryKey(overrides, name)) ?? name;
    if (!enabled) {
      if (overrides?.[key] === OVERRIDE_OFF) return false;
      const target = overrides ?? {};
      target[key] = OVERRIDE_OFF;
      value.skillOverrides = target;
      return true;
    }
    if (!overrides || overrides[key] !== OVERRIDE_OFF) return false;
    delete overrides[key];
    if (Object.keys(overrides).length === 0) delete value.skillOverrides;
    return true;
  });
}
