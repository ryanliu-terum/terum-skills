import { describe, expect, it } from 'vitest';
import { guard, GuardContext, GuardError, guardRawPush, isMember } from '../guard.js';

const ID = '4e80fd2a-04bc-4d9f-88f7-a849d92879f1';
const ABSENT_ID = '11111111-1111-4111-8111-111111111111';
const RUN = '20260907T123456Z';
const HASH = 'a'.repeat(40);

/** Layout 3 (§3.1): `global` is deleted and `policy.publish` with it. */
const team = (overrides: Record<string, unknown> = {}) => JSON.stringify({ layout_version: 3, name: 't', categories: [], projects: { p: { remotes: ['github.com/a/p'], skills: [] } }, archived: [], policy: { skill_license: 'UNLICENSED' }, ...overrides });
/** Layout 2 — what row j's pre-image actually is, and what `teamSchema` refuses to parse. */
const legacyTeam = () => JSON.stringify({ layout_version: 2, name: 't', categories: [], global: [ID], projects: { p: { remotes: ['github.com/a/p'], skills: [] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } });
const skill = (id = ID, author = 'Me <me@x.test>') => `---\nname: x\ndescription: d\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: "${author}"\n  terum-category: docs\n---\n\n# x\n`;

type Changes = Record<string, [string | undefined, string | undefined]>;
const tree = (changes: Changes, unchanged: Record<string, string> = {}) => ({
  before: (path: string) => (path in changes ? changes[path]![0] : unchanged[path]),
  after: (path: string) => (path in changes ? changes[path]![1] : unchanged[path]),
  changedPaths: Object.keys(changes),
  // `makeTree` always supplies this, so a fixture without it models a tree that cannot exist — and
  // rows a' and g both fail closed without it, so omitting it would refuse every publish.
  paths: (prefix = '') => [...new Set([...Object.keys(unchanged), ...Object.keys(changes).filter((path) => changes[path]![1] !== undefined)])].filter((path) => path.startsWith(prefix)).sort(),
});
/** A tree that cannot enumerate its post-image at all: rows a' and g must both fail CLOSED on it. */
const pathlessTree = (changes: Changes, unchanged: Record<string, string> = {}) => ({
  before: (path: string) => (path in changes ? changes[path]![0] : unchanged[path]),
  after: (path: string) => (path in changes ? changes[path]![1] : unchanged[path]),
  changedPaths: Object.keys(changes),
});

/**
 * Row g resolves a receipt's uuid against the POST-IMAGE, so a receipt tree must expose `paths()`
 * over every version SKILL.md the commit leaves behind — added ones included.
 */
const receiptTree = (changes: Changes, unchanged: Record<string, string> = { 'skills/x/v1/SKILL.md': skill() }) => ({
  ...tree(changes, unchanged),
  paths: (prefix = '') => [...Object.keys(unchanged), ...Object.keys(changes).filter((path) => changes[path]![1] !== undefined)].filter((path) => path.startsWith(prefix)),
});
const refuse = (t: ReturnType<typeof tree>, c: GuardContext, path: string) => expect(() => guard(t, c)).toThrow(new RegExp(`refused ${path.replace(/[.]/g, '\\.')}`));

const publish: GuardContext = { action: 'publish', handle: 'me' };
const migrate: GuardContext = { action: 'migrate', handle: 'me' };

describe("row a' — a version folder is add-only, and ownership is never consulted", () => {
  // §14.1/OF-3, the clause the rest of this block cannot reach: every case above calls `tree()` with
  // no `unchanged` map, so the target version is never in the pre-image and the prefix property is
  // never exercised. Marked RESOLVED rev 8 in the open-findings list, which only ever meant the SPEC
  // text was corrected — the code shipped the per-path predicate with a comment asserting the
  // property it did not have.
  it("refuses adding a previously-absent file to a version that already exists, while admitting many files for a NEW version", () => {
    const committed = { 'skills/x/v1/SKILL.md': skill() };
    // The defect: `notes.md` is an ADD, so the per-path test admitted it — mutating a published
    // version's bytes and therefore its skillContentDigest, which §3.1 calls immutable and which
    // §5.1 step 7 compares against to decide whether to mint a new ordinal.
    refuse(tree({ 'skills/x/v1/notes.md': [undefined, 'n'] }, committed), publish, 'skills/x/v1/notes.md');
    // Eval assets are not a loophole: D9 makes them ordinary version bytes, so the same refusal holds.
    refuse(tree({ 'skills/x/v1/evals/cases/new.yaml': [undefined, 'task: t'] }, committed), publish, 'skills/x/v1/evals/cases/new.yaml');
    // And the property that must NOT regress: a whole new version lands in one commit, many files at
    // once, alongside the version that already exists.
    expect(() => guard(tree({
      'skills/x/v2/SKILL.md': [undefined, skill()],
      'skills/x/v2/references/deep/a.md': [undefined, 'aux'],
      'skills/x/v2/evals/triggers.yaml': [undefined, 'should_trigger: []'],
    }, committed), publish)).not.toThrow();
  });

  it('admits every kind of file publish puts in a NEW version folder', () => {
    expect(() => guard(tree({ 'skills/x/v1/SKILL.md': [undefined, skill()] }), publish)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/v12/references/deep/a.md': [undefined, 'aux'] }), publish)).not.toThrow();
    // D9: eval assets inside a version folder are ordinary version bytes. Row h is gone, not re-pointed.
    expect(() => guard(tree({ 'skills/x/v2/evals/triggers.yaml': [undefined, 'should_trigger: []'], 'skills/x/v2/evals/cases/happy.yaml': [undefined, 'task: t'] }), publish)).not.toThrow();
  });

  it('refuses a modification or a removal inside a version folder — immutability is an authorization rule, not a convention', () => {
    refuse(tree({ 'skills/x/v1/SKILL.md': [skill(), skill().replace('# x', '# y')] }), publish, 'skills/x/v1/SKILL.md');
    refuse(tree({ 'skills/x/v1/SKILL.md': [skill(), undefined] }), publish, 'skills/x/v1/SKILL.md');
    refuse(tree({ 'skills/x/v1/references/a.md': ['aux', 'edited'] }), publish, 'skills/x/v1/references/a.md');
  });

  it('refuses anything under skills/ that is not inside a v<N> folder', () => {
    refuse(tree({ 'skills/x/SKILL.md': [undefined, skill()] }), publish, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/v0/SKILL.md': [undefined, skill()] }), publish, 'skills/x/v0/SKILL.md');
    refuse(tree({ 'skills/x/v01/SKILL.md': [undefined, skill()] }), publish, 'skills/x/v01/SKILL.md');
    refuse(tree({ 'skills/x/v1': [undefined, 'not a folder'] }), publish, 'skills/x/v1');
  });

  it('is publish-only: no other verb may mint bytes', () => {
    for (const action of ['join', 'install', 'uninstall', 'team-remove', 'profile', 'project'] as const) {
      refuse(tree({ 'skills/x/v1/SKILL.md': [undefined, skill()] }), { action, handle: 'me' }, 'skills/x/v1/SKILL.md');
    }
  });

  it('D15: a version folder authored by someone else is still admitted — there is no committed author to compare against', () => {
    expect(() => guard(tree({ 'skills/x/v1/SKILL.md': [undefined, skill(ID, 'Other <o@x.test>')] }), publish)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/v1/SKILL.md': [undefined, skill(ID, 'Other <o@x.test>')] }), { ...publish, handle: 'someoneelse' })).not.toThrow();
  });
});

describe('row g — receipts are append-only testimony, written only by publish', () => {
  it('admits a correctly keyed receipt whose uuid names a skill in the post-image', () => {
    expect(() => guard(receiptTree({ [`evals/${ID}/v1/${RUN}.json`]: [undefined, '{}'] }), publish)).not.toThrow();
    // Skill uuids are case-tolerant: callers pass `metadata.id` verbatim.
    expect(() => guard(receiptTree({ [`evals/${ID.toUpperCase()}/v1/${RUN}.json`]: [undefined, '{}'] }), publish)).not.toThrow();
  });

  it('resolves the uuid against a version folder ADDED by this same commit', () => {
    expect(() => guard(receiptTree({ 'skills/x/v1/SKILL.md': [undefined, skill()], [`evals/${ID}/v1/${RUN}.json`]: [undefined, '{}'] }, {}), publish)).not.toThrow();
  });

  it('is a PER-PATH predicate: one publish commit legitimately carries a version, team.json, a people file and several receipts', () => {
    expect(() => guard(receiptTree({
      'skills/x/v2/SKILL.md': [undefined, skill()],
      'team.json': [team(), team({ projects: { p: { remotes: ['github.com/a/p'], skills: [ID] } } })],
      'people/me.json': ['{}', '{"a":1}'],
      'README.md': ['a', 'b'],
      [`evals/${ID}/v2/${RUN}.json`]: [undefined, '{}'],
      [`evals/${ID}/v2/20260907T123457Z.json`]: [undefined, '{}'],
    }, {}), publish)).not.toThrow();
  });

  it('refuses modifying or deleting committed evidence', () => {
    const path = `evals/${ID}/v1/${RUN}.json`;
    refuse(receiptTree({ [path]: ['{}', '{"changed":true}'] }), publish, path);
    refuse(receiptTree({ [path]: ['{}', undefined] }), publish, path);
  });

  it('refuses a malformed key, a uuid absent from the post-image, and the old tree-hash segment', () => {
    for (const path of [
      `evals/not-a-uuid/v1/${RUN}.json`,
      `evals/${ID}/${HASH}/${RUN}.json`,
      `evals/${ID}/v0/${RUN}.json`,
      `evals/${ID}/v1/not-a-run-id.json`,
      `evals/${ID}/../v1/${RUN}.json`,
      `evals/${ABSENT_ID}/v1/${RUN}.json`,
      `evals/${ID}/v1/${RUN}.json/extra`,
    ]) refuse(receiptTree({ [path]: [undefined, '{}'] }), publish, path);
  });

  it('refuses every other action, and a tree that cannot enumerate its post-image at all', () => {
    for (const action of ['join', 'install', 'uninstall', 'profile', 'project', 'team-remove'] as const) {
      refuse(receiptTree({ [`evals/${ID}/v1/${RUN}.json`]: [undefined, '{}'] }), { action, handle: 'me' }, `evals/${ID}/v1/${RUN}.json`);
    }
    refuse(pathlessTree({ [`evals/${ID}/v1/${RUN}.json`]: [undefined, '{}'] }, { 'skills/x/v1/SKILL.md': skill() }), publish, `evals/${ID}/v1/${RUN}.json`);
    // OF-3 made row a' depend on the same accessor, so it fails closed on such a tree too.
    refuse(pathlessTree({ 'skills/x/v9/SKILL.md': [undefined, skill()] }), publish, 'skills/x/v9/SKILL.md');
  });
});

describe('row b — people files', () => {
  it('admits only your own file, and only from the five verbs that write it', () => {
    for (const action of ['join', 'install', 'uninstall', 'profile', 'publish'] as const) {
      expect(() => guard(tree({ 'people/me.json': ['{}', '{"a":1}'] }), { action, handle: 'me' }), action).not.toThrow();
    }
    refuse(tree({ 'people/other.json': ['{}', '{}'] }), { action: 'join', handle: 'me' }, 'people/other.json');
    for (const action of ['project', 'team-remove'] as const) {
      refuse(tree({ 'people/me.json': ['{}', '{}'] }), { action, handle: 'me' }, 'people/me.json');
    }
  });

  it('compares handles lowercase, and refuses an invalid one outright', () => {
    expect(() => guard(tree({ 'people/me.json': ['{}', '{"a":1}'] }), { action: 'join', handle: 'ME' })).not.toThrow();
    expect(() => guard(tree({ 'people/me.json': ['{}', '{"a":1}'] }), { action: 'join', handle: 'bad handle' })).toThrow(/invalid handle/);
  });
});

describe('rows c, d, e — team.json', () => {
  it("row c: publish may change projects[].skills and nothing else", () => {
    expect(() => guard(tree({ 'team.json': [team(), team({ projects: { p: { remotes: ['github.com/a/p'], skills: [ID] } } })] }), publish)).not.toThrow();
    refuse(tree({ 'team.json': [team(), team({ projects: { p: { remotes: ['github.com/a/evil'], skills: [] } } })] }), publish, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ projects: {} })] }), publish, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ policy: { skill_license: 'MIT' } })] }), publish, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ categories: ['new'] })] }), publish, 'team.json');
  });

  it('row d: team remove appends exactly the target, and never the actor', () => {
    expect(() => guard(tree({ 'team.json': [team({ archived: ['a'] }), team({ archived: ['a', 'x'] })] }), { action: 'team-remove', handle: 'me', targetHandle: 'x' })).not.toThrow();
    expect(() => guard(tree({ 'team.json': [team(), team({ archived: ['alice'] })] }), { action: 'team-remove', handle: 'Admin', targetHandle: 'Alice' })).not.toThrow();
    refuse(tree({ 'team.json': [team({ archived: ['a'] }), team({ archived: ['x', 'a'] })] }), { action: 'team-remove', handle: 'me', targetHandle: 'x' }, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ archived: ['me'] })] }), { action: 'team-remove', handle: 'me', targetHandle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team({ archived: ['x'] }), team({ archived: ['x', 'x'] })] }), { action: 'team-remove', handle: 'me', targetHandle: 'x' }, 'team.json');
  });

  it('row e: join removes exactly its own handle — a set difference, not a length check', () => {
    expect(() => guard(tree({ 'team.json': [team({ archived: ['a', 'me', 'b'] }), team({ archived: ['a', 'b'] })] }), { action: 'join', handle: 'me' })).not.toThrow();
    refuse(tree({ 'team.json': [team(), team({ archived: ['other'] })] }), { action: 'join', handle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team({ archived: ['other'] }), team({ archived: [] })] }), { action: 'join', handle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team({ archived: ['me', 'x'] }), team({ archived: ['y'] })] }), { action: 'join', handle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team({ archived: ['me'] }), team({ archived: [], categories: ['sneaked'] })] }), { action: 'join', handle: 'me' }, 'team.json');
    expect(() => guard(tree({ 'team.json': [team(), undefined] }), { action: 'join', handle: 'me' })).toThrow(/missing team\.json/);
  });
});

