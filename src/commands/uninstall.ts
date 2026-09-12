import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { projectPath } from '../lib/projects.js';
import { AGENT_PATHS, checkoutRootOf } from '../lib/placer/agent-paths.js';
import type { Config, Destination } from '../lib/schema.js';
import { exists } from '../lib/fs.js';
import { lockTarget, remove } from '../lib/placer.js';
import { Prompter } from '../lib/prompt.js';
import { cancelled, failure, fromError, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { handleSchema, parseJson, parseOrExplain, personSchema, sameScope, teamSchema } from '../lib/schema.js';
import { findSkill, readPerson, readTeam, skillRecords } from '../lib/skills.js';
import { openTeamRepo, SafeWriteOptions, treeText, lockWait } from '../lib/teamRepo.js';
import { parseRef, placementHome, samePending, teamForReference } from './install.js';

export interface UninstallArgs extends WithForm { from?: string; ref?: string; kind?: 'skill' | 'member' | 'project'; member?: string; project?: string; team?: string; config?: ConfigStore; runner?: Runner; cwd?: string; home?: string; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>; }
export interface UninstalledResult { id: string; team: string; removed: number; }

/** Placements are already gone but the people-file write failed: `results` is what went, so the caller can still report it. */
export class UninstallInterruptedError extends Error {
  constructor(message: string, readonly results: UninstalledResult[], options?: ErrorOptions) {
    super(message, options);
    this.name = 'UninstallInterruptedError';
  }
}

export async function run(args: UninstallArgs, io: Prompter): Promise<Result<UninstalledResult[]>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const parsedRef = args.ref && !args.kind && !args.member && !args.project ? parseRef(args.ref) : undefined;
    // The rule install and publish already use: a qualified ref names the team and `--team` only
    // answers a bare one. The destructive verb must not resolve the same two arguments to a
    // different team than the verb it undoes.
    const team = parsedRef ? await teamForReference(config, parsedRef.team ?? args.team, parsedRef.remote, parsedRef.name, args.form) : selectTeam(config.teams, args.team, args.form)[0];
    if (args.kind === 'member' || args.member) {
      const handle = args.member ?? args.ref;
      if (!handle) throw new Error(`Provide a member handle: \`${invocation(args.form, 'uninstall-skill member <handle>')}\`.`);
      const member = await readPerson(store.teamClone(team), parseOrExplain(handleSchema, handle, 'member handle'));
      const targets: UninstallTarget[] = [];
      for (const item of member.installed) for (const scope of await ledgerScopes(store, team, item.id, [item.scope])) targets.push({ id: item.id, scope });
      return await confirmAndRemove({ team, targets, from: args.from, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io, (preview) => ({
        question: config.teams[team]?.handle === handle ? `Remove everything you installed (${preview.ids.length} skills)?` : `Remove ${handle}'s ${preview.ids.length} skills from this machine?`,
        detail: [...preview.lines, `Targets are ${handle}'s current installed list, not what you installed from them.`],
      }));
    }
    if (args.kind === 'project' || args.project) {
      const project = args.project ?? args.ref;
      if (!project) throw new Error(`Provide a project name: \`${invocation(args.form, 'uninstall-skill project <name>')}\`.`);
      const teamJson = await readTeam(store.teamClone(team));
      const listed = Object.hasOwn(teamJson.projects, project) ? teamJson.projects[project] : undefined;
      if (!listed) throw new Error(`Unknown project ${project}.`);
      const targets: UninstallTarget[] = [];
      // `uninstall project` is the exact inverse of `install project`, which always places at that
      // project's scope: it takes back exactly that. A global copy the user installed separately is
      // not part of the project and survives. The member verb keeps its union of people and ledger scopes.
      for (const id of listed.skills) targets.push({ id, scope: { kind: 'project', project } });
      return await confirmAndRemove({ team, targets, from: args.from, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io, (preview) => ({ question: `Remove ${project}'s ${preview.ids.length} skills from this machine?`, detail: [...preview.lines, 'Copies installed to Global stay.'] }));
    }
    if (!args.ref) throw new Error('Provide a skill ref, `member <handle>`, or `project <name>`.');
    const record = await findSkill(store.teamClone(team), team, parsedRef?.name ?? args.ref.split('@')[0]!);
    if (!record) throw new Error(`No skill ${args.ref} in team ${team}.`);
    const handle = config.teams[team]!.handle;
    if (!handle) throw new Error(`Team ${team} has no joined handle.`);
    const person = await readPerson(store.teamClone(team), handle);
    const installed = person.installed.filter((entry) => entry.id === record.id);
    const targets = (await ledgerScopes(store, team, record.id, installed.map((entry) => entry.scope))).map((scope) => ({ id: record.id, scope }));
    // A real team skill that was never installed here resolves to no targets; confirmAndRemove
    // would return an empty success without asking, so say it here instead of exiting 0 in silence.
    if (!targets.length) { io.print(`${record.id.slice(0, 8)} is not placed on this machine.`); return success([]); }
    return await confirmAndRemove({ team, targets, from: args.from, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io, (preview) => ({ question: `Remove ${record.name}?`, detail: preview.lines }));
  } catch (error) {
    if (error instanceof UninstallInterruptedError) return failure(error.message, error.results);
    return fromError(error);
  }
}

export interface UninstallTarget { id: string; scope: { kind: 'global' } | { kind: 'project'; project: string }; }
interface UninstallInput { from?: string; destination?: Destination; team: string; store: ConfigStore; runner: Runner; cwd?: string; home?: string; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>; }
export interface CopySelection { target: UninstallTarget; matching: Array<[string, Config['placements'][string]]>; destination: Destination; }

/**
 * Which copy of each target goes: `--from` names it, a single copy needs no question, and several
 * copies at one scope ask `Remove which copy?` (a non-interactive caller gets the --from hint).
 * The bulk verbs run this BEFORE their confirm so the preview lists exactly the copies that go;
 * uninstallMany runs it itself when it is called without selections (sync's pending replay).
 */
export async function selectCopies(input: UninstallInput & { targets: readonly UninstallTarget[] }, io: Prompter): Promise<CopySelection[]> {
  const config = await input.store.read();
  const home = input.home ?? placementHome(input.store);
  let destination = input.destination;
  if (input.from !== undefined) {
    if (input.from !== 'global' && !isAbsolute(input.from)) throw new Error('Pass --from global or --from <checkout root>');
    destination = input.from === 'global' ? { kind: 'global' } : { kind: 'checkout', root: await projectPath(input.from) };
  }
  const selectedRoot = destination ? await projectPath(destination.kind === 'global' ? AGENT_PATHS['claude-code'].global(home) : AGENT_PATHS['claude-code'].project(destination.root)) : undefined;
  const selections: CopySelection[] = [];
  for (const target of input.targets) {
    let matching = Object.entries(config.placements).filter(([, entry]) => entry.id === target.id && entry.team === input.team && sameScope(entry.scope, target.scope));
    if (selectedRoot !== undefined) {
      const matches = await Promise.all(matching.map(async ([path]) => await projectPath(dirname(path)) === selectedRoot));
      matching = matching.filter((_, index) => matches[index]);
    }
    if (!destination && matching.length > 1) {
      if (!io.interactive) throw new Error('Pass --from global or --from <checkout root>');
      const selected = await io.select('Remove which copy?', matching.map(([path]) => path));
      matching = matching.filter(([path]) => path === selected);
      if (!matching.length) throw new Error('Invalid uninstall destination.');
    }
    const path = matching[0]?.[0];
    const checkout = path ? checkoutRootOf(path) : undefined;
    const copyDestination: Destination = destination ?? (checkout && await projectPath(checkout) !== await projectPath(home) ? { kind: 'checkout', root: await projectPath(checkout) } : { kind: 'global' });
    selections.push({ target, matching, destination: copyDestination });
  }
  return selections;
}

interface UninstallPreview { placements: CopySelection['matching']; records: Awaited<ReturnType<typeof readPerson>>['installed']; declining: string[]; ids: string[]; lines: string[]; }

/**
 * Read-only: what uninstallMany will do with these selections — the folders, the install records
 * that go (only where no copy at that scope remains, the same last-copy rule as the write) and the
 * ids that land in `declined`. The clone is the last synced state; the write re-reads it under
 * safeWrite, so a preview never touches the store, the placer or the team repo.
 */
async function previewUninstall(store: ConfigStore, team: string, selections: readonly CopySelection[]): Promise<UninstallPreview> {
  const config = await store.read();
  const handle = config.teams[team]?.handle;
  if (!handle) throw new Error(`Team ${team} has no joined handle.`);
  const clone = store.teamClone(team);
  const person = await readPerson(clone, handle);
  const endorsed = await readTeam(clone);
  const placements = selections.flatMap((selection) => selection.matching);
  const going = new Set(placements.map(([path]) => path));
  const remaining = Object.entries(config.placements).filter(([path]) => !going.has(path)).map(([, entry]) => entry);
  const lastCopies = selections.map((selection) => selection.target).filter((target) => !remaining.some((entry) => entry.id === target.id && entry.team === team && sameScope(entry.scope, target.scope)));
  const records = person.installed.filter((entry) => lastCopies.some((target) => entry.id === target.id && sameScope(entry.scope, target.scope)));
  const survivingInstalled = person.installed.filter((entry) => !records.includes(entry));
  const isAuto = (id: string): boolean => endorsed.global.includes(id) || Object.values(endorsed.projects).some((project) => project.skills.includes(id));
  const declining = [...new Set(lastCopies.map((target) => target.id))].filter((id) => isAuto(id) && !survivingInstalled.some((entry) => entry.id === id) && !person.declined.includes(id));
  const ids = [...new Set([...placements.map(([, entry]) => entry.id), ...records.map((entry) => entry.id)])];
  const names = new Map((await skillRecords(clone, team)).map((record) => [record.id, record.name]));
  const name = (id: string) => names.get(id) ?? id.slice(0, 8);
  const lines = [
    `Folders removed (${placements.length}):`,
    ...placements.map(([path, entry]) => `  ${path}  ·  ${entry.scope.kind === 'global' ? 'Global' : `project ${entry.scope.project}`}`),
    `Local changes are moved to ${join(store.root, 'quarantine')}, never deleted.`,
    records.length ? `Install records dropped from your people file (${records.length}): ${records.map((entry) => name(entry.id)).join(', ')}` : `Install records dropped from your people file (0)${lastCopies.length ? '' : ': another copy stays, so your records are kept'}`,
    ...(declining.length ? [`Not offered again until you install them: ${declining.map(name).join(', ')}`, 'These have no remaining install record, so sync stops placing them anywhere.'] : []),
  ];
  return { placements, records, declining, ids, lines };
}

/** Select the copies, show what goes, ask once, then write. An empty preview asks nothing and writes nothing. */
async function confirmAndRemove(input: UninstallInput & { targets: readonly UninstallTarget[] }, io: Prompter, ask: (preview: UninstallPreview) => { question: string; detail: string[] }): Promise<Result<UninstalledResult[]>> {
  const selections = await selectCopies(input, io);
  const preview = await previewUninstall(input.store, input.team, selections);
  if (!preview.placements.length && !preview.records.length) return success([]);
  const { question, detail } = ask(preview);
  if (!(await io.confirm(question, { detail }))) return cancelled('Remove was declined.');
  return success(await uninstallMany({ ...input, selections }, io));
}

/**
 * Remove several placements and unrecord them in ONE team-repo write. `uninstall member` and
 * `uninstall project` used to run one full fetch/commit/push per skill against the same people
 * file (M2 review, contested 4b; D9 sweep 2026-09-05): N pushes for N skills, and a refused push
 * midway left the roster half-updated. Order: record every pending entry, remove every placement
 * under its target lock, rewrite the people file once, clear the pending entries. A crash before
 * the write leaves the pending entries for sync to replay one at a time through uninstallOne —
 * the same primitive with one target.
 */
export async function uninstallMany(input: UninstallInput & { targets: readonly UninstallTarget[]; selections?: readonly CopySelection[] }, io: Prompter): Promise<UninstalledResult[]> {
  const config = await input.store.read();
  const teamConfig = config.teams[input.team];
  if (!teamConfig?.handle) throw new Error(`Team ${input.team} has no joined handle.`);
  if (!input.targets.length) return [];
  const selections = input.selections ?? await selectCopies(input, io);
  const started = new Date().toISOString();
  const pendings: Config['pending'] = selections.map(({ target, destination }) => ({ op: 'uninstall' as const, id: target.id, team: input.team, scope: target.scope, destination, started }));
  await input.store.update((fresh) => { for (const pending of pendings) if (!fresh.pending.some((entry) => samePending(entry, pending))) fresh.pending.push(pending); });
  const results: UninstalledResult[] = [];
  for (const { target, matching } of selections) {
    if (!matching.length) io.print(`${target.id.slice(0, 8)} is not placed on this machine.`);
    await removePlacements(input.store, matching, io);
    results.push({ id: target.id, team: input.team, removed: matching.length });
  }
  const remaining = Object.values((await input.store.read()).placements);
  const lastCopies = input.targets.filter(target => !remaining.some(entry => entry.id === target.id && entry.team === input.team && sameScope(entry.scope, target.scope)));
  const repo = openTeamRepo(input.store.teamClone(input.team), teamConfig.remote, input.runner);
  const label = input.targets.length === 1 ? input.targets[0]!.id.slice(0, 8) : `${input.targets.length} skills`;
  try {
    if (lastCopies.length) await repo.safeWrite((tree) => {
      const path = `people/${teamConfig.handle}.json`;
      const raw = tree.before(path);
      if (!raw) throw new Error(`Missing ${path}.`);
      const person = parseJson(personSchema, treeText(raw), path);
      const teamJson = tree.before('team.json');
      const endorsed = teamJson === undefined ? undefined : parseJson(teamSchema, treeText(teamJson), 'team.json');
      const isAuto = (id: string): boolean => endorsed ? endorsed.global.includes(id) || Object.values(endorsed.projects).some((project) => project.skills.includes(id)) : false;
      const installed = person.installed.filter((entry) => !lastCopies.some((target) => entry.id === target.id && sameScope(entry.scope, target.scope)));
      const declined = [...person.declined];
      // `declined` is keyed by skill id with no scope: a scope-targeted uninstall must not write an
      // id-wide suppression while another scope's install record survives, or sync would skip the
      // surviving placement forever.
      for (const target of lastCopies) if (isAuto(target.id) && !installed.some((entry) => entry.id === target.id) && !declined.includes(target.id)) declined.push(target.id);
      tree.set(path, `${JSON.stringify({ ...person, installed, declined }, null, 2)}\n`);
    }, { action: 'uninstall', handle: teamConfig.handle, message: `${teamConfig.handle}: uninstall ${label}`, ...input.safeWrite, ...lockWait(io) });
    await input.store.update((fresh) => { fresh.pending = fresh.pending.filter((entry) => !pendings.some((pending) => samePending(entry, pending))); });
  } catch (error) {
    throw new UninstallInterruptedError(error instanceof Error ? error.message : String(error), results, { cause: error });
  }
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

export async function ledgerScopes(store: ConfigStore, team: string, id: string, peopleScopes: Array<{ kind: 'global' } | { kind: 'project'; project: string }>): Promise<Array<{ kind: 'global' } | { kind: 'project'; project: string }>> {
  const scopes = [...peopleScopes, ...Object.values((await store.read()).placements).filter((entry) => entry.team === team && entry.id === id).map((entry) => entry.scope)];
  return scopes.filter((scope, index) => scopes.findIndex((candidate) => sameScope(candidate, scope)) === index) as Array<{ kind: 'global' } | { kind: 'project'; project: string }>;
}
