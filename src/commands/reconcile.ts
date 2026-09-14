import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WithForm } from '../lib/invocation.js';
import { invocation } from '../lib/invocation.js';
import { createConfigStore, selectTeam, type ConfigStore } from '../lib/config.js';
import { adoptableEntry, createLibraryScan, type LocalEntry, type LocalRoot } from '../lib/local-skills.js';
import { projectPath } from '../lib/projects.js';
import { PromptClosedError, type Prompter } from '../lib/prompt.js';
import { fromError, success, type Result } from '../lib/result.js';
import { normalizeAuthor } from '../lib/guard.js';
import { readPeople } from '../lib/readme.js';
import { canonicalDigest, skillRecords, type SkillRecord } from '../lib/skills.js';
import { systemRunner, type Runner } from '../lib/runner.js';
import { parseSkillFrontmatter } from '../lib/schema.js';
import { versionDigests, type VersionDigest } from '../lib/version-digests.js';
import { parseVersionFolder, versionFolderName, versionLabel } from '../lib/versions.js';
import type { SafeWriteOptions } from '../lib/teamRepo.js';
import { authorBylines } from './ls.js';
import { installOne } from './install.js';
import { run as publish } from './publish.js';

export interface ReconcileArgs extends WithForm {
  list?: boolean;
  team?: string;
  /** In-process project-add boundary; deliberately not exposed by the CLI or frame protocol. */
  root?: string;
  config?: ConfigStore;
  home?: string;
  runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
  /** Test seam: production still has one install and one publish implementation. */
  verbs?: Partial<ReconcileVerbs>;
}

export interface ReconcileRow { path: string; name: string; team: string; skillId: string | null }
export interface ReconcileResult {
  identical: (ReconcileRow & { version: string })[];
  differing: (ReconcileRow & { teamVersion: string; nextVersion: string; sameId: boolean; teamAuthor: string })[];
  renamed: (ReconcileRow & { version: string; teamName: string })[];
  adopted: string[];
  published: string[];
}

interface ReconcileVerbs {
  install: typeof installOne;
  publish: typeof publish;
}

interface TeamIndex {
  team: string;
  byName: Map<string, SkillRecord>;
  digests: VersionDigest[];
  bylines: Map<string, string>;
}

interface Candidate { entry: LocalEntry; digest: string; skillId: string | null }

function emptyResult(): ReconcileResult {
  return { identical: [], differing: [], renamed: [], adopted: [], published: [] };
}

/** One predicate for "there is something to reconcile" — setup's `existing` outcome and the desktop share it. */
export function reconcileHasRows(result: ReconcileResult): boolean {
  return result.identical.length + result.differing.length + result.renamed.length > 0;
}

/** Scan once, classify once, and only then ask or write. */
export async function run(args: ReconcileArgs, io: Prompter): Promise<Result<ReconcileResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const teamNames = selectedTeams(config.teams, args.team, args.form);
    const home = args.home ?? homedir();
    const scan = createLibraryScan(home, config.projects ?? [], store.root);
    let roots = (await scan.roots()).filter((root) => root.scope === 'global' || root.registered);
    if (args.root !== undefined) roots = await oneRegisteredRoot(args.root, config.projects ?? [], roots);

    io.print('Checking your library against the team…');
    const candidates: Candidate[] = [];
    for (const root of roots) {
      const inventory = await scan.inventory(root, config);
      for (const entry of inventory.entries) {
        if (entry.placement || !adoptableEntry(entry)) continue;
        candidates.push({ entry, digest: await canonicalDigest(entry.path), skillId: await candidateSkillId(entry) });
      }
    }

    const teams = await Promise.all(teamNames.map((team) => indexTeam(store, team)));
    const result = classify(candidates, teams);
    printSummary(result, io);
    for (const row of result.renamed) io.print(`${row.path} holds the bytes of ${row.teamName} ${versionLabel(parseVersionFolder(row.version)!)} under a different folder name; nothing is offered for it.`);
    if (args.list) {
      // A terminal reader sees only what is printed (the result object travels over frames), so the two groups are
      // listed by name, version and path; interactive mode names each row in its question instead.
      for (const row of result.identical) io.print(`  ${row.name} — matches ${versionLabel(parseVersionFolder(row.version)!)} (${row.path})`);
      for (const row of result.differing) io.print(`  ${row.name} — differs from the team's ${versionLabel(parseVersionFolder(row.teamVersion)!)} (${row.path})`);
      return success(result);
    }

    // Rows are independent (spec §5 M2 "every folder the person said yes to"): a declined consent or a refused publish
    // on one row is printed and the next row is still offered; only a closed channel ends the dialogue.
    const rowFailed = (error: unknown) => {
      if (error instanceof PromptClosedError) throw error;
      io.print(error instanceof Error ? error.message : String(error));
    };
    const verbs: ReconcileVerbs = { install: installOne, publish, ...args.verbs };
    for (const row of result.identical) {
      const n = parseVersionFolder(row.version)!;
      if (!(await io.confirm(`Record ${row.name} as installed (${versionLabel(n)})?`))) continue;
      try {
        await verbs.install({ team: row.team, adopt: row.path, store, runner, home, safeWrite: args.safeWrite }, io);
        result.adopted.push(row.path);
      } catch (error) { rowFailed(error); }
    }
    for (const row of result.differing) {
      const next = parseVersionFolder(row.nextVersion)!;
      const question = row.sameId
        ? `Publish your version of ${row.name} as ${versionLabel(next)} of the team's ${row.name}? Your folder carries the team's id for ${row.name}.`
        : `Publish your version of ${row.name} as ${versionLabel(next)} of the team's ${row.name}? Your folder carries no team id for this name, and the team's copy was published by ${row.teamAuthor}; publishing makes your content the next version of their skill. To keep them separate, rename yours first: ${invocation(args.form, 'skill rename', row.path, { raw: '--to' }, { raw: '<new-name>' })}.`;
      if (!(await io.confirm(question))) continue;
      try {
        const published = await verbs.publish({ form: args.form, ref: row.path, team: row.team, config: store, runner, home, safeWrite: args.safeWrite }, io);
        if (!published.ok) { io.print(published.error); continue; }
        result.published.push(row.path);
      } catch (error) { rowFailed(error); }
    }
    io.print(`Recorded ${result.adopted.length} install${result.adopted.length === 1 ? '' : 's'}. Published ${result.published.length} skill${result.published.length === 1 ? '' : 's'}.`);
    return success(result);
  } catch (error) {
    return fromError(error);
  }
}

