import { describe, expect, it } from 'vitest';
import { guard, GuardContext, GuardError, isMember } from '../guard.js';

const ID = '4e80fd2a-04bc-4d9f-88f7-a849d92879f1';
const team = (overrides: Record<string, unknown> = {}) => JSON.stringify({ layout_version: 2, name: 't', categories: [], global: [], projects: { p: { remotes: ['github.com/a/p'], skills: [] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' }, ...overrides });
const skill = (author: string) => `---\nname: x\ndescription: d\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: "${author}"\n  terum-category: docs\n---\n\n# x\n`;
type Changes = Record<string, [string | undefined, string | undefined]>;
const tree = (changes: Changes, unchanged: Record<string, string> = {}) => ({
  before: (path: string) => (path in changes ? changes[path]![0] : unchanged[path]),
  after: (path: string) => (path in changes ? changes[path]![1] : unchanged[path]),
  changedPaths: Object.keys(changes),
});
const ME = 'Me <me@x.test>';
const connect: GuardContext = { action: 'connect', handle: 'me', author: ME };
const receiptPath = (id = ID, hash = 'a'.repeat(40), runId = '20260907T123456Z') => `evals/${id}/${hash}/${runId}.json`;
const receiptTree = (changes: Changes) => ({
  ...tree(changes, { 'skills/x/SKILL.md': skill(ME) }),
  paths: (prefix = '') => ['skills/x/SKILL.md'].filter((path) => path.startsWith(prefix)),
});
const refuse = (t: ReturnType<typeof tree>, c: GuardContext, path: string) => expect(() => guard(t, c)).toThrow(new RegExp(`refused ${path.replace(/[.]/g, '\\.')}`));

describe('row a — skill folders, ownership by metadata.author', () => {
  it('allows the author to edit, add aux files to, and delete their own skill', () => {
    expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME).replace('# x', '# y')] }), connect)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/references/a.md': [undefined, 'aux'] }, { 'skills/x/SKILL.md': skill(ME) }), connect)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(ME), undefined] }), connect)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/SKILL.md': [undefined, skill(ME)] }), { ...connect, action: 'sync' })).not.toThrow();
  });

  it('compares authors after normalization: case, doubled and surrounding whitespace are not identity', () => {
    for (const spelling of ['me <ME@X.test>', '  Me  <me@x.test>  ', 'ME <ME@X.TEST>']) {
      expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME).replace('# x', '# y')] }), { ...connect, author: spelling }), spelling).not.toThrow();
      expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(spelling), skill(spelling).replace('# x', '# y')] }), connect), spelling).not.toThrow();
    }
    refuse(tree({ 'skills/x/SKILL.md': [skill('Me <me@x.test>'), skill('Me <me@x.test>')] }), { ...connect, author: 'Me <me@y.test>' }, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill('Me <me@x.test>'), skill('Me <me@x.test>')] }), { ...connect, author: 'Mel <me@x.test>' }, 'skills/x/SKILL.md');
  });

  it("rejects another author's folder, including aux files and a folder with no SKILL.md", () => {
    refuse(tree({ 'skills/x/SKILL.md': [skill('Other <o@x.test>'), skill('Other <o@x.test>')] }), connect, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/references/a.md': [undefined, 'aux'] }, { 'skills/x/SKILL.md': skill('Other <o@x.test>') }), connect, 'skills/x/references/a.md');
    refuse(tree({ 'skills/x/references/a.md': [undefined, 'aux'] }), connect, 'skills/x/references/a.md');
  });

  it('reads ownership from the committed pre-image: a diff cannot grant itself authorship or hand the folder away', () => {
    refuse(tree({ 'skills/x/SKILL.md': [skill('Other <o@x.test>'), skill(ME)] }), connect, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill(ME), skill('Other <o@x.test>')] }), connect, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [undefined, skill('Other <o@x.test>')] }), connect, 'skills/x/SKILL.md');
    const bodyOnly = `# x\n\nauthor: ${ME}\n`;
    refuse(tree({ 'skills/x/SKILL.md': [bodyOnly, bodyOnly] }), connect, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME)] }), { action: 'connect', handle: 'me' }, 'skills/x/SKILL.md');
  });

  it('a rename that moves a file out of an owned folder is refused, and skills are never writable from join/install', () => {
    refuse(tree({ 'skills/x/notes.md': ['n', undefined], 'notes.md': [undefined, 'n'] }, { 'skills/x/SKILL.md': skill(ME) }), connect, 'notes.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME)] }), { action: 'join', handle: 'me', author: ME }, 'skills/x/SKILL.md');
  });
});

