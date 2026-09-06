import { describe, expect, it } from 'vitest';
import { applyReadme, generateReadme, ReadmeData } from '../readme.js';

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

  it('never interprets replacement patterns or breaks table rows on skill text', () => {
    const tricky: ReadmeData = { ...data, skills: [{ ...data.skills[1]!, description: "Costs $' and $& | pipes\nand a newline" }] };
    const block = generateReadme(tricky);
    expect(block).toContain("| first | testing | Costs $' and $& \\| pipes and a newline | 2 |");
    const existing = 'Intro\n\n<!-- terum-skills:begin -->\nold\n<!-- terum-skills:end -->\n';
    expect(applyReadme(existing, block)).toBe(`Intro\n\n${block.trimEnd()}\n`);
  });

  it('neutralizes block markers, pipes, newlines and backslashes in every interpolated field, so a poisoned field cannot wedge later writes', () => {
    const marker = '<!-- terum-skills:end -->';
    const hostile: ReadmeData = {
      ...data,
      team: { ...data.team, name: `team ${marker}` },
      people: [{ ...data.people[0]!, display_name: `Amy\n${marker}` }],
      skills: [{ ...data.skills[1]!, name: `first|${marker}`, category: 'test\\ing|x', author: `Amy <amy@example.com> ${marker}`, description: `Ends here ${marker}` }],
    };
    const block = generateReadme(hostile);
    expect(block.split('<!-- terum-skills:begin -->')).toHaveLength(2);
    expect(block.split(marker)).toHaveLength(2);
    expect(block).toContain('## team &lt;!-- terum-skills:end --> skills');
    expect(block).toContain('- @amy — Amy &lt;!-- terum-skills:end -->');
    expect(block).toContain('### Amy <amy@example.com> &lt;!-- terum-skills:end -->');
    const row = block.split('\n').find((line) => line.startsWith('| first'))!;
    expect(row).toContain('| first\\|&lt;!-- terum-skills:end --> | test\\\\ing\\|x | Ends here &lt;!-- terum-skills:end --> |');
    expect(row.split(/(?<!\\)\|/)).toHaveLength(10);
    const existing = 'Intro\n\n<!-- terum-skills:begin -->\nold\n<!-- terum-skills:end -->\n\nFooter\n';
    const once = applyReadme(existing, block);
    expect(applyReadme(once, generateReadme(hostile))).toBe(once);
    expect(once).toContain('\n\nFooter\n');
  });
});
