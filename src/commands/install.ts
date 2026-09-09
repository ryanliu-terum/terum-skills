import { invocation, type InvocationForm } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { HookOptions } from '../lib/hook.js';
import type { WrapperOptions } from '../lib/wrapper.js';
import { inspect, lockTarget, moveToQuarantine, place, quarantineDrift, resolveTarget } from '../lib/placer.js';
import { Prompter } from '../lib/prompt.js';
import { refuseSecondTeam, teamByRemote } from '../lib/auth.js';
import { normalizeRemote } from '../lib/remote.js';
import { fromError, CancelledError, RefusedError, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { Config, Team, describeRaw, handleSchema, parseJson, parseOrExplain, parseSkillFrontmatter, personSchema, sameScope } from '../lib/schema.js';
import { findSkill, readPerson, readTeam, SkillRecord } from '../lib/skills.js';
import { openTeamRepo, SafeWriteOptions, treeText } from '../lib/teamRepo.js';
import { materializeVersion, resolveVersion } from '../lib/version.js';

export interface InstallArgs extends WithForm {
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
  /** Where the §8 hook offer writes when a three-part ref bootstraps a fresh machine (test knob). */
  hook?: HookOptions;
  /** Where that bootstrap offers the bundled /terum-skills Claude Code skill (test knob). */
  wrapper?: WrapperOptions;
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
      const [team] = selectTeam(config.teams, args.team, args.form);
      const person = await readPerson(store.teamClone(team), operation.member);
      const results: InstalledResult[] = [];
      for (const item of person.installed) {
        const result = await installOne({ team, id: item.id, version: item.version ?? undefined, force: args.force, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io);
        results.push(result);
      }
      return success(results);
    }
    if (operation.kind === 'project') {
      const [team] = selectTeam(config.teams, args.team, args.form);
      const teamJson = await readTeam(store.teamClone(team));
      const project = Object.hasOwn(teamJson.projects, operation.project) ? teamJson.projects[operation.project] : undefined;
      if (!project) throw new Error(`Unknown project ${operation.project}.`);
      const results: InstalledResult[] = [];
      for (const id of project.skills) results.push(await installOne({ team, id, project: operation.project, force: args.force, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io));
      return success(results);
    }
    const reference = parseRef(operation.ref);
    const team = await teamForReference(config, reference.team ?? args.team, reference.remote, reference.name, args.form).catch(async (error: unknown) => {
      // §6: a three-part ref on a machine that has joined nothing performs the bootstrap first —
      // `setup <org>/<repo>` with its print-only steps suppressed — and then installs: one code
      // path, not two. The shared pre-flight refuses a configured machine before bootstrap.
      // The import is deferred because setup is
      // built on team, which is built on this module.
      if (!(error instanceof NotJoinedError) || Object.keys(config.teams).length > 0) throw error;
      const { run: setup } = await import('./setup.js');
      const bootstrapped = await setup({ form: args.form, target: error.remote.replace(/^github\.com\//, ''), quiet: true, offerConnect: false, config: store, runner, home: args.home, hook: args.hook, wrapper: args.wrapper }, io);
      if (!bootstrapped.ok) {
        if (bootstrapped.refused) throw new RefusedError(bootstrapped.error);
        if (bootstrapped.cancelled) throw new CancelledError(bootstrapped.error);
        throw new Error(bootstrapped.error);
      }
      return bootstrapped.value.team;
    });
    return success([await installOne({ team, reference: reference.name, version: reference.version, force: args.force, store, runner, cwd: args.cwd, home: args.home, safeWrite: args.safeWrite }, io)]);
  } catch (error) { return fromError(error); }
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
    const entry = (await input.store.read()).placements[destination];
    const owned = entry?.id === skill.id;
    const collision = await inspect(destination, owned);
    if (collision.kind === 'foreign') {
      if (!input.force) throw new Error(`Install target ${destination} already contains another skill; retry with --force to move it to quarantine.`);
      await moveToQuarantine(destination, join(input.store.root, 'quarantine'), basename(destination));
    }
    if (collision.kind === 'ours' && entry) {
      // Re-placing over our own placement keeps the user's edits (spec §4.3 / default 33): the
      // same quarantine-on-mismatch rule sync and uninstall apply, through the same helper.
      const drift = await quarantineDrift(destination, entry.fingerprint, join(input.store.root, 'quarantine'));
      if (drift.quarantined) io.print(`Local changes at ${destination} moved to ${drift.quarantined}.`);
    }
    placed = await place(source, root, skill.name, { replace: collision.kind === 'ours', projectRoot: repoRoot, runner: input.runner, quarantineRoot: join(input.store.root, 'quarantine') });
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
    const installed = person.installed.filter((entry) => !(entry.id === skill.id && sameScope(entry.scope, scope)));
    installed.push({ id: skill.id, version: latest, scope, since: new Date().toISOString().slice(0, 10) });
    const declined = person.declined.filter((id) => id !== skill.id);
    tree.set(path, `${JSON.stringify({ ...person, installed, declined }, null, 2)}\n`);
  }, { action: 'install', handle: binding.handle, message: `${binding.handle}: install ${skill.name}`, ...input.safeWrite });
  await input.store.update((fresh) => { fresh.pending = fresh.pending.filter((entry) => !samePending(entry, pending)); });
  return { id: skill.id, team: input.team, path: placed!.path, version: latest };
}

async function ensureConsent(store: ConfigStore, skill: SkillRecord, io: Prompter): Promise<void> {
  if (!skill.grants.ok) {
    if (!(await io.confirm(`Install ${skill.name} despite malformed allowed-tools?`, { detail: [`allowed-tools for ${skill.name} could not be parsed: ${describeRaw(skill.grants.raw)}`] }))) throw new CancelledError(`Consent was declined for malformed allowed-tools on ${skill.name}.`);
    return;
  }
  if (skill.grants.normalized === 'none') return;
  const config = await store.read();
  if (config.approvals[skill.id]?.grants === skill.grants.hash) return;
  if (!(await io.confirm(`Approve these tools for ${skill.name}?`, { detail: [`${skill.name} requests allowed-tools:`, ...skill.grants.normalized.split('\n')] }))) throw new CancelledError(`Consent was declined for ${skill.name}.`);
  await store.update((fresh) => { fresh.approvals[skill.id] = { grants: skill.grants.ok ? skill.grants.hash : '', approved_at: new Date().toISOString().slice(0, 10) }; });
}

export async function skillAtSource(source: string, expected: SkillRecord): Promise<SkillRecord> {
  const parsed = parseSkillFrontmatter(await readFile(join(source, 'SKILL.md'), 'utf8'));
  if (!parsed.ok) throw new Error(`Pinned skill at ${source} has invalid SKILL.md: ${parsed.error}`);
  if (parsed.data.name !== expected.name || parsed.data.metadata.id !== expected.id) throw new Error(`Pinned skill at ${source} does not match ${expected.name} (${expected.id}).`);
  return { ...expected, directory: source, frontmatter: parsed.data, body: parsed.body, grants: parsed.grants };
}

async function resolveSkill(clone: string, team: string, ref: string): Promise<SkillRecord> {
  const record = await findSkill(clone, team, ref);
  if (!record) throw new Error(`No skill ${ref} in team ${team}.`);
  return record;
}

type ParsedOperation = { kind: 'skill'; ref: string } | { kind: 'member'; member: string } | { kind: 'project'; project: string };
function parseOperation(args: InstallArgs): ParsedOperation {
  // A missing selector is a usage error here, for every caller of run() — never an empty handle
  // that reaches the filesystem as people/.json — and a present one is held to the handle rule
  // before it can become a path segment (ls and team remove do the same).
  if (args.kind === 'member' || args.member) {
    const member = args.member ?? args.ref;
    if (!member) throw new Error(`Provide a member handle: \`${invocation(args.form, 'install member <handle>')}\`.`);
    if (member.includes('@')) throw new Error('Version pins are supported for single-skill installs only.');
    return { kind: 'member', member: parseOrExplain(handleSchema, member, 'member handle') };
  }
  if (args.kind === 'project' || args.project) {
    const project = args.project ?? args.ref;
    if (!project) throw new Error(`Provide a project name: \`${invocation(args.form, 'install project <name>')}\`.`);
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
/** A three-part ref names a repository this machine has not joined: `install` answers it with the §6 bootstrap, every other verb with the message. */
export class NotJoinedError extends Error {
  constructor(readonly remote: string, message: string) { super(message); this.name = 'NotJoinedError'; }
}
export async function teamForReference(config: Config, explicit: string | undefined, remote: string | undefined, name?: string, form?: InvocationForm): Promise<string> {
  if (remote) {
    const found = teamByRemote(config, remote);
    if (!found) refuseSecondTeam(config, { remote }, invocation(form, 'setup', remote.replace(/^github\.com\//, '')), form);
    if (!found) throw new NotJoinedError(remote, `This machine has not joined ${remote}; run \`${invocation(form, 'team join', remote.replace(/^github\.com\//, ''))}\` first.`);
    return found[0];
  }
  // Only the genuinely ambiguous bare ref is answered here, because only a ref-taking verb can name
  // the qualified refs that would settle it; the zero-team, one-team and unknown `--team` answers
  // come from the one resolver every other verb uses, so they cannot drift again.
  const teams = Object.keys(config.teams);
  if (!explicit && teams.length > 1) {
    const qualified = name ? ` Matching refs: ${teams.map((team) => `${team}/${name}`).join(', ')}.` : '';
    throw new Error(`A bare skill ref is ambiguous across configured teams; use <team>/<skill> or --team.${qualified}`);
  }
  return selectTeam(config.teams, explicit, form)[0];
}
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
  const endorses = (name: string): boolean => Object.hasOwn(team.projects, name) && team.projects[name]!.skills.includes(id);
  const project = explicit ?? (matching && endorses(matching) ? matching : undefined);
  if (project && endorses(project)) return { kind: 'project', project };
  return { kind: 'global' };
}
function samePending(a: { op: string; id: string; team: string; scope: unknown }, b: { op: string; id: string; team: string; scope: unknown }): boolean { return a.op === b.op && a.id === b.id && a.team === b.team && sameScope(a.scope, b.scope); }
/**
 * HOME for a global placement: the default store root is `~/.terum/skills`, so HOME is two path
 * segments up — judged segment-wise, because win32 roots are backslash-separated and a hard-coded
 * `/.terum/skills` suffix silently placed skills inside the store where Claude Code never looks.
 * A custom or test root is its own placement home. Exported with an injectable path flavour so the
 * win32 shape is provable from any host.
 */
export function placementHome(store: Pick<ConfigStore, 'root'>, path: Pick<typeof import('node:path'), 'basename' | 'dirname'> = { basename, dirname }): string {
  return path.basename(store.root) === 'skills' && path.basename(path.dirname(store.root)) === '.terum' ? path.dirname(path.dirname(store.root)) : store.root;
}
