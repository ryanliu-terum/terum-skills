import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyReadme, applyReadmeWithReason, generateReadme, ReadmeData, installCounts, installersById, latestChange, readReadmeData, regenerateReadmeInTree } from '../readme.js';
import type { MutableTree } from '../teamRepo.js';
import { person, TEAM_JSON, temporaryDirectory } from './fixtures.js';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const data: ReadmeData = {
  // §4.1 folded `global` into an ordinary project, so every endorsement is now `project: <key>`.
  team: { name: 'team', remote: 'github.com/acme/team', projects: { Global: { skills: [ID_A] }, app: { skills: [ID_B] } }, archived: ['bea'] },
  people: [
    { handle: 'amy', display_name: 'Amy', email: 'amy@example.com', github: 'amy', bio: '', installed: [{ id: ID_A, version: null, scope: { kind: 'global' }, since: '2026-09-04' }], declined: [] },
    { handle: 'bea', display_name: 'Bea', email: 'bea@example.com', github: 'bea', bio: '', installed: [{ id: ID_A, version: null, scope: { kind: 'global' }, since: '2026-09-04' }, { id: ID_B, version: null, scope: { kind: 'project', project: 'app' }, since: '2026-09-04' }], declined: [] },
  ],
  skills: [
    { id: ID_B, name: 'second', description: 'Second skill', category: 'docs', author: 'Bea <bea@example.com>', latest: 'v2' },
    { id: ID_A, name: 'first', description: 'First skill', category: 'testing', author: 'Amy <amy@example.com>', latest: 'v1' },
  ],
  skipped: [],
};