describe('row i — project create adds one key, born empty', () => {
  const P = { remotes: ['github.com/a/p'], skills: [] };
  const create: GuardContext = { action: 'project', handle: 'me' };

  it('admits exactly one new empty project, with or without a remote', () => {
    expect(() => guard(tree({ 'team.json': [team(), team({ projects: { p: P, q: { remotes: [], skills: [] } } })] }), create)).not.toThrow();
    expect(() => guard(tree({ 'team.json': [team(), team({ projects: { p: P, q: { remotes: ['github.com/a/q'], skills: [] } } })] }), create)).not.toThrow();
  });

  it('refuses a create that also endorses, edits another project, or renames one', () => {
    refuse(tree({ 'team.json': [team(), team({ projects: { p: P, q: { remotes: [], skills: [ID] } } })] }), create, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ categories: ['c'], projects: { p: P, q: { remotes: [], skills: [] } } })] }), create, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ projects: { p: { remotes: ['github.com/a/other'], skills: [] }, q: { remotes: [], skills: [] } } })] }), create, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ projects: { q: { remotes: [], skills: [] } } })] }), create, 'team.json');
  });

  it('refuses two keys at once, a key with an extra field, and more than one remote', () => {
    refuse(tree({ 'team.json': [team(), team({ projects: { p: P, q: { remotes: [], skills: [] }, r: { remotes: [], skills: [] } } })] }), create, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ projects: { p: P, q: { remotes: [], skills: [], owner: 'me' } } })] }), create, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ projects: { p: P, q: { remotes: ['github.com/a/q', 'github.com/a/q2'], skills: [] } } })] }), create, 'team.json');
  });

  it('is the only action that may create a key, and creates nothing on its own', () => {
    refuse(tree({ 'team.json': [team(), team({ projects: { p: P, q: { remotes: [], skills: [] } } })] }), publish, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ archived: ['x'] })] }), create, 'team.json');
  });
});

