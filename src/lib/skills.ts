import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { allowedTools, parseJson, parseSkillFrontmatter, Person, SkillFrontmatter, Team, personSchema, teamSchema } from './schema.js';

export interface SkillRecord {
  id: string;
  name: string;
  team: string;
  directory: string;
  frontmatter: SkillFrontmatter;
  grants: ReturnType<typeof allowedTools>;
}

export interface SkillProblem { name: string; message: string; }
export interface SkillRecordOptions { onProblem?: (problem: SkillProblem) => void; }

/** Enumerate usable skills without allowing one bad folder to poison the whole team. */
export async function skillRecords(clone: string, team: string, options: SkillRecordOptions = {}): Promise<SkillRecord[]> {
  const root = join(clone, 'skills');
  let names: string[];
  try { names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); }
  catch (error) { if (isMissing(error)) return []; throw error; }
  const result: SkillRecord[] = [];
  for (const name of names) {
    try {
      const directory = join(root, name);
      const source = await readFile(join(directory, 'SKILL.md'), 'utf8');
      const parsed = parseSkillFrontmatter(source);
      if (!parsed.ok) throw new Error(`Invalid skills/${name}/SKILL.md: ${parsed.error}`);
      if (parsed.data.name !== name) throw new Error(`Skill folder ${name} does not match frontmatter name ${parsed.data.name}.`);
      result.push({ id: parsed.data.metadata.id, name, team, directory, frontmatter: parsed.data, grants: parsed.grants });
    } catch (error) {
      options.onProblem?.({ name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export async function findSkill(clone: string, team: string, reference: string): Promise<SkillRecord | undefined> {
  const problems: SkillProblem[] = [];
  const records = await skillRecords(clone, team, { onProblem: (problem) => problems.push(problem) });
  const lower = reference.toLowerCase();
  const byName = records.find((record) => record.name === reference);
  if (byName) return byName;
  const problem = problems.find((item) => item.name === reference);
  if (problem) throw new Error(`Skill ${reference} cannot be used: ${problem.message}`);
  const matches = records.filter((record) => record.id.toLowerCase().startsWith(lower));
  if (matches.length > 1) throw new Error(`Skill ID prefix ${reference} is ambiguous.`);
  return matches[0];
}

/** Team-endorsed skills that this member has neither installed nor explicitly declined. */
export async function endorsedCandidates(clone: string, team: string, handle: string, options: SkillRecordOptions = {}): Promise<SkillRecord[]> {
  const [teamJson, person, records] = await Promise.all([readTeam(clone), readPerson(clone, handle), skillRecords(clone, team, options)]);
  return teamJson.global
    .filter((id) => !person.installed.some((entry) => entry.id === id) && !person.declined.includes(id))
    .map((id) => records.find((record) => record.id === id))
    .filter((record): record is SkillRecord => Boolean(record));
}

export async function readTeam(clone: string): Promise<Team> { return parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json'); }
export async function readPerson(clone: string, handle: string): Promise<Person> { return parseJson(personSchema, await readFile(join(clone, 'people', `${handle}.json`), 'utf8'), `people/${handle}.json`); }

/** Canonical §5.3 digest: all bytes count except the three Terum-managed YAML fields. */
export async function canonicalDigest(root: string): Promise<string> {
  const files = await walk(root);
  const aggregate = createHash('sha256');
  for (const relative of files) {
    let content = await readFile(join(root, relative));
    if (relative === 'SKILL.md') content = Buffer.from(canonicalSkillMd(content.toString('utf8')));
    aggregate.update(`${relative}:${createHash('sha256').update(content).digest('hex')}\n`);
  }
  return `sha256:${aggregate.digest('hex')}`;
}

/** Canonical digest for a single SKILL.md, used to authorize a managed-field-only refresh. */
export function canonicalSkillDigest(source: string | Buffer): string {
  return `sha256:${createHash('sha256').update(canonicalSkillMd(Buffer.isBuffer(source) ? source.toString('utf8') : source)).digest('hex')}`;
}

/** Insert/refresh only the managed legal frontmatter fields while retaining body text. */
export function injectManagedFields(source: string, values: { license: string; id: string; author: string }): string {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source);
  if (!match) throw new Error('SKILL.md has no YAML frontmatter');
  const document = YAML.parseDocument(match[1]!);
  if (document.errors.length) throw new Error(`Invalid SKILL.md frontmatter: ${document.errors.map((error) => error.message).join('; ')}`);
  const raw = document.toJS();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('SKILL.md frontmatter must be a mapping');
  document.set('license', values.license);
  const metadata = (raw as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) document.set('metadata', {});
  document.setIn(['metadata', 'id'], values.id);
  document.setIn(['metadata', 'author'], values.author);
  // Mutate the parsed document so comments, quoting, ordering, and untouched source lines survive.
  return `---\n${document.toString()}---${match[2] || '\n'}${source.slice(match[0].length)}`;
}

function canonicalSkillMd(source: string): string {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source);
  if (!match) return source;
  const document = YAML.parseDocument(match[1]!);
  if (document.errors.length) return source;
  const raw = document.toJS();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return source;
  const record = { ...(raw as Record<string, unknown>) };
  delete record.license;
  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const copied = { ...(metadata as Record<string, unknown>) };
    delete copied.id;
    delete copied.author;
    record.metadata = copied;
  }
  return `---\n${YAML.stringify(record)}---${match[2] || '\n'}${source.slice(match[0].length)}`;
}

async function walk(root: string, base = root): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute, base));
    else if (entry.isFile()) result.push(absolute.slice(base.length + 1).split('\\').join('/'));
  }
  return result.sort();
}

export function isInside(child: string, parent: string): boolean {
  const relative = resolve(child).slice(resolve(parent).length + 1);
  return relative !== '' && !relative.startsWith('..');
}

export async function existsDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch (error) { if (isMissing(error)) return false; throw error; }
}
function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