describe('README generator (§9)', () => {
  it('is deterministic and renders grouping, ID-derived counts, endorsements, and self-locating installs', () => {
    const first = generateReadme(data);
    expect(generateReadme(data)).toBe(first);
    expect(first).toContain('### Amy <amy@example.com>');
    // D1: the Latest column is the version LABEL, never a tree hash.
    expect(first).toContain('| first | testing | First skill | 2 | project: Global | Version 1 | — | `npx -y terum-skills@latest install acme/team/first` |');
    expect(first).toContain('| second | docs | Second skill | 1 | project: app | Version 2 | — | `npx -y terum-skills@latest install acme/team/second` |');
    expect(first).not.toContain('- @bea — Bea');
  });

  it('counts a teammate once per skill even when they hold it at two scopes (D38 counts people, not placements)', () => {
    const twoScopes = generateReadme({
      ...data,
      people: [{ ...data.people[0]!, installed: [
        { id: ID_A, version: null, scope: { kind: 'global' }, since: '2026-09-04' },
        { id: ID_A, version: null, scope: { kind: 'project', project: 'app' }, since: '2026-09-04' },
      ] }],
    });
    expect(twoScopes).toContain('| first | testing | First skill | 1 | project: Global | Version 1 |');
  });

  it('shows a crafted folder name as data in the Skill cell: neither a Markdown link nor an HTML anchor renders', () => {
    const hostile = generateReadme({ ...data, skills: [{ ...data.skills[1]!, name: '<a href="https://evil.example">[click]</a>' }] });
    expect(hostile).not.toContain('<a href');
    expect(hostile).toContain('&lt;a href="https://evil.example"&gt;\\[click\\]&lt;/a&gt;');
  });

  it('no repo text renders as a link whose label lies — description, category, author heading, team name, roster — while a bare URL still auto-links (R14)', () => {
    const hostile = generateReadme({
      ...data,
      team: { ...data.team, name: 'team [home](https://evil.example)' },
      people: [{ ...data.people[0]!, display_name: '[Amy](https://evil.example)' }, data.people[1]!],
      skills: [{ ...data.skills[1]!, description: 'see [Install v2](https://evil.example) or https://docs.example', category: 'testing [x](https://evil.example)', author: '[Amy](https://evil.example) <amy@example.com>' }],
    });
    // No unescaped `](` anywhere: the label is dead in every position; the bare URL is untouched.
    expect(hostile).not.toMatch(/[^\\]\]\(https:\/\/evil\.example/);
    expect(hostile).toContain('## team \\[home\\](https://evil.example) skills');
    expect(hostile).toContain('- @amy — \\[Amy\\](https://evil.example)');
    expect(hostile).toContain('### \\[Amy\\](https://evil.example) <amy@example.com>');
    expect(hostile).toContain('| testing \\[x\\](https://evil.example) | see \\[Install v2\\](https://evil.example) or https://docs.example |');
  });

  it('rejects malformed marker layouts without changing the input', () => {
    for (const malformed of [
      `Intro\n${'<!-- terum-skills:begin -->'}\n`,
      `Intro\n${'<!-- terum-skills:end -->'}\n${'<!-- terum-skills:begin -->'}\n`,
      `Intro\n${'<!-- terum-skills:begin -->'}\n${'<!-- terum-skills:begin -->'}\n${'<!-- terum-skills:end -->'}\n`,
    ]) {
      expect(() => applyReadme(malformed, generateReadme(data))).toThrow(/README.md.*markers/);
      expect(malformed).toBe(malformed);
    }
  });

  it('renders empty roster and skill fallbacks', () => {
    const empty = generateReadme({ ...data, people: [], skills: [] });
    expect(empty).toContain('- No members yet.');
    expect(empty).toContain('No shared skills yet.');
  });

  // §13.1(a)/§14.1. A derived artifact may not silently delete a repo's catalogue: the Action is the
  // only job with `contents: write`, so an empty render would be committed and PUSHED over it.
  it('refuses to replace a non-empty catalogue with the empty fallback, and leaves the block untouched', () => {
    const populated = applyReadme('Intro\n', generateReadme(data));
    expect(populated).not.toContain('No shared skills yet.');
    // The half-migrated case: `readReadmeData` skips any skills/<name>/ holding no v<N> folder, so
    // every name can vanish and the generator emits the empty fallback over a real catalogue.
    expect(applyReadme(populated, generateReadme({ ...data, skills: [] }))).toBe(populated);
    // But it must REFUSE, not throw: a team legitimately removing its last shared skill would hit the
    // same path, and a throw would wedge README regeneration for them permanently.
    expect(() => applyReadme(populated, generateReadme({ ...data, skills: [] }))).not.toThrow();
    // First generation into a README that has no catalogue yet is still allowed.
    expect(applyReadme('Intro\n', generateReadme({ ...data, skills: [] }))).toContain('No shared skills yet.');
    // And a populated catalogue still replaces a populated catalogue normally.
    expect(applyReadme(populated, generateReadme(data))).toBe(populated);
  });

  it('replaces only the generated markers and preserves every surrounding byte', () => {
    const existing = 'Intro with two spaces  \n\n<!-- terum-skills:begin -->\nold\n<!-- terum-skills:end -->\n\nHand written footer\n';
    const next = applyReadme(existing, generateReadme(data));
    expect(next).toMatch(/^Intro with two spaces  \n\n<!-- terum-skills:begin -->/);
    expect(next).toContain('\n\nHand written footer\n');
    expect(applyReadme(next, generateReadme(data))).toBe(next);
    expect(applyReadme('Notes', generateReadme(data))).toBe(`Notes\n\n${generateReadme(data)}`);
  });

  it('prints no install command for a folder name the CLI would refuse, so a backtick in a hand-committed name cannot leave the code span or reach a clipboard', () => {
    const block = generateReadme({ ...data, skills: [{ ...data.skills[1]!, name: 'x`[Install v2](https://evil.example/pkg)' }] });
    const row = block.split('\n').find((line) => line.startsWith('| x`'))!;
    expect(row.split(/(?<!\\)\|/).at(-2)?.trim()).toBe('—');
    expect(block).not.toContain('install acme/team/x');
    expect(block.split('`')).toHaveLength(2);
    // ...and the name does not render as a link labelled by the attacker either.
    expect(block).not.toMatch(/(?<!\\)\]\(https:\/\/evil\.example/);
    expect(row).toContain('x`\\[Install v2\\](https://evil.example/pkg)');
  });

  it('never interprets replacement patterns or breaks table rows on skill text', () => {
    const tricky: ReadmeData = { ...data, skills: [{ ...data.skills[1]!, description: "Costs $' and $& | pipes\nand a newline" }] };
    const block = generateReadme(tricky);
    expect(block).toContain("| first | testing | Costs $' and $& \\| pipes and a newline | 2 |");
    const existing = 'Intro\n\n<!-- terum-skills:begin -->\nold\n<!-- terum-skills:end -->\n';
    expect(applyReadme(existing, block)).toBe(`Intro\n\n${block.trimEnd()}\n`);
  });

  it('neutralizes block markers, pipes, every line ending and backslashes in every interpolated field, so a poisoned field cannot wedge later writes', () => {
    const marker = '<!-- terum-skills:end -->';
    // The endorsement column is fed a project key (unvalidated team.json content), not the literal 'global'.
    const hostile: ReadmeData = {
      ...data,
      team: { ...data.team, name: `team\r\n${marker}`, projects: { [`app|${marker}`]: { skills: [ID_A] } } },
      people: [{ ...data.people[0]!, display_name: `Amy\n${marker}` }],
      skills: [{ ...data.skills[1]!, name: `first|${marker}`, category: 'test\\ing|x', author: `Amy <amy@example.com> ${marker}`, description: `Ends\rhere ${marker}` }],
    };
    const block = generateReadme(hostile);
    expect(block.split('<!-- terum-skills:begin -->')).toHaveLength(2);
    expect(block.split(marker)).toHaveLength(2);
    expect(block).not.toContain('\r');
    expect(block).toContain('## team &lt;!-- terum-skills:end --> skills');
    expect(block).toContain('- @amy — Amy &lt;!-- terum-skills:end -->');
    expect(block).toContain('### Amy <amy@example.com> &lt;!-- terum-skills:end -->');
    const row = block.split('\n').find((line) => line.startsWith('| first'))!;
    // The Skill cell alone also neutralizes angle brackets (an HTML anchor vector); the free-text cells keep `-->` as text.
    expect(row).toContain('| first\\|&lt;!-- terum-skills:end --&gt; | test\\\\ing\\|x | Ends here &lt;!-- terum-skills:end --> |');
    expect(row).toContain('| project: app\\|&lt;!-- terum-skills:end --> |');
    // A name the CLI would refuse to create gets no install command rather than an escaped, unrunnable one.
    expect(row.split(/(?<!\\)\|/).at(-2)?.trim()).toBe('—');
    expect(row.split(/(?<!\\)\|/)).toHaveLength(10);
    const existing = 'Intro\n\n<!-- terum-skills:begin -->\nold\n<!-- terum-skills:end -->\n\nFooter\n';
    const once = applyReadme(existing, block);
    expect(applyReadme(once, generateReadme(hostile))).toBe(once);
    expect(once).toContain('\n\nFooter\n');
  });
});

