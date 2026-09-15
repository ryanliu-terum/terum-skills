import { z } from 'zod';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { anyLayoutTeamSchema, installedSchema, isSkillName, LEGACY_TREE_HASH, parseJson, parseOrExplain, parseSkillFrontmatter, personSchema, teamSchema } from '../lib/schema.js';
import { ignoredByDigest, skillContentDigest } from '../lib/skills.js';
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

  // Layout 2's `global[]` is DROPPED, not folded into a project. Under layout 3 a skill is in the
  // team because `skills/<name>/v<N>` holds its bytes — that is the marketplace — and `projects` is
  // an optional membership list. The ids in `global[]` name skills this repo already carries, so
  // deleting the list loses nothing; there is no reserved catch-all project to fold them into, and
  // inventing one would put a card in front of every team that never asked for it. Existing project
  // cards are carried across untouched, whatever they are named (`team project delete` retires one).
  const policy = { ...team.policy };
  delete policy.publish;
  const nextTeam = { ...team, projects: { ...team.projects }, policy, layout_version: 3 };
  delete nextTeam.global;
  parseOrExplain(teamSchema, nextTeam, 'migrated team.json');

  const writes = new Map<string, string | Buffer>();
  const removals = new Set<string>();
  const executable = tree.executablePaths();
  const movedExecutables = new Set<string>();
  const hashes = new Map<string, string>(); // UUID → this attempt's HEAD:skills/<name> tree.
  // UUID → the v1 bytes keyed the way `canonicalDigest`'s walker keys a folder on disk: skill-relative
  // POSIX paths with D2's ignore list applied. D76 stamps a digest from this map, and B6's install
  // seeding looks the receipt up by re-walking the placed folder (§9.1) -- a key shape or ignore rule
  // that differs from `walk()`'s would mint a digest no on-disk reader can ever reproduce.
  const filesById = new Map<string, Map<string, Buffer>>();
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
    const files = new Map<string, Buffer>();
    for (const source of skillPaths) {
      const relative = source.slice(prefix.length);
      const bytes = required(tree, source);
      // Every path moves (§13 step 1 -- `.DS_Store` and friends are bytes the team committed); only the
      // digest applies D2's ignore list, exactly as `sourceFiles()` and `walk()` do for a folder on disk.
      if (!ignoredByDigest(relative)) files.set(relative, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8'));
      move(source, `${prefix}${v1}/${relative}`, bytes);
    }
    filesById.set(id, files);
    counts.skills++;
  }

  for (const source of paths.filter(path => path.startsWith('evals/') && path !== 'evals/.gitkeep')) {
    const match = /^evals\/([0-9a-fA-F-]{36})\/([0-9a-f]{40})\/(\d{8}T\d{6}Z)\.json$/.exec(source);
    if (!match) throw new Error(`Migration refused: unexpected receipt path ${source}; resolve it before retrying.`);
    // The folder is the one identity here that no schema normalizes: `z.uuid()` lower-cases the
    // frontmatter id the `hashes` map is keyed by, so a raw upper-case capture would miss it and send
    // the CURRENT receipt to the archive silently. Compare the way guard.ts does, lower-cased -- but
    // keep the folder's recorded spelling for the destination: safeWrite applies the mutation through
    // the working tree and stages by literal path, so a case-only rename of the folder cannot be
    // committed from a case-insensitive volume (macOS, Windows). Normalizing the folder is a separate
    // step, not this verb's.
    const folder = match[1]!; const id = folder.toLowerCase(); const hash = match[2]!; const runId = match[3]!;
    const bytes = required(tree, source);
    if (hashes.get(id) === hash) {
      const receipt = parseJson(receiptSchema, treeText(bytes), source);
      if (receipt.skill_id !== id || receipt.version !== hash || receipt.run_id !== runId) throw new Error(`Migration refused: misfiled receipt ${source}.`);
      if (receipt.version_tree !== undefined && receipt.version_tree !== hash) throw new Error(`Migration refused: conflicting version_tree in ${source}.`);
      // D76 (LOCK, 2026-09-13): stamp `content_digest`, the key B6's install seeding reads the receipt
      // by. Faithful by construction: this branch runs only when HEAD:skills/<name> IS the tree the
      // receipt was evaluated on, so the v1 bytes are the evaluated bytes. The receipt stays schema 1
      // (`content_digest` is optional there, §6.1). `filesById` is populated beside `hashes`, so the
      // guard above proves the lookup. An archived receipt describes OTHER bytes and is never stamped.
      move(source, `evals/${folder}/${v1}/${runId}.json`, json({ ...receipt, version: v1, version_tree: hash, content_digest: skillContentDigest(filesById.get(id)!) }));
      counts.rekeyedReceipts++;
    } else {
      move(source, `evals/${folder}/archive/${hash}/${runId}.json`, bytes);
      counts.archivedReceipts++;
    }
  }

  for (const path of paths.filter(path => /^people\/[^/]+\.json$/.test(path))) {
    const person = parseJson(legacyPersonSchema, treeText(required(tree, path)), path);
    const next = {
      ...person,
      // Only the version vocabulary changes here. Nothing renames a project any more, so an install
      // scope and a person's project list both carry across verbatim.
      installed: person.installed.map(entry => ({
        ...entry,
        version: entry.version !== null && LEGACY_TREE_HASH.test(entry.version) ? (hashes.get(entry.id) === entry.version ? v1 : null) : entry.version,
      })),
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
