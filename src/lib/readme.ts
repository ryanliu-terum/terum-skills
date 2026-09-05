import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Person, parseJson, parseSkillFrontmatter, personSchema, teamSchema } from './schema.js';
import { githubOwnerRepo } from './remote.js';
import { Runner, systemRunner } from './runner.js';
import type { MutableTree } from './teamRepo.js';

export const README_BEGIN = '<!-- terum-skills:begin -->';
export const README_END = '<!-- terum-skills:end -->';

export interface ReadmeSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  latest: string;
}

export interface ReadmeData {
  team: { name: string; remote: string; global: readonly string[]; projects: Record<string, { skills: readonly string[] }>; archived?: readonly string[] };
  people: readonly Person[];
  skills: readonly ReadmeSkill[];
}

type EndorsementTeam = Pick<ReadmeData['team'], 'global' | 'projects'>;

/** Install totals include archived people: they are historical installs, not active membership. */
export function installCounts(people: readonly Person[]): Map<string, number> {
  const installs = new Map<string, number>();
  for (const person of people) for (const item of person.installed) installs.set(item.id, (installs.get(item.id) ?? 0) + 1);
  return installs;
}

export function skillEndorsement(team: EndorsementTeam, id: string): string {
  const projects = Object.entries(team.projects).filter(([, project]) => project.skills.includes(id)).map(([name]) => name).sort();
  return team.global.includes(id) ? 'global' : projects.length ? `project: ${projects.join(', ')}` : '—';
}

export function activePeople(people: readonly Person[], archived: readonly string[] = []): Person[] {
  return people.filter((person) => isActivePerson(person, archived));
}

export function isActivePerson(person: Pick<Person, 'handle'>, archived: readonly string[] = []): boolean {
  return !archived.includes(person.handle);
}

