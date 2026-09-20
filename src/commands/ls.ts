import { mapWithConcurrency } from '../lib/concurrency.js';
import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadOverrides, overrideFilesFor } from '../lib/skill-overrides.js';
import { canonicalLedger, isSkillFolder, localSkillCounts, localRootLabel, localSkillRoots, localSkills, type LocalEntry, type LocalRoot } from '../lib/local-skills.js';
import { snapshotSkillDirectory } from '../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { printable, type SourceProblem } from '../lib/skill-source.js';
import { canonicalDigest, readPerson, skillRecords } from '../lib/skills.js';
import { createConfigStore, selectTeam, type ConfigStore } from '../lib/config.js';
import { normalizeAuthor } from '../lib/guard.js';
import type { Prompter } from '../lib/prompt.js';
import { installCounts, installersById, type Installer, isActivePerson, latestChange, type readPeople, skillEndorsement } from '../lib/readme.js';
import { parseVersionFolder, versionFolderName, versionLabel } from '../lib/versions.js';
import { NO_TEAM_RUNNER_HANDLE, receiptSchema, type Receipt } from '../lib/evals/receipt.js';
import { localReceiptsFor, receiptFiles, selectCardEval } from '../lib/evals/receipt-store.js';
import { versionDigests, type VersionDigest } from '../lib/version-digests.js';
import { failure, fromError, success, type Result } from '../lib/result.js';
import { systemRunner, type Runner } from '../lib/runner.js';
import { type Config, handleSchema, parseJson, parseOrExplain, type Person, teamSchema } from '../lib/schema.js';
import { githubOwnerRepo, repositoryUrl } from '../lib/remote.js';
import { resolveSkillRef } from '../lib/resolve-ref.js';

import { skillVersions } from '../lib/teamRepo.js';
import type { SkillVersion } from '../lib/versions.js';

/** Fingerprint walks are latency-bound; overlap them (W-02). */
const FINGERPRINT_CONCURRENCY = 8;

export interface LsArgs extends WithForm { local?: boolean; home?: string; cwd?: string; kind?: 'all' | 'member' | 'project' | 'skill'; value?: string; team?: string; config?: ConfigStore; runner?: Runner; }
/**
 * The display facts of the selected receipt at a published skill version — a strict subset of
 * the receipt, under the receipt's own field names so a shell maps it with the same code it already
 * maps `eval-report` with. Never derived across receipts and never combined (eval-engine spec §12).
 * `null` is the honest "no usable receipt in this history" state a shell draws as "—".
 */
export interface LsReceipt {
  run_id: string;
  verdict: Receipt['verdict'];
  execution_status: Receipt['execution_status'];
  expected_rows: number;
  scored_rows: number;
  /** Eval-gen D4: why a partial receipt is partial; absent on receipts written before D4. */
  dropped_cases?: Receipt['dropped_cases'];
  comparisons: Receipt['comparisons'];
  arm_scores: Receipt['arm_scores'];
  provenance: Pick<Receipt['provenance'], 'model' | 'k' | 'cc_version' | 'timestamp' | 'runner_handle'>;
}
export interface LsSkill {
  id: string; name: string; author: string; category: string; characters: number; installs: number;
/**
   * §8.4 — the `v<N>` FOLDER of the highest version, never a tree hash and never the rendered label.
   * It is data: §8.6 puts it in a repository URL as a path segment, and every renderer already has
   * `versionLabel` for the prose. A DTO carrying `Version 3` would force each reader to parse the
   * sentence back into an address.
   */
  latest: string;
  /** How many versions the skill has published. */
  versionCount: number;
  latestVersion: string | null;
  evalVersion: number | null;
  latestEvalState: 'ok' | 'none' | 'invalid';
  endorsement: string; description: string; grants: string | null; grantsHash: string | null; installedBy: readonly Installer[]; body: string | null; frontmatter: string | null; updated: string; receipt: LsReceipt | null;
}
export type LocalHealth = 'local-changed' | 'unknown';
/** The checkout's `origin`, for the Library's "which repository is this folder" line. `slug` is owner/repo on GitHub and null on every other host. */
export interface LocalRemote { url: string; slug: string | null; }
export interface LocalSection extends LocalRoot { rootState: 'scanned' | 'absent' | 'unreadable'; label: string; remote: LocalRemote | null; counts: { skillFolders: number; connectable: number }; rows: { skillId: string | null; placed: boolean; name: string; path: string; state: string; tracked: boolean; placement: NonNullable<LocalEntry['placement']> | null; health: LocalHealth; /** False only when Claude Code's `skillOverrides` for this root says `off` (src/lib/skill-overrides.ts). */ enabled: boolean; edited: boolean; localEval: (Receipt & { path: string; mine: boolean }) | null; localEvalStale: boolean; teamEval: TeamEval | null; matchedVersion: string | null; matchedName: string | null; matchedTeam: string | null; knownToTeam: boolean; description: string | null; frontmatter: string | null; body?: string | null; category: string | null; characters: number | null; updated: string | null; problem?: string }[]; /** `enabled` is read the same way as a row's: Claude Code loads a symlinked or half-broken folder just as readily, and its `skillOverrides` switch it off by name. */ notOffered: { skillId: string | null; name: string; path: string; reason: SourceProblem | 'failed'; detail: string; description: string | null; frontmatter: string | null; body?: string | null; category: string | null; characters: number | null; enabled: boolean }[]; problems: { path: string; reason: string }[]; }
/**
 * §8.4 — one member, whole, from the team read that already parsed `people/<handle>.json`.
 *
 * This limb is what replaces the marketplace's per-member fan-out: `catalog()` spawned
 * `status` + `ls --local` + N × `ls member`, and after this it is two processes regardless of team
 * size. It is also the ONLY reader `profile[]` has — without it §9.3 curates a list nothing ever
 * shows, and §14.1's two-children gate is unreachable.
 *
 * `installed[]` and `profile[]` are deliberately both here and deliberately different (§3.5):
 * `installed` is automatic and means *a copy is on a machine*; `profile` is curated and means
 * *I stand behind this*. A reader that collapses them loses the distinction §8.5's two buckets exist
 * to show.
 */
