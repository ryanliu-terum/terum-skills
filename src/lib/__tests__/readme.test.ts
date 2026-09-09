import { describe, expect, it } from 'vitest';
import { applyReadme, generateReadme, ReadmeData, installCounts, installersById, latestChange } from '../readme.js';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const data: ReadmeData = {
  team: { name: 'team', remote: 'github.com/acme/team', global: [ID_A], projects: { app: { skills: [ID_B] } }, archived: ['bea'] },
  people: [
    { handle: 'amy', display_name: 'Amy', email: 'amy@example.com', github: 'amy', bio: '', installed: [{ id: ID_A, version: null, scope: { kind: 'global' }, since: '2026-09-04' }], declined: [] },
    { handle: 'bea', display_name: 'Bea', email: 'bea@example.com', github: 'bea', bio: '', installed: [{ id: ID_A, version: null, scope: { kind: 'global' }, since: '2026-09-04' }, { id: ID_B, version: null, scope: { kind: 'project', project: 'app' }, since: '2026-09-04' }], declined: [] },
  ],
  skills: [
    { id: ID_B, name: 'second', description: 'Second skill', category: 'docs', author: 'Bea <bea@example.com>', latest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    { id: ID_A, name: 'first', description: 'First skill', category: 'testing', author: 'Amy <amy@example.com>', latest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  ],
};

describe('README generator (§9)', () => {
  it('is deterministic and renders grouping, ID-derived counts, endorsements, and self-locating installs', () => {
    const first = generateReadme(data);
    expect(generateReadme(data)).toBe(first);
    expect(first).toContain('### Amy <amy@example.com>');
    expect(first).toContain('| first | testing | First skill | 2 | global | aaaaaaaa | — | `npx -y terum-skills@latest install acme/team/first` |');
    expect(first).toContain('| second | docs | Second skill | 1 | project: app | bbbbbbbb | — | `npx -y terum-skills@latest install acme/team/second` |');
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
    expect(twoScopes).toContain('| first | testing | First skill | 1 | global | aaaaaaaa |');
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
      team: { ...data.team, name: `team\r\n${marker}`, global: [], projects: { [`app|${marker}`]: { skills: [ID_A] } } },
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


it('lists every install record oldest first, including archived members and two scopes, but counts each person once', () => {
  const people = [{ ...data.people[0]!, installed: [
    { id: ID_A, version: null, scope: { kind: 'global' as const }, since: '2026-09-04' },
    { id: ID_A, version: null, scope: { kind: 'project' as const, project: 'app' }, since: '2026-09-01' },
  ] }, data.people[1]!];
  expect(installCounts(people).get(ID_A)).toBe(2);
  expect(installersById(people).get(ID_A)).toEqual([
    { handle: 'amy', displayName: 'Amy', scope: { kind: 'project', project: 'app' }, since: '2026-09-01' },
    { handle: 'amy', displayName: 'Amy', scope: { kind: 'global' }, since: '2026-09-04' },
    { handle: 'bea', displayName: 'Bea', scope: { kind: 'global' }, since: '2026-09-04' },
  ]);
});
it.each([['2026-09-04T10:22:33-07:00\n', '2026-09-04T10:22:33-07:00'], ['', '—']])('latestChange returns a committed date or an empty-history dash', async (stdout, expected) => {
  const calls: unknown[] = [];
  expect(await latestChange({ run: async (...args) => { calls.push(args); return { code: 0, stdout, stderr: '' }; } }, '/clone', 'sample')).toBe(expected);
  expect(calls).toEqual([['git', ['log', '-1', '--format=%cI', '--', 'skills/sample'], { cwd: '/clone' }]]);
});
it('latestChange surfaces git failure so the inventory can report the row', async () => {
  await expect(latestChange({ run: async () => ({ code: 1, stdout: '', stderr: 'broken history' }) }, '/clone', 'sample')).rejects.toThrow('broken history');
});
