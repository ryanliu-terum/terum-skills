import { basename, dirname, join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
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
      const results: UninstalledResult[] = [];
      for (const item of member.installed) for (const scope of await ledgerScopes(store, team, item.id, [item.scope])) results.push(await uninstallOne({ team, id: item.id, scope, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io));
      return success(results);
    }
    if (args.kind === 'project' || args.project) {
      const project = args.project ?? args.ref ?? '';
      const teamJson = await readTeam(store.teamClone(team));
      const listed = teamJson.projects[project];
      if (!listed) throw new Error(`Unknown project ${project}.`);
      const results: UninstalledResult[] = [];
      for (const id of listed.skills) for (const scope of await ledgerScopes(store, team, id, [{ kind: 'project', project }])) results.push(await uninstallOne({ team, id, scope, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io));
      return success(results);
    }
    if (!args.ref) throw new Error('Provide a skill ref, `member <handle>`, or `project <name>`.');
    const record = await findSkill(store.teamClone(team), team, parsedRef?.name ?? args.ref.split('@')[0]!);
    if (!record) throw new Error(`No skill ${args.ref} in team ${team}.`);
    const handle = config.teams[team]!.handle;
    if (!handle) throw new Error(`Team ${team} has no joined handle.`);
    const person = await readPerson(store.teamClone(team), handle);
    const installed = person.installed.filter((entry) => entry.id === record.id);
    const results: UninstalledResult[] = [];
    for (const scope of await ledgerScopes(store, team, record.id, installed.map((entry) => entry.scope))) results.push(await uninstallOne({ team, id: record.id, scope, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io));
    return success(results);
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

export async function uninstallOne(input: { team: string; id: string; scope: { kind: 'global' } | { kind: 'project'; project: string }; store: ConfigStore; runner: Runner; cwd?: string; home?: string; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'> }, io: Prompter): Promise<UninstalledResult> {
  void io;
  const config = await input.store.read();
  const teamConfig = config.teams[input.team];
  if (!teamConfig?.handle) throw new Error(`Team ${input.team} has no joined handle.`);
  const pending = { op: 'uninstall' as const, id: input.id, team: input.team, scope: input.scope, started: new Date().toISOString() };
  await input.store.update((fresh) => { if (!fresh.pending.some((entry) => samePending(entry, pending))) fresh.pending.push(pending); });
  const matching = Object.entries((await input.store.read()).placements).filter(([, entry]) => entry.id === input.id && entry.team === input.team && sameScope(entry.scope, input.scope));
  if (!matching.length) io.print(`${input.id.slice(0, 8)} is not placed on this machine.`);
  for (const [path, entry] of matching) {
    const root = dirname(path);
    const release = await lockTarget(root, basename(path));
    try {
      const removed = await remove(root, path, entry.fingerprint, join(input.store.root, 'quarantine'));
      if (removed.quarantined) io.print(`Local changes at ${path} moved to ${removed.quarantined}.`);
      await input.store.update((fresh) => { delete fresh.placements[path]; });
    } finally { await release(); }
  }
  const repo = openTeamRepo(input.store.teamClone(input.team), teamConfig.remote, input.runner);
  await repo.safeWrite((tree) => {
    const path = `people/${teamConfig.handle}.json`;
    const raw = tree.before(path);
    if (!raw) throw new Error(`Missing ${path}.`);
    const person = parseJson(personSchema, treeText(raw), path);
    const installed = person.installed.filter((entry) => !(entry.id === input.id && sameScope(entry.scope, input.scope)));
    const teamJson = tree.before('team.json');
    const endorsed = teamJson === undefined ? undefined : parseJson(teamSchema, treeText(teamJson), 'team.json');
    const auto = endorsed ? endorsed.global.includes(input.id) || Object.values(endorsed.projects).some((project) => project.skills.includes(input.id)) : false;
    const declined = auto && !person.declined.includes(input.id) ? [...person.declined, input.id] : person.declined;
    tree.set(path, `${JSON.stringify({ ...person, installed, declined }, null, 2)}\n`);
  }, { action: 'uninstall', handle: teamConfig.handle, message: `${teamConfig.handle}: uninstall ${input.id.slice(0, 8)}`, ...input.safeWrite });
  await input.store.update((fresh) => { fresh.pending = fresh.pending.filter((entry) => !samePending(entry, pending)); });
  return { id: input.id, team: input.team, removed: matching.length };
}

function samePending(a: { op: string; id: string; team: string; scope: unknown }, b: { op: string; id: string; team: string; scope: unknown }): boolean { return a.op === b.op && a.id === b.id && a.team === b.team && sameScope(a.scope, b.scope); }
async function ledgerScopes(store: ConfigStore, team: string, id: string, peopleScopes: Array<{ kind: 'global' } | { kind: 'project'; project: string }>): Promise<Array<{ kind: 'global' } | { kind: 'project'; project: string }>> {
  const scopes = [...peopleScopes, ...Object.values((await store.read()).placements).filter((entry) => entry.team === team && entry.id === id).map((entry) => entry.scope)];
  return scopes.filter((scope, index) => scopes.findIndex((candidate) => sameScope(candidate, scope)) === index) as Array<{ kind: 'global' } | { kind: 'project'; project: string }>;
}
