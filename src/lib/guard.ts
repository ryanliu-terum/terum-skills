import { handleSchema, parseJson, parseSkillFrontmatter, personSchema, Team, teamSchema } from './schema.js';
import { canonicalSkillDigest } from './skills.js';

/**
 * §6.0 write guard — the authorization model. A diff may touch only the rows a–f below, and
 * nothing else is writable. It runs inside the safeWrite loop against the tree the mutation
 * actually produced; teamRepo additionally proves the staged diff equals that tree's changes.
 */
export type GuardAction = 'share' | 'sync' | 'join' | 'install' | 'uninstall' | 'publish' | 'team-remove';

export interface GuardContext {
  action: GuardAction;
  /** The actor's handle for this team (§5.4 `teams.<team>.handle`). */
  handle: string;
  /** The actor's `Name <email>` (§5.3 metadata.author); required for skill-folder writes. */
  author?: string;
  /** A config-driven §5.3 managed-author refresh may replace this committed author with `author`. */
  previousAuthor?: string;
  /** `team remove` only: the handle being archived. */
  targetHandle?: string;
}

export interface GuardTree {
  before(path: string): string | Buffer | undefined;
  after(path: string): string | Buffer | undefined;
  readonly changedPaths: readonly string[];
}

export class GuardError extends Error {
  constructor(message: string) { super(message); this.name = 'GuardError'; }
}

const PEOPLE_ACTIONS: readonly GuardAction[] = ['join', 'install', 'uninstall', 'sync'];
const SKILL_ACTIONS: readonly GuardAction[] = ['share', 'sync'];

export function guard(tree: GuardTree, rawContext: GuardContext): void {
  // Handles are stored lowercase (§5.4); compare like with like so a mixed-case caller is not refused.
  const context: GuardContext = { ...rawContext, handle: normalizeHandle(rawContext.handle), targetHandle: rawContext.targetHandle === undefined ? undefined : normalizeHandle(rawContext.targetHandle) };
  for (const path of tree.changedPaths) {
    if (path === 'README.md') continue; // row f: generated, regenerated not hand-edited
    if (path === `people/${context.handle}.json` && PEOPLE_ACTIONS.includes(context.action)) continue; // row b
    if (path === 'team.json') { guardTeam(tree, context); continue; } // rows c, d, e
    const skill = /^skills\/([^/]+)\/.+$/.exec(path);
    if (skill && SKILL_ACTIONS.includes(context.action) && ownsSkill(tree, skill[1]!, context)) continue; // row a
    throw new GuardError(`Write guard refused ${path} for ${context.action} by ${context.handle}`);
  }
}

function normalizeHandle(handle: string): string {
  const parsed = handleSchema.safeParse(handle);
  if (!parsed.success) throw new GuardError(`Write guard refused an invalid handle ${JSON.stringify(handle)}`);
  return parsed.data;
}

/**
 * Row a. Ownership is metadata, not geography: the committed SKILL.md's `metadata.author` decides
 * who may touch an existing folder (the pre-image, never the post-image a diff can rewrite), and a
 * new folder may only be created carrying the actor's own author line. A write may not hand the
 * folder to someone else either.
 */
function ownsSkill(tree: GuardTree, name: string, context: GuardContext): boolean {
  if (!context.author) return false;
  const me = normalizeAuthor(context.author);
  // Only sync's §5.3 managed-field refresh may additionally present the committed author it is
  // replacing. It is deliberately narrower than ordinary ownership: only SKILL.md may change and
  // its canonical content must be identical before and after.
  const previousAuthor = context.previousAuthor === undefined || context.action !== 'sync' ? undefined : normalizeAuthor(context.previousAuthor);
  const skillFile = `skills/${name}/SKILL.md`;
  const before = tree.before(skillFile);
  const after = tree.after(skillFile);
  if (before === undefined && after === undefined) return false;
  const beforeAuthor = before === undefined ? undefined : authorOf(before);
  if (beforeAuthor !== undefined && beforeAuthor !== me) {
    if (before === undefined || beforeAuthor !== previousAuthor || after === undefined || tree.changedPaths.length !== 1 || tree.changedPaths[0] !== skillFile) return false;
    if (canonicalSkillDigest(before) !== canonicalSkillDigest(after)) return false;
  }
  if (after !== undefined && authorOf(after) !== me) return false;
  return true;
}

