import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { normalizeAuthor } from '../lib/guard.js';
import { Prompter } from '../lib/prompt.js';
import { installCounts, isActivePerson, latestTree, readPeople, shortHash, skillEndorsement } from '../lib/readme.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { handleSchema, parseJson, parseOrExplain, parseSkillFrontmatter, teamSchema } from '../lib/schema.js';

export interface LsArgs { kind?: 'all' | 'member' | 'project'; value?: string; team?: string; config?: ConfigStore; runner?: Runner; }
export interface LsSkill { id: string; name: string; author: string; category: string; installs: number; latest: string; endorsement: string; }
export interface LsResult { roster: readonly { handle: string; active: boolean }[]; skills: readonly LsSkill[]; }

/** §6 read-only team inventory; it deliberately neither pulls nor prompts. */
export async function run(args: LsArgs, io: Prompter): Promise<Result<LsResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const [teamName] = selectTeam((await store.read()).teams, args.team);
    const clone = store.teamClone(teamName);
    const runner = args.runner ?? systemRunner;
    const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    const people = await readPeople(clone);
    const roster = people.sort((a, b) => a.handle.localeCompare(b.handle)).map((person) => ({ handle: person.handle, active: isActivePerson(person, team.archived) }));
    const skills = await listSkills(team, people, clone, runner);
    if (args.kind === 'member') return showMember(args.value, people, skills, io, roster);
    if (args.kind === 'project') return showProject(args.value, team, skills, io, roster);
    io.print('Members:');
    for (const member of roster) io.print(`  ${member.handle}${member.active ? '' : ' (inactive)'}`);
    io.print('Skills:');
    for (const skill of skills) io.print(format(skill));
    return success({ roster, skills });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

async function listSkills(team: ReturnType<typeof teamSchema.parse>, people: Awaited<ReturnType<typeof readPeople>>, clone: string, runner: Runner): Promise<LsSkill[]> {
  const names = (await readdir(join(clone, 'skills'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const counts = installCounts(people);
  return Promise.all(names.map(async (name) => {
    const parsed = parseSkillFrontmatter(await readFile(join(clone, 'skills', name, 'SKILL.md'), 'utf8'));
    if (!parsed.ok) throw new Error(`Invalid skills/${name}/SKILL.md: ${parsed.error}`);
    const id = parsed.data.metadata.id;
    return { id, name, author: parsed.data.metadata.author, category: parsed.data.metadata['terum-category'], installs: counts.get(id) ?? 0, latest: shortHash(await latestTree(runner, clone, name)), endorsement: skillEndorsement(team, id) };
  }));
}
async function showMember(handle: string | undefined, people: Awaited<ReturnType<typeof readPeople>>, skills: readonly LsSkill[], io: Prompter, roster: LsResult['roster']): Promise<Result<LsResult>> {
  if (!handle) throw new Error('Specify a member handle.');
  const normalizedHandle = parseOrExplain(handleSchema, handle, 'member handle');
  const member = people.find((person) => person.handle === normalizedHandle);
  if (!member) throw new Error(`No member named ${handle}.`);
  const authored = skills.filter((skill) => normalizeAuthor(skill.author) === normalizeAuthor(`${member.display_name} <${member.email}>`));
  const namesById = new Map(skills.map((skill) => [skill.id, skill.name]));
  io.print(`Member ${member.handle}:`);
  io.print(`  Authored: ${authored.map((skill) => skill.name).join(', ') || '—'}`);
  io.print(`  Installed: ${member.installed.map((item) => namesById.get(item.id) ?? item.id).join(', ') || '—'}`);
  return success({ roster, skills: authored });
}
async function showProject(projectName: string | undefined, team: ReturnType<typeof teamSchema.parse>, skills: readonly LsSkill[], io: Prompter, roster: LsResult['roster']): Promise<Result<LsResult>> {
  if (!projectName || !team.projects[projectName]) throw new Error(`No project named ${projectName ?? ''}.`);
  const projectIds = new Set(team.projects[projectName]!.skills);
  const selected = skills.filter((skill) => projectIds.has(skill.id));
  io.print(`Project ${projectName}:`);
  for (const skill of selected) io.print(format(skill));
  return success({ roster, skills: selected });
}
function format(skill: LsSkill): string { return `  ${skill.name} — ${skill.author}; ${skill.category}; ${skill.installs} installs; ${skill.latest}; ${skill.endorsement}`; }