describe('row j — the §13 migration', () => {
  it('MUST run before the team.json branch: the pre-image is layout 2, which teamSchema refuses to parse', () => {
    expect(() => guard(tree({ 'team.json': [legacyTeam(), team()] }), migrate)).not.toThrow();
    // The proof that ordering is what admits it: any other action on the same diff dies in parseTeam.
    expect(() => guard(tree({ 'team.json': [legacyTeam(), team()] }), publish)).toThrow(GuardError);
  });

  it('admits the moves §13 actually makes, keyed by direction', () => {
    // step 1 — layout-2 bytes out, v1 in
    expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(), undefined], 'skills/x/v1/SKILL.md': [undefined, skill()] }), migrate)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/references/a.md': ['aux', undefined], 'skills/x/v1/references/a.md': [undefined, 'aux'] }), migrate)).not.toThrow();
    // step 3 — tree-hash receipts re-keyed to v1, or parked in D7's archive
    expect(() => guard(tree({ [`evals/${ID}/${HASH}/${RUN}.json`]: ['{}', undefined], [`evals/${ID}/v1/${RUN}.json`]: [undefined, '{}'] }), migrate)).not.toThrow();
    expect(() => guard(tree({ [`evals/${ID}/archive/${HASH}/${RUN}.json`]: [undefined, '{}'] }), migrate)).not.toThrow();
    // step 5 — EVERY member's people file, not just the actor's, plus the regenerated README
    expect(() => guard(tree({ 'people/other.json': ['{}', '{"a":1}'], 'people/me.json': ['{}', '{"a":1}'], 'README.md': ['a', 'b'] }), migrate)).not.toThrow();
  });

  it('does not open immutability: a removal inside a version folder stays refused even here', () => {
    refuse(tree({ 'skills/x/v1/SKILL.md': [skill(), undefined] }), migrate, 'skills/x/v1/SKILL.md');
    refuse(tree({ 'skills/x/v2/references/a.md': ['aux', undefined] }), migrate, 'skills/x/v2/references/a.md');
  });

  it('mints only v1, modifies only the three file shapes it rewrites, and adds no new member', () => {
    refuse(tree({ 'skills/x/v2/SKILL.md': [undefined, skill()] }), migrate, 'skills/x/v2/SKILL.md');
    refuse(tree({ 'people/other.json': [undefined, '{}'] }), migrate, 'people/other.json');
    refuse(tree({ 'skills/x/v1/SKILL.md': [skill(), skill().replace('# x', '# y')] }), migrate, 'skills/x/v1/SKILL.md');
    refuse(tree({ '.github/workflows/terum-skills.yml': ['a', 'b'] }), migrate, '.github/workflows/terum-skills.yml');
  });

  it('opens nothing for any other verb', () => {
    refuse(tree({ 'skills/x/SKILL.md': [skill(), undefined] }), publish, 'skills/x/SKILL.md');
    refuse(tree({ 'people/other.json': ['{}', '{"a":1}'] }), publish, 'people/other.json');
    refuse(tree({ [`evals/${ID}/archive/${HASH}/${RUN}.json`]: [undefined, '{}'] }), publish, `evals/${ID}/archive/${HASH}/${RUN}.json`);
  });
});

