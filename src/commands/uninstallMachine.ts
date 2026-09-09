import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { access, mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { defaultHookOptions, HookOptions, hookInstalled, removeHook } from '../lib/hook.js';
import { defaultWrapperOptions, inspectWrapper, removeWrapper, wrapperDestination, WrapperOptions } from '../lib/wrapper.js';
import { Launch, packageRemovalLines } from '../lib/launch.js';
import { Prompter } from '../lib/prompt.js';
import { stripRemoteCredentials } from '../lib/remote.js';
import { fromError, cancelled, failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { teardownTeam } from './leave.js';

export const fsForTests = { rm, rmdir };
export interface UninstallMachineArgs extends WithForm { config?: ConfigStore; hook?: HookOptions; wrapper?: WrapperOptions; launch?: Launch; runner?: Runner; home?: string; }
export interface MachineUninstallResult { teams: string[]; removedPlacements: number; hookRemoved: boolean; wrapperRemoved: boolean; configRemoved: boolean; kept: string[]; record: string; launch: Launch | null; }

/** Confirm and remove this machine's tracked state. Package removal is always advice, never executed. */
export async function run(args: UninstallMachineArgs, io: Prompter): Promise<Result<MachineUninstallResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const options = { ...defaultHookOptions(store.root, args.home), ...args.hook };
    const runner = args.runner ?? systemRunner;
    const bindings = Object.entries(config.teams);
    const placements = Object.keys(config.placements);
    const shared = Object.values(config.shared);
    // Every authoring source stays protected for the whole run, not only until its team's records go.
    const protectedSources = shared.map(({ source }) => source);
    const clones: string[] = [];
    for (const [name] of bindings) { const clone = store.teamClone(name); if (await exists(clone)) clones.push(clone); }
    let hookPresent: boolean;
    try { hookPresent = await hookInstalled(options.settingsFile); }
    catch (error) { return failure(`${message(error)}; nothing was removed`); }
    // The /terum-skills Claude Code skill setup placed: only a copy carrying our marker is ours to remove.
    const wrapper = { ...defaultWrapperOptions(args.home), ...args.wrapper };
    const wrapperDir = wrapperDestination(wrapper.skillsRoot);
    let wrapperPresence: Awaited<ReturnType<typeof inspectWrapper>>;
    try { wrapperPresence = await inspectWrapper(wrapper.skillsRoot); }
    catch (error) { return failure(`${message(error)}; nothing was removed`); }
    const quarantine = join(store.root, 'quarantine');
    const quarantineCount = (await entries(quarantine)).length;
    const backups = join(store.root, 'backups');
    await exists(backups); // Inventory also surfaces an unreadable backup directory before confirmation.
    const configPath = join(store.root, 'config.json');
    const kept: string[] = [];
    const app = join(store.root, 'app');
    const appPresent = await exists(app);
    const evals = join(store.root, 'evals');
    const evalsPresent = await exists(evals);

    io.print('terum-skills will be removed from this machine.');
    io.print(`  Teams (${bindings.length})${bindings.length ? `: ${bindings.map(([name, binding]) => `${name} (${stripRemoteCredentials(binding.remote)}, ${binding.handle === null ? 'no handle' : `handle ${binding.handle}`})`).join(', ')}` : ''}`);
    if (placements.length) io.print(`  Placed skills (${placements.length}): ${placements.join(', ')}`);
    if (clones.length) {
      io.print(`  Local clones (${clones.length}): ${clones.join(', ')}`);
      io.print(`    (a clone holding uncommitted or unpushed work is moved to ${quarantine} instead)`);
    }
    if (bindings.length) io.print('  Version cache and run files for these teams');
    io.print(`  ${hookPresent ? 'Session-start hook in' : 'No session hook in'} ${options.settingsFile}`);
    if (wrapperPresence.kind === 'foreign') io.print(`  ${wrapperDir} is not the bundled /terum-skills Claude Code skill (${wrapperPresence.why}); left alone`);
    else io.print(`  ${wrapperPresence.kind === 'managed' ? '/terum-skills Claude Code skill at' : 'No /terum-skills Claude Code skill at'} ${wrapperDir}`);
    if (appPresent) io.print(`  Downloaded desktop app bundle at ${app} (all versions)`);
    io.print(`  ${configPath}`);
    io.print(`Kept: ${quarantineCount ? `${quarantine} (${quarantineCount} items), ` : ''}${backups} (settings backups and a record of this uninstall)${evalsPresent ? `, ${evals} (eval runs and transcripts)` : ''}`);
    if (quarantineCount) kept.push(quarantine);
    kept.push(backups);
    if (evalsPresent) kept.push(evals);
    if (shared.length) io.print(`Connected-skill sources stay where they are: ${shared.map(({ source }) => `${basename(source)}: ${source}`).join(', ')}`);
    io.print('Your membership and installed-skill records in each team repo are unchanged. Rejoining does not re-place skills; `npx -y terum-skills@latest install member <handle>` does.');
    io.print('The package itself is not removed by this command; the last line tells you how.');
    if (!(await io.confirm('Remove terum-skills from this machine?'))) return cancelled('Uninstall was cancelled.');

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
    let wrapperRemoved = false;
    if (wrapperPresence.kind === 'managed') {
      try { wrapperRemoved = (await removeWrapper(wrapper)) === 'removed'; }
      catch (error) { return failure(`${message(error)}; the /terum-skills skill was left in place and nothing else was removed`); }
      if (wrapperRemoved) io.print(`Removed the /terum-skills Claude Code skill from ${wrapperDir}.`);
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
        const removed = await teardownTeam(store, name, io, runner, protectedSources);
        kept.push(...removed.kept); removedPlacements += removed.removedPaths.length;
      } catch (error) {
        const report = await reportRemaining();
        return failure(`${message(error)}\n${report}\nRe-run \`${invocation(args.form, 'uninstall')}\` to continue.`);
      }
      teams.push(name); io.print(`Left ${name}.`);
    }

    const removal = await store.remove((c) => Object.keys(c.teams).length === 0 && Object.keys(c.placements).length === 0 && c.pending.length === 0 && Object.keys(c.shared).length === 0);
    if (removal === 'kept') {
      const fresh = await store.read();
      const what = [
        Object.keys(fresh.teams).length ? `teams: ${Object.keys(fresh.teams).join(', ')}` : '',
        Object.keys(fresh.placements).length ? `placements: ${Object.keys(fresh.placements).length}` : '',
        fresh.pending.length ? `pending: ${fresh.pending.length}` : '',
        Object.keys(fresh.shared).length ? `connected: ${Object.keys(fresh.shared).length}` : '',
      ].filter(Boolean).join(', ');
      return failure(`Kept ${configPath}: still configured — ${what}. Re-run \`${invocation(args.form, 'uninstall')}\` to continue.`);
    }
    const configRemoved = removal === 'removed';
    if (configRemoved) io.print(`Removed ${configPath}.`);

    let directoryFailure: string | undefined;
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
    io.print('Machine cleanup complete. The package itself has not been removed; finish with the package manager that installed it.');
    for (const line of packageRemovalLines(args.launch)) io.print(line);
    return success({ teams, removedPlacements, hookRemoved, wrapperRemoved, configRemoved, kept, record, launch: args.launch ?? null });
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
