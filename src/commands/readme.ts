import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Prompter } from '../lib/prompt.js';
import { applyReadme, generateReadme, readReadmeData } from '../lib/readme.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { parseJson, teamSchema } from '../lib/schema.js';

export interface ReadmeArgs { prComment?: string; cwd?: string; runner?: Runner; }

/** Hidden host-side entry point for the scaffolded Action. */
export async function run(args: ReadmeArgs, io: Prompter): Promise<Result<{ changed?: boolean; comment?: string }>> {
  try {
    const cwd = args.cwd ?? resolve('.');
    const runner = args.runner ?? systemRunner;
    const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd });
    if (origin.code !== 0) throw new Error(`Could not read origin: ${(origin.stderr || origin.stdout).trim()}`);
    const data = await readReadmeData(cwd, origin.stdout.trim(), runner);
    if (args.prComment) {
      const base = await runner.run('git', ['show', `${args.prComment}:team.json`], { cwd });
      if (base.code !== 0) throw new Error(`Could not read ${args.prComment}:team.json: ${(base.stderr || base.stdout).trim()}`);
      const before = parseJson(teamSchema, base.stdout, `${args.prComment}:team.json`);
      const current = parseJson(teamSchema, await readFile(join(cwd, 'team.json'), 'utf8'), 'team.json');
      const beforeIds = new Set([...before.global, ...Object.values(before.projects).flatMap((project) => project.skills)]);
      const added = new Set([...current.global, ...Object.values(current.projects).flatMap((project) => project.skills)].filter((id) => !beforeIds.has(id)));
      const skills = data.skills.filter((skill) => added.has(skill.id));
      const comment = ['<!-- terum-skills:pr-comment -->', '## terum-skills publish preview', ...(skills.length ? skills.map((skill) => `- ${skill.name} (${skill.category})`) : ['- No new endorsements.'])].join('\n');
      io.print(comment);
      return success({ comment });
    }
    const path = join(cwd, 'README.md');
    const existing = await readFile(path, 'utf8').catch(() => '');
    const next = applyReadme(existing, generateReadme(data));
    if (next !== existing) await writeFile(path, next, 'utf8');
    return success({ changed: next !== existing });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}
