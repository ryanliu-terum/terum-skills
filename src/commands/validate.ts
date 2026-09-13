import type { WithForm } from '../lib/invocation.js';
import { lstat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { assessHygiene, formatHygieneFindings, HygieneRefused, reportHygieneWarnings } from '../lib/evals/hygiene.js';
import { Prompter } from '../lib/prompt.js';
import { fromError, failure, Result, success } from '../lib/result.js';
import { isSkillName } from '../lib/schema.js';
import { assertSkillDirectory, sourceFiles } from '../lib/skill-source.js';
import { readTeam } from '../lib/skills.js';
import { listVersions } from '../lib/teamRepo.js';

export interface ValidateArgs extends WithForm { target: string; team?: string; cwd?: string; config?: ConfigStore; }
export interface ValidateResult { name: string; findings: number; warnings: number; }

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
 * The target as a directory path. One holding `SKILL.md` is a skill folder (a local WIP folder, a
 * version folder) and validates as-is, named by its basename. One holding no `SKILL.md` directly
 * under a `skills/` parent is the layout-3 container `skills/<name>/`, whose only entries are
 * `v1/`, `v2/`, …: validating it would report HYG1 on a skill that is perfectly fine, so it
 * descends to the newest version — the documented path invocation `validate skills/<name> --cwd .`
 * depends on this (D71, the contested `:30` case folded into D72). Anything else validates as-is
 * and lets hygiene say what is wrong with it. `undefined` when the path is not a directory.
 */
async function atPath(absolute: string): Promise<Target | undefined> {
  if (!(await isDirectory(absolute))) return undefined;
  const asIs = { directory: absolute, name: basename(absolute) };
  if (await isFile(join(absolute, 'SKILL.md'))) return asIs;
  const container = basename(dirname(absolute)) === 'skills' ? await newestVersion(dirname(dirname(absolute)), asIs.name) : undefined;
  return container ?? asIs;
}

/** Run the free §9 tier on a local skill folder, or a named skill in the selected team clone. */
export async function run(args: ValidateArgs, io: Prompter): Promise<Result<ValidateResult>> {
  try {
    let clone: string;
    let policy: Awaited<ReturnType<typeof readTeam>>['policy'];
    if (args.cwd === undefined) {
      const store = args.config ?? createConfigStore();
      const config = await store.read();
      const [team] = selectTeam(config.teams, args.team, args.form);
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
    const byName = async (): Promise<Target | undefined> => (isSkillName(args.target) ? newestVersion(clone, args.target) : undefined);
    const target = args.cwd === undefined
      ? ((await atPath(resolve(args.target))) ?? (await byName()))
      : ((await byName()) ?? (await atPath(resolve(clone, args.target))));
    if (target === undefined) throw new Error(`skills/${args.target} holds no v<N> folder.`);
    const { directory, name } = target;
    await assertSkillDirectory(directory);
    const input = await sourceFiles(directory);
    let assessment;
    try { assessment = assessHygiene(name, input, policy.skill_license); }
    catch (error) { if (!(error instanceof HygieneRefused)) throw error; assessment = error.assessment; }
    reportHygieneWarnings((line) => io.print(line), assessment);
    if (assessment.errors.length) {
      const errors = formatHygieneFindings(assessment.errors);
      for (const line of errors.split('\n')) io.print(line);
      return failure(`Hygiene failed for ${name}:\n${errors}`, { name, findings: assessment.errors.length, warnings: assessment.warnings.length });
    }
    const warnings = assessment.warnings.length;
    io.print(`${name}: hygiene passed${warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}.`);
    return success({ name, findings: 0, warnings });
  } catch (error) { return fromError(error); }
}
