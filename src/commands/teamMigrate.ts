import { z } from 'zod';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { anyLayoutTeamSchema, GLOBAL_PROJECT, installedSchema, isSkillName, LEGACY_TREE_HASH, parseJson, parseOrExplain, parseSkillFrontmatter, personSchema, teamSchema } from '../lib/schema.js';
import { installPushGuard, lockWait, MutableTree, openTeamRepo, SafeWriteOptions, treeText } from '../lib/teamRepo.js';
import { parseVersionFolder, VERSION_FOLDER, versionFolderName } from '../lib/versions.js';
import { receiptSchema } from '../lib/evals/receipt.js';

export interface MigrateArgs extends WithForm {
  team?: string;
  config?: ConfigStore;
  runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}
export interface MigrationCounts { skills: number; rekeyedReceipts: number; archivedReceipts: number; people: number; }
export interface MigrateResult extends MigrationCounts { team: string; changed: boolean; layoutVersion: 3; }

// Explicit legacy reader: never pass the input through config's lossy version preprocess.
const legacyPersonSchema = personSchema.extend({
  installed: z.array(installedSchema.extend({
    version: z.union([z.string().regex(LEGACY_TREE_HASH), z.string().regex(VERSION_FOLDER), z.null()]),
  })),
});

/** §13: terum-skills team migrate. Terminal-only; a human runs it after the B1 release propagates. */
export async function run(args: MigrateArgs, io: Prompter): Promise<Result<MigrateResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const [team, binding] = selectTeam(config.teams, args.team, args.form);
    const clone = store.teamClone(team);
    const result = await openTeamRepo(clone, binding.remote, runner).safeWrite(migrateTree, {
      action: 'migrate', handle: binding.handle, message: `${binding.handle}: migrate repository to layout 3`,
      ...lockWait(io), ...args.safeWrite,
    });
    // Also re-arm on an already-migrated repo: a retry repairs an interrupted hook refresh.
    try { await installPushGuard(clone, runner); }
    catch (error) { throw new Error(`The repository is at layout 3, but its push guard could not be re-armed. Re-run team migrate: ${error instanceof Error ? error.message : String(error)}`); }
    io.print(result.changed ? `Migrated ${team} to layout 3: ${result.returned.skills} skill(s), ${result.returned.rekeyedReceipts} re-keyed receipt(s), ${result.returned.archivedReceipts} archived receipt(s), ${result.returned.people} member file(s).` : `${team} already uses layout 3; its push guard is re-armed.`);
    return success({ team, changed: result.changed, layoutVersion: 3, ...result.returned });
  } catch (error) { return fromError(error); }
}