function authorOf(source: string | Buffer): string | null {
  const parsed = parseSkillFrontmatter(asText(source));
  return parsed.ok ? normalizeAuthor(parsed.data.metadata.author) : null;
}

export function normalizeAuthor(author: string): string {
  return author.trim().replace(/\s+/g, ' ').toLowerCase();
}

function guardTeam(tree: GuardTree, context: GuardContext): void {
  const before = parseTeam(tree.before('team.json'));
  const after = parseTeam(tree.after('team.json'));
  if (context.action === 'publish' && onlySkillListsChanged(before, after)) return; // row c
  if (context.action === 'team-remove' && context.targetHandle && context.targetHandle !== context.handle && archivedAppendedOnly(before, after, context.targetHandle)) return; // row d
  if (context.action === 'join' && archivedRemovedOnly(before, after, context.handle)) return; // row e
  throw new GuardError(`Write guard refused team.json for ${context.action} by ${context.handle}`);
}

function parseTeam(value: string | Buffer | undefined): Team {
  if (value === undefined) throw new GuardError('Write guard cannot authorize a missing team.json');
  try { return parseJson(teamSchema, asText(value), 'team.json'); }
  catch (error) { throw new GuardError(error instanceof Error ? error.message : String(error)); }
}

function asText(value: string | Buffer): string { return Buffer.isBuffer(value) ? value.toString('utf8') : value; }

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function sameExcept(before: Team, after: Team, permitted: readonly string[]): boolean {
  const scrub = (team: Team) => Object.fromEntries(Object.entries(team).filter(([key]) => !permitted.includes(key)));
  return same(scrub(before), scrub(after));
}

/** Row c: `global` and `projects[].skills` only — project keys, remotes, and every other field are untouchable. */
function onlySkillListsChanged(before: Team, after: Team): boolean {
  if (!sameExcept(before, after, ['global', 'projects'])) return false;
  const withoutSkills = (team: Team) => Object.fromEntries(Object.entries(team.projects).map(([key, project]) => {
    const rest: Record<string, unknown> = { ...project };
    delete rest.skills;
    return [key, rest];
  }));
  return same(withoutSkills(before), withoutSkills(after));
}

/** Row d: `archived` becomes exactly `before.archived + [target]`; a handle already archived cannot be appended again. */
function archivedAppendedOnly(before: Team, after: Team, target: string): boolean {
  return sameExcept(before, after, ['archived']) && !before.archived.includes(target) && same(after.archived, [...before.archived, target]);
}

/** Row e: `archived` becomes exactly `before.archived` minus the actor's own handle — a set difference, never a length check. */
function archivedRemovedOnly(before: Team, after: Team, handle: string): boolean {
  return sameExcept(before, after, ['archived']) && before.archived.includes(handle) && same(after.archived, before.archived.filter((item) => item !== handle));
}

/** §4.1 membership: active iff the people file exists (and parses as that handle) AND the handle is not archived. */
export function isMember(personJson: string | undefined, teamJson: string, handle: string): boolean {
  if (personJson === undefined) return false;
  // Same normalization as guard(): stored handles are lowercase, so compare like with like; an invalid handle is simply not a member.
  const normalized = handleSchema.safeParse(handle);
  if (!normalized.success) return false;
  try {
    const person = parseJson(personSchema, personJson, `people/${normalized.data}.json`);
    if (person.handle !== normalized.data) return false;
    return !parseJson(teamSchema, teamJson, 'team.json').archived.includes(normalized.data);
  } catch {
    return false;
  }
}
