import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { lockTarget, moveToQuarantine, place, remove } from '../lib/placer.js';
import { NonInteractivePrompter, Prompter } from '../lib/prompt.js';
import { normalizeRemote } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { allowedTools, parseJson, personSchema, sameScope } from '../lib/schema.js';
import { endorsedCandidates, findSkill, readPerson, readTeam, skillRecords } from '../lib/skills.js';
import { snapshotSkillDirectory } from '../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { openTeamRepo, refreshClone, treeText } from '../lib/teamRepo.js';
import { materializeVersion } from '../lib/version.js';
import { reconcileShared } from './share.js';
import { installOne, skillAtSource } from './install.js';
import { uninstallOne } from './uninstall.js';

export interface SyncArgs { hook?: boolean; prune?: boolean; config?: ConfigStore; runner?: Runner; cwd?: string; }
export interface SyncResult { placed: number; deferred: string[]; notices: string[]; changed: boolean; hook: boolean; }

/** Overloads keep the hook caller compiler-restricted to print-only I/O (§3). */
export function run(args: SyncArgs & { hook: true }, io: NonInteractivePrompter): Promise<Result<SyncResult>>;
export function run(args: SyncArgs, io: Prompter): Promise<Result<SyncResult>>;
export async function run(args: SyncArgs, io: Prompter | NonInteractivePrompter): Promise<Result<SyncResult>> {
  const notices: string[] = [];
  const deferred: string[] = [];
  let placed = 0;
  let changed = false;
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const interactive = !args.hook && io.interactive && 'confirm' in io;
    const notice = (line: string) => { notices.push(line); if (!args.hook) io.print(line); };
    if (args.prune) {
      if (!interactive) throw new Error('sync prune needs an interactive terminal.');
      await prune(store, io as Prompter);
      return success({ placed: 0, deferred: [], notices: [], changed: true, hook: false });
    }
    const config = await store.read();
    for (const team of Object.keys(config.teams)) {
      const clone = store.teamClone(team);
      await refreshClone(runner, clone, { label: team, env: args.hook ? { GIT_TERMINAL_PROMPT: '0' } : {} });
      await skillRecords(clone, team, { onProblem: (problem) => notice(`Skipping ${team}/${problem.name}: ${problem.message}`) });
      // Pending is intent, never inferred from the filesystem. A replay uses the same command
      // primitive; an unapproved hook replay is deferred rather than silently completed.
      for (const pending of (await store.read()).pending.filter((entry) => entry.team === team)) {
        try {
          const skill = await findSkill(clone, team, pending.id);
          if (!skill) { deferred.push(`${pending.id.slice(0, 8)} is no longer in ${team}`); continue; }
          if (pending.op === 'uninstall') { await uninstallOne({ team, id: pending.id, scope: pending.scope, store, runner, cwd: args.cwd }, io as Prompter); changed = true; continue; }
          const version = 'version' in pending && typeof pending.version === 'string' ? pending.version : undefined;
          const source = version ? await materializeVersion(store, team, clone, skill.name, version, runner) : skill.directory;
          const placedSkill = await skillAtSource(source, skill);
          if (!approved((await store.read()), skill.id, placedSkill.grants) && !interactive) { deferred.push(skill.name); continue; }
          await installOne({ team, id: pending.id, scope: pending.scope, version, store, runner, cwd: args.cwd }, io as Prompter);
          placed++; changed = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          deferred.push(pending.scope.kind === 'project' && message.includes('no matching project context') ? `${pending.id.slice(0, 8)} needs a checkout for project ${pending.scope.project}` : pending.id.slice(0, 8));
          notice(`Deferred pending ${pending.op} for ${pending.id.slice(0, 8)}: ${message}`);
        }
      }
    }
    // Reconciliation never prompts, but it reports. Its lines must ride the notice channel so a
    // hook run keeps stdout for the reload directive alone (§8) and stderr carries the rest.
    const reconcileIo: Prompter = {
      interactive: 'confirm' in io ? io.interactive : false,
      print: notice,
      confirm: (question) => ('confirm' in io ? io.confirm(question) : Promise.resolve(false)),
      text: (question, defaultValue) => ('text' in io ? io.text(question, defaultValue) : Promise.reject(new Error('sync --hook cannot prompt'))),
      select: (question, choices) => ('select' in io ? io.select(question, choices) : Promise.reject(new Error('sync --hook cannot prompt'))),
    };
    await reconcileShared(store, runner, reconcileIo);
    // Existing ledger paths drive every later decision. A folder merely present on disk is never
    // adopted, quarantined, or deleted without a ledger entry.
    const currentConfig = await store.read();
    for (const [path, entry] of Object.entries(currentConfig.placements)) {
      const clone = store.teamClone(entry.team);
      const projectRoot = entry.scope.kind === 'project' ? await matchingProjectRoot(clone, entry.scope.project, runner, args.cwd) : undefined;
      // Project placement is worktree-local. An unrelated session never even inspects another
      // checkout's placement, so it cannot quarantine or overwrite it.
      if (entry.scope.kind === 'project' && !projectRoot) continue;
      const binding = (await store.read()).teams[entry.team];
      const person = binding?.handle ? await actorPerson(store, entry.team, binding.handle) : undefined;
      if (person && !person.installed.some((item) => item.id === entry.id && sameScope(item.scope, entry.scope)) && !currentConfig.pending.some((pending) => pending.id === entry.id && pending.team === entry.team && sameScope(pending.scope, entry.scope))) continue;
      if (person?.declined.includes(entry.id)) continue;
      const skill = await findSkill(clone, entry.team, entry.id);
      if (!skill) { notice(`Blocked ${path}: its skill is no longer in the repository.`); continue; }
      const source = entry.version ? await materializeVersion(store, entry.team, clone, skill.name, entry.version, runner) : skill.directory;
      const grants = (await skillAtSource(source, skill)).grants;
      if (!approved((await store.read()), skill.id, grants)) {
        if (!grants.ok) { notice(`Blocked ${skill.name}: allowed-tools is malformed.`); continue; }
        if (!interactive) { deferred.push(skill.name); continue; }
        (io as Prompter).print(`allowed-tools changed for ${skill.name}:\n${grants.normalized}`);
        if (!(await (io as Prompter).confirm(`Approve updated tools for ${skill.name}?`))) { deferred.push(skill.name); continue; }
        await store.update((fresh) => { fresh.approvals[skill.id] = { grants: grants.hash, approved_at: new Date().toISOString().slice(0, 10) }; });
      }
      const current = await snapshotSkillDirectory(path).catch(() => undefined);
      if (current && current.fingerprint !== entry.fingerprint) {
        const quarantined = await moveToQuarantine(path, join(store.root, 'quarantine'), basename(path));
        notice(`Local changes at ${path} moved to ${quarantined}.`);
        changed = true;
      }
      const repoSnapshot = await snapshotSkillDirectory(source);
      if (current?.fingerprint === entry.fingerprint && repoSnapshot.fingerprint === entry.fingerprint) continue;
      // The ledger is provenance for the exact placement, including a particular project checkout.
      // Re-resolving a global path would use this process's HOME and can update the wrong machine.
      const root = dirname(path);
      const release = await lockTarget(root, skill.name);
      try {
        const result = await place(source, root, skill.name, { replace: Boolean(current), projectRoot, runner });
        const renamed = basename(path) !== skill.name;
        await store.update((fresh) => {
          const placement = fresh.placements[path];
          if (!placement) return;
          if (renamed) { delete fresh.placements[path]; fresh.placements[result.path] = { ...placement, fingerprint: result.snapshot.fingerprint }; }
          else placement.fingerprint = result.snapshot.fingerprint;
        });
        if (renamed) {
          await remove(root, path, entry.fingerprint, join(store.root, 'quarantine'));
          notice(`Renamed placed skill ${basename(path)} to ${skill.name}.`);
        }
        for (const line of result.notices) notice(line);
      } finally { await release(); }
      placed++; changed = true;
    }
    {
      // Newly endorsed global skills are an opt-in batch. Per-skill tool approval remains inside
      // installOne, so the batch question cannot answer a consent prompt on the user's behalf.
      for (const [team, binding] of Object.entries((await store.read()).teams)) {
        if (!binding.handle) continue;
        const candidates = await endorsedCandidates(store.teamClone(team), team, binding.handle, { onProblem: (problem) => notice(`Skipping ${team}/${problem.name}: ${problem.message}`) });
        if (!candidates.length) continue;
        if (!interactive) {
          deferred.push(...candidates.map((skill) => skill.name));
          continue;
        }
        if (await (io as Prompter).confirm(`Install ${candidates.length} newly endorsed skill(s) from ${team}?`)) {
          for (const skill of candidates) { await installOne({ team, id: skill.id, store, runner, cwd: args.cwd }, io as Prompter); placed++; changed = true; }
        }
      }
    }
    await reconcileOrphans(store, runner, interactive ? io as Prompter : undefined, deferred, notice);
    if (changed && !args.hook) (io as { print(line: string): void }).print('Skills synchronized.');
    if (args.hook && placed) (io as { print(line: string): void }).print('{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}');
    for (const team of Object.keys((await store.read()).teams)) await writeStamp(store, team);
    return success({ placed, deferred, notices, changed, hook: Boolean(args.hook) });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error), args.hook ? { placed, deferred, notices, changed, hook: true } : undefined); }
}

