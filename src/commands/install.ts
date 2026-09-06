import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { inspect, lockTarget, moveToQuarantine, place, resolveTarget } from '../lib/placer.js';
import { Prompter } from '../lib/prompt.js';
import { normalizeRemote } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { Config, Team, parseJson, parseSkillFrontmatter, personSchema, sameScope } from '../lib/schema.js';
import { findSkill, readPerson, readTeam, SkillRecord } from '../lib/skills.js';
import { openTeamRepo, SafeWriteOptions, treeText } from '../lib/teamRepo.js';
import { materializeVersion, resolveVersion } from '../lib/version.js';

export interface InstallArgs {
  ref?: string;
  kind?: 'skill' | 'member' | 'project';
  member?: string;
  project?: string;
  team?: string;
  force?: boolean;
  config?: ConfigStore;
  runner?: Runner;
  cwd?: string;
  home?: string;
  /** Injectable retry clock for deterministic recovery tests; authorization remains command-owned. */
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}
export interface InstalledResult { id: string; team: string; path: string; version: string | null; }

export async function run(args: InstallArgs, io: Prompter): Promise<Result<InstalledResult[]>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const operation = parseOperation(args);
    if (operation.kind === 'member') {
      const team = await selectTeam(config, args.team);
      const person = await readPerson(store.teamClone(team), operation.member);
      const results: InstalledResult[] = [];
      for (const item of person.installed) {
        const result = await installOne({ team, id: item.id, version: item.version ?? undefined, force: args.force, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io);
        results.push(result);
      }
      return success(results);
    }
    if (operation.kind === 'project') {
      const team = await selectTeam(config, args.team);
      const teamJson = await readTeam(store.teamClone(team));
      const project = teamJson.projects[operation.project];
      if (!project) throw new Error(`Unknown project ${operation.project}.`);
      const results: InstalledResult[] = [];
      for (const id of project.skills) results.push(await installOne({ team, id, project: operation.project, force: args.force, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io));
      return success(results);
    }
    const reference = parseRef(operation.ref);
    const team = await teamForReference(config, reference.team ?? args.team, reference.remote, reference.name);
    return success([await installOne({ team, reference: reference.name, version: reference.version, force: args.force, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io)]);
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

/** Shared by team join and sync: exactly one install/consent/placement path. */
export async function installOne(input: { team: string; reference?: string; id?: string; version?: string; project?: string; scope?: { kind: 'global' } | { kind: 'project'; project: string }; force?: boolean; store: ConfigStore; runner: Runner; cwd?: string; home?: string; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'> }, io: Prompter): Promise<InstalledResult> {
  const config = await input.store.read();
  const binding = config.teams[input.team];
  if (!binding?.handle) throw new Error(`Team ${input.team} has no joined handle.`);
  const clone = input.store.teamClone(input.team);
  const skill = await resolveSkill(clone, input.team, input.reference ?? input.id!);
  const teamJson = await readTeam(clone);
  const matchedProject = await matchingProject(teamJson, input.runner, input.cwd);
  const project = input.project ?? matchedProject;
  const scope = input.scope ?? selectScope(teamJson, skill.id, project, input.project);
  if (scope.kind === 'project' && (!project || matchedProject !== scope.project)) throw new Error(`Install project ${scope.project} from a checkout registered for that project; no matching project context was found.`);
  const latest = input.version ? await resolveVersion(clone, skill.name, input.version, input.runner) : null;
  const pending = { op: 'install' as const, id: skill.id, team: input.team, scope, version: latest, started: new Date().toISOString() };
  const pendingAlreadyExists = (await input.store.read()).pending.some((entry) => samePending(entry, pending));
  await input.store.update((fresh) => { if (!fresh.pending.some((entry) => samePending(entry, pending))) fresh.pending.push(pending); });
  const source = latest ? await materializeVersion(input.store, input.team, clone, skill.name, latest, input.runner) : skill.directory;
  const sourceSkill = await skillAtSource(source, skill);
  try {
    await ensureConsent(input.store, sourceSkill, io);
  } catch (error) {
    // A declined pre-placement consent is not an interrupted install: nothing observable moved.
    if (!pendingAlreadyExists) await input.store.update((fresh) => { fresh.pending = fresh.pending.filter((entry) => entry.started !== pending.started); });
    throw error;
  }
  const repoRoot = scope.kind === 'project' ? await currentRepoRoot(input.runner, input.cwd) : undefined;
  const root = resolveTarget('claude-code', scope, repoRoot, input.home ?? placementHome(input.store));
  const destination = join(root, skill.name);
  const release = await lockTarget(root, skill.name);
  let placed: { path: string; snapshot: { fingerprint: string }; notices: string[] };
  try {
    const owned = Boolean((await input.store.read()).placements[destination]?.id === skill.id);
    const collision = await inspect(destination, owned);
    if (collision.kind === 'foreign') {
      if (!input.force) throw new Error(`Install target ${destination} already contains another skill; retry with --force to move it to quarantine.`);
      await moveToQuarantine(destination, join(input.store.root, 'quarantine'), basename(destination));
    }
    placed = await place(source, root, skill.name, { replace: collision.kind === 'ours', projectRoot: repoRoot, runner: input.runner });
    await input.store.update((fresh) => {
      fresh.placements[placed.path] = { id: skill.id, team: input.team, version: latest, scope, placed_at: new Date().toISOString().slice(0, 10), fingerprint: placed.snapshot.fingerprint };
    });
    for (const notice of placed.notices) io.print(notice);
  } finally { await release(); }
  const repo = openTeamRepo(clone, binding.remote, input.runner);
  await repo.safeWrite((tree) => {
    const path = `people/${binding.handle}.json`;
    const raw = tree.before(path);
    if (!raw) throw new Error(`Missing ${path}.`);
    const person = parseJson(personSchema, treeText(raw), path);
    const installed = person.installed.filter((entry) => !(entry.id === skill.id && JSON.stringify(entry.scope) === JSON.stringify(scope)));
    installed.push({ id: skill.id, version: latest, scope, since: new Date().toISOString().slice(0, 10) });
    const declined = person.declined.filter((id) => id !== skill.id);
    tree.set(path, `${JSON.stringify({ ...person, installed, declined }, null, 2)}\n`);
  }, { action: 'install', handle: binding.handle, message: `${binding.handle}: install ${skill.name}`, ...input.safeWrite });
  await input.store.update((fresh) => { fresh.pending = fresh.pending.filter((entry) => !samePending(entry, pending)); });
  return { id: skill.id, team: input.team, path: placed!.path, version: latest };
}

async function ensureConsent(store: ConfigStore, skill: SkillRecord, io: Prompter): Promise<void> {
  if (!skill.grants.ok) {
    io.print(`allowed-tools for ${skill.name} could not be parsed: ${String(skill.grants.raw)}`);
    if (!(await io.confirm(`Install ${skill.name} despite malformed allowed-tools?`))) throw new Error(`Consent was declined for malformed allowed-tools on ${skill.name}.`);
    return;
  }
  if (skill.grants.normalized === 'none') return;
  const config = await store.read();
  if (config.approvals[skill.id]?.grants === skill.grants.hash) return;
  io.print(`${skill.name} requests allowed-tools:\n${skill.grants.normalized}`);
  if (!(await io.confirm(`Approve these tools for ${skill.name}?`))) throw new Error(`Consent was declined for ${skill.name}.`);
  await store.update((fresh) => { fresh.approvals[skill.id] = { grants: skill.grants.ok ? skill.grants.hash : '', approved_at: new Date().toISOString().slice(0, 10) }; });
}

export async function skillAtSource(source: string, expected: SkillRecord): Promise<SkillRecord> {
  const parsed = parseSkillFrontmatter(await readFile(join(source, 'SKILL.md'), 'utf8'));
  if (!parsed.ok) throw new Error(`Pinned skill at ${source} has invalid SKILL.md: ${parsed.error}`);
  if (parsed.data.name !== expected.name || parsed.data.metadata.id !== expected.id) throw new Error(`Pinned skill at ${source} does not match ${expected.name} (${expected.id}).`);
  return { ...expected, directory: source, frontmatter: parsed.data, grants: parsed.grants };
}

async function resolveSkill(clone: string, team: string, ref: string): Promise<SkillRecord> {
  const record = await findSkill(clone, team, ref);
  if (!record) throw new Error(`No skill ${ref} in team ${team}.`);
  return record;
}

type ParsedOperation = { kind: 'skill'; ref: string } | { kind: 'member'; member: string } | { kind: 'project'; project: string };
function parseOperation(args: InstallArgs): ParsedOperation {
  if (args.kind === 'member' || args.member) {
    const member = args.member ?? args.ref ?? '';
    if (member.includes('@')) throw new Error('Version pins are supported for single-skill installs only.');
    return { kind: 'member', member };
  }
  if (args.kind === 'project' || args.project) {
    const project = args.project ?? args.ref ?? '';
    if (project.includes('@')) throw new Error('Version pins are supported for single-skill installs only.');
    return { kind: 'project', project };
  }
  if (!args.ref) throw new Error('Provide a skill ref, `member <handle>`, or `project <name>`.');
  return { kind: 'skill', ref: args.ref };
}
export function parseRef(value: string): { team?: string; remote?: string; name: string; version?: string } {
  const at = value.lastIndexOf('@');
  const bare = at > 0 ? value.slice(0, at) : value;
  const version = at > 0 ? value.slice(at + 1) : undefined;
  const segments = bare.split('/');
  if (segments.length === 1) return { name: bare, version };
  if (segments.length === 2) return { team: segments[0], name: segments[1]!, version };
  if (segments.length === 3) return { remote: `github.com/${segments[0]}/${segments[1]}`, name: segments[2]!, version };
  throw new Error(`Invalid skill ref ${value}.`);
}
export async function teamForReference(config: Config, explicit: string | undefined, remote: string | undefined, name?: string): Promise<string> {
  if (remote) {
    const found = Object.entries(config.teams).find(([, entry]) => normalizeRemote(entry.remote) === normalizeRemote(remote));
    if (!found) throw new Error(`This machine has not joined ${remote}; run \`team join ${remote.replace(/^github\.com\//, '')}\` first.`);
    return found[0];
  }
  if (explicit) { if (!config.teams[explicit]) throw new Error(`Team ${explicit} is not configured.`); return explicit; }
  const teams = Object.keys(config.teams);
  if (teams.length === 1) return teams[0]!;
  const qualified = name ? ` Matching refs: ${teams.map((team) => `${team}/${name}`).join(', ')}.` : '';
  throw new Error(`A bare skill ref is ambiguous across configured teams; use <team>/<skill> or --team.${qualified}`);
}
async function selectTeam(config: Config, explicit?: string): Promise<string> { return teamForReference(config, explicit, undefined); }
async function matchingProject(team: Team, runner: Runner, cwd?: string): Promise<string | undefined> {
  const root = await currentRepoRoot(runner, cwd).catch(() => undefined);
  if (!root) return undefined;
  const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: root });
  if (origin.code !== 0) return undefined;
  return Object.entries(team.projects).find(([, project]) => project.remotes.some((remote) => normalizeRemote(remote) === normalizeRemote(origin.stdout.trim())))?.[0];
}
async function currentRepoRoot(runner: Runner, cwd?: string): Promise<string> {
  const answer = await runner.run('git', ['rev-parse', '--show-toplevel'], cwd ? { cwd } : undefined);
  if (answer.code !== 0 || !answer.stdout.trim()) throw new Error('No git worktree is available for project placement.');
  return answer.stdout.trim();
}
function selectScope(team: Team, id: string, matching: string | undefined, explicit: string | undefined): { kind: 'global' } | { kind: 'project'; project: string } {
  const project = explicit ?? (matching && team.projects[matching]?.skills.includes(id) ? matching : undefined);
  if (project && team.projects[project]?.skills.includes(id)) return { kind: 'project', project };
  return { kind: 'global' };
}
function samePending(a: { op: string; id: string; team: string; scope: unknown }, b: { op: string; id: string; team: string; scope: unknown }): boolean { return a.op === b.op && a.id === b.id && a.team === b.team && sameScope(a.scope, b.scope); }
function placementHome(store: ConfigStore): string { return store.root.endsWith('/.terum/skills') ? dirname(dirname(store.root)) : store.root; }
