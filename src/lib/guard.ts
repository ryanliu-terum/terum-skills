import { invocation, type InvocationForm } from './invocation.js';
import { handleSchema, parseJson, parseSkillFrontmatter, personSchema, Team, teamSchema } from './schema.js';

/**
 * §6.0 write guard — the authorization model. A diff may touch only the rows a–i below, and
 * nothing else is writable. It runs inside the safeWrite loop against the tree the mutation
 * actually produced; teamRepo additionally proves the staged diff equals that tree's changes.
 */
export type GuardAction = 'join' | 'install' | 'uninstall' | 'publish' | 'team-remove' | 'profile' | 'project' | 'migrate';

export interface GuardContext {
  action: GuardAction;
  /** The actor's handle for this team (§5.4 `teams.<team>.handle`). */
  handle: string;
  /** `team remove` only: the handle being archived. */
  targetHandle?: string;
}

export interface GuardTree {
  before(path: string): string | Buffer | undefined;
  after(path: string): string | Buffer | undefined;
  readonly changedPaths: readonly string[];
  /** Post-image paths, needed by row g to resolve a receipt UUID against a skill's metadata. */
  paths?(prefix?: string): readonly string[];
}

export class GuardError extends Error {
  constructor(message: string) { super(message); this.name = 'GuardError'; }
}

/**
 * Every verb that writes a people file. **Edit this list in exactly one place and re-list every verb
 * that writes the file in the same change** — a mismatch throws `Write guard refused
 * people/<handle>.json for install` on every install. `'publish'` is here because the profile prompt
 * writes the file (§5.1 step 10). `'migrate'` is deliberately ABSENT: its people-file writes touch
 * *every* member's file (§13 step 5) while row b only ever admits the actor's own handle, so they are
 * admitted by row j, which runs first.
 */
const PEOPLE_ACTIONS: readonly GuardAction[] = ['join', 'install', 'uninstall', 'profile', 'publish'];

/** Row a′: a published skill's bytes. Add-only — this is what makes a version immutable at the authorization layer. */
const VERSION_PATH = /^skills\/([^/]+)\/v[1-9][0-9]*\/.+$/;
/** The version folder a path lives in, trailing slash included — OF-3's unit of immutability. */
const VERSION_PREFIX = /^skills\/[^/]+\/v[1-9][0-9]*\//;
/** The SKILL.md of some version, used by row g to resolve a receipt uuid against a skill's metadata. */
const VERSION_SKILL_MD = /^skills\/[^/]+\/v[1-9][0-9]*\/SKILL\.md$/;
// Skill uuids are case-tolerant (z.uuid() admits both; callers pass metadata.id verbatim). The version
// segment is now the `v<N>` folder name (§3.4), not the old 40-char tree hash.
const RECEIPT_PATH = /^evals\/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})\/(v[1-9][0-9]*)\/(\d{8}T\d{6}Z)\.json$/;

export function guard(tree: GuardTree, rawContext: GuardContext): void {
  // Handles are stored lowercase (§5.4); compare like with like so a mixed-case caller is not refused.
  const context: GuardContext = { ...rawContext, handle: normalizeHandle(rawContext.handle), targetHandle: rawContext.targetHandle === undefined ? undefined : normalizeHandle(rawContext.targetHandle) };
  for (const path of tree.changedPaths) {
    // Row j MUST be first. Placed after the team.json branch it is unreachable, because guardTeam
    // claims team.json and would refuse a migrate diff before this clause ever ran.
    if (context.action === 'migrate' && permitsMigration(tree, path)) continue; // row j
    if (context.action === 'publish' && permitsVersionFolder(tree, path)) continue; // row a′
    if (context.action === 'publish' && permitsReceipt(tree, path)) continue; // row g
    if (path === 'README.md') continue; // row f: generated, regenerated not hand-edited
    if (path === `people/${context.handle}.json` && PEOPLE_ACTIONS.includes(context.action)) continue; // row b
    if (path === 'team.json') { guardTeam(tree, context); continue; } // rows c, d, e, i
    throw new GuardError(`Write guard refused ${path} for ${context.action} by ${context.handle}`);
  }
}

/**
 * Row a′: publish writes a version folder. A path under `skills/<name>/v<N>/` is permitted only when
 * it is **added** — never modified, never removed. This is what makes a version immutable at the
 * authorization layer rather than by convention, and it is why there is no add-or-replace row
 * anywhere: a version folder is add-only, full stop.
 *
 * Ownership is not consulted. Under this refactor `publish` is the only way bytes reach the team and
 * it always mints a NEW folder, so there is no committed author to compare against — which is why
 * row a, `ownsSkill`, `authorOf` and `canonicalSkillDigest` are all deleted (D15).
 *
 * Eval cases land here too (D9): `v<N>/evals/triggers.yaml` and `v<N>/evals/cases/*.yaml` are
 * ordinary version bytes, admitted by this row like every other file. Row h is gone, not re-pointed.
 */
