import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { access, mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { defaultHookOptions, HookOptions, hookInstalled, removeHook } from '../lib/hook.js';
import { defaultWrapperOptions, type ManagedInventory, managedSkillInventory, removeManagedSkill, type WrapperOptions } from '../lib/wrapper.js';
import { defaultEditHookOptions, editHookDestination, type EditHookOptions, inspectEditHook, removeEditHook } from '../lib/editHook.js';
import { Launch, packageRemovalLines } from '../lib/launch.js';
import { Prompter } from '../lib/prompt.js';
import { stripRemoteCredentials } from '../lib/remote.js';
import { fromError, cancelled, failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { APP_BUNDLE, APP_PRODUCT, applicationsDirectory } from './app.js';
import { teardownTeam } from './leave.js';

export const fsForTests = { rm, rmdir };
export interface UninstallMachineArgs extends WithForm { config?: ConfigStore; hook?: HookOptions; wrapper?: WrapperOptions; editHook?: Partial<EditHookOptions>; launch?: Launch; runner?: Runner; home?: string; platform?: NodeJS.Platform; /** Test knob: the folder holding the macOS bundle (default `~/Applications`). */ applicationsDir?: string; }
export interface MachineUninstallResult { teams: string[]; removedPlacements: number; hookRemoved: boolean; wrapperRemoved: boolean; /** The bundled skill folders removed, per host root; `wrapperRemoved` is their non-emptiness (the desktop reads the boolean). */ wrappersRemoved: string[]; configRemoved: boolean; kept: string[]; record: string; launch: Launch | null; advice: string[]; }

/** Confirm and remove this machine's tracked state. Package removal is always advice, never executed. */
export async function run(args: UninstallMachineArgs, io: Prompter): Promise<Result<MachineUninstallResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const options = { ...defaultHookOptions(store.root, args.home), ...args.hook };
    const runner = args.runner ?? systemRunner;
    const bindings = Object.entries(config.teams);
    const placements = Object.keys(config.placements);
    const clones: string[] = [];
    for (const [name] of bindings) { const clone = store.teamClone(name); if (await exists(clone)) clones.push(clone); }
    let hookPresent: boolean;
    try { hookPresent = await hookInstalled(options.settingsFile); }
    catch (error) { return failure(`${message(error)}; nothing was removed`); }
    // The terum-skills skills setup placed under each host's skills root: only a copy carrying our marker is ours to remove.
    const wrapper = { ...defaultWrapperOptions(args.home), ...args.wrapper };
    let skills: ManagedInventory;
    try { skills = await managedSkillInventory(wrapper); }
    catch (error) { return failure(`${message(error)}; nothing was removed`); }
    const editHook = { ...defaultEditHookOptions(store.root, args.home), ...args.editHook };
    const editHookPath = editHookDestination(editHook.storeRoot);
    let editHookPresence: Awaited<ReturnType<typeof inspectEditHook>>;
    try { editHookPresence = await inspectEditHook(editHook.storeRoot); }
    catch (error) { return failure(`${editHookPath} could not be read: ${message(error)}`); }
    const quarantine = join(store.root, 'quarantine');
    const quarantineCount = (await entries(quarantine)).length;
    const backups = join(store.root, 'backups');
    await exists(backups); // Inventory also surfaces an unreadable backup directory before confirmation.
    const configPath = join(store.root, 'config.json');
    const kept: string[] = [];
    const app = join(store.root, 'app');
    const appPresent = await exists(app);
    const platform = args.platform ?? process.platform;
    const bundle = join(applicationsDirectory(args.applicationsDir), APP_BUNDLE);
    const bundlePresent = platform === 'darwin' && await exists(bundle);
    const evals = join(store.root, 'evals');
    const evalsPresent = await exists(evals);

    const launchStateFiles = ['app.json', 'latest-version.json'].map(name => join(store.root, 'run', name));
    const launchStatePresent = (await Promise.all(launchStateFiles.map(exists))).some(Boolean);
    const detail: string[] = [];
    detail.push('terum-skills will be removed from this machine.');
    if (bindings.length === 0) detail.push('  No team');
    else if (bindings.length === 1) {
      const [name, binding] = bindings[0]!;
      detail.push(`  Team: ${name} (${stripRemoteCredentials(binding.remote)}, ${binding.handle === null ? 'no handle' : `handle ${binding.handle}`})`);
    } else detail.push(`  Teams (${bindings.length})${bindings.length ? `: ${bindings.map(([name, binding]) => `${name} (${stripRemoteCredentials(binding.remote)}, ${binding.handle === null ? 'no handle' : `handle ${binding.handle}`})`).join(', ')}` : ''}`);
    if (placements.length) detail.push(`  Placed skills (${placements.length}): ${placements.join(', ')}`);
    if (clones.length) {
      detail.push(`  Local clones (${clones.length}): ${clones.join(', ')}`);
      detail.push(`    (a clone holding uncommitted or unpushed work is moved to ${quarantine} instead)`);
    }
    if (bindings.length) detail.push('  Version cache and run files for these teams');
    detail.push(`  ${hookPresent ? 'Session-start hook in' : 'No session hook in'} ${options.settingsFile}`);
    for (const root of skills.roots) {
      detail.push(root.managed.length ? `  terum-skills skills in ${root.root}: ${root.managed.map((skill) => skill.name).join(', ')}` : `  No terum-skills skills in ${root.root}`);
      for (const entry of root.foreign) detail.push(`  ${entry.directory} is not a bundled terum-skills skill (${entry.why}); left alone`);
    }
    for (const root of skills.skipped) detail.push(`  No ${dirname(root.root)} on this machine; Codex skills skipped.`);
    if (editHookPresence.kind === 'foreign') detail.push(`  ${editHookPath} is not the bundled terum-skills edit hook (${editHookPresence.why}); left alone`);
    else detail.push(`  ${editHookPresence.kind === 'managed' ? 'Edit hook (and its Write/Edit entry) at' : 'No edit hook at'} ${editHookPath}`);
    if (bundlePresent) detail.push(`  Desktop app at ${bundle}`);
    if (appPresent) detail.push(`  Desktop app downloads and records at ${app} (all versions)`);
    if (launchStatePresent) detail.push(`  Desktop launch state in ${join(store.root, 'run')} (app.json, latest-version.json)`);
    detail.push(`  ${configPath}`);
    detail.push(`Kept: ${quarantineCount ? `${quarantine} (${quarantineCount} items), ` : ''}${backups} (settings backups and a record of this uninstall)${evalsPresent ? `, ${evals} (eval runs and transcripts)` : ''}`);
    if (quarantineCount) kept.push(quarantine);
    kept.push(backups);
    if (evalsPresent) kept.push(evals);
    detail.push('Your membership and installed-skill records in the team repo are unchanged. Rejoining does not re-place skills; `npx -y terum-skills@latest install member <handle>` does.');
    detail.push('The package itself is not removed by this command; the last line tells you how.');
    if (!(await io.confirm('Remove terum-skills from this machine?', { detail }))) return cancelled('Uninstall was cancelled.');

    await mkdir(backups, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const record = join(backups, `uninstall.${stamp}.json`);
    await writeFile(record, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    io.print(`Wrote a record of this machine's terum-skills state to ${record}.`);
    let hookRemoved = false;
    if (hookPresent) {
      let outcome: 'removed' | 'absent';
      try { outcome = await removeHook(options); }
      catch (error) { return failure(`${message(error)}; the hook was left in place and nothing else was removed`); }
      hookRemoved = outcome === 'removed';
      io.print(hookRemoved ? `Removed the session hook from ${options.settingsFile}.` : `No session hook in ${options.settingsFile}.`);
    }
    const wrappersRemoved: string[] = [];
    for (const root of skills.roots) {
      const removed: string[] = [];
      for (const skill of root.managed) {
        try { if ((await removeManagedSkill(root.root, skill.name)) === 'removed') { removed.push(skill.name); wrappersRemoved.push(skill.directory); } }
        catch (error) { return failure(`${message(error)}; removing the terum-skills skills stopped at ${skill.directory} and the teams were left in place`); }
      }
      if (removed.length) io.print(`Removed the terum-skills skills from ${root.root}: ${removed.join(', ')}.`);
    }
    const wrapperRemoved = wrappersRemoved.length > 0;
    // Both halves, entry first (removeEditHook): an entry naming a deleted script would fire on
    // every edit and fail. A foreign file at that path keeps its settings entry too — we did not
    // write either one, and guessing which is ours is how a hand-rolled hook gets deleted.
    if (editHookPresence.kind === 'managed') {
      try { if (await removeEditHook(editHook) === 'removed') io.print(`Removed the terum-skills edit hook from ${editHookPath} and ${editHook.settingsFile}.`); }
      catch (error) { return failure(`${message(error)}; the edit hook was left in place and nothing else was removed`); }
    }

    const teams: string[] = [];
    let removedPlacements = 0;
    const confirmed = new Set(Object.keys(config.teams));
    async function reportRemaining(): Promise<string> {
      const remaining = Object.keys((await store.read()).teams);
      if (await exists(configPath)) remaining.push('config.json');
      const lines = [`Done: ${teams.join(', ') || 'nothing'}`, `Remaining: ${remaining.join(', ') || 'nothing'}`];
      for (const line of lines) io.print(line);
      return lines.join('\n');
    }
    while (true) {
      const fresh = await store.read();
      const remaining = Object.keys(fresh.teams);
      const added = remaining.find((name) => !confirmed.has(name));
      if (added !== undefined) {
        await reportRemaining();
        return failure(`Team ${added} was added while uninstalling; re-run ${invocation(args.form, 'uninstall')}.`);
      }
      const name = remaining[0];
      if (name === undefined) break;
      io.print(`Leaving ${name}…`);
      try {
        const removed = await teardownTeam(store, name, io, runner);
        kept.push(...removed.kept); removedPlacements += removed.removedPaths.length;
      } catch (error) {
        const report = await reportRemaining();
        return failure(`${message(error)}\n${report}\nRe-run \`${invocation(args.form, 'uninstall')}\` to continue.`);
      }
      teams.push(name); io.print(`Left ${name}.`);
    }

    const removal = await store.remove((c) => Object.keys(c.teams).length === 0 && Object.keys(c.placements).length === 0 && c.pending.length === 0);
    if (removal === 'kept') {
      const fresh = await store.read();
      const what = [
        Object.keys(fresh.teams).length ? `teams: ${Object.keys(fresh.teams).join(', ')}` : '',
        Object.keys(fresh.placements).length ? `placements: ${Object.keys(fresh.placements).length}` : '',
        fresh.pending.length ? `pending: ${fresh.pending.length}` : '',
      ].filter(Boolean).join(', ');
      return failure(`Kept ${configPath}: still configured — ${what}. Re-run \`${invocation(args.form, 'uninstall')}\` to continue.`);
    }
    const configRemoved = removal === 'removed';
    if (configRemoved) io.print(`Removed ${configPath}.`);

    let directoryFailure: string | undefined;
    for (const path of launchStateFiles) {
      try { await fsForTests.rm(path, { force: true }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        io.print(`Kept ${path}: ${message(error)}`); kept.push(path);
        directoryFailure ??= `Could not remove ${path}: ${message(error)}. Everything else was removed; re-run \`${invocation(args.form, 'uninstall')}\` to retry.`;
      }
    }
    if (bundlePresent) {
      try { await fsForTests.rm(bundle, { recursive: true, force: true }); }
      catch (error) {
        io.print(`Kept ${bundle}: ${message(error)}`); kept.push(bundle);
        directoryFailure ??= `Could not remove ${bundle}: ${message(error)}. Everything else was removed; re-run \`${invocation(args.form, 'uninstall')}\` to retry.`;
      }
    }
    for (const path of ['app', 'run', 'cache', 'teams', 'quarantine'].map((name) => join(store.root, name)).concat(store.root)) {
      try { if (path === app) await fsForTests.rm(path, { recursive: true, force: true }); else await fsForTests.rmdir(path); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') continue;
        if (code === 'ENOTEMPTY' || code === 'EEXIST') {
          if (path === store.root) continue;
          io.print(path === quarantine ? `Kept ${path} (${(await entries(path)).length} items).` : `Kept ${path} (not empty).`);
          kept.push(path);
          continue;
        }
        io.print(`Kept ${path}: ${message(error)}`); kept.push(path);
        directoryFailure ??= `Could not remove ${path}: ${message(error)}. Everything else was removed; re-run \`${invocation(args.form, 'uninstall')}\` to retry.`;
      }
    }
    if (directoryFailure) return failure(directoryFailure);
    const appLines: string[] = [];
    if (appPresent || bundlePresent) {
      if (platform === 'darwin') appLines.push(`The desktop app was deleted from ${[bundlePresent ? bundle : null, appPresent ? app : null].filter(Boolean).join(' and ')}. A copy that is running keeps running until you quit it; it cannot be reopened from the Dock. \`${invocation(args.form, 'app')}\` downloads it again (needs gh and the release).`);
      if (platform === 'win32') appLines.push(`The desktop app under %LOCALAPPDATA%\\${APP_PRODUCT} stays installed; remove it from Windows Settings ▸ Apps. Only its download record under ${app} was removed.`);
      appLines.push("This app's own preferences (theme, layout) are kept by the app and were not touched.");
    }
    const advice = [...packageRemovalLines(args.launch), ...appLines];
    io.print('Machine cleanup complete. The package itself has not been removed; finish with the package manager that installed it.');
    for (const line of advice) io.print(line);
    return success({ teams, removedPlacements, hookRemoved, wrapperRemoved, wrappersRemoved, configRemoved, kept, record, advice, launch: args.launch ?? null });
  } catch (error) { return fromError(error); }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function entries(path: string): Promise<string[]> {
  try { return await readdir(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
