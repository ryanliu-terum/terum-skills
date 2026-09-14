/**
 * §6.1 argument autofill. Wraps PR #193's `resolveLibrarySkill` (a name or a path, always inside a
 * Library root) with the rungs a person at a prompt reaches for: the folder above cwd, then a unique
 * case-insensitive / prefix / substring match over the Library's entry names and the team's skill
 * names. A hit at rungs 2–4 is passed back through the exact resolvers so the folder or record comes
 * from the one authoritative reader; an ambiguity is a failure naming the candidates, never a guess.
 * D9: `eval` runs rungs 0–2 (paid: a prefix never picks the bill); the read verbs run 0–4.
 */
import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { localSkillRoots, localSkills, refIsPath, resolveLibrarySkill, type LibrarySkillMatch } from './local-skills.js';
import { failure, success, type Result } from './result.js';
import type { Config } from './schema.js';
import { findSkill, skillRecords, type SkillRecord } from './skills.js';

/** D7: the one recognisable line the board sink lifts into `board.resolved`. */
export const RESOLVED_PREFIX = 'Resolved: ';
export const CWD_MISS = 'Name a skill; the working directory is not inside a library skill folder.';

export type ResolveHow = 'cwd' | 'exact' | 'case' | 'prefix' | 'substring';
export type ResolvedRef =
  | { name: string; how: ResolveHow; source: 'library'; match: LibrarySkillMatch }
  | { name: string; how: ResolveHow; source: 'team'; record: SkillRecord };
type ResolvedWithoutHow =
  | { name: string; source: 'library'; match: LibrarySkillMatch }
  | { name: string; source: 'team'; record: SkillRecord };

export interface ResolveInput {
  ref: string | undefined;
  cwd: string;
  home: string;
  config: Pick<Config, 'placements' | 'projects'>;
  stateRoot: string;
  /** The selected team, when one is configured; absent on a team-less machine or for a verb that reads no team. */
  team?: { clone: string; name: string } | undefined;
  /** 2: case only (eval); 4: case, prefix, substring (the read verbs). */
  rungs: 2 | 4;
  print(line: string): void;
  /** The verb's own miss sentence for a name no rung matched. */
  miss(ref: string): string;
  /** The verb's own sentence for a path ref no Library root holds; defaults to `miss`. */
  pathMiss?(ref: string): string;
}

const HOW_TEXT: Record<Exclude<ResolveHow, 'cwd' | 'exact'>, string> = { case: 'case-insensitive match', prefix: 'unique prefix', substring: 'unique substring' };

/** The first ancestor of `cwd` (itself included) holding a regular `SKILL.md`; undefined at the filesystem root. */
export async function nearestSkillFolder(cwd: string): Promise<string | undefined> {
  let current = cwd;
  for (;;) {
    const marker = await lstat(join(current, 'SKILL.md')).then((details) => details.isFile(), () => false);
    if (marker) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function resolveSkillRef(input: ResolveInput): Promise<Result<ResolvedRef>> {
  const { home, config, stateRoot, team } = input;
  const library = (ref: string): Promise<LibrarySkillMatch | undefined> => resolveLibrarySkill(home, config, stateRoot, ref);
  // Rung 0 — the folder above cwd, which must itself lie inside a Library root.
  if (input.ref === undefined) {
    const folder = await nearestSkillFolder(input.cwd);
    const match = folder === undefined ? undefined : await library(folder);
    if (match === undefined) return failure(CWD_MISS);
    input.print(`${RESOLVED_PREFIX}${match.name} from the working directory`);
    return success({ name: match.name, how: 'cwd', source: 'library', match });
  }
  const ref = input.ref;
  // Rung 1 — exact: the Library (name or path), then the team (name or unique id prefix).
  const exact = await library(ref);
  if (exact !== undefined) return success({ name: exact.name, how: 'exact', source: 'library', match: exact });
  if (refIsPath(ref)) return failure((input.pathMiss ?? input.miss)(ref));
  if (team !== undefined) {
    const found = await teamLookup(team, ref);
    if (!found.ok) return failure(found.error);
    if (found.value !== undefined) return success({ name: found.value.name, how: 'exact', source: 'team', record: found.value });
  }
  // Rungs 2–4 — over every Library entry name and every readable team skill name.
  const candidates = await candidateNames(home, config, stateRoot, team);
  const lower = ref.toLowerCase();
  const rungs: [ResolveHow, (name: string) => boolean][] = [['case', (name) => name.toLowerCase() === lower]];
  if (input.rungs === 4) rungs.push(['prefix', (name) => name.toLowerCase().startsWith(lower)], ['substring', (name) => name.toLowerCase().includes(lower)]);
  for (const [how, matches] of rungs) {
    const hits = candidates.filter(matches);
    if (hits.length === 0) continue;
    if (hits.length > 1) return failure(`Ambiguous skill name "${ref}": ${hits.join(', ')}. Name one.`);
    const name = hits[0]!;
    const resolved = await resolveExactly(name, library, team);
    if (!resolved.ok) return failure(resolved.error);
    if (resolved.value === undefined) break;
    input.print(`${RESOLVED_PREFIX}"${ref}" → ${name} (${HOW_TEXT[how as Exclude<ResolveHow, 'cwd' | 'exact'>]})`);
    return success({ ...resolved.value, how } as ResolvedRef);
  }
  return failure(input.miss(ref));
}

async function teamLookup(team: { clone: string; name: string }, ref: string): Promise<Result<SkillRecord | undefined>> {
  try { return success(await findSkill(team.clone, team.name, ref)); }
  catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

async function resolveExactly(name: string, library: (ref: string) => Promise<LibrarySkillMatch | undefined>, team: { clone: string; name: string } | undefined): Promise<Result<ResolvedWithoutHow | undefined>> {
  const match = await library(name);
  if (match !== undefined) return success({ name: match.name, source: 'library', match });
  if (team === undefined) return success(undefined);
  const found = await teamLookup(team, name);
  if (!found.ok) return failure(found.error);
  return success(found.value === undefined ? undefined : { name: found.value.name, source: 'team', record: found.value });
}

/** Sorted, deduplicated: every Library entry (rejected folders included — they resolve, then the verb refuses them) plus the team's readable records. */
async function candidateNames(home: string, config: Pick<Config, 'placements' | 'projects'>, stateRoot: string, team: { clone: string; name: string } | undefined): Promise<string[]> {
  const names = new Set<string>();
  const discovery = await localSkillRoots(home, config.projects ?? []);
  for (const root of discovery.roots) {
    const inventory = await localSkills(root.root, config, { scope: root.scope, stateRoot });
    for (const entry of inventory.entries) names.add(entry.name);
  }
  if (team !== undefined) for (const record of await skillRecords(team.clone, team.name, { onProblem: () => undefined })) names.add(record.name);
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
