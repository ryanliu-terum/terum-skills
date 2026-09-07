import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSkillName, Person, parseJson, parseSkillFrontmatter, personSchema, teamSchema } from './schema.js';
import { githubOwnerRepo } from './remote.js';
import { receiptSchema } from './evals/receipt.js';
import { Runner, systemRunner } from './runner.js';
import type { MutableTree } from './teamRepo.js';

/** The tree may hold Buffers (binary skill assets); README generation reads only text paths, decoded here. */
const asText = (value: string | Buffer): string => (Buffer.isBuffer(value) ? value.toString('utf8') : value);

export const README_BEGIN = '<!-- terum-skills:begin -->';
export const README_END = '<!-- terum-skills:end -->';

export interface ReadmeSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  latest: string;
  /** Latest schema-valid receipt verdict for `latest`, or absent when no receipt exists. */
  eval?: string;
}

export interface ReadmeData {
  team: { name: string; remote: string; global: readonly string[]; projects: Record<string, { skills: readonly string[] }>; archived?: readonly string[] };
  people: readonly Person[];
  skills: readonly ReadmeSkill[];
}

type EndorsementTeam = Pick<ReadmeData['team'], 'global' | 'projects'>;

/**
 * Install totals include archived people: they are historical installs, not active membership.
 * D38: the number is how many TEAMMATES hold the skill, not how many placements they hold — install
 * dedupes `installed` on (id, scope), so one person who installed the same id globally and again
 * into a project legitimately carries two entries and must still count once.
 */
export function installCounts(people: readonly Person[]): Map<string, number> {
  const installs = new Map<string, number>();
  for (const person of people) for (const id of new Set(person.installed.map((item) => item.id))) installs.set(id, (installs.get(id) ?? 0) + 1);
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
  // Every value below comes from repo content nobody validated for rendering (team.json, people
  // files, SKILL.md frontmatter); each one goes through inlineText()/cell() so it can neither break
  // the table nor spell a block marker.
  const lines = [README_BEGIN, `## ${inlineText(data.team.name)} skills`, '', '### Roster'];
  const roster = activePeople(data.people, data.team.archived).sort((a, b) => a.handle.localeCompare(b.handle));
  lines.push(...(roster.length ? roster.map((person) => `- @${person.handle} — ${inlineText(person.display_name)}`) : ['- No members yet.']));
  const repo = installRepository(data.team.remote);
  for (const [author, skills] of [...byAuthor.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push('', `### ${inlineText(author)}`);
    lines.push('', '| Skill | Category | Description | Installs | Endorsed | Latest | Eval | Install |', '| --- | --- | --- | ---: | --- | --- | --- | --- |');
    for (const skill of skills.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const endorsement = skillEndorsement(data.team, skill.id);
      // A code span's only delimiter is a backtick, which cell() cannot escape, and this column is a
      // command a reader copies: a folder name the CLI itself would refuse to create gets no command.
      const command = repo && isSkillName(skill.name) ? `\`npx -y terum-skills@latest install ${repo}/${skill.name}\`` : '—';
      // The Skill column shows the folder name as data even when the CLI would refuse it: cell() has
      // already defanged a link label (every cell has, per R14); an angle bracket could still spell an
      // HTML anchor, so those become entities here. A no-op for every name the CLI accepts.
      const shownName = cell(skill.name).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      lines.push(`| ${shownName} | ${cell(skill.category)} | ${cell(skill.description)} | ${installs.get(skill.id) ?? 0} | ${cell(endorsement)} | ${shortHash(skill.latest)} | ${cell(skill.eval ?? '—')} | ${command} |`);
    }
  }
  if (byAuthor.size === 0) lines.push('', '### Skills', '', 'No shared skills yet.');
  lines.push('', README_END);
  const block = `${lines.join('\n')}\n`;
  // Fails closed: a block with any other marker count would be committed once and then wedge every
  // later write for every member, because applyReadme validates only the EXISTING file. Unreachable
  // while every field goes through the sanitizers above; kept so a future raw interpolation cannot
  // poison a team repository.
  if (countMarkers(block, README_BEGIN) !== 1 || countMarkers(block, README_END) !== 1) throw new Error(`Refusing to write a README block carrying ${countMarkers(block, README_BEGIN)} ${README_BEGIN} and ${countMarkers(block, README_END)} ${README_END} markers.`);
  return block;
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
    skills.push({ id: parsed.data.metadata.id, name, description: parsed.data.description, category: parsed.data.metadata['terum-category'], author: parsed.data.metadata.author, latest, eval: await latestReceiptVerdict(clone, parsed.data.metadata.id, latest) });
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
  const team = parseJson(teamSchema, asText(source), 'team.json');
  const people = tree.paths().filter((path) => /^people\/[^/]+\.json$/.test(path)).sort().map((path) => {
    const value = tree.after(path);
    if (value === undefined) throw new Error(`Cannot generate README: ${path} was removed from the tree.`);
    return parseJson(personSchema, asText(value), path);
  });
  const names = tree.paths().filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path)).map((path) => path.split('/')[1]!).sort();
  const skills: ReadmeSkill[] = [];
  for (const name of names) {
    const source = tree.after(`skills/${name}/SKILL.md`);
    if (source === undefined) throw new Error(`Cannot generate README: skills/${name}/SKILL.md was removed from the tree.`);
    const parsed = parseSkillFrontmatter(asText(source));
    if (!parsed.ok) throw new Error(`Invalid skills/${name}/SKILL.md: ${parsed.error}`);
    const latest = latestBySkill === undefined ? await latestTree(runner, clone, name) : latestBySkill.get(name);
    if (latest === undefined) throw new Error(`Cannot generate README: skills/${name} is absent from the written tree.`);
    skills.push({ id: parsed.data.metadata.id, name, description: parsed.data.description, category: parsed.data.metadata['terum-category'], author: parsed.data.metadata.author, latest, eval: latestReceiptVerdictInTree(tree, parsed.data.metadata.id, latest) });
  }
  tree.set('README.md', applyReadme(asText(tree.after('README.md') ?? ''), generateReadme({ team: { name: team.name, remote, global: team.global, projects: team.projects, archived: team.archived }, people, skills })));
}