const SKILL = (name: string, id: string) => `---\nname: ${name}\ndescription: ${name} skill\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Amy <amy@example.com>\n  terum-category: docs\n---\n`;
const REMOTE = 'git@git.example.com:acme/team.git';
const skill = (id: string, name: string): ReadmeData['skills'][number] => ({ id, name, description: `${name} skill`, category: 'docs', author: 'Amy <amy@example.com>', latest: 'v1' });
/** Skill rows of a generated block, read back the way a reader would: table body lines under the header and rule. */
const rowsOf = (text: string) => text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Skill |') && !line.startsWith('| ---')).length;

/** The `MutableTree` safeWrite hands `regenerateReadmeInTree`: a post-image over `files`, recording every write. */
function fakeTree(files: Record<string, string>): MutableTree & { writes: string[] } {
  const store = new Map(Object.entries(files));
  const writes: string[] = [];
  return {
    writes,
    before: (path) => files[path],
    after: (path) => store.get(path),
    get changedPaths() { return writes; },
    set(path, content) { writes.push(path); store.set(path, typeof content === 'string' ? content : content.toString('utf8')); },
    remove(path) { writes.push(path); store.delete(path); },
    // §13's `beforeTreeId` (migrate-only HEAD identities): README generation never reads one, so inert here.
    beforeTreeId: () => undefined,
    setExecutable() {},
    paths: (prefix = '') => [...store.keys()].filter((path) => path.startsWith(prefix)).sort(),
    executablePaths: () => new Set(),
  };
}

