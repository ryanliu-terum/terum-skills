import { mapWithConcurrency } from '../lib/concurrency.js';
import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { canonicalLedger, localSkillCounts, localRootLabel, localSkillRoots, localSkills, type LocalEntry, type LocalRoot } from '../lib/local-skills.js';
import { snapshotSkillDirectory } from '../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { printable, type SourceProblem } from '../lib/skill-source.js';
import { readPerson, readTeam, skillRecords } from '../lib/skills.js';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { normalizeAuthor } from '../lib/guard.js';
import { Prompter } from '../lib/prompt.js';
import { installCounts, installersById, type Installer, isActivePerson, latestChange, readPeople, skillEndorsement } from '../lib/readme.js';
import { versionLabel } from '../lib/versions.js';
import type { Receipt } from '../lib/evals/receipt.js';
import { selectCardEval } from '../lib/evals/receipt-store.js';
import { fromError, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { handleSchema, parseJson, parseOrExplain, type Person, teamSchema } from '../lib/schema.js';
import { githubOwnerRepo, repositoryUrl } from '../lib/remote.js';

import { skillVersions } from '../lib/teamRepo.js';
import type { SkillVersion } from '../lib/versions.js';

/** Fingerprint walks are latency-bound; overlap them (W-02). */
const FINGERPRINT_CONCURRENCY = 8;

export interface LsArgs extends WithForm { local?: boolean; home?: string; cwd?: string; kind?: 'all' | 'member' | 'project'; value?: string; team?: string; config?: ConfigStore; runner?: Runner; }
/**
 * The display facts of the newest valid receipt at a skill's current tree hash — a strict subset of
 * the receipt, under the receipt's own field names so a shell maps it with the same code it already
 * maps `eval-report` with. Never derived across receipts and never combined (eval-engine spec §12).
 * `null` is the honest "no receipt at this version" state a shell draws as "—".
 */
export interface LsReceipt {
  run_id: string;
  verdict: Receipt['verdict'];
  execution_status: Receipt['execution_status'];
  expected_rows: number;
  scored_rows: number;
  comparisons: Receipt['comparisons'];
  arm_scores: Receipt['arm_scores'];
  provenance: Pick<Receipt['provenance'], 'model' | 'k' | 'cc_version' | 'timestamp' | 'runner_handle'>;
}
export interface LsSkill {
  id: string; name: string; author: string; category: string; characters: number; installs: number;
  /** `Version 3` — never a tree hash (§8.4, D1). */
  latest: string;
  /** How many versions the skill has published. */
  versionCount: number;
  endorsement: string; description: string; grants: string | null; grantsHash: string | null; installedBy: readonly Installer[]; body: string | null; frontmatter: string | null; updated: string; receipt: LsReceipt | null;
}
export type LocalHealth = 'up-to-date' | 'update-available' | 'local-changed' | 'both' | 'gone-from-repo' | 'untracked' | 'unknown';
/** The checkout's `origin`, for the Library's "which repository is this folder" line. `slug` is owner/repo on GitHub and null on every other host. */
export interface LocalRemote { url: string; slug: string | null; }
export interface LocalSection extends LocalRoot { rootState: 'scanned' | 'absent' | 'unreadable'; label: string; remote: LocalRemote | null; counts: { skillFolders: number; connectable: number }; rows: { skillId: string | null; placed: boolean; name: string; path: string; state: string; tracked: boolean; placement: NonNullable<LocalEntry['placement']> | null; health: LocalHealth; description: string | null; frontmatter: string | null; category: string | null; characters: number | null; problem?: string }[]; notOffered: { skillId: string | null; name: string; path: string; reason: SourceProblem; detail: string; description: string | null; frontmatter: string | null; category: string | null; characters: number | null }[]; problems: { path: string; reason: string }[]; }
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
export interface LsResult { local?: LocalSection[]; roster: readonly { handle: string; active: boolean; role: string | null; projects: readonly string[] }[]; skills: readonly LsSkill[]; problems: readonly { source: string; message: string }[];
  /** §8.4: emitted on the `kind:'all'` team read only; `member?` still serves the single-member view. */
  people?: readonly LsPerson[]; projects?: readonly { name: string; skills: readonly string[]; remotes: readonly string[]; [k: string]: unknown }[]; member?: { installed: { id: string; scope: Person['installed'][number]['scope']; since: string }[]; handle: string; declined: Person['declined']; role: string | null; projects: readonly string[] }; }

/** §6 read-only team inventory; it deliberately neither pulls nor prompts. */
export async function run(args: LsArgs, io: Prompter): Promise<Result<LsResult>> {
  try {
    if (args.local && (args.kind === 'member' || args.kind === 'project')) throw new Error('--local cannot be combined with member or project.');
    if (args.local && args.team) throw new Error('--local lists every configured team; drop --team.');
    const store = args.config ?? createConfigStore();
    if (args.local) return await showLocal(store, args.home ?? homedir(), io, args.runner ?? systemRunner);
    const [teamName] = selectTeam((await store.read()).teams, args.team, args.form);
    const clone = store.teamClone(teamName);
    const runner = args.runner ?? systemRunner;
    const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    const projects = Object.entries(team.projects).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, project]) => ({ ...project, name }));
    const problems: { source: string; message: string }[] = [];
    const report = (source: string, message: string) => { problems.push({ source, message }); io.print(`${source}: ${message}`); };
    const people = (await Promise.all((await readdir(join(clone, 'people'))).filter((file) => file.endsWith('.json')).sort().map((file) => readPerson(clone, file.slice(0, -5)).catch((error: unknown) => { report(`people/${file}`, error instanceof Error ? error.message : String(error)); return undefined; })))).filter((person) => person !== undefined);
    const roster = people.sort((a, b) => a.handle.localeCompare(b.handle)).map((person) => ({ handle: person.handle, active: isActivePerson(person, team.archived), role: person.role ?? null, projects: person.projects ?? [] }));
    // §8.4: built from the same parsed people the roster and the install counts come from — no extra
    // read, no second process, and one shape every marketplace reader shares.
    const personRows: LsPerson[] = people.map((person) => ({
      handle: person.handle,
      display_name: person.display_name,
      role: person.role ?? null,
      projects: person.projects ?? [],
      installed: person.installed.map(({ id, version, scope, since }) => ({ id, version, scope, since })),
      profile: (person.profile ?? []).map(({ id, name, version, added, via }) => ({ id, name, version, added, via })),
      local_skills: person.local_skills ?? null,
    }));
    const skills = await listSkills(team, people, clone, runner, io, teamName, problems);
    // `return await`: a returned promise leaves the try block before it settles, so a throw inside
    // showMember/showProject would reject run() instead of becoming the failure Result every verb returns.
    if (args.kind === 'member') return await showMember(args.value, people, skills, io, roster, projects, problems);
    if (args.kind === 'project') return await showProject(args.value, team, skills, io, roster, projects, problems);
    io.print('Members:');
    for (const member of roster) io.print(`  ${member.handle}${member.active ? '' : ' (inactive)'}`);
    io.print('Skills:');
    for (const skill of skills) io.print(format(skill));
    io.print(`Local skills: ${invocation(args.form, 'ls --local')}`);
    return success({ roster, skills, projects, problems, people: personRows });
  } catch (error) { return fromError(error); }
}

