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
const share: GuardContext = { action: 'share', handle: 'me', author: ME };
const refuse = (t: ReturnType<typeof tree>, c: GuardContext, path: string) => expect(() => guard(t, c)).toThrow(new RegExp(`refused ${path.replace(/[.]/g, '\\.')}`));

describe('row a — skill folders, ownership by metadata.author', () => {
  it('allows the author to edit, add aux files to, and delete their own skill', () => {
    expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME).replace('# x', '# y')] }), share)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/references/a.md': [undefined, 'aux'] }, { 'skills/x/SKILL.md': skill(ME) }), share)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(ME), undefined] }), share)).not.toThrow();
    expect(() => guard(tree({ 'skills/x/SKILL.md': [undefined, skill(ME)] }), { ...share, action: 'sync' })).not.toThrow();
  });

  it('compares authors after normalization: case, doubled and surrounding whitespace are not identity', () => {
    for (const spelling of ['me <ME@X.test>', '  Me  <me@x.test>  ', 'ME <ME@X.TEST>']) {
      expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME).replace('# x', '# y')] }), { ...share, author: spelling }), spelling).not.toThrow();
      expect(() => guard(tree({ 'skills/x/SKILL.md': [skill(spelling), skill(spelling).replace('# x', '# y')] }), share), spelling).not.toThrow();
    }
    refuse(tree({ 'skills/x/SKILL.md': [skill('Me <me@x.test>'), skill('Me <me@x.test>')] }), { ...share, author: 'Me <me@y.test>' }, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill('Me <me@x.test>'), skill('Me <me@x.test>')] }), { ...share, author: 'Mel <me@x.test>' }, 'skills/x/SKILL.md');
  });

  it("rejects another author's folder, including aux files and a folder with no SKILL.md", () => {
    refuse(tree({ 'skills/x/SKILL.md': [skill('Other <o@x.test>'), skill('Other <o@x.test>')] }), share, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/references/a.md': [undefined, 'aux'] }, { 'skills/x/SKILL.md': skill('Other <o@x.test>') }), share, 'skills/x/references/a.md');
    refuse(tree({ 'skills/x/references/a.md': [undefined, 'aux'] }), share, 'skills/x/references/a.md');
  });

  it('reads ownership from the committed pre-image: a diff cannot grant itself authorship or hand the folder away', () => {
    refuse(tree({ 'skills/x/SKILL.md': [skill('Other <o@x.test>'), skill(ME)] }), share, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill(ME), skill('Other <o@x.test>')] }), share, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [undefined, skill('Other <o@x.test>')] }), share, 'skills/x/SKILL.md');
    const bodyOnly = `# x\n\nauthor: ${ME}\n`;
    refuse(tree({ 'skills/x/SKILL.md': [bodyOnly, bodyOnly] }), share, 'skills/x/SKILL.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME)] }), { action: 'share', handle: 'me' }, 'skills/x/SKILL.md');
  });

  it('a rename that moves a file out of an owned folder is refused, and skills are never writable from join/install', () => {
    refuse(tree({ 'skills/x/notes.md': ['n', undefined], 'notes.md': [undefined, 'n'] }, { 'skills/x/SKILL.md': skill(ME) }), share, 'notes.md');
    refuse(tree({ 'skills/x/SKILL.md': [skill(ME), skill(ME)] }), { action: 'join', handle: 'me', author: ME }, 'skills/x/SKILL.md');
  });
});

describe('row b — people files', () => {
  it('only your own file, only from join/install/uninstall/sync', () => {
    for (const action of ['join', 'install', 'uninstall', 'sync'] as const) expect(() => guard(tree({ 'people/me.json': ['{}', '{"a":1}'] }), { action, handle: 'me' })).not.toThrow();
    refuse(tree({ 'people/other.json': ['{}', '{}'] }), { action: 'join', handle: 'me' }, 'people/other.json');
    refuse(tree({ 'people/me.json': ['{}', '{}'] }), share, 'people/me.json');
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
    refuse(tree({ 'evals/x.json': [undefined, '{}'] }), share, 'evals/x.json');
    refuse(tree({ '.github/workflows/terum-skills.yml': ['a', 'b'] }), { action: 'publish', handle: 'me' }, '.github/workflows/terum-skills.yml');
    expect(() => guard(tree({ 'outside.txt': [undefined, 'x'] }), share)).toThrow(GuardError);
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
    refuse(refresh('Me <old@x.test>', 'Me <new@x.test>'), ctx('share'), 'skills/x/SKILL.md');
    refuse(refresh('Them <them@x.test>', 'Me <new@x.test>'), ctx('sync'), 'skills/x/SKILL.md');
    refuse(refresh('Me <old@x.test>', 'Them <them@x.test>'), ctx('sync'), 'skills/x/SKILL.md');
  });
});