function selectedTeams(teams: Parameters<typeof selectTeam>[0], requested: string | undefined, form: WithForm['form']): string[] {
  if (requested !== undefined) return [selectTeam(teams, requested, form)[0]];
  const names = Object.keys(teams).sort();
  if (names.length === 0) selectTeam(teams, undefined, form);
  return names;
}

async function candidateSkillId(entry: LocalEntry): Promise<string | null> {
  if (entry.skillId !== null) return entry.skillId;
  if (entry.inspection.kind !== 'rejected' || entry.inspection.reason !== 'name-mismatch') return null;
  const parsed = parseSkillFrontmatter(await readFile(join(entry.path, 'SKILL.md'), 'utf8'));
  return parsed.ok ? parsed.data.metadata.id : null;
}

async function oneRegisteredRoot(requested: string, projects: readonly { root: string }[], roots: readonly LocalRoot[]): Promise<LocalRoot[]> {
  const canonical = await projectPath(requested);
  const registered = await Promise.all(projects.map(async (project) => ({ project, canonical: await projectPath(project.root) })));
  const found = registered.find((item) => item.canonical === canonical);
  if (!found) throw new Error(`${canonical} is not one of your registered projects.`);
  const root = await firstAsync(roots, async (candidate) => candidate.repoRoot !== undefined && await projectPath(candidate.repoRoot) === canonical);
  if (!root) throw new Error(`${canonical} is not one of your registered projects.`);
  return [root];
}

async function firstAsync<T>(values: readonly T[], predicate: (value: T) => Promise<boolean>): Promise<T | undefined> {
  for (const value of values) if (await predicate(value)) return value;
  return undefined;
}

async function indexTeam(store: ConfigStore, team: string): Promise<TeamIndex> {
  const clone = store.teamClone(team);
  const records = await skillRecords(clone, team);
  const digestMap = await versionDigests(clone, records.map((record) => record.name));
  const bylines = authorBylines(await readPeople(clone));
  return {
    team,
    byName: new Map(records.map((record) => [record.name, record])),
    digests: [...digestMap.values()].sort((a, b) => a.name.localeCompare(b.name) || b.n - a.n),
    bylines,
  };
}

function classify(candidates: readonly Candidate[], teams: readonly TeamIndex[]): ReconcileResult {
  const result = emptyResult();
  for (const { entry, digest, skillId } of candidates) {
    const matches = teams.flatMap((team) => team.digests.filter((version) => version.digest === digest).map((version) => ({ team, version })));
    const sameNameMatch = matches.find(({ version }) => version.name === entry.name);
    if (sameNameMatch) {
      result.identical.push({ path: entry.path, name: entry.name, team: sameNameMatch.team.team, skillId, version: sameNameMatch.version.folder });
      continue;
    }
    const renamed = matches[0];
    if (renamed) {
      result.renamed.push({ path: entry.path, name: entry.name, team: renamed.team.team, skillId, version: renamed.version.folder, teamName: renamed.version.name });
      continue;
    }
    // A name-mismatch folder was admitted only so its bytes could be reported under `renamed`; publish would refuse it.
    if (entry.inspection.kind !== 'candidate') continue;
    const named = teams.map((team) => ({ team, record: team.byName.get(entry.name) })).find((item): item is { team: TeamIndex; record: SkillRecord } => item.record !== undefined);
    if (!named) continue;
    const teamVersion = versionFolderName(named.record.latestVersion);
    result.differing.push({
      path: entry.path,
      name: entry.name,
      team: named.team.team,
      skillId,
      teamVersion,
      nextVersion: versionFolderName(named.record.latestVersion + 1),
      sameId: skillId === named.record.id,
      teamAuthor: named.team.bylines.get(normalizeAuthor(named.record.frontmatter.metadata.author)) ?? named.record.frontmatter.metadata.author,
    });
  }
  return result;
}

function printSummary(result: ReconcileResult, io: Prompter): void {
  if (!reconcileHasRows(result)) {
    io.print('Nothing to reconcile: none of your skills match a team skill by bytes or by name.');
    return;
  }
  io.print(`${result.identical.length} of your skills match the team's exactly; ${result.differing.length} share a name with a team skill but differ.`);
}