async function listSkills(team: ReturnType<typeof teamSchema.parse>, people: Awaited<ReturnType<typeof readPeople>>, clone: string, runner: Runner, io: Prompter, teamName: string, problems: { source: string; message: string }[]): Promise<LsSkill[]> {
  // Preserve ls's fail-closed root boundary; skillRecords treats an absent root as an empty team.
  await readdir(join(clone, 'skills'));
  const records = await skillRecords(clone, teamName, { onProblem: ({ name, message }) => { problems.push({ source: `skills/${name}`, message }); io.print(`${name}: ${message}`); } });
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
      skills.push({ id, name, description: frontmatter.description, author: frontmatter.metadata.author, category: frontmatter.metadata['terum-category'], characters: record.characters, installs: counts.get(id) ?? 0, latest: versionLabel(record.latestVersion), versionCount: record.versionCount, endorsement: skillEndorsement(team, id), grants: grants.ok ? grants.normalized : null, grantsHash: grants.ok ? grants.hash : null, installedBy: installers.get(id) ?? [], body: record.body ?? null, frontmatter: record.rawFrontmatter, updated, receipt: found.status === 'fulfilled' ? found.value : null });
    }
  }
  return skills;
}
/**
 * The newest valid receipt at `version`, reduced to the card's display facts. A version with no
 * receipt directory is not a problem — it is the "—" state. The identity check is `eval-report`'s
 * own (evalReport.ts), so the two verbs cannot disagree about which receipt is this version's.
 */