function permitsVersionFolder(tree: GuardTree, path: string): boolean {
  if (!VERSION_PATH.test(path)) return false;
  if (tree.before(path) !== undefined || tree.after(path) === undefined) return false;
  // OF-3: the per-path test above is NOT immutability. It refuses MODIFYING a file that already
  // exists, but happily ADDS a previously-absent file into a version folder that is already
  // committed — changing a published version's bytes and therefore its `skillContentDigest`, which
  // §3.1 calls immutable and which §5.1 step 7 compares against to decide whether to mint a new
  // ordinal. So the PREFIX, not the path, is the unit: many files added together for a NEW version
  // are admitted; one file added to an EXISTING version is refused.
  const prefix = VERSION_PREFIX.exec(path)?.[0];
  if (prefix === undefined) return false;
  if (tree.paths === undefined) return false; // fail CLOSED without the accessor, exactly as row g does
  return !tree.paths(prefix).some((sibling) => tree.before(sibling) !== undefined);
}

/**
 * Row g: testimony is append-only, and it now belongs to `publish` — the only verb that writes a
 * receipt, because a local eval never commits (§6.3).
 *
 * **Append-only is a PER-PATH predicate, not a whole-commit one.** The old `changedPaths.length !== 1`
 * clause is deliberately gone: a publish commit legitimately writes a version folder, the team.json
 * skill list, a people file and N receipts at once, so requiring a lone changed path would refuse
 * every real publish.
 *
 * The uuid must still name a skill in the post-image; the candidate SKILL.md is now the one inside a
 * version folder.
 */
function permitsReceipt(tree: GuardTree, path: string): boolean {
  if (tree.before(path) !== undefined || tree.after(path) === undefined) return false;
  const match = RECEIPT_PATH.exec(path);
  if (!match || tree.paths === undefined) return false;
  const id = match[1]!.toLowerCase();
  return tree.paths('skills/')
    .filter((candidate) => VERSION_SKILL_MD.test(candidate))
    .some((candidate) => {
      const source = tree.after(candidate);
      const parsed = source === undefined ? undefined : parseSkillFrontmatter(asText(source));
      return parsed?.ok === true && parsed.data.metadata.id.toLowerCase() === id;
    });
}

/** Row j's add arm: a migrated skill's bytes land at v1, and its receipts under v1 or D7's archive. */
const MIGRATE_ADD = [/^skills\/[^/]+\/v1\/.+$/, /^evals\/[0-9a-fA-F-]{36}\/(v1|archive\/[0-9a-f]{40})\/\d{8}T\d{6}Z\.json$/];
/** Row j's remove arm: every layout-2 file step 1 moves, and the tree-hash receipts step 3 re-keys. */
const MIGRATE_REMOVE = [/^skills\/[^/]+\/(?!v[1-9][0-9]*\/).+$/, /^evals\/[0-9a-fA-F-]{36}\/[0-9a-f]{40}\/\d{8}T\d{6}Z\.json$/];
/** Row j's modify arm: §13 step 5 rewrites EVERY member's people file, not just the actor's. */
const MIGRATE_MODIFY = [/^team\.json$/, /^README\.md$/, /^people\/[^/]+\.json$/];

/**
 * Row j — the §13 migration, and the only row that may remove anything under `skills/`.
 *
 * It is defined by the diff §13 actually produces, keyed by DIRECTION, because the guard sees every
 * move **twice**: `MutableTree.remove()` stores `undefined` in the overlay and `changedPaths` lists
 * removals alongside adds, so a destination-only admit list would refuse the migration's own commit.
 *
 * **It must not call `parseTeam`.** The pre-image is layout 2 and the layout-3 `teamSchema` rejects
 * it, so the guard would refuse the very file the migration exists to rewrite. The check is
 * structural — path shapes and direction only.
 *
 * **A removal under `skills/<name>/v<N>/` stays refused even here.** The migration row does not open
 * immutability; the negative lookahead in MIGRATE_REMOVE is what keeps a version folder add-only.
 *
 * The `archive/` arm is not optional: D7's archive path is in the locked layout (§3.1) and is
 * admitted by no other row, so without it the migration's own push is refused by the guard it just
 * passed.
 */
function permitsMigration(tree: GuardTree, path: string): boolean {
  const before = tree.before(path) !== undefined;
  const after = tree.after(path) !== undefined;
  if (!before && after) return MIGRATE_ADD.some((rule) => rule.test(path));
  if (before && !after) return MIGRATE_REMOVE.some((rule) => rule.test(path));
  if (before && after) return MIGRATE_MODIFY.some((rule) => rule.test(path));
  return false;
}