// D69 (§13.1(a)): B3's never-blank guard refused only a FULL wipe. The readers skip any skills/<name>/
// with no v<N>/SKILL.md — the state a half-finished migration leaves — so one migrated skill and nine
// unmigrated rendered a one-row table that the Action (contents: write) or a generic-remote safeWrite
// pushed over the team's whole catalogue. The refusal now fires on the CAUSE (a skipped folder) and
// on the SYMPTOM (fewer rows than the block being replaced), keeps `existing`, and never throws.
describe('README never-partial invariant (D69)', () => {
  it('a clone holding one valid and one versionless skill folder: the reader names the skipped folder and the apply step keeps the README, saying why', async () => {
    const clone = await temporaryDirectory();
    await mkdir(join(clone, 'people'), { recursive: true });
    await mkdir(join(clone, 'skills', 'a', 'v1'), { recursive: true });
    await mkdir(join(clone, 'skills', 'b'), { recursive: true });
    await writeFile(join(clone, 'team.json'), `${JSON.stringify(TEAM_JSON)}\n`);
    await writeFile(join(clone, 'people', 'amy.json'), `${JSON.stringify(person('amy'))}\n`);
    await writeFile(join(clone, 'skills', 'a', 'v1', 'SKILL.md'), SKILL('a', ID_A));
    // The layout-2 leftover: SKILL.md flat at the skill root, no v<N>/ at all.
    await writeFile(join(clone, 'skills', 'b', 'SKILL.md'), SKILL('b', ID_B));
    const read = await readReadmeData(clone, REMOTE);
    expect(read.skipped).toEqual(['b']);
    expect(read.skills.map((entry) => entry.name)).toEqual(['a']);
    // The README already catalogues both skills; the half-migrated render would drop `b`.
    const existing = applyReadme('Intro\n', generateReadme({ ...data, skills: [skill(ID_A, 'a'), skill(ID_B, 'b')] }));
    expect(rowsOf(existing)).toBe(2);
    expect(applyReadme(existing, generateReadme(read), { skipped: read.skipped })).toBe(existing);
    const applied = applyReadmeWithReason(existing, generateReadme(read), { skipped: read.skipped });
    expect(applied.text).toBe(existing);
    expect(applied.refusal).toMatch(/README\.md left unchanged: skills\/b has no v<N>\/SKILL\.md/);
    expect(applied.refusal).not.toContain('skills/a');
    // The cause refuses even a first generation: a README with no region yet gets none until the repo is whole.
    expect(applyReadmeWithReason('Intro\n', generateReadme(read), { skipped: read.skipped })).toEqual({ text: 'Intro\n', refusal: expect.stringContaining('skills/b') });
    expect(() => applyReadme(existing, generateReadme(read), { skipped: read.skipped })).not.toThrow();
  });

  it('refuses a block with fewer skill rows than the region it would replace, naming both counts, whether the previous table was generated or hand-written', () => {
    const three = applyReadme('Intro\n', generateReadme({ ...data, skills: [skill(ID_A, 'a'), skill(ID_B, 'b'), skill(ID_C, 'c')] }));
    expect(rowsOf(three)).toBe(3);
    const one = generateReadme({ ...data, skills: [skill(ID_A, 'a')] });
    expect(rowsOf(one)).toBe(1);
    expect(applyReadme(three, one)).toBe(three);
    const applied = applyReadmeWithReason(three, one);
    expect(applied.text).toBe(three);
    expect(applied.refusal).toBe("README.md left unchanged: the regenerated catalogue has 1 skill row where the current one has 3; a derived artifact may not drop a team's skills.");
    expect(() => applyReadme(three, one)).not.toThrow();
    // Rows are counted structurally — body lines under a header and a rule — not by matching names,
    // so a region an older generator wrote with other columns and other names still counts.
    const foreign = 'Intro\n\n<!-- terum-skills:begin -->\n## team skills\n\n| Skill | Owner |\n| --- | --- |\n| deploy | ops |\n| review | qa |\n| write | docs |\n<!-- terum-skills:end -->\n';
    expect(applyReadmeWithReason(foreign, one)).toEqual({ text: foreign, refusal: expect.stringContaining('has 1 skill row where the current one has 3') });
    // Two rows is not below two; the block replaces the foreign region as before.
    const two = generateReadme({ ...data, skills: [skill(ID_A, 'a'), skill(ID_B, 'b')] });
    expect(applyReadmeWithReason('Intro\n\n<!-- terum-skills:begin -->\n| Skill | Owner |\n| --- | --- |\n| deploy | ops |\n| review | qa |\n<!-- terum-skills:end -->\n', two)).toEqual({ text: `Intro\n\n${two.trimEnd()}\n` });
  });

  it('replaces a region with a block of the same or a greater row count exactly as before', () => {
    const two = applyReadme('Intro\n', generateReadme({ ...data, skills: [skill(ID_A, 'a'), skill(ID_B, 'b')] }));
    const renamed = generateReadme({ ...data, skills: [skill(ID_A, 'alpha'), skill(ID_B, 'beta')] });
    expect(applyReadmeWithReason(two, renamed)).toEqual({ text: `Intro\n\n${renamed.trimEnd()}\n` });
    expect(applyReadme(two, renamed)).toContain('| alpha |');
    const three = generateReadme({ ...data, skills: [skill(ID_A, 'a'), skill(ID_B, 'b'), skill(ID_C, 'c')] });
    const grown = applyReadme(two, three);
    expect(grown).toBe(`Intro\n\n${three.trimEnd()}\n`);
    expect(rowsOf(grown)).toBe(3);
    // No region yet and nothing skipped: first generation still appends.
    expect(applyReadmeWithReason('Intro\n', three)).toEqual({ text: `Intro\n\n${three}` });
  });

  it('regenerateReadmeInTree leaves README.md byte-identical on a versionless skill folder and resolves to the reason', async () => {
    const readme = applyReadme('# team\n', generateReadme({ ...data, skills: [skill(ID_A, 'a'), skill(ID_B, 'legacy')] }));
    const withoutReadme = {
      'team.json': `${JSON.stringify(TEAM_JSON)}\n`,
      'people/amy.json': `${JSON.stringify(person('amy'))}\n`,
      'skills/.gitkeep': '',
      'skills/a/v1/SKILL.md': SKILL('a', ID_A),
      'skills/legacy/SKILL.md': SKILL('legacy', ID_B),
    };
    const tree = fakeTree({ ...withoutReadme, 'README.md': readme });
    const refusal = await regenerateReadmeInTree(tree, REMOTE);
    expect(tree.after('README.md')).toBe(readme);
    expect(tree.writes).toEqual([]);
    expect(refusal).toMatch(/^README\.md left unchanged: skills\/legacy has no v<N>\/SKILL\.md/);
    // `skills/.gitkeep` is a file, not a skill folder, and the catalogued skill is not "skipped".
    expect(refusal).not.toMatch(/\.gitkeep|skills\/a\b/);
    // A repo with no README yet gets none created — not even an empty one — while it is half-migrated.
    const bare = fakeTree(withoutReadme);
    expect(await regenerateReadmeInTree(bare, REMOTE)).toContain('skills/legacy');
    expect(bare.after('README.md')).toBeUndefined();
    expect(bare.writes).toEqual([]);
    // The positive control: the same tree once `legacy` is versioned regenerates and resolves to undefined.
    const migrated = fakeTree({ ...withoutReadme, 'README.md': readme, 'skills/legacy/v1/SKILL.md': SKILL('legacy', ID_B) });
    expect(await regenerateReadmeInTree(migrated, REMOTE)).toBeUndefined();
    expect(migrated.writes).toEqual(['README.md']);
    expect(migrated.after('README.md')).toContain('| legacy | docs | legacy skill | 0 | — | Version 1 |');
  });
});