async function cardReceipt(clone: string, id: string, versions: readonly SkillVersion[], onProblem?: (message: string) => void): Promise<LsReceipt | null> {
  // §8.1's fallback, shared with the README: show the newest version carrying a usable receipt. A
  // corrupt newest file fails closed for that version only and the walk continues, so one bad file
  // cannot blank a skill with three good older evals.
  const selected = await selectCardEval(clone, id, versions, onProblem);
  if (selected.eval === null) return null;
  const found = selected.eval.receipt.receipt;
  const { model, k, cc_version, timestamp, runner_handle } = found.provenance;
  return { run_id: found.run_id, verdict: found.verdict, execution_status: found.execution_status, expected_rows: found.expected_rows, scored_rows: found.scored_rows, comparisons: found.comparisons, arm_scores: found.arm_scores, provenance: { model, k, cc_version, timestamp, runner_handle } };
}
async function showMember(handle: string | undefined, people: Awaited<ReturnType<typeof readPeople>>, skills: readonly LsSkill[], io: Prompter, roster: LsResult['roster'], projects: NonNullable<LsResult['projects']>, problems: LsResult['problems']): Promise<Result<LsResult>> {
  if (!handle) throw new Error('Specify a member handle.');
  const normalizedHandle = parseOrExplain(handleSchema, handle, 'member handle');
  const member = people.find((person) => person.handle === normalizedHandle);
  if (!member) throw new Error(`No member named ${handle}.`);
  const authored = skills.filter((skill) => normalizeAuthor(skill.author) === normalizeAuthor(`${member.display_name} <${member.email}>`));
  const namesById = new Map(skills.map((skill) => [skill.id, skill.name]));
  io.print(`Member ${member.handle}:`);
  io.print(`  Authored: ${authored.map((skill) => skill.name).join(', ') || '—'}`);
  io.print(`  Installed: ${member.installed.map((item) => namesById.get(item.id) ?? item.id).join(', ') || '—'}`);
  return success({ roster, skills: authored, projects, problems, member: { installed: member.installed.map(({id,scope,since}) => ({id,scope,since})), handle: member.handle, declined: member.declined, role: member.role ?? null, projects: member.projects ?? [] } });
}
async function showProject(projectName: string | undefined, team: ReturnType<typeof teamSchema.parse>, skills: readonly LsSkill[], io: Prompter, roster: LsResult['roster'], projects: NonNullable<LsResult['projects']>, problems: LsResult['problems']): Promise<Result<LsResult>> {
  if (!projectName || !Object.hasOwn(team.projects, projectName)) throw new Error(`No project named ${projectName ?? ''}.`);
  const projectIds = new Set(team.projects[projectName]!.skills);
  const selected = skills.filter((skill) => projectIds.has(skill.id));
  io.print(`Project ${projectName}:`);
  for (const skill of selected) io.print(format(skill));
  return success({ roster, skills: selected, projects, problems });
}
/** One skill per line, the §6 `ls` format; `search` prints hits through the same function. */
export function format(skill: LsSkill): string { return `  ${skill.name} — ${skill.author}; ${skill.category}; ${skill.installs} installs; ${skill.latest}; ${skill.endorsement}; ${skill.updated}`; }


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

