/**
 * `skill disable <path>` / `skill enable <path>` — the per-machine switch behind `disablePerMachine`.
 *
 * Nothing moves and nothing is recorded in the ledger: the verb writes Claude Code's own
 * `skillOverrides` entry for the root the folder sits in (src/lib/skill-overrides.ts), which is the
 * same key the `/skills` menu writes, so the app's switch and Claude's menu always agree. A global
 * folder is governed by `~/.claude/settings.json`; a project folder by that checkout's
 * `.claude/settings.local.json`, which this tool keeps out of git the way it keeps placed folders out.
 */
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { type ConfigStore, createConfigStore } from '../lib/config.js';
import { defaultHookOptions } from '../lib/hook.js';
import type { WithForm } from '../lib/invocation.js';
import { appendExclude } from '../lib/placer.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { overrideTargetFor, writeSkillEnabled } from '../lib/skill-overrides.js';

export interface SkillToggleArgs extends WithForm { kind: 'enable' | 'disable'; path: string; config?: ConfigStore; home?: string; runner?: Runner; }
export interface SkillToggleResult { kind: 'enable' | 'disable'; path: string; name: string; enabled: boolean; settingsFile: string; changed: boolean; notices: string[]; }

const LOCAL_SETTINGS = '.claude/settings.local.json';

export async function run(args: SkillToggleArgs, io: Prompter): Promise<Result<SkillToggleResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const home = args.home ?? homedir();
    const runner = args.runner ?? systemRunner;
    const path = resolve(args.path);
    const target = overrideTargetFor(path, home);
    if (!target) throw new Error(`Refusing to change ${path}: it is not a folder directly under a .claude/skills directory.`);
    try { await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Nothing at ${path}.`); throw error; }
    const { name, repoRoot, files } = target;
    const enabled = args.kind === 'enable';
    const verb = enabled ? 'Enabled' : 'Disabled';
    const { changed, created } = await writeSkillEnabled({ settingsFile: files.write, backupDir: defaultHookOptions(store.root, home).backupDir }, name, enabled);
    const notices: string[] = [];
    // The exclude is hygiene, not the change: a checkout without git keeps the setting and hears why the exclude was skipped.
    if (created && repoRoot !== undefined) await appendExclude(repoRoot, LOCAL_SETTINGS, runner).catch((error: unknown) => {
      notices.push(`${verb} ${name} but could not add ${LOCAL_SETTINGS} to .git/info/exclude: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!changed) io.print(`${name} is already ${enabled ? 'enabled' : 'disabled'}; nothing changed.`);
    else io.print(enabled ? `Enabled ${name}: Claude Code loads it again on this machine (skillOverrides in ${files.write}).` : `Disabled ${name}: Claude Code no longer loads it on this machine (skillOverrides in ${files.write}).`);
    for (const notice of notices) io.print(notice);
    return success({ kind: args.kind, path, name, enabled, settingsFile: files.write, changed, notices });
  } catch (error) { return fromError(error); }
}
