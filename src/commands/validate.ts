import type { WithForm } from '../lib/invocation.js';
import { lstat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { formatHygieneFindings, hygieneFrontmatter, inspectHygiene } from '../lib/evals/hygiene.js';
import { Prompter } from '../lib/prompt.js';
import { failure, Result, success } from '../lib/result.js';
import { assertSkillDirectory, sourceFiles } from '../lib/skill-source.js';
import { readTeam } from '../lib/skills.js';

export interface ValidateArgs extends WithForm { target: string; team?: string; cwd?: string; config?: ConfigStore; }
export interface ValidateResult { name: string; findings: number; }

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
    const absolute = resolve(args.target);
    let directory: string;
    try {
      const details = await lstat(absolute);
      directory = details.isDirectory() ? absolute : resolve(clone, 'skills', args.target);
    } catch { directory = resolve(clone, 'skills', args.target); }
    await assertSkillDirectory(directory);
    const input = await sourceFiles(directory);
    const skill = input.files.get('SKILL.md');
    const name = basename(directory);
    const findings = inspectHygiene({ name, frontmatter: skill === undefined ? undefined : hygieneFrontmatter(skill), files: input.files, executable: input.executable, policy: { skill_license: policy.skill_license } });
    if (findings.length) {
      for (const finding of findings) io.print(`${finding.code} ${finding.path}${finding.line === undefined ? '' : `:${finding.line}`}: ${finding.message}`);
      return failure(`Hygiene failed for ${name}:\n${formatHygieneFindings(findings)}`, { name, findings: findings.length });
    }
    io.print(`${name}: hygiene passed.`);
    return success({ name, findings: 0 });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}