/** Local discovery is independent of team selection, and only enriches ledger references. */
async function showLocal(store: ConfigStore, home: string, io: Prompter, runner: Runner): Promise<Result<LsResult>> {
  const config = await store.read();
  const ledger = await canonicalLedger(config);
  // §7.2: no ledger-inferred roots and no cwd root. The Library shows the projects you added, and
  // nothing else — a placement recorded under a folder you never added is not evidence you want it.
  const discovery = await localSkillRoots(home, config.projects ?? []);
  const inventories = await Promise.all(discovery.roots.map(async (root) => ({ ...root, inventory: await localSkills(root.root, config, { scope: root.scope, stateRoot: store.root, ledger }) })));
  const sections: LocalSection[] = [];
  const snapshots = new Map<string, { teamJson?: Awaited<ReturnType<typeof readTeam>>; ids?: Set<string>; fingerprints?: Map<string, string>; complete: boolean }>();
  const stateOf = (entry: LocalEntry): string => {
    return entry.placement ? `placement recorded from ${entry.placement.team}${entry.placement.version === null ? '' : ` @${entry.placement.version.slice(0, 8)}`}` : 'untracked locally';
  };
  const healthOf = async (entry: LocalEntry): Promise<LocalHealth> => {
    if (entry.inspection.kind === 'rejected') return 'unknown';
    if (!entry.placement) return 'untracked';
    const snapshot = snapshots.get(entry.placement.team);
    if (!snapshot?.complete || !snapshot.ids) return 'unknown';
    if (!snapshot.ids.has(entry.placement.id)) return 'gone-from-repo';
    const current = snapshot.fingerprints?.get(entry.placement.id);
    if (current === undefined || entry.placementFingerprint === undefined) return 'unknown';
    try {
      const placed = (await snapshotSkillDirectory(entry.path)).fingerprint;
      const localChanged = placed !== entry.placementFingerprint;
      const repoChanged = current !== entry.placementFingerprint;
      return localChanged ? repoChanged ? 'both' : 'local-changed' : repoChanged ? 'update-available' : 'up-to-date';
    } catch { return 'unknown'; }
  };
  // Probe origins in one wave before rendering the ordered sections.
  const remotes = await Promise.all(inventories.map((root) => originRemote(root.repoRoot, runner)));
  for (const [index, { inventory, ...root }] of inventories.entries()) {
    const local: LocalSection = { ...root, root: inventory.root, rootState: inventory.rootState, label: localRootLabel(root), remote: remotes[index]!, counts: localSkillCounts(inventory), rows: [], notOffered: [], problems: [...inventory.problems] };
    sections.push(local);
    io.print(`Local Claude Code skills (${printable(inventory.root)}; ${inventory.scope}${root.registered ? '; registered' : ''}):`);
    if (root.repoRoot !== undefined) io.print(`  GitHub: ${local.remote === null ? 'not connected' : local.remote.slug === null ? `not connected (origin is ${printable(local.remote.url)})` : printable(local.remote.slug)}`);
    for (const entry of inventory.entries) {
      for (const ref of entry.placement ? [entry.placement] : []) {
        if (snapshots.has(ref.team)) continue;
        const snapshot: { teamJson?: Awaited<ReturnType<typeof readTeam>>; ids?: Set<string>; fingerprints?: Map<string, string>; complete: boolean } = { complete: false };
        snapshots.set(ref.team, snapshot);
        try {
          const clone = store.teamClone(ref.team);
          snapshot.teamJson = await readTeam(clone);
          let complete = true;
          const records = await skillRecords(clone, ref.team, { onProblem: () => { complete = false; } });
          snapshot.ids = new Set(records.map((record) => record.id));
          snapshot.complete = complete;
          snapshot.fingerprints = new Map();
          await mapWithConcurrency(records, FINGERPRINT_CONCURRENCY, async (record) => {
            try { snapshot.fingerprints!.set(record.id, (await snapshotSkillDirectory(record.directory)).fingerprint); }
            catch { /* An unreadable tree has no usable fingerprint. */ }
          });
        } catch { /* A ledger fact survives an unavailable clone. */ }
      }
    }
    // Recursive fingerprint reads dominate latency on UNC roots; retain row order after the wave.
    const healthNeeded = inventory.entries.filter((entry) => entry.placement !== undefined || entry.inspection.kind === 'candidate');
    const healths = new Map<LocalEntry, LocalHealth>();
    const computed = await mapWithConcurrency(healthNeeded, FINGERPRINT_CONCURRENCY, (entry) => healthOf(entry));
    healthNeeded.forEach((entry, index) => healths.set(entry, computed[index]!));
    for (const entry of inventory.entries) {
      const tracked = entry.placement !== undefined;
      const inspection = entry.inspection;
      if (tracked || inspection.kind === 'candidate') {
        const problem = inspection.kind === 'rejected' ? inspection.detail : inspection.kind === 'failed' ? inspection.reason : inspection.privileged ? 'contains plugin or hook definitions (connect needs --allow-privileged)' : undefined;
        local.rows.push({ skillId: entry.skillId, placed: entry.placement !== undefined, name: entry.name, path: entry.path, state: stateOf(entry), tracked, placement: entry.placement ?? null, health: healths.get(entry)!, description: describedBy(inspection), frontmatter: entry.frontmatter, category: entry.category, characters: entry.characters ?? null, ...(problem === undefined ? {} : { problem }) });
      } else if (inspection.kind === 'rejected') local.notOffered.push({ skillId: entry.skillId, name: entry.name, path: entry.path, reason: inspection.reason, detail: inspection.detail, description: inspection.description ?? null, frontmatter: entry.frontmatter, category: entry.category, characters: entry.characters ?? null });
      if (inspection.kind === 'failed') local.problems.push({ path: entry.path, reason: inspection.reason });
    }
    for (const row of local.rows) io.print(`  ${printable(row.name)} — ${printable(row.state)}${row.problem === undefined ? '' : `; source problem: ${printable(row.problem)}`}; path: ${printable(row.path)}`);
    if (local.notOffered.length) {
      io.print('Cannot be connected:');
      for (const entry of local.notOffered) io.print(`  ${printable(entry.name)} — ${printable(entry.detail)}; path: ${printable(entry.path)}`);
    }
    if (inventory.rootState === 'absent') io.print(`  none (${printable(inventory.root)} does not exist)`);
    else if (inventory.rootState === 'scanned' && !inventory.entries.length) io.print('  none');
    for (const problem of local.problems) io.print(`Could not inspect ${printable(problem.path)}: ${printable(problem.reason)}`);
    io.print(`  ${local.counts.skillFolders} skill ${local.counts.skillFolders === 1 ? 'folder' : 'folders'} (${local.counts.connectable} connectable)`);
  }
  for (const problem of discovery.problems) io.print(`Could not inspect ${printable(problem.path)}: ${printable(problem.reason)}`);
  io.print('Team status is from local clones and may be stale; open endorsement requests are not checked.');
  return success({ roster: [], skills: [], problems: [], local: sections });
}