export interface LsPerson {
  handle: string;
  display_name: string;
  /** The byline half of `metadata.author`: without it no reader can reproduce `ls member`s authorship join. */
  email: string;
  /**
   * The ids of the skills whose `metadata.author` is this member's byline — the same join
   * `ls member <handle>` makes, resolved HERE so it has exactly one implementation. A reader that
   * re-derived it would need `normalizeAuthor`, and the desktop bundle may only import root modules
   * that import nothing at all (`cli-tree-imports.test.ts`).
   */
  authored: readonly string[];
  role: string | null;
  projects: readonly string[];
  installed: readonly { id: string; version: Person['installed'][number]['version']; scope: Person['installed'][number]['scope']; since: string }[];
  profile: readonly { id: string; name: string; version: string; added: string; via: 'publish' | 'install' }[];
  /**
   * §3.5 — how many skill folders that machine held at its last sync. A SELF-REPORT: null means
   * "no answer" (never synced since it shipped, or never synced at all) and must never be drawn as
   * a zero.
   */
  local_skills: number | null;
}
/** D11: which narrowed read produced this value — a shell cannot tell a project view from the whole team by shape alone. */
export type LsSelection = { kind: 'member'; handle: string } | { kind: 'project'; name: string } | { kind: 'skill'; name: string; source: 'team' | 'library'; path?: string };
export interface LsMember { handle: string; displayName: string; role: string | null; projects: readonly string[]; installed: { id: string; name: string | null; version: string | null; scope: Person['installed'][number]['scope']; since: string }[]; profile: { id: string; name: string; version: string; added: string; via: 'publish' | 'install' }[]; }
export interface LsResult { local?: LocalSection[]; roster: readonly { handle: string; active: boolean; role: string | null; projects: readonly string[] }[]; skills: readonly LsSkill[]; problems: readonly { source: string; message: string }[];
  /** §8.4: emitted on the `kind:'all'` team read only; `member?` still serves the single-member view. */
  people?: readonly LsPerson[]; projects?: readonly { name: string; skills: readonly string[]; remotes: readonly string[]; [k: string]: unknown }[]; member?: LsMember; selection?: LsSelection; viewer?: { handle: string; team: string }; }

/** One byline join for every caller that attributes a skill's managed author to a team handle. */
export function authorBylines(people: readonly Pick<Person, 'display_name' | 'email' | 'handle'>[]): Map<string, string> {
  return new Map(people.map((person) => [normalizeAuthor(`${person.display_name} <${person.email}>`), person.handle]));
}

/** §6 read-only team inventory; it deliberately neither pulls nor prompts. */
export async function run(args: LsArgs, io: Prompter): Promise<Result<LsResult>> {
  try {
    if (args.local && (args.kind === 'member' || args.kind === 'project')) throw new Error('--local cannot be combined with member or project.');
    if (args.local && args.kind === 'skill') throw new Error('--local cannot be combined with skill; ls skill reads both the team and your Library.');
    if (args.local && args.team) throw new Error('--local lists every configured team; drop --team.');
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    if (args.local) return await showLocal(store, args.home ?? homedir(), io, runner);
    if (args.kind === 'skill') return await showSkill(args, store, io, runner);
    const [teamName, binding] = selectTeam((await store.read()).teams, args.team, args.form);
    const viewer = { handle: binding.handle, team: teamName };
    const clone = store.teamClone(teamName);
    const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    const projects = Object.entries(team.projects).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, project]) => ({ ...project, name }));
    const problems: { source: string; message: string }[] = [];
    const { people, roster } = await readTeamPeople(clone, team, io, problems);
    // §8.4: built from the same parsed people the roster and the install counts come from — no extra
    // read, no second process, and one shape every marketplace reader shares.
    const bylines = authorBylines(people);
    const personRows: LsPerson[] = people.map((person) => ({
      handle: person.handle,
      display_name: person.display_name,
      email: person.email,
      role: person.role ?? null,
      projects: person.projects ?? [],
      installed: person.installed.map(({ id, version, scope, since }) => ({ id, version, scope, since })),
      profile: (person.profile ?? []).map(({ id, name, version, added, via }) => ({ id, name, version, added, via })),
      local_skills: person.local_skills ?? null,
      authored: [],
    }));
    const skills = await listSkills(team, people, clone, runner, io, teamName, problems);
    const byHandle = new Map(personRows.map((row) => [row.handle, row]));
    for (const skill of skills) {
      const handle = bylines.get(normalizeAuthor(skill.author));
      const row = handle === undefined ? undefined : byHandle.get(handle);
      if (row) (row.authored as string[]).push(skill.id);
    }
    // `return await`: a returned promise leaves the try block before it settles, so a throw inside
    // showMember/showProject would reject run() instead of becoming the failure Result every verb returns.
    if (args.kind === 'member') return await showMember(args.value, people, skills, io, roster, projects, problems, viewer);
    if (args.kind === 'project') return await showProject(args.value, team, skills, io, roster, projects, problems, viewer);
    io.print('Members:');
    for (const member of roster) io.print(`  ${member.handle}${member.active ? '' : ' (inactive)'}`);
    io.print('Skills:');
    for (const skill of skills) io.print(format(skill));
    io.print(`Local skills: ${invocation(args.form, 'ls --local')}`);
    return success({ roster, skills, projects, problems, people: personRows, viewer });
  } catch (error) { return fromError(error); }
}

