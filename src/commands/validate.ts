import type { WithForm } from '../lib/invocation.js';
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { assessHygiene, formatHygieneFindings, HygieneRefused, reportHygieneWarnings } from '../lib/evals/hygiene.js';
import { Prompter } from '../lib/prompt.js';
import { fromError, failure, Result, success } from '../lib/result.js';
import { isSkillName, type Config } from '../lib/schema.js';
import { nearestSkillFolder, resolveSkillRef, CWD_MISS, RESOLVED_PREFIX } from '../lib/resolve-ref.js';
import { assertSkillDirectory, sourceFiles } from '../lib/skill-source.js';
import { readTeam } from '../lib/skills.js';
import { listVersions } from '../lib/teamRepo.js';
import { parseVersionFolder } from '../lib/versions.js';
import { planRepairs } from '../lib/skill-repair.js';

export interface ValidateArgs extends WithForm { /** A path, a name, or absent: the skill folder above `workingDirectory` (§6.1 rung 0). */ target?: string; team?: string; /** The team checkout to read (the Action); unrelated to the working directory. */ cwd?: string; /** Where a bare validate looks for the skill folder; defaults to process.cwd(). */ workingDirectory?: string; config?: ConfigStore; }
/** `repairs` lists, one plain sentence each, the changes `skill fix` would make to this folder, and `repairable`
 *  is their count — the app draws Fix when it is above zero and shows the list before the folder is touched. */
export interface ValidateResult { name: string; findings: number; warnings: number; repairable: number; /** The folder that was checked — what `skill fix` would rewrite. */ directory: string; repairs: string[]; }

interface Target { directory: string; name: string }

const isDirectory = (path: string): Promise<boolean> => lstat(path).then((details) => details.isDirectory(), () => false);
const isFile = (path: string): Promise<boolean> => lstat(path).then((details) => details.isFile(), () => false);

/**
 * `<root>/skills/<name>/v<max>/` — where a published skill's BYTES live (§3.1). The name is the
 * `skills/<name>` segment, never `basename(directory)`: that is `v<max>`, and HYG1 would reject
 * every valid published skill. `undefined` when the name has no version folder.
 */
async function newestVersion(root: string, name: string): Promise<Target | undefined> {
  const latest = (await listVersions(root, name))[0];
  return latest === undefined ? undefined : { directory: resolve(root, 'skills', name, latest.folder), name };
}

/**
 * The target as a directory path. One holding `SKILL.md` is a skill folder and validates as-is. Its
 * NAME is its basename for a local WIP folder — but a directly-targeted VERSION folder,
 * `skills/<name>/v<N>/` (the path `ls` and `listVersions` print, and the documented
 * `validate skills/<name>/v<N> --cwd .`), is named by its `skills/<name>` segment: its basename is
 * `v<N>`, and naming it so made HYG1 ("SKILL.md name <name> does not equal folder v<N>") reject every
 * valid published skill reached by such a path (confirmation-review HIGH 1 on
 * refactor/b3-versions-keystone — `newestVersion` above carries the same warning, and only the
 * container branch below had honoured it). The shape is exact — the basename parses as a version
 * folder (`parseVersionFolder`, the one parser) AND the grandparent is `skills/` — so a WIP folder
 * that merely happens to be called `v2` elsewhere keeps its basename. One holding no `SKILL.md`
 * directly under a `skills/` parent is the layout-3 container `skills/<name>/`, whose only entries
 * are `v1/`, `v2/`, …: validating it would report HYG1 on a skill that is perfectly fine, so it
 * descends to the newest version — the documented path invocation `validate skills/<name> --cwd .`
 * depends on this (D71, the contested `:30` case folded into D72). Anything else validates as-is
 * and lets hygiene say what is wrong with it. `undefined` when the path is not a directory.
 */
async function atPath(absolute: string): Promise<Target | undefined> {
  if (!(await isDirectory(absolute))) return undefined;
  const parent = dirname(absolute);
  if (await isFile(join(absolute, 'SKILL.md'))) {
    const versionFolder = parseVersionFolder(basename(absolute)) !== null && basename(dirname(parent)) === 'skills';
    return { directory: absolute, name: versionFolder ? basename(parent) : basename(absolute) };
  }
  const container = basename(parent) === 'skills' ? await newestVersion(dirname(parent), basename(absolute)) : undefined;
  return container ?? { directory: absolute, name: basename(absolute) };
}

