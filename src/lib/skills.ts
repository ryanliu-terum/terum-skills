import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import YAML from 'yaml';
import { allowedTools, parseJson, parseSkillFrontmatter, Person, SkillFrontmatter, Team, personSchema, teamSchema } from './schema.js';

export interface SkillRecord {
  id: string;
  name: string;
  team: string;
  directory: string;
  frontmatter: SkillFrontmatter;
  rawFrontmatter: string;
  body: string;
  /** UTF-16 code units of the whole SKILL.md, the basis HYG6's 20,000-character guideline uses. */
  characters: number;
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
      result.push({ id: parsed.data.metadata.id, name, team, directory, frontmatter: parsed.data, rawFrontmatter: parsed.frontmatter, body: parsed.body, characters: source.length, grants: parsed.grants });
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

/** `admin` is host truth (GitHub collaborator permission), joined on the person's github login; null when the lookup was unavailable or the person declares no login. */
export interface RosterEntry { handle: string; displayName: string; role: string | null; projects: readonly string[]; admin: boolean | null; }

/** Active roster with filename-checked identities; one bad people file never hides the others. `options.adminLogins` (lowercased GitHub logins with host admin permission, or null when unknown) decides each entry's `admin`. */
export async function readRoster(clone: string, options: { adminLogins?: readonly string[] | null } = {}): Promise<{ roster: RosterEntry[]; problems: { file: string; message: string }[] }> {
  const team = await readTeam(clone);
  const adminLogins = options.adminLogins ?? null;
  const files = (await readdir(join(clone, 'people'))).filter((file) => file.endsWith('.json')).sort();
  const roster: RosterEntry[] = [];
  const problems: { file: string; message: string }[] = [];
  for (const file of files) {
    try {
      const handle = file.slice(0, -5);
      const person = await readPerson(clone, handle);
      if (person.handle !== handle) throw new Error(`Declared handle ${person.handle} does not match filename ${file}.`);
      const github = person.github.trim().toLowerCase();
      if (!team.archived.includes(handle)) roster.push({ handle, displayName: person.display_name, role: person.role ?? null, projects: person.projects ?? [], admin: adminLogins === null || github === '' ? null : adminLogins.includes(github) });
    } catch (error) { problems.push({ file: `people/${file}`, message: error instanceof Error ? error.message : String(error) }); }
  }
  roster.sort((a, b) => a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0);
  return { roster, problems };
}

/** Canonical §5.3 digest: all bytes count except the three Terum-managed YAML fields. */
export async function canonicalDigest(root: string): Promise<string> {
  const files = await walk(root);
  const aggregate = createHash('sha256');
  for (const relative of files) {
    let content = await readFile(join(root, relative));
    if (relative === 'SKILL.md') content = Buffer.from(canonicalSkillMd(content.toString('utf8')));
    aggregate.update(`${digestKey(relative)}:${createHash('sha256').update(content).digest('hex')}\n`);
  }
  return `sha256:${aggregate.digest('hex')}`;
}

/**
 * The digest record's path field with `\` and newline escaped, so the record stream is prefix-free
 * and no two file lists share a digest. A record is `key:<64 hex>\n`: the hash field is fixed-width,
 * so the record's final `:` is always the separator and a `:` inside a path needs no escape — and
 * must not get one, because `config.shared[].baseline` persists this digest with no version field
 * and a `:`-bearing filename is legal on POSIX. Every path that can reach a stored baseline therefore
 * hashes to exactly the bytes it did before, except one carrying a literal newline (the ambiguity the
 * escape exists to close); a backslash path never reaches one, because `assertSafePath` refuses it
 * in the mirror before a baseline is recorded.
 */
function digestKey(relative: string): string {
  return relative.replace(/[\\\n]/g, (char) => (char === '\n' ? '\\n' : `\\${char}`));
}

/** Canonical digest for a single SKILL.md, used to authorize a managed-field-only refresh. */
export function canonicalSkillDigest(source: string | Buffer): string {
  return `sha256:${createHash('sha256').update(canonicalSkillMd(Buffer.isBuffer(source) ? source.toString('utf8') : source)).digest('hex')}`;
}

/** The category written when a SKILL.md carries none: the starter list's catch-all (rulings walk R1, 2026-09-06). */
export const DEFAULT_CATEGORY = 'misc';

/** The `metadata.terum-category` a frontmatter declares, or undefined when it is absent, empty, or not a string. */
export function declaredCategory(source: string): string | undefined {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source);
  if (!match) return undefined;
  try { return categoryOf((YAML.parse(match[1]!) as Record<string, unknown> | null)?.metadata); } catch { return undefined; }
}

function categoryOf(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)['terum-category'];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Insert/refresh the managed legal frontmatter fields while retaining body text: `license`,
 * `metadata.id`, `metadata.author`, and — only when the file declares none — `metadata.terum-category`
 * as DEFAULT_CATEGORY, so every off-the-shelf SKILL.md (no `metadata:` block at all) becomes a
 * complete Terum skill without a hand edit; a declared category is never overwritten.
 */
export function injectManagedFields(source: string, values: { license: string; id: string; author: string; category?: string }): string {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source);
  if (!match) throw new Error('SKILL.md has no YAML frontmatter');
  const document = YAML.parseDocument(match[1]!);
  if (document.errors.length) throw new Error(`Invalid SKILL.md frontmatter: ${document.errors.map((error) => error.message).join('; ')}`);
  const raw = document.toJS();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('SKILL.md frontmatter must be a mapping');
  document.set('license', values.license);
  const metadata = (raw as Record<string, unknown>).metadata;
  // A real YAML map, never a plain `{}`: `setIn` below walks YAML nodes and treats a plain object as a
  // scalar, which is exactly how a file with no `metadata:` block used to crash the connect.
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) document.set('metadata', document.createNode({}));
  document.setIn(['metadata', 'id'], values.id);
  document.setIn(['metadata', 'author'], values.author);
  if (categoryOf(metadata) === undefined) document.setIn(['metadata', 'terum-category'], values.category ?? DEFAULT_CATEGORY);
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
    // Separators are rewritten to '/' only on Windows: on POSIX a backslash is a legal filename
    // character, and folding it would give `docs\readme.md` and `docs/readme.md` one digest key
    // (the rule the vendored fingerprint walker already follows).
    else if (entry.isFile()) { const relative = absolute.slice(base.length + 1); result.push(sep === '\\' ? relative.split('\\').join('/') : relative); }
  }
  return result.sort();
}

function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