describe('row f and everything else', () => {
  it('README is regenerable from any action; any other path is refused', () => {
    expect(() => guard(tree({ 'README.md': ['a', 'b'] }), { action: 'install', handle: 'me' })).not.toThrow();
    refuse(tree({ 'evals/x.json': [undefined, '{}'] }), publish, 'evals/x.json');
    refuse(tree({ '.github/workflows/terum-skills.yml': ['a', 'b'] }), publish, '.github/workflows/terum-skills.yml');
    expect(() => guard(tree({ 'outside.txt': [undefined, 'x'] }), publish)).toThrow(GuardError);
  });
});

describe('guardRawPush — D12 clone-local half', () => {
  it('stands open to every row the pusher could have taken as themselves', () => {
    expect(() => guardRawPush(tree({ 'README.md': ['a', 'b'] }), { handle: 'me' })).not.toThrow();
    expect(() => guardRawPush(tree({ 'people/me.json': ['{}', '{"a":1}'] }), { handle: 'ME' })).not.toThrow();
    expect(() => guardRawPush(tree({ 'team.json': [team(), team({ projects: { p: { remotes: ['github.com/a/p'], skills: [ID] } } })] }), { handle: 'me' })).not.toThrow();
    expect(() => guardRawPush(tree({ 'team.json': [team(), team({ archived: ['someoneelse'] })] }), { handle: 'me' })).not.toThrow();
    expect(() => guardRawPush(tree({ 'team.json': [team({ archived: ['me'] }), team({ archived: [] })] }), { handle: 'me' })).not.toThrow();
  });

  it("D15: skills/** is refused outright — a version is minted, never written", () => {
    expect(() => guardRawPush(tree({ 'skills/x/v1/SKILL.md': [undefined, skill()] }), { handle: 'me' })).toThrow(/skill versions are minted by/);
    // Row h is gone with the rest: a hand-pushed eval asset is a hand-pushed skill byte.
    expect(() => guardRawPush(tree({ 'skills/x/evals/cases/happy.yaml': [undefined, 'task: t'] }), { handle: 'me' })).toThrow(/skill versions are minted by/);
    expect(() => guardRawPush(tree({ [`evals/${ID}/v1/${RUN}.json`]: [undefined, '{}'] }), { handle: 'me' })).toThrow(/eval receipts are written by/);
  });

  it('refuses another member, archiving yourself, and names a stale hook for what it is', () => {
    expect(() => guardRawPush(tree({ 'people/other.json': ['{}', '{}'] }), { handle: 'me' })).toThrow(GuardError);
    expect(() => guardRawPush(tree({ 'team.json': [team(), team({ archived: ['me'] })] }), { handle: 'me' })).toThrow(/only the skill lists/);
    expect(() => guardRawPush(tree({ '.github/workflows/terum-skills.yml': ['a', 'b'] }), { handle: 'me' })).toThrow(/predates the repository's layout/);
  });
});

describe('membership predicate (§4.1)', () => {
  const me = JSON.stringify({ handle: 'me', display_name: 'Me', email: 'me@x.test', github: 'me', bio: '', installed: [], declined: [] });
  it('requires the people file AND an unarchived handle, and never throws on garbage', () => {
    expect(isMember(me, team(), 'me')).toBe(true);
    expect(isMember(me, team({ archived: ['me'] }), 'me')).toBe(false);
    expect(isMember(undefined, team(), 'me')).toBe(false);
    expect(isMember('not json', team(), 'me')).toBe(false);
    expect(isMember(me, team(), 'other')).toBe(false);
    // Same normalization as guard(): a mixed-case caller is a member, an archived one is not, an invalid one never throws.
    expect(isMember(me, team(), 'Me')).toBe(true);
    expect(isMember(me, team({ archived: ['me'] }), 'ME')).toBe(false);
    expect(isMember(me, team(), 'bad handle')).toBe(false);
  });
});