/** Run the free §9 tier on a local skill folder, or a named skill in the selected team clone. */
export async function run(args: ValidateArgs, io: Prompter): Promise<Result<ValidateResult>> {
  try {
    // Rung 0: a bare validate checks the skill folder above the working directory — any folder holding SKILL.md,
    // Library or not, because validate has always accepted any path.
    let targetRef = args.target;
    if (targetRef === undefined) {
      const folder = await nearestSkillFolder(args.workingDirectory ?? process.cwd());
      if (folder === undefined) return failure(CWD_MISS);
      // A published folder is named by its parent skill segment, not its `v<N>` basename.
      const name = (await atPath(folder))?.name ?? basename(folder);
      io.print(`${RESOLVED_PREFIX}${name} from the working directory`);
      targetRef = folder;
    }
    let clone: string;
    let policy: Awaited<ReturnType<typeof readTeam>>['policy'];
    let store: ConfigStore | undefined;
    let config: Config | undefined;
    let team: string | undefined;
    if (args.cwd === undefined) {
      store = args.config ?? createConfigStore();
      config = await store.read();
      [team] = selectTeam(config.teams, args.team, args.form);
      clone = store.teamClone(team);
      policy = (await readTeam(clone)).policy;
    } else {
      // The Action runs in an unconfigured team checkout; do not touch ConfigStore on this path.
      clone = resolve(args.cwd);
      policy = (await readTeam(clone)).policy;
    }
    // D72: which of `<path|name>` the target is depends on the call mode, never on process.cwd().
    //  · With --cwd (the Action, desktop's cliValidate) the caller passes a skill NAME and lets
    //    validate pick the version (decision-walk row 47), so the name is tried first in that
    //    checkout: `evals`, `people`, `skills` and the runner's own `src/` are real folders that a
    //    well-formed skill may be named after, and hygiene-checking one of them fails CI for a
    //    skill that is fine. A path is then read relative to the checkout, not to wherever the
    //    runner happens to be.
    //  · Without --cwd a folder at the user's cwd wins over the configured clone: a WIP folder is
    //    almost always named like the published skill it will become.
    const byName = async (): Promise<Target | undefined> => (isSkillName(targetRef) ? newestVersion(clone, targetRef) : undefined);
    const target = args.cwd === undefined
      ? ((await atPath(resolve(targetRef))) ?? (await byName()))
      : ((await byName()) ?? (await atPath(resolve(clone, targetRef))));
    // Rungs 1–4 (name mode, without --cwd only): after both lookups missed, a name may still be a unique
    // case/prefix/substring of a Library folder or a team skill. The Action's --cwd path is untouched.
    let resolvedTarget = target;
    const nameLike = isSkillName(targetRef.toLowerCase());
    if (resolvedTarget === undefined && args.cwd === undefined && nameLike && store !== undefined && config !== undefined && team !== undefined) {
      const resolved = await resolveSkillRef({ ref: targetRef, cwd: args.workingDirectory ?? process.cwd(), home: homedir(), config, stateRoot: store.root, team: { clone, name: team }, rungs: 4, print: (line) => io.print(line), miss: (ref) => `skills/${ref} holds no v<N> folder.` });
      if (!resolved.ok) return failure(resolved.error);
      resolvedTarget = resolved.value.source === 'library' ? await atPath(resolved.value.match.path) : await newestVersion(clone, resolved.value.record.name);
    }
    if (resolvedTarget === undefined) throw new Error(`skills/${targetRef} holds no v<N> folder.`);
    const { directory, name } = resolvedTarget;
    await assertSkillDirectory(directory);
    const input = await sourceFiles(directory);
    let assessment;
    try { assessment = assessHygiene(name, input, policy.skill_license); }
    catch (error) { if (!(error instanceof HygieneRefused)) throw error; assessment = error.assessment; }
    reportHygieneWarnings((line) => io.print(line), assessment);
    const repairs = planRepairs({ name, ...input, policyLicense: policy.skill_license }).repaired, repairable = repairs.length;
    if (assessment.errors.length) {
      const errors = formatHygieneFindings(assessment.errors);
      for (const line of errors.split('\n')) io.print(line);
      return failure(`Hygiene failed for ${name}:\n${errors}`, { name, findings: assessment.errors.length, warnings: assessment.warnings.length, repairable, repairs, directory });
    }
    const warnings = assessment.warnings.length;
    io.print(`${name}: hygiene passed${warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}.`);
    return success({ name, findings: 0, warnings, repairable, repairs, directory });
  } catch (error) { return fromError(error); }
}