/** §9 deterministic generated region; callers use applyReadme to retain author-written prose. */
export function generateReadme(data: ReadmeData): string {
  const installs = installCounts(data.people);
  const byAuthor = new Map<string, ReadmeSkill[]>();
  for (const skill of data.skills) {
    const list = byAuthor.get(skill.author) ?? [];
    list.push(skill);
    byAuthor.set(skill.author, list);
  }
  const lines = [README_BEGIN, `## ${data.team.name} skills`, '', '### Roster'];
  const roster = activePeople(data.people, data.team.archived).sort((a, b) => a.handle.localeCompare(b.handle));
  lines.push(...(roster.length ? roster.map((person) => `- @${person.handle} — ${person.display_name}`) : ['- No members yet.']));
  const repo = installRepository(data.team.remote);
  for (const [author, skills] of [...byAuthor.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push('', `### ${author}`);
    lines.push('', '| Skill | Category | Description | Installs | Endorsed | Latest | Eval | Install |', '| --- | --- | --- | ---: | --- | --- | --- | --- |');
    for (const skill of skills.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const endorsement = skillEndorsement(data.team, skill.id);
      const command = repo ? `\`npx -y terum-skills@latest install ${repo}/${skill.name}\`` : '—';
      lines.push(`| ${skill.name} | ${skill.category} | ${cell(skill.description)} | ${installs.get(skill.id) ?? 0} | ${endorsement} | ${shortHash(skill.latest)} | — | ${command} |`);
    }
  }
  if (byAuthor.size === 0) lines.push('', '### Skills', '', 'No shared skills yet.');
  lines.push('', README_END);
  return `${lines.join('\n')}\n`;
}

/** Replace exactly the generated region. Everything outside the two markers is byte-for-byte retained. */
export function applyReadme(existing: string, block: string): string {
  const begins = countMarkers(existing, README_BEGIN);
  const ends = countMarkers(existing, README_END);
  const beginAt = existing.indexOf(README_BEGIN);
  const endAt = existing.indexOf(README_END);
  if (begins !== 0 || ends !== 0) {
    if (begins !== 1 || ends !== 1 || endAt < beginAt) {
      throw new Error(`README.md has malformed ${README_BEGIN}/${README_END} markers; expected exactly one BEGIN before one END.`);
    }
  }
  const expression = new RegExp(`${escapeRegExp(README_BEGIN)}[\\s\\S]*?${escapeRegExp(README_END)}`);
  if (expression.test(existing)) return existing.replace(expression, () => block.trimEnd()); // function form: `$&`/`$1` in skill text must not be interpreted
  const suffix = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${suffix}${block}`;
}

/** §M3 bridge for ls; M2 moves this single helper into version.ts at integration. */
export async function latestTree(runner: Runner, clone: string, name: string): Promise<string> {
  const result = await runner.run('git', ['rev-parse', `HEAD:skills/${name}`], { cwd: clone });
  if (result.code !== 0) throw new Error(`Could not resolve the latest version of ${name}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

/** Read one clone without pulling or mutating it; used by the hidden workflow command and ls. */
export async function readReadmeData(clone: string, remote: string, runner: Runner = systemRunner): Promise<ReadmeData> {
  const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
  const people = await readPeople(clone);
  const names = (await readdir(join(clone, 'skills'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const skills: ReadmeSkill[] = [];
  for (const name of names) {
    const source = await readFile(join(clone, 'skills', name, 'SKILL.md'), 'utf8');
    const parsed = parseSkillFrontmatter(source);
    if (!parsed.ok) throw new Error(`Invalid skills/${name}/SKILL.md: ${parsed.error}`);
    if (parsed.data.name !== name) throw new Error(`skills/${name}/SKILL.md names ${parsed.data.name}; folder name must match`);
    const latest = await latestTree(runner, clone, name);
    skills.push({ id: parsed.data.metadata.id, name, description: parsed.data.description, category: parsed.data.metadata['terum-category'], author: parsed.data.metadata.author, latest });
  }
  return { team: { name: team.name, remote, global: team.global, projects: team.projects, archived: team.archived }, people, skills };
}

export async function readPeople(clone: string): Promise<Person[]> {
  const files = (await readdir(join(clone, 'people'))).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => parseJson(personSchema, await readFile(join(clone, 'people', file), 'utf8'), `people/${file}`)));
}

/** §9 generic-git fallback: derive the README from safeWrite's in-memory tree before it is guarded. */
export async function regenerateReadmeInTree(tree: MutableTree, remote: string, runner: Runner, clone: string, latestBySkill?: ReadonlyMap<string, string>): Promise<void> {
  const source = tree.after('team.json');
  if (source === undefined) throw new Error('Cannot generate README without team.json.');
  const team = parseJson(teamSchema, source, 'team.json');
  const people = tree.paths.filter((path) => /^people\/[^/]+\.json$/.test(path)).sort().map((path) => {
    const value = tree.after(path);
    if (value === undefined) throw new Error(`Cannot generate README: ${path} was removed from the tree.`);
    return parseJson(personSchema, value, path);
  });
  const names = tree.paths.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path)).map((path) => path.split('/')[1]!).sort();
  const skills: ReadmeSkill[] = [];
  for (const name of names) {
    const source = tree.after(`skills/${name}/SKILL.md`);
    if (source === undefined) throw new Error(`Cannot generate README: skills/${name}/SKILL.md was removed from the tree.`);
    const parsed = parseSkillFrontmatter(source);
    if (!parsed.ok) throw new Error(`Invalid skills/${name}/SKILL.md: ${parsed.error}`);
    const latest = latestBySkill === undefined ? await latestTree(runner, clone, name) : latestBySkill.get(name);
    if (latest === undefined) throw new Error(`Cannot generate README: skills/${name} is absent from the written tree.`);
    skills.push({ id: parsed.data.metadata.id, name, description: parsed.data.description, category: parsed.data.metadata['terum-category'], author: parsed.data.metadata.author, latest });
  }
  tree.set('README.md', applyReadme(tree.after('README.md') ?? '', generateReadme({ team: { name: team.name, remote, global: team.global, projects: team.projects, archived: team.archived }, people, skills })));
}

/** Markdown table cells: a pipe or newline inside a description would break the row. */
function cell(value: string): string { return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|'); }

export function shortHash(value: string): string { return value === '—' ? value : value.slice(0, 8); }

function installRepository(remote: string): string | null { return githubOwnerRepo(remote); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function countMarkers(value: string, marker: string): number { return value.split(marker).length - 1; }