async function readTeamPeople(clone: string, team: ReturnType<typeof teamSchema.parse>, io: Prompter, problems: { source: string; message: string }[]): Promise<{ people: Awaited<ReturnType<typeof readPeople>>; roster: LsResult['roster'] }> {
  const report = (source: string, message: string) => { problems.push({ source, message }); io.print(`${source}: ${message}`); };
  const people = (await Promise.all((await readdir(join(clone, 'people'))).filter((file) => file.endsWith('.json')).sort().map((file) => readPerson(clone, file.slice(0, -5)).catch((error: unknown) => { report(`people/${file}`, error instanceof Error ? error.message : String(error)); return undefined; })))).filter((person) => person !== undefined);
  const roster = people.sort((a, b) => a.handle.localeCompare(b.handle)).map((person) => ({ handle: person.handle, active: isActivePerson(person, team.archived), role: person.role ?? null, projects: person.projects ?? [] }));
  return { people, roster };
}

async function listSkills(team: ReturnType<typeof teamSchema.parse>, people: Awaited<ReturnType<typeof readPeople>>, clone: string, runner: Runner, io: Prompter, teamName: string, problems: { source: string; message: string }[], only?: string): Promise<LsSkill[]> {
  // Preserve ls's fail-closed root boundary; skillRecords treats an absent root as an empty team.
  await readdir(join(clone, 'skills'));
  const records = (await skillRecords(clone, teamName, { onProblem: ({ name, message }) => { problems.push({ source: `skills/${name}`, message }); io.print(`${name}: ${message}`); } })).filter((record) => only === undefined || record.name === only);
  const counts = installCounts(people), installers = installersById(people);
  // §8.4: `skillRecords` already resolved each skill's latest version folder, and a name holding none
  // never reaches here — so the old `skillVersions` spawn and the `unresolved` row it fed are gone.
  const versions = await skillVersions(clone, records.map((record) => record.name));
  const skills: LsSkill[] = [];
  for (let index = 0; index < records.length; index += 8) {
    const chunk = records.slice(index, index + 8);
    const dates = await Promise.allSettled(chunk.map((record) => latestChange(runner, clone, record.name)));
    // The version this chunk resolved is already in hand, so the card's receipt costs one readdir and
    // one readFile per skill — no extra process and no second version resolution (card-lift override).
    const receipts = await Promise.allSettled(chunk.map((record) => cardReceipt(clone, record.id, versions.get(record.name) ?? [], (message) => { problems.push({ source: `evals/${record.id}`, message }); io.print(`${record.name}: ${message}`); })));
    for (const [offset, record] of chunk.entries()) {
      const { id, name, frontmatter, grants } = record;
      const date = dates[offset]!;
      const updated = date.status === 'fulfilled' ? date.value : '—';
      if (date.status === 'rejected') {
        const message = date.reason instanceof Error ? date.reason.message : String(date.reason);
        problems.push({ source: `skills/${name}`, message }); io.print(`${name}: ${message}`);
      }
      // An unreadable receipt is this skill's problem, never the listing's: the row still lists, with
      // the receipt limb null, so one corrupt file cannot blank a team's inventory.
      const found = receipts[offset]!;
      if (found.status === 'rejected') {
        const message = found.reason instanceof Error ? found.reason.message : String(found.reason);
        problems.push({ source: `evals/${id}`, message }); io.print(`${name}: ${message}`);
      }
      skills.push({ id, name, description: frontmatter.description, author: frontmatter.metadata.author, category: frontmatter.metadata['terum-category'], characters: record.characters, installs: counts.get(id) ?? 0, latest: versionFolderName(record.latestVersion), versionCount: record.versionCount, endorsement: skillEndorsement(team, id), grants: grants.ok ? grants.normalized : null, grantsHash: grants.ok ? grants.hash : null, installedBy: installers.get(id) ?? [], body: record.body ?? null, frontmatter: record.rawFrontmatter, updated, latestVersion: versionFolderName(record.latestVersion), ...(found.status === 'fulfilled' ? found.value : { receipt: null, evalVersion: null, latestEvalState: 'invalid' as const }) });
    }
  }
  return skills;
}
/**
 * The newest valid receipt at `version`, reduced to the card's display facts. A version with no
 * receipt directory is not a problem — it is the "—" state. The identity check is `eval-report`'s
 * own (evalReport.ts), so the two verbs cannot disagree about which receipt is this version's.
 */