/** §5.4 / §12: display only the lexicographically newest valid receipt for this exact version. */
async function latestReceiptVerdict(clone: string, id: string, version: string): Promise<string | undefined> {
  const directory = join(clone, 'evals', id, version);
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const newest = names.filter((name) => name.endsWith('.json')).sort().at(-1);
  if (newest === undefined) return undefined;
  const source = await readFile(join(directory, newest), 'utf8');
  return receiptVerdict(source, id, version);
}

/** The safeWrite fallback must derive README exclusively from the in-memory post-image. */
function latestReceiptVerdictInTree(tree: MutableTree, id: string, version: string): string | undefined {
  const prefix = `evals/${id}/${version}/`;
  const newest = tree.paths(prefix).filter((path) => path.endsWith('.json')).sort().at(-1);
  if (newest === undefined) return undefined;
  const source = tree.after(newest);
  return source === undefined ? undefined : receiptVerdict(asText(source), id, version);
}

function receiptVerdict(source: string, id: string, version: string): string | undefined {
  try {
    const receipt = receiptSchema.safeParse(JSON.parse(source));
    if (!receipt.success || receipt.data.skill_id.toLowerCase() !== id.toLowerCase() || receipt.data.version !== version) return undefined;
    // §5.4: a partial receipt is never silently promoted to a full verdict.
    return receipt.data.execution_status === 'partial'
      ? `${receipt.data.verdict} — partial (${receipt.data.scored_rows}/${receipt.data.expected_rows} scored)`
      : receipt.data.verdict;
  } catch { return undefined; }
}

/**
 * Free repo text rendered inside a generated, marker-delimited artifact (team name, display names,
 * authors, skill fields, PR-comment lines): one line — CommonMark ends a line at LF, CRLF *or* a
 * bare CR, so all three collapse to a space — and never a comment opener — `<!--` becomes
 * `&lt;!--`, which Markdown renders identically but can no longer spell README_BEGIN/README_END or
 * the PR-comment anchor.
 */
export function inlineText(value: string): string { return noLinkLabel(oneLine(value)); }
function oneLine(value: string): string { return value.replace(/\r\n|[\r\n]/g, ' ').replace(/<!--/g, '&lt;!--'); }
/**
 * The link-label rule (rulings walk R14, 2026-09-06): `[` and `]` are escaped as the LAST step of both
 * sanitizers, so nothing committed to a team repo — a description, a category, an author, a team or
 * display name — can render as a Markdown link whose label lies about its destination, in any cell,
 * heading, roster line or the Action's PR comment. Normal text renders pixel-identically; a bare URL
 * still auto-links, only the label dies. Last, because a backslash escape written before cell()'s
 * backslash doubling would come out as a literal backslash and a live link.
 */
function noLinkLabel(value: string): string { return value.replace(/[[\]]/g, '\\$&'); }
/** Markdown table cells: oneLine() plus the pipe, the backslash that could un-escape it, and then the link brackets. */
function cell(value: string): string { return noLinkLabel(oneLine(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')); }

export function shortHash(value: string): string { return value === '—' ? value : value.slice(0, 8); }

function installRepository(remote: string): string | null { return githubOwnerRepo(remote); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function countMarkers(value: string, marker: string): number { return value.split(marker).length - 1; }