function approved(config: Awaited<ReturnType<ConfigStore['read']>>, id: string, grants: ReturnType<typeof allowedTools>): boolean {
  return grants.ok && (grants.normalized === 'none' || config.approvals[id]?.grants === grants.hash);
}
async function reconcileOrphans(store: ConfigStore, runner: Runner, io: Prompter | undefined, deferred: string[], notice: (line: string) => void): Promise<void> {
  const config = await store.read();
  for (const [path, placement] of Object.entries(config.placements)) {
    if (config.pending.some((entry) => entry.id === placement.id && entry.team === placement.team && sameScope(entry.scope, placement.scope))) continue;
    const binding = config.teams[placement.team];
    if (!binding?.handle) continue;
    const person = await actorPerson(store, placement.team, binding.handle);
    if (!person) continue;
    if (person.declined.includes(placement.id)) continue;
    if (person.installed.some((entry) => entry.id === placement.id && sameScope(entry.scope, placement.scope))) continue;
    if (!io) { deferred.push(basename(path)); continue; }
    const adopt = await io.confirm(`Adopt orphaned placement at ${path}?`);
    const repo = openTeamRepo(store.teamClone(placement.team), binding.remote, runner);
    if (adopt) {
      await repo.safeWrite((tree) => {
        const personPath = `people/${binding.handle}.json`;
        const raw = tree.before(personPath);
        if (!raw) throw new Error(`Missing ${personPath}.`);
        const fresh = parseJson(personSchema, treeText(raw), personPath);
        if (!fresh.installed.some((entry) => entry.id === placement.id && sameScope(entry.scope, placement.scope))) {
          fresh.installed.push({ id: placement.id, version: placement.version, scope: placement.scope, since: new Date().toISOString().slice(0, 10) });
          tree.set(personPath, `${JSON.stringify(fresh, null, 2)}\n`);
        }
      }, { action: 'install', handle: binding.handle, message: `${binding.handle}: adopt ${placement.id.slice(0, 8)}` });
      notice(`Adopted orphaned placement at ${path}.`);
    } else {
      await repo.safeWrite((tree) => {
        const personPath = `people/${binding.handle}.json`;
        const raw = tree.before(personPath);
        if (!raw) throw new Error(`Missing ${personPath}.`);
        const fresh = parseJson(personSchema, treeText(raw), personPath);
        if (!fresh.declined.includes(placement.id)) fresh.declined.push(placement.id);
        tree.set(personPath, `${JSON.stringify(fresh, null, 2)}\n`);
      }, { action: 'uninstall', handle: binding.handle, message: `${binding.handle}: decline ${placement.id.slice(0, 8)}` });
      notice(`Declined orphaned placement at ${path}.`);
    }
  }
}
async function actorPerson(store: ConfigStore, team: string, handle: string) {
  try { return await readPerson(store.teamClone(team), handle); } catch { return undefined; }
}
async function writeStamp(store: ConfigStore, team: string): Promise<void> { const run = join(store.root, 'run'); await mkdir(run, { recursive: true, mode: 0o700 }); await writeFile(join(run, `${team}.stamp`), new Date().toISOString(), 'utf8'); }