describe('row b — people files', () => {
  it('only your own file, only from join/install/uninstall/sync', () => {
    for (const action of ['join', 'install', 'uninstall', 'sync'] as const) expect(() => guard(tree({ 'people/me.json': ['{}', '{"a":1}'] }), { action, handle: 'me' })).not.toThrow();
    refuse(tree({ 'people/other.json': ['{}', '{}'] }), { action: 'join', handle: 'me' }, 'people/other.json');
    refuse(tree({ 'people/me.json': ['{}', '{}'] }), connect, 'people/me.json');
    refuse(tree({ 'people/me.json': ['{}', '{}'] }), { action: 'publish', handle: 'me' }, 'people/me.json');
  });
});

describe('rows c, d, e — team.json', () => {
  it('publish may change global and projects[].skills, nothing else', () => {
    expect(() => guard(tree({ 'team.json': [team(), team({ global: [ID] })] }), { action: 'publish', handle: 'me' })).not.toThrow();
    expect(() => guard(tree({ 'team.json': [team(), team({ projects: { p: { remotes: ['github.com/a/p'], skills: [ID] } } })] }), { action: 'publish', handle: 'me' })).not.toThrow();
    refuse(tree({ 'team.json': [team(), team({ projects: { p: { remotes: ['github.com/a/evil'], skills: [] } } })] }), { action: 'publish', handle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ projects: {} })] }), { action: 'publish', handle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ policy: { publish: 'push', skill_license: 'UNLICENSED' } })] }), { action: 'publish', handle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ global: [ID] })] }), { action: 'join', handle: 'me' }, 'team.json');
  });

  it('handles are compared lowercase, so a mixed-case caller is not refused and an invalid one is', () => {
    expect(() => guard(tree({ 'team.json': [team(), team({ archived: ['alice'] })] }), { action: 'team-remove', handle: 'Admin', targetHandle: 'Alice' })).not.toThrow();
    expect(() => guard(tree({ 'people/me.json': ['{}', '{"a":1}'] }), { action: 'join', handle: 'ME' })).not.toThrow();
    expect(() => guard(tree({ 'people/me.json': ['{}', '{"a":1}'] }), { action: 'join', handle: 'bad handle' })).toThrow(/invalid handle/);
  });

  it('team remove appends exactly the target; join removes exactly its own handle — set differences, not length checks', () => {
    expect(() => guard(tree({ 'team.json': [team({ archived: ['a'] }), team({ archived: ['a', 'x'] })] }), { action: 'team-remove', handle: 'me', targetHandle: 'x' })).not.toThrow();
    refuse(tree({ 'team.json': [team({ archived: ['a'] }), team({ archived: ['x', 'a'] })] }), { action: 'team-remove', handle: 'me', targetHandle: 'x' }, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ archived: ['me'] })] }), { action: 'team-remove', handle: 'me', targetHandle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team({ archived: ['x'] }), team({ archived: ['x', 'x'] })] }), { action: 'team-remove', handle: 'me', targetHandle: 'x' }, 'team.json');
    refuse(tree({ 'team.json': [team(), team({ archived: ['other'] })] }), { action: 'join', handle: 'me' }, 'team.json');
    expect(() => guard(tree({ 'team.json': [team({ archived: ['a', 'me', 'b'] }), team({ archived: ['a', 'b'] })] }), { action: 'join', handle: 'me' })).not.toThrow();
    refuse(tree({ 'team.json': [team({ archived: ['other'] }), team({ archived: [] })] }), { action: 'join', handle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team({ archived: ['me', 'x'] }), team({ archived: ['y'] })] }), { action: 'join', handle: 'me' }, 'team.json');
    refuse(tree({ 'team.json': [team({ archived: ['me'] }), team({ archived: [], global: [ID] })] }), { action: 'join', handle: 'me' }, 'team.json');
    expect(() => guard(tree({ 'team.json': [team(), undefined] }), { action: 'join', handle: 'me' })).toThrow(/missing team\.json/);
  });
});

describe('row f and everything else', () => {
  it('README is regenerable from any action; any other path is refused', () => {
    expect(() => guard(tree({ 'README.md': ['a', 'b'] }), { action: 'install', handle: 'me' })).not.toThrow();
    refuse(tree({ 'evals/x.json': [undefined, '{}'] }), connect, 'evals/x.json');
    refuse(tree({ '.github/workflows/terum-skills.yml': ['a', 'b'] }), { action: 'publish', handle: 'me' }, '.github/workflows/terum-skills.yml');
    expect(() => guard(tree({ 'outside.txt': [undefined, 'x'] }), connect)).toThrow(GuardError);
  });
});