it('lists every install record oldest first, including archived members and two scopes, but counts each person once', () => {
  const people = [{ ...data.people[0]!, installed: [
    { id: ID_A, version: null, scope: { kind: 'global' as const }, since: '2026-09-04' },
    { id: ID_A, version: null, scope: { kind: 'project' as const, project: 'app' }, since: '2026-09-01' },
  ] }, data.people[1]!];
  expect(installCounts(people).get(ID_A)).toBe(2);
  expect(installersById(people).get(ID_A)).toEqual([
    { handle: 'amy', displayName: 'Amy', scope: { kind: 'project', project: 'app' }, since: '2026-09-01', version: null },
    { handle: 'amy', displayName: 'Amy', scope: { kind: 'global' }, since: '2026-09-04', version: null },
    { handle: 'bea', displayName: 'Bea', scope: { kind: 'global' }, since: '2026-09-04', version: null },
  ]);
});
it.each([['2026-09-04T10:22:33-07:00\n', '2026-09-04T10:22:33-07:00'], ['', '—']])('latestChange returns a committed date or an empty-history dash', async (stdout, expected) => {
  const calls: unknown[] = [];
  expect(await latestChange({ run: async (...args) => { calls.push(args); return { code: 0, stdout, stderr: '' }; } }, '/clone', 'sample')).toBe(expected);
  // The date is the SKILL's, across every version: a new version folder is a new path, so pinning
  // the newest one would report each publish as the skill's first change.
  expect(calls).toEqual([['git', ['log', '-1', '--format=%cI', '--', 'skills/sample'], { cwd: '/clone' }]]);
});
it('latestChange surfaces git failure so the inventory can report the row', async () => {
  await expect(latestChange({ run: async () => ({ code: 1, stdout: '', stderr: 'broken history' }) }, '/clone', 'sample')).rejects.toThrow('broken history');
});