async function cardReceipt(clone: string, id: string, versions: readonly SkillVersion[], onProblem?: (message: string) => void): Promise<Pick<LsSkill, 'receipt' | 'evalVersion' | 'latestEvalState'>> {
  // §8.1's fallback, shared with the README: show the newest version carrying a usable receipt. A
  // corrupt newest file fails closed for that version only and the walk continues, so one bad file
  // cannot blank a skill with three good older evals.
  const selected = await selectCardEval(clone, id, versions, onProblem);
  const fields = { evalVersion: selected.eval?.version ?? null, latestEvalState: selected.latestEvalState };
  if (selected.eval === null) return { ...fields, receipt: null };
  const found = selected.eval.receipt.receipt;
  const { model, k, cc_version, timestamp, runner_handle } = found.provenance;
  return { ...fields, receipt: { run_id: found.run_id, verdict: found.verdict, execution_status: found.execution_status, expected_rows: found.expected_rows, scored_rows: found.scored_rows, ...(found.dropped_cases === undefined ? {} : { dropped_cases: found.dropped_cases }), comparisons: found.comparisons, arm_scores: found.arm_scores, provenance: { model, k, cc_version, timestamp, runner_handle } } };
}
async function showMember(handle: string | undefined, people: Awaited<ReturnType<typeof readPeople>>, skills: readonly LsSkill[], io: Prompter, roster: LsResult['roster'], projects: NonNullable<LsResult['projects']>, problems: LsResult['problems'], viewer: LsResult['viewer']): Promise<Result<LsResult>> {
  if (!handle) throw new Error('Specify a member handle.');
  const normalizedHandle = parseOrExplain(handleSchema, handle, 'member handle');
  const member = people.find((person) => person.handle === normalizedHandle);
  if (!member) throw new Error(`No member named ${handle}.`);
  const authored = skills.filter((skill) => normalizeAuthor(skill.author) === normalizeAuthor(`${member.display_name} <${member.email}>`));
  const namesById = new Map(skills.map((skill) => [skill.id, skill.name]));
  io.print(`Member ${member.handle}:`);
  io.print(`  Authored: ${authored.map((skill) => skill.name).join(', ') || '—'}`);
  io.print(`  Installed: ${member.installed.map((item) => namesById.get(item.id) ?? item.id).join(', ') || '—'}`);
  return success({ roster, skills: authored, projects, problems, viewer, selection: { kind: 'member', handle: member.handle }, member: {
    handle: member.handle, displayName: member.display_name, role: member.role ?? null, projects: member.projects ?? [],
    installed: member.installed.map(({ id, version, scope, since }) => ({ id, name: namesById.get(id) ?? null, version, scope, since })),
    profile: (member.profile ?? []).map(({ id, name, version, added, via }) => ({ id, name, version, added, via })),
  } });
}
async function showProject(projectName: string | undefined, team: ReturnType<typeof teamSchema.parse>, skills: readonly LsSkill[], io: Prompter, roster: LsResult['roster'], projects: NonNullable<LsResult['projects']>, problems: LsResult['problems'], viewer: LsResult['viewer']): Promise<Result<LsResult>> {
  if (!projectName || !Object.hasOwn(team.projects, projectName)) throw new Error(`No project named ${projectName ?? ''}.`);
  const projectIds = new Set(team.projects[projectName]!.skills);
  const selected = skills.filter((skill) => projectIds.has(skill.id));
  io.print(`Project ${projectName}:`);
  for (const skill of selected) io.print(format(skill));
  return success({ roster, skills: selected, projects, problems, viewer, selection: { kind: 'project', name: projectName } });
}

function skillSelection(name: string, source: 'team' | 'library', row: LocalSection['rows'][number] | undefined): LsSelection {
  return { kind: 'skill', name, source, ...(row === undefined ? {} : { path: row.path }) };
}