/** All planning and validation completes before any overlay write; safeWrite re-runs this on every retry. */
export function migrateTree(tree: MutableTree): MigrationCounts {
  const team = parseJson(anyLayoutTeamSchema, treeText(required(tree, 'team.json')), 'team.json');
  const counts: MigrationCounts = { skills: 0, rekeyedReceipts: 0, archivedReceipts: 0, people: 0 };
  if (team.layout_version === 3) return counts;

  const aliases = Object.keys(team.projects).filter(key => key.toLowerCase() === GLOBAL_PROJECT.toLowerCase());
  if (aliases.length > 1) throw new Error(`Migration refused: multiple projects spell Global (${aliases.join(', ')}); resolve the project names before retrying.`);
  const adopted = aliases[0];
  const projects = { ...team.projects };
  const global = adopted === undefined ? { remotes: [], skills: [] } : projects[adopted]!;
  if (adopted !== undefined) delete projects[adopted];
  projects[GLOBAL_PROJECT] = { ...global, skills: [...new Set([...global.skills, ...(team.global ?? [])])] };
  const policy = { ...team.policy };
  delete policy.publish;
  const nextTeam = { ...team, projects, policy, layout_version: 3 };
  delete nextTeam.global;
  parseOrExplain(teamSchema, nextTeam, 'migrated team.json');

  const writes = new Map<string, string | Buffer>();
  const removals = new Set<string>();
  const executable = tree.executablePaths();
  const movedExecutables = new Set<string>();
  const hashes = new Map<string, string>(); // UUID → this attempt's HEAD:skills/<name> tree.
  const v1 = versionFolderName(1);
  const paths = tree.paths();
  const skillNames = new Set(paths.flatMap(path => /^skills\/([^/]+)\/.+$/.exec(path)?.slice(1, 2) ?? []));
  for (const name of skillNames) {
    if (!isSkillName(name)) throw new Error(`Migration refused: invalid skill folder skills/${name}.`);
    const prefix = `skills/${name}/`;
    const skillPaths = paths.filter(path => path.startsWith(prefix));
    if (skillPaths.some(path => parseVersionFolder(path.slice(prefix.length).split('/')[0]!) !== null)) {
      throw new Error(`Migration refused: ${prefix} already contains a version path; resolve the partial migration before retrying.`);
    }
    const parsed = parseSkillFrontmatter(treeText(required(tree, `${prefix}SKILL.md`)));
    if (!parsed.ok) throw new Error(`Invalid ${prefix}SKILL.md: ${parsed.error}`);
    if (parsed.data.name !== name) throw new Error(`Migration refused: ${prefix}SKILL.md declares a different name.`);
    const id = parsed.data.metadata.id;
    if (hashes.has(id)) throw new Error(`Migration refused: multiple skill folders declare identity ${id}.`);
    const hash = tree.beforeTreeId(`skills/${name}`);
    if (hash === undefined || !LEGACY_TREE_HASH.test(hash)) throw new Error(`Migration refused: no HEAD tree identity for skills/${name}.`);
    hashes.set(id, hash);
    for (const source of skillPaths) {
      const destination = `${prefix}${v1}/${source.slice(prefix.length)}`;
      move(source, destination, required(tree, source));
    }
    counts.skills++;
  }

  for (const source of paths.filter(path => path.startsWith('evals/') && path !== 'evals/.gitkeep')) {
    const match = /^evals\/([0-9a-fA-F-]{36})\/([0-9a-f]{40})\/(\d{8}T\d{6}Z)\.json$/.exec(source);
    if (!match) throw new Error(`Migration refused: unexpected receipt path ${source}; resolve it before retrying.`);
    const id = match[1]!; const hash = match[2]!; const runId = match[3]!;
    const bytes = required(tree, source);
    if (hashes.get(id) === hash) {
      const receipt = parseJson(receiptSchema, treeText(bytes), source);
      if (receipt.skill_id !== id || receipt.version !== hash || receipt.run_id !== runId) throw new Error(`Migration refused: misfiled receipt ${source}.`);
      if (receipt.version_tree !== undefined && receipt.version_tree !== hash) throw new Error(`Migration refused: conflicting version_tree in ${source}.`);
      move(source, `evals/${id}/${v1}/${runId}.json`, json({ ...receipt, version: v1, version_tree: hash }));
      counts.rekeyedReceipts++;
    } else {
      move(source, `evals/${id}/archive/${hash}/${runId}.json`, bytes);
      counts.archivedReceipts++;
    }
  }

  for (const path of paths.filter(path => /^people\/[^/]+\.json$/.test(path))) {
    const person = parseJson(legacyPersonSchema, treeText(required(tree, path)), path);
    const next = {
      ...person,
      installed: person.installed.map(entry => ({
        ...entry,
        version: entry.version !== null && LEGACY_TREE_HASH.test(entry.version) ? (hashes.get(entry.id) === entry.version ? v1 : null) : entry.version,
        scope: entry.scope.kind === 'project' && adopted !== undefined && entry.scope.project === adopted ? { ...entry.scope, project: GLOBAL_PROJECT } : entry.scope,
      })),
      ...(person.projects === undefined ? {} : { projects: person.projects.map(project => project === adopted ? GLOBAL_PROJECT : project) }),
    };
    // This is the REAL layout-3 validator, not the lenient input reader. Never stage a half-converted member.
    parseOrExplain(personSchema, next, `migrated ${path}`);
    writes.set(path, json(next));
    counts.people++;
  }
  writes.set('team.json', json(nextTeam));
  for (const path of removals) tree.remove(path);
  for (const [path, bytes] of writes) {
    tree.set(path, bytes);
    if (movedExecutables.has(path)) tree.setExecutable(path, true);
  }
  return counts;

  function move(source: string, destination: string, bytes: string | Buffer): void {
    if (tree.before(destination) !== undefined || writes.has(destination)) throw new Error(`Migration refused: destination ${destination} already exists.`);
    writes.set(destination, bytes);
    removals.add(source);
    if (executable.has(source)) movedExecutables.add(destination);
  }
}

function required(tree: MutableTree, path: string): string | Buffer {
  const bytes = tree.before(path);
  if (bytes === undefined) throw new Error(`Migration refused: missing ${path}.`);
  return bytes;
}
function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
