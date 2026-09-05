import { basename, dirname, join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { exists } from '../lib/fs.js';
import { lockTarget, remove } from '../lib/placer.js';
import { Prompter } from '../lib/prompt.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { parseJson, personSchema, sameScope, teamSchema } from '../lib/schema.js';
import { findSkill, readPerson, readTeam } from '../lib/skills.js';
import { openTeamRepo, SafeWriteOptions, treeText } from '../lib/teamRepo.js';
import { parseRef, teamForReference } from './install.js';

export interface UninstallArgs { ref?: string; kind?: 'skill' | 'member' | 'project'; member?: string; project?: string; team?: string; config?: ConfigStore; runner?: Runner; cwd?: string; home?: string; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>; }
export interface UninstalledResult { id: string; team: string; removed: number; }

export async function run(args: UninstallArgs, io: Prompter): Promise<Result<UninstalledResult[]>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const parsedRef = args.ref && !args.kind && !args.member && !args.project ? parseRef(args.ref) : undefined;
    const team = parsedRef ? await teamForReference(config, args.team ?? parsedRef.team, parsedRef.remote, parsedRef.name) : args.team ?? (Object.keys(config.teams).length === 1 ? Object.keys(config.teams)[0] : undefined);
    if (!team || !config.teams[team]) throw new Error('Select a configured team with --team or a qualified ref.');
    if (args.kind === 'member' || args.member) {
      const member = await readPerson(store.teamClone(team), args.member ?? args.ref ?? '');
      const targets: UninstallTarget[] = [];
      for (const item of member.installed) for (const scope of await ledgerScopes(store, team, item.id, [item.scope])) targets.push({ id: item.id, scope });
      return success(await uninstallMany({ team, targets, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io));
    }
    if (args.kind === 'project' || args.project) {
      const project = args.project ?? args.ref ?? '';
      const teamJson = await readTeam(store.teamClone(team));
      const listed = teamJson.projects[project];
      if (!listed) throw new Error(`Unknown project ${project}.`);
      const targets: UninstallTarget[] = [];
      for (const id of listed.skills) for (const scope of await ledgerScopes(store, team, id, [{ kind: 'project', project }])) targets.push({ id, scope });
      return success(await uninstallMany({ team, targets, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io));
    }
    if (!args.ref) throw new Error('Provide a skill ref, `member <handle>`, or `project <name>`.');
    const record = await findSkill(store.teamClone(team), team, parsedRef?.name ?? args.ref.split('@')[0]!);
    if (!record) throw new Error(`No skill ${args.ref} in team ${team}.`);
    const handle = config.teams[team]!.handle;
    if (!handle) throw new Error(`Team ${team} has no joined handle.`);
    const person = await readPerson(store.teamClone(team), handle);
    const installed = person.installed.filter((entry) => entry.id === record.id);
    const targets = (await ledgerScopes(store, team, record.id, installed.map((entry) => entry.scope))).map((scope) => ({ id: record.id, scope }));
    return success(await uninstallMany({ team, targets, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io));
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

export interface UninstallTarget { id: string; scope: { kind: 'global' } | { kind: 'project'; project: string }; }
interface UninstallInput { team: string; store: ConfigStore; runner: Runner; cwd?: string; home?: string; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>; }

/**
 * Remove several placements and unrecord them in ONE team-repo write. `uninstall member` and
 * `uninstall project` used to run one full fetch/commit/push per skill against the same people
 * file (M2 review, contested 4b; D9 sweep 2026-09-05): N pushes for N skills, and a refused push
 * midway left the roster half-updated. Order: record every pending entry, remove every placement
 * under its target lock, rewrite the people file once, clear the pending entries. A crash before
 * the write leaves the pending entries for sync to replay one at a time through uninstallOne —
 * the same primitive with one target.
 */
export async function uninstallMany(input: UninstallInput & { targets: readonly UninstallTarget[] }, io: Prompter): Promise<UninstalledResult[]> {
  const config = await input.store.read();
  const teamConfig = config.teams[input.team];
  if (!teamConfig?.handle) throw new Error(`Team ${input.team} has no joined handle.`);
  if (!input.targets.length) return [];
  const started = new Date().toISOString();
  const pendings = input.targets.map((target) => ({ op: 'uninstall' as const, id: target.id, team: input.team, scope: target.scope, started }));
  await input.store.update((fresh) => { for (const pending of pendings) if (!fresh.pending.some((entry) => samePending(entry, pending))) fresh.pending.push(pending); });
  const results: UninstalledResult[] = [];
  const placements = (await input.store.read()).placements;
  for (const target of input.targets) {
    const matching = Object.entries(placements).filter(([, entry]) => entry.id === target.id && entry.team === input.team && sameScope(entry.scope, target.scope));
    if (!matching.length) io.print(`${target.id.slice(0, 8)} is not placed on this machine.`);
    await removePlacements(input.store, matching, io);
    results.push({ id: target.id, team: input.team, removed: matching.length });
  }
  const repo = openTeamRepo(input.store.teamClone(input.team), teamConfig.remote, input.runner);
  const label = input.targets.length === 1 ? input.targets[0]!.id.slice(0, 8) : `${input.targets.length} skills`;
  await repo.safeWrite((tree) => {
    const path = `people/${teamConfig.handle}.json`;
    const raw = tree.before(path);
    if (!raw) throw new Error(`Missing ${path}.`);
    const person = parseJson(personSchema, treeText(raw), path);
    const teamJson = tree.before('team.json');
    const endorsed = teamJson === undefined ? undefined : parseJson(teamSchema, treeText(teamJson), 'team.json');
    const isAuto = (id: string): boolean => endorsed ? endorsed.global.includes(id) || Object.values(endorsed.projects).some((project) => project.skills.includes(id)) : false;
    const installed = person.installed.filter((entry) => !input.targets.some((target) => entry.id === target.id && sameScope(entry.scope, target.scope)));
    const declined = [...person.declined];
    for (const target of input.targets) if (isAuto(target.id) && !declined.includes(target.id)) declined.push(target.id);
    tree.set(path, `${JSON.stringify({ ...person, installed, declined }, null, 2)}\n`);
  }, { action: 'uninstall', handle: teamConfig.handle, message: `${teamConfig.handle}: uninstall ${label}`, ...input.safeWrite });
  await input.store.update((fresh) => { fresh.pending = fresh.pending.filter((entry) => !pendings.some((pending) => samePending(entry, pending))); });
  return results;
}

/** One target; the pending-replay primitive sync uses. */
export async function uninstallOne(input: UninstallInput & UninstallTarget, io: Prompter): Promise<UninstalledResult> {
  const [result] = await uninstallMany({ ...input, targets: [{ id: input.id, scope: input.scope }] }, io);
  return result!;
}

/**
 * The placement ledger is the sole authority for paths that may be removed locally. Returns the
 * ledger keys it processed, so a caller that took its list before a prompt can drop exactly those.
 */
export async function removePlacements(store: ConfigStore, matching: ReadonlyArray<[string, { fingerprint: string }]>, io: Pick<Prompter, 'print'>): Promise<string[]> {
  const processed: string[] = [];
  for (const [path, entry] of matching) {
    const root = dirname(path);
    // A placement whose parent is gone (a deleted checkout, an unmounted volume) has nothing to
    // remove, and taking the target lock would recreate the tree: just drop the ledger entry.
    if (!(await exists(root))) { await store.update((fresh) => { delete fresh.placements[path]; }); processed.push(path); continue; }
    const release = await lockTarget(root, basename(path));
    try {
      const removed = await remove(root, path, entry.fingerprint, join(store.root, 'quarantine'));
      if (removed.quarantined) io.print(`Local changes at ${path} moved to ${removed.quarantined}.`);
      await store.update((fresh) => { delete fresh.placements[path]; });
    } finally { await release(); }
    processed.push(path);
  }
  return processed;
}

function samePending(a: { op: string; id: string; team: string; scope: unknown }, b: { op: string; id: string; team: string; scope: unknown }): boolean { return a.op === b.op && a.id === b.id && a.team === b.team && sameScope(a.scope, b.scope); }
async function ledgerScopes(store: ConfigStore, team: string, id: string, peopleScopes: Array<{ kind: 'global' } | { kind: 'project'; project: string }>): Promise<Array<{ kind: 'global' } | { kind: 'project'; project: string }>> {
  const scopes = [...peopleScopes, ...Object.values((await store.read()).placements).filter((entry) => entry.team === team && entry.id === id).map((entry) => entry.scope)];
  return scopes.filter((scope, index) => scopes.findIndex((candidate) => sameScope(candidate, scope)) === index) as Array<{ kind: 'global' } | { kind: 'project'; project: string }>;
}