async function matchingProjectRoot(clone: string, project: string, runner: Runner, cwd?: string): Promise<string | undefined> {
  const root = await runner.run('git', ['rev-parse', '--show-toplevel'], cwd ? { cwd } : undefined);
  if (root.code !== 0 || !root.stdout.trim()) return undefined;
  const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: root.stdout.trim() });
  if (origin.code !== 0) return undefined;
  const listed = (await readTeam(clone)).projects[project];
  return listed?.remotes.some((remote) => normalizeRemote(remote) === normalizeRemote(origin.stdout.trim())) ? root.stdout.trim() : undefined;
}

/** The only destructive operation: named entries immediately under our quarantine root. */
async function prune(store: ConfigStore, io: Prompter): Promise<void> {
  const root = resolve(store.root, 'quarantine');
  let entries: string[];
  try { entries = await readdir(root); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { io.print('Quarantine is empty.'); return; } throw error; }
  const paths = entries.map((entry) => resolve(root, entry)).filter((path) => path.startsWith(`${root}/`));
  if (!paths.length) { io.print('Quarantine is empty.'); return; }
  for (const path of paths) io.print(path);
  if (!(await io.confirm(`Delete ${paths.length} quarantined item(s)?`))) return;
  for (const path of paths) await rm(path, { recursive: true, force: false });
}