/** D10: one skill, whole — from the team record when the name is a team skill, else from the Library row. Resolution through §6.1, rungs 0–4. */
async function showSkill(args: LsArgs, store: ConfigStore, io: Prompter, runner: Runner): Promise<Result<LsResult>> {
  const config = await store.read();
  const home = args.home ?? homedir();
  const selected = args.team !== undefined || Object.keys(config.teams).length > 0 ? selectTeam(config.teams, args.team, args.form) : null;
  const teamName = selected === null ? null : selected[0];
  const viewer = selected === null ? undefined : { handle: selected[1].handle, team: selected[0] };
  const clone = teamName === null ? null : store.teamClone(teamName);
  const resolved = await resolveSkillRef({
    ref: args.value, cwd: args.cwd ?? process.cwd(), home, config, stateRoot: store.root, rungs: 4, print: (line) => io.print(line),
    ...(clone === null || teamName === null ? {} : { team: { clone, name: teamName } }),
    miss: (ref) => `No skill named ${ref}.`,
  });
  if (!resolved.ok) return failure(resolved.error);
  const name = resolved.value.name;
  const library = await collectLocal(store, home, io, runner, name);
  const local = library.sections.map((section) => ({ ...section, rows: section.rows.filter((row) => row.name === name), notOffered: section.notOffered.filter((entry) => entry.name === name) })).filter((section) => section.rows.length > 0 || section.notOffered.length > 0);
  const fallbackRow = local.find((section) => section.rows.length > 0)?.rows[0];
  const resolvedLibraryPath = resolved.value.source === 'library' ? resolved.value.match.path : undefined;
  const row = resolvedLibraryPath !== undefined
    ? local.flatMap((section) => section.rows).find((candidate) => candidate.path === resolvedLibraryPath) ?? fallbackRow
    : fallbackRow;
  if (clone !== null && teamName !== null && viewer !== undefined) {
    const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    const problems: { source: string; message: string }[] = [];
    const { people, roster } = await readTeamPeople(clone, team, io, problems);
    const skills = await listSkills(team, people, clone, runner, io, teamName, problems, name);
    const record = skills[0];
    if (record !== undefined) {
      const projects = Object.entries(team.projects).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([projectName, project]) => ({ ...project, name: projectName })).filter((project) => project.skills.includes(record.id));
      io.print(format(record));
      io.print(record.description);
      if (record.body !== null && record.body.trim() !== '') io.print(record.body.trimEnd());
      return success({ roster, skills: [record], projects, problems, local, viewer, selection: skillSelection(name, 'team', row) });
    }
    if (row === undefined) return failure(`No skill named ${args.value ?? name}.`);
    printLibraryDetail(io, row);
    return success({ roster, skills: [], projects: [], problems, local, viewer, selection: skillSelection(name, 'library', row) });
  }
  if (row === undefined) return failure(`No skill named ${args.value ?? name}.`);
  printLibraryDetail(io, row);
  return success({ roster: [], skills: [], problems: [], local, viewer, selection: skillSelection(name, 'library', row) });
}

function printLibraryDetail(io: Prompter, row: LocalSection['rows'][number]): void {
  io.print(`  ${printable(row.name)} — ${printable(row.state)}${row.problem === undefined ? '' : `; source problem: ${printable(row.problem)}`}; path: ${printable(row.path)}`);
  if (row.description !== null) io.print(row.description);
  if (row.body !== null && row.body !== undefined && row.body.trim() !== '') io.print(row.body.trimEnd());
}
/** One skill per line, the §6 `ls` format; `search` prints hits through the same function. */
/** D1: the printed line is prose, so the folder is rendered here — the DTO stays an address. */
// `endorsement` is optional because a search hit no longer carries one (§4.1 dropped `SearchHit.endorsed`, review r1
// HIGH): its line runs from the version straight to the date rather than printing a '—' for a field it does not have.
export function format<T extends Pick<LsSkill, 'name' | 'author' | 'category' | 'installs' | 'latest' | 'updated'> & { endorsement?: string }>(skill: T): string {
  const ordinal = parseVersionFolder(skill.latest);
  return `  ${skill.name} — ${skill.author}; ${skill.category}; ${skill.installs} installs; ${ordinal === null ? skill.latest : versionLabel(ordinal)}; ${skill.endorsement === undefined ? '' : `${skill.endorsement}; `}${skill.updated}`;
}


/**
 * The checkout's `origin`, read live. A folder with no git, no origin, or an origin git refuses to
 * name is simply not connected: a read-only listing never fails because a remote is unreadable.
 */
async function originRemote(repoRoot: string | undefined, runner: Runner): Promise<LocalRemote | null> {
  if (repoRoot === undefined) return null;
  const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot }).catch(() => undefined);
  const raw = origin?.code === 0 ? origin.stdout.trim() : '';
  if (!raw) return null;
  try { return { url: repositoryUrl(raw), slug: githubOwnerRepo(raw) }; }
  catch { return null; } // not a remote shape this product accepts; the folder is still a Library row
}

/**
 * The description a row can honestly show. A candidate has one; a rejection carries the one its
 * frontmatter parsed to, when it got that far (skill-source.ts). Nothing is reconstructed: a folder
 * whose YAML never parsed reports null, and a blank description is then the honest report.
 */
function describedBy(inspection: LocalEntry['inspection']): string | null {
  if (inspection.kind === 'candidate') return inspection.description;
  return inspection.kind === 'rejected' ? inspection.description ?? null : null;
}

/**
 * Cross-mirror overlays spec §4.1 — the one team-side annotation a Library row may carry for its
 * eval: the newest committed receipt whose `content_digest` equals the folder's digest. `team` names
 * the clone it came from; `mine` is whether this machine's handle ran it (the card then omits the
 * "run by" attribution). `path` is the receipt file inside the clone.
 */
export type TeamEval = Receipt & { path: string; team: string; mine: boolean };

/**
 * Cross-mirror overlays spec §4.1, review walk D3 — `mine`, defined once for BOTH receipts a row can carry:
 * the receipt's runner is one of the handles given. A team receipt is checked against that team's binding;
 * an own-store receipt names no team, so it is checked against every binding this machine holds, plus the
 * placeholder `eval` stamps when the machine holds none (`NO_TEAM_RUNNER_HANDLE`) — that run was this
 * machine's too, and the card must never read "run by local". Computed here and nowhere else — the desktop
 * names a runner exactly when the shown receipt's `mine` is false.
 */