/**
 * D12's clone-local half, run by the pre-push hook. A raw `git push` cannot say which verb it is, so
 * every row any verb could take stands open to the pusher's own identity — README (f), their own
 * people file (b), and a team.json change shaped like publish (c), team remove (d) or a rejoin (e).
 *
 * **Under layout 3 `skills/**` is refused outright (D15).** A version is minted, not written: only
 * `publish` can produce one, because only `publish` digests the folder, compares it against every
 * existing version and picks the next ordinal. A hand push that lands bytes in `skills/<name>/v<N>/`
 * bypasses all of that and produces a version whose number means nothing. `evals/**` stays refused as
 * it always was.
 *
 * Accidents, not abuse: the hook is bypassable and the bypass is attributed.
 */
export function guardRawPush(tree: GuardTree, identity: { handle: string }, form?: InvocationForm): void {
  const handle = normalizeHandle(identity.handle);
  for (const path of tree.changedPaths) {
    if (path === 'README.md') continue;
    if (path === `people/${handle}.json`) continue;
    if (path === 'team.json') {
      if (teamChangeOpenToRawPush(tree, handle)) continue;
      throw new GuardError('Push guard refused team.json: only the skill lists (publish), an archive of someone else (team remove), or your own rejoin may change it');
    }
    if (/^skills\//.test(path)) throw new GuardError(`Push guard refused ${path}: skill versions are minted by \`${invocation(form, 'publish')}\`; a hand push cannot mint one`);
    if (/^evals\//.test(path)) throw new GuardError(`Push guard refused ${path}: eval receipts are written by \`${invocation(form, 'publish')}\` when it attaches a run to a version`);
    // An unrecognised top-level shape almost always means this hook predates the repository it is
    // guarding — `installPushGuard` runs at clone and join time only, and the hook body launches the
    // CLI version that armed it (§4.3), so an upgraded repo meets a frozen guard. Say that, rather
    // than reporting it as someone else's file and advising `--no-verify`, which teaches the user to
    // disable the guard permanently.
    throw new GuardError(`Push guard refused ${path}: this clone's push guard predates the repository's layout; re-run \`${invocation(form, 'team join', '<remote>')}\` to re-arm it`);
  }
}

function teamChangeOpenToRawPush(tree: GuardTree, handle: string): boolean {
  let before: Team; let after: Team;
  try { before = parseTeam(tree.before('team.json')); after = parseTeam(tree.after('team.json')); } catch { return false; }
  if (onlySkillListsChanged(before, after) || archivedRemovedOnly(before, after, handle)) return true;
  const appended = after.archived.filter((item) => !before.archived.includes(item));
  return appended.length === 1 && appended[0] !== handle && archivedAppendedOnly(before, after, appended[0]!);
}

function normalizeHandle(handle: string): string {
  const parsed = handleSchema.safeParse(handle);
  if (!parsed.success) throw new GuardError(`Write guard refused an invalid handle ${JSON.stringify(handle)}`);
  return parsed.data;
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
  if (context.action === 'project' && oneEmptyProjectAdded(before, after)) return; // row i
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

/** Row c: `projects[].skills` only — project keys, remotes, and every other field are untouchable (row i creates a key; nothing edits one). The `global` branch is deleted with the field (§4.1). */
function onlySkillListsChanged(before: Team, after: Team): boolean {
  if (!sameExcept(before, after, ['projects'])) return false;
  const withoutSkills = (team: Team) => Object.fromEntries(Object.entries(team.projects).map(([key, project]) => {
    const rest: Record<string, unknown> = { ...project };
    delete rest.skills;
    return [key, rest];
  }));
  return same(withoutSkills(before), withoutSkills(after));
}

/**
 * Row i: exactly one new project key, born empty — `{ remotes: [] | [one], skills: [] }`. Every
 * pre-existing project and every other team.json field is byte-identical, so a create can never
 * carry an endorsement, a rename (an add plus a removal), or a second project. The record schema is
 * `.passthrough()`, so an unknown extra field is refused here rather than admitted by the parse.
 */
function oneEmptyProjectAdded(before: Team, after: Team): boolean {
  if (!sameExcept(before, after, ['projects'])) return false;
  const beforeKeys = Object.keys(before.projects);
  const added = Object.keys(after.projects).filter((key) => !Object.hasOwn(before.projects, key));
  if (added.length !== 1 || Object.keys(after.projects).length !== beforeKeys.length + 1) return false;
  if (beforeKeys.some((key) => !same(before.projects[key], after.projects[key]))) return false;
  const born = after.projects[added[0]!]!;
  if (!same(born.skills, []) || born.remotes.length > 1) return false;
  return same(Object.keys(born).sort(), ['remotes', 'skills']);
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