describe('row g — eval receipts are one-file, append-only testimony', () => {
  const evalContext: GuardContext = { action: 'eval', handle: 'me' };

  it('allows exactly one newly added, correctly keyed receipt for a post-image skill id', () => {
    expect(() => guard(receiptTree({ [receiptPath()]: [undefined, '{}'] }), evalContext)).not.toThrow();
  });

  it('refuses malformed identity directories, hashes, absent ids, and non-eval actions (VE3)', () => {
    for (const path of [
      receiptPath('not-a-uuid'),
      receiptPath(ID, 'a'.repeat(39)),
      receiptPath(ID, 'a'.repeat(41)),
      receiptPath(ID, 'A'.repeat(40)),
      receiptPath('11111111-1111-4111-8111-111111111111'),
      `evals/${ID}/../${'a'.repeat(40)}/20260907T123456Z.json`,
      receiptPath(ID, 'a'.repeat(40), 'not-a-run-id'),
    ]) refuse(receiptTree({ [path]: [undefined, '{}'] }), evalContext, path);
    refuse(receiptTree({ [receiptPath()]: [undefined, '{}'] }), connect, receiptPath());
  });

  it('refuses modifying, deleting, or combining receipts — previously committed evidence is immutable', () => {
    const path = receiptPath();
    refuse(receiptTree({ [path]: ['{}', '{"changed":true}'] }), evalContext, path);
    refuse(receiptTree({ [path]: ['{}', undefined] }), evalContext, path);
    const second = receiptPath(ID, 'b'.repeat(40));
    refuse(receiptTree({ [path]: [undefined, '{}'], [second]: [undefined, '{}'] }), evalContext, path);
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

describe('row a — previousAuthor is the §5.3 managed-field refresh, for sync only', () => {
  it('lets sync replace the committed author with the configured one, but only as a SKILL.md-only canonical refresh', () => {
    const refresh = (before: string, after: string) => tree({ 'skills/x/SKILL.md': [skill(before), skill(after)] });
    const ctx = (action: GuardContext['action']): GuardContext => ({ action, handle: 'me', author: 'Me <new@x.test>', previousAuthor: 'Me <old@x.test>' });
    expect(() => guard(refresh('Me <old@x.test>', 'Me <new@x.test>'), ctx('sync'))).not.toThrow();
    // Once the refresh has landed, the actor retains ordinary ownership even when the prior
    // author is still supplied for a replayed mutation.
    expect(() => guard(tree({ 'skills/x/SKILL.md': [skill('Me <new@x.test>'), skill('Me <new@x.test>').replace('# x', '# changed')] }), ctx('sync'))).not.toThrow();
    refuse(tree({ 'skills/x/SKILL.md': [skill('Me <old@x.test>'), skill('Me <new@x.test>').replace('# x', '# changed')] }), ctx('sync'), 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill('Me <old@x.test>'), skill('Me <new@x.test>')], 'skills/x/note.md': [undefined, 'extra'] }), ctx('sync'), 'skills/x/SKILL.md');
    refuse(refresh('Me <old@x.test>', 'Me <new@x.test>'), ctx('connect'), 'skills/x/SKILL.md');
    refuse(refresh('Them <them@x.test>', 'Me <new@x.test>'), ctx('sync'), 'skills/x/SKILL.md');
    refuse(refresh('Me <old@x.test>', 'Them <them@x.test>'), ctx('sync'), 'skills/x/SKILL.md');
  });
});

it('issue 5 connect authorizes owned skills and names connect in a non-owned refusal', () => {
  const context: GuardContext = { action: 'connect', handle: 'me', author: ME };
  expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME).replace('# x', '# edited')] }), context)).not.toThrow();
  expect(() => guard(tree({ 'skills/x/SKILL.md': [skill('Other <other@x.test>'), skill(ME)] }), context))
    .toThrow('Write guard refused skills/x/SKILL.md for connect by me');
});

it.each(['profile', 'decline'] as const)('row b grants %s only the caller people path', action => {
  expect(() => guard(tree({ 'people/me.json': ['{}', '{"role":"Platform"}'] }), { action, handle: 'me' })).not.toThrow();
  refuse(tree({ 'people/other.json': ['{}', '{}'] }), { action, handle: 'me' }, 'people/other.json');
  refuse(tree({ 'team.json': [team(), team({ global: [ID] })] }), { action, handle: 'me' }, 'team.json');
});