function ranHere(receipt: Receipt, handles: readonly string[]): boolean {
  return handles.includes(receipt.provenance.runner_handle);
}
function ranHereWithoutTeam(receipt: Receipt, handles: readonly string[]): boolean {
  return ranHere(receipt, handles) || receipt.provenance.runner_handle === NO_TEAM_RUNNER_HANDLE;
}

interface TeamIndex {
  /** Every uuid any configured team publishes — `knownToTeam` on a row. */
  ids: Set<string>;
  /** Committed version folders by their content digest — the byte-level version match. */
  byDigest: Map<string, (VersionDigest & { team: string })[]>;
  /** Committed receipts by the digest they evaluated, newest run first. */
  receiptsByDigest: Map<string, TeamEval[]>;
  /** Per skill uuid, every digest a committed receipt describes — the "evaluated before your last edit" line. */
  digestsBySkill: Map<string, Set<string>>;
}

/**
 * The team-side facts the Library overlays onto its rows, read from every configured clone and
 * nothing else: version-folder digests and committed receipts, both keyed by content digest so a
 * folder joins by its bytes and never by its name (cross-mirror overlays spec §2 L-DECL). Fetch-free
 * like every read verb. A missing or unreadable clone contributes nothing and prints one line: the
 * Library is complete without a team, and a team it cannot read must not look like a team with no
 * versions. Pre-migration receipts (no `content_digest`) cannot join and are skipped silently — they
 * describe bytes nobody can identify.
 */
async function teamIndex(store: ConfigStore, config: Config, io: Prompter): Promise<TeamIndex> {
  const index: TeamIndex = { ids: new Set(), byDigest: new Map(), receiptsByDigest: new Map(), digestsBySkill: new Map() };
  for (const [team, binding] of Object.entries(config.teams)) {
    const clone = store.teamClone(team);
    let records;
    try { records = await skillRecords(clone, team); }
    catch (error) { io.print(`${team}: team versions and evals are not shown in the Library (${error instanceof Error ? error.message : String(error)}).`); continue; }
    for (const record of records) index.ids.add(record.id);
    for (const entry of (await versionDigests(clone, records.map((record) => record.name))).values()) {
      const list = index.byDigest.get(entry.digest) ?? [];
      list.push({ ...entry, team });
      index.byDigest.set(entry.digest, list);
    }
    const found = await mapWithConcurrency(records, 8, async (record) => {
      const root = join(clone, 'evals', record.id);
      let folders: string[] = [];
      try { folders = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && parseVersionFolder(entry.name) !== null).map((entry) => entry.name); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') io.print(`${team}/${record.name}: ${error instanceof Error ? error.message : String(error)}`); return []; }
      const receipts: { id: string; entry: TeamEval }[] = [];
      for (const folder of folders) {
        for (const file of await receiptFiles(join(root, folder))) {
          const path = join(root, folder, file);
          let raw: unknown;
          try { raw = JSON.parse(await readFile(path, 'utf8')); }
          catch { io.print(`${team}/${record.name}: unreadable receipt ${folder}/${file}; not considered.`); continue; }
          const parsed = receiptSchema.safeParse(raw);
          if (!parsed.success) { io.print(`${team}/${record.name}: schema-invalid receipt ${folder}/${file}; not considered.`); continue; }
          if (!parsed.data.content_digest) continue;
          receipts.push({ id: record.id, entry: { ...parsed.data, path, team, mine: ranHere(parsed.data, [binding.handle]) } });
        }
      }
      return receipts;
    });
    for (const { id, entry } of found.flat()) {
      const digest = entry.content_digest!;
      const list = index.receiptsByDigest.get(digest) ?? [];
      list.push(entry);
      index.receiptsByDigest.set(digest, list);
      const digests = index.digestsBySkill.get(id) ?? new Set<string>();
      digests.add(digest);
      index.digestsBySkill.set(id, digests);
    }
  }
  for (const list of index.receiptsByDigest.values()) list.sort((a, b) => b.run_id.localeCompare(a.run_id));
  return index;
}

/**
 * Which committed version a folder's bytes ARE. One team → the entry whose name equals the folder's,
 * else the first name alphabetically, highest version within it. More than one team holding the same
 * bytes → the placement's team decides; with no placement the match is refused and reported, because
 * naming one team over another would be a guess (§4.1 ambiguity rule).
 */
function matchVersion(candidates: readonly (VersionDigest & { team: string })[], entry: LocalEntry): { match: (VersionDigest & { team: string }) | null; ambiguous: boolean } {
  if (candidates.length === 0) return { match: null, ambiguous: false };
  const teams = new Set(candidates.map((candidate) => candidate.team));
  let pool = candidates;
  if (teams.size > 1) {
    const preferred = entry.placement?.team;
    if (preferred === undefined || !teams.has(preferred)) return { match: null, ambiguous: true };
    pool = candidates.filter((candidate) => candidate.team === preferred);
  }
  const sorted = [...pool].sort((a, b) => Number(b.name === entry.name) - Number(a.name === entry.name) || a.name.localeCompare(b.name) || b.n - a.n);
  return { match: sorted[0]!, ambiguous: false };
}

/** The Library read without its report: sections in root order, plus the discovery problems the report ends with. */
export async function collectLocal(store: ConfigStore, home: string, io: Prompter, runner: Runner, only?: string): Promise<{ sections: LocalSection[]; discoveryProblems: { path: string; reason: string }[] }> {
  const config = await store.read();
  const ledger = await canonicalLedger(config);
  // §7.2: no ledger-inferred roots and no cwd root. The Library shows the projects you added, and
  // nothing else — a placement recorded under a folder you never added is not evidence you want it.
  const discovery = await localSkillRoots(home, config.projects ?? []);
  const inventories = await Promise.all(discovery.roots.map(async (root) => ({ ...root, inventory: await localSkills(root.root, config, { scope: root.scope, stateRoot: store.root, ledger }) })));
  const sections: LocalSection[] = [];
  const stateOf = (entry: LocalEntry): string => {
    if (!entry.placement) return 'untracked locally';
    // D1: `Version N` is the only form a version takes in a user-facing string. The old ` @<8 hex>`
    // suffix sliced a tree hash; slicing a version FOLDER would print `@v1`, the one spelling D1
    // forbids. A null version (no ordinal recorded, or a legacy tree hash the config read mapped to
    // null) simply says nothing rather than inventing one.
    const ordinal = entry.placement.version === null ? null : parseVersionFolder(entry.placement.version);
    return `placement recorded from ${entry.placement.team}${ordinal === null ? '' : ` (${versionLabel(ordinal)})`}`;
  };
  const healthOf = async (entry: LocalEntry): Promise<LocalHealth> => {
    if (entry.placementFingerprint === undefined || (entry.inspection.kind === 'rejected' && ['symlink','nested-symlink','not-a-directory','inside-state-root'].includes(entry.inspection.reason))) return 'unknown';
    try { return (await snapshotSkillDirectory(entry.path)).fingerprint !== entry.placementFingerprint ? 'local-changed' : 'unknown'; }
    catch { return 'unknown'; }
  };
  // Read only the content-keyed LOCAL store, once per load. IDs identify older runs; a name alone
  // cannot prove that two folders contain the same skill.
  const receipts: Receipt[] = [];
  const evalRoot = join(store.root, 'evals', 'local');
  let digests: string[] = [];
  try { digests = await readdir(evalRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') io.print(String(error)); }
  await Promise.all(digests.filter(d => /^[0-9a-f]{64}$/.test(d)).map(async digest => {
    receipts.push(...(await localReceiptsFor(store.root, 'sha256:' + digest, line => io.print(line))).map(run => run.receipt).filter(receipt => receipt.content_digest === 'sha256:' + digest));
  }));
  receipts.sort((a, b) => b.run_id.localeCompare(a.run_id));
  // Cross-mirror overlays spec §4.1: the team-side facts a row may carry, joined on the digest the
  // row already computes. Every configured clone is read once per load; none is fetched.
  const team = await teamIndex(store, config, io);
  const ambiguous = new Set<string>();
  const evalOf = async (entry: LocalEntry) => {
    const knownToTeam = entry.skillId !== null && team.ids.has(entry.skillId);
    const none = { localEval: null, localEvalStale: false, teamEval: null, matchedVersion: null, matchedName: null, matchedTeam: null, knownToTeam };
    if (entry.inspection.kind !== 'candidate') return none;
    try {
      const digest = await canonicalDigest(entry.path);
      const receipt = receipts.find(r => r.content_digest === digest);
      const teamEval = team.receiptsByDigest.get(digest)?.[0] ?? null;
      const version = matchVersion(team.byDigest.get(digest) ?? [], entry);
      if (version.ambiguous) ambiguous.add(entry.path);
      // Stale means: no score for THESE bytes anywhere, but some store scored this skill at another digest.
      const evaluatedElsewhere = entry.skillId !== null && (receipts.some(r => r.skill_id === entry.skillId && r.content_digest !== digest) || [...(team.digestsBySkill.get(entry.skillId) ?? [])].some(d => d !== digest));
      return { localEval: receipt ? { ...receipt, path: join(evalRoot, digest.slice(7), receipt.run_id, 'receipt.json'), mine: ranHereWithoutTeam(receipt, Object.values(config.teams).map((binding) => binding.handle)) } : null,
        localEvalStale: !receipt && !teamEval && evaluatedElsewhere,
        teamEval, matchedVersion: version.match?.folder ?? null, matchedName: version.match?.name ?? null, matchedTeam: version.match?.team ?? null, knownToTeam };
    } catch { return none; }
  };
  // Probe origins in one wave before rendering the ordered sections.
  const remotes = await Promise.all(inventories.map((root) => originRemote(root.repoRoot, runner)));
  for (const [index, { inventory, ...root }] of inventories.entries()) {
    // One read of the settings files that govern this root; a malformed file is the root's problem, never a skill reported off on a guess.
    const overrides = await loadOverrides(overrideFilesFor({ scope: root.scope, repoRoot: root.repoRoot }, home).read);
    const local: LocalSection = { ...root, root: inventory.root, rootState: inventory.rootState, label: localRootLabel(root), remote: remotes[index]!, counts: localSkillCounts(inventory), rows: [], notOffered: [], problems: [...inventory.problems, ...overrides.problems] };
    sections.push(local);
    // `only`: one folder's row without the fingerprint and digest cost of every other folder; counts stay the root's.
    const entries = only === undefined ? inventory.entries : inventory.entries.filter((entry) => entry.name === only);
    // Recursive fingerprint reads dominate latency on UNC roots; retain row order after the wave.
    const healthNeeded = entries.filter((entry) => entry.placement !== undefined || entry.inspection.kind === 'candidate');
    const healths = new Map<LocalEntry, LocalHealth>();
    const computed = await mapWithConcurrency(healthNeeded, FINGERPRINT_CONCURRENCY, (entry) => healthOf(entry));
    healthNeeded.forEach((entry, index) => healths.set(entry, computed[index]!));
    const evals = await Promise.all(entries.map(evalOf));
    for (const [entryIndex, entry] of entries.entries()) {
      const tracked = entry.placement !== undefined;
      const inspection = entry.inspection;
      // §7.4(b) / D16: a plain file is not a skill folder — no row, no card, no count (isSkillFolder). A
      // ledger row that points at one is reported the way a missing folder is, so the stale placement
      // stays visible without drawing a card for a file.
      if (!isSkillFolder(entry)) {
        if (tracked) local.problems.push({ path: entry.path, reason: 'placement recorded in the ledger but the path is not a folder' });
        continue;
      }
      if (ambiguous.has(entry.path)) local.problems.push({ path: entry.path, reason: 'identical bytes exist in more than one team; no version is shown' });
      if (tracked || inspection.kind === 'candidate') {
        const problem = inspection.kind === 'rejected' ? inspection.detail : inspection.kind === 'failed' ? inspection.reason : inspection.privileged ? 'contains plugin or hook definitions' : undefined;
        local.rows.push({ skillId: entry.skillId, placed: entry.placement !== undefined, name: entry.name, path: entry.path, state: stateOf(entry), tracked, placement: entry.placement ?? null, health: healths.get(entry)!, enabled: overrides.enabled(entry.name), edited: healths.get(entry) === 'local-changed', ...evals[entryIndex]!, description: describedBy(inspection), frontmatter: entry.frontmatter, body: entry.body ?? null, category: entry.category, characters: entry.characters ?? null, updated: entry.updated ?? null, ...(problem === undefined ? {} : { problem }) });
      } else if (inspection.kind === 'rejected') local.notOffered.push({ skillId: entry.skillId, name: entry.name, path: entry.path, reason: inspection.reason, detail: inspection.detail, description: inspection.description ?? null, frontmatter: entry.frontmatter, body: entry.body ?? null, category: entry.category, characters: entry.characters ?? null, enabled: overrides.enabled(entry.name) });
      if (inspection.kind === 'failed') {
        if (!tracked) local.notOffered.push({ skillId: entry.skillId, name: entry.name, path: entry.path, reason: 'failed', detail: inspection.reason, description: null, frontmatter: entry.frontmatter, body: entry.body ?? null, category: entry.category, characters: entry.characters ?? null, enabled: overrides.enabled(entry.name) });
        local.problems.push({ path: entry.path, reason: inspection.reason });
      }
    }
  }
  return { sections, discoveryProblems: discovery.problems };
}

/** The Library report, exactly the lines `ls --local` has always printed, in the same order. */
export function printLocal(io: Prompter, sections: readonly LocalSection[], discoveryProblems: readonly { path: string; reason: string }[]): void {
  for (const local of sections) {
    io.print(`Local Claude Code skills (${printable(local.root)}; ${local.scope}${local.registered ? '; registered' : ''}):`);
    if (local.repoRoot !== undefined) io.print(`  GitHub: ${local.remote === null ? 'not connected' : local.remote.slug === null ? `not connected (origin is ${printable(local.remote.url)})` : printable(local.remote.slug)}`);
    for (const row of local.rows) io.print(`  ${printable(row.name)} — ${printable(row.state)}${row.problem === undefined ? '' : `; source problem: ${printable(row.problem)}`}; path: ${printable(row.path)}`);
    if (local.notOffered.length) {
      io.print('Could not inspect as skills:');
      for (const entry of local.notOffered) io.print(`  ${printable(entry.name)} — ${printable(entry.detail)}; path: ${printable(entry.path)}`);
    }
    if (local.rootState === 'absent') io.print(`  none (${printable(local.root)} does not exist)`);
    else if (local.rootState === 'scanned' && local.counts.skillFolders === 0) io.print('  none');
    for (const problem of local.problems) io.print(`Could not inspect ${printable(problem.path)}: ${printable(problem.reason)}`);
    io.print(`  ${local.counts.skillFolders} skill ${local.counts.skillFolders === 1 ? 'folder' : 'folders'} (${local.counts.connectable} connectable)`);
  }
  for (const problem of discoveryProblems) io.print(`Could not inspect ${printable(problem.path)}: ${printable(problem.reason)}`);
}

/** Local discovery is independent of team selection, and only enriches ledger references. */
async function showLocal(store: ConfigStore, home: string, io: Prompter, runner: Runner): Promise<Result<LsResult>> {
  const { sections, discoveryProblems } = await collectLocal(store, home, io, runner);
  printLocal(io, sections, discoveryProblems);
  return success({ roster: [], skills: [], problems: [], local: sections });
}
