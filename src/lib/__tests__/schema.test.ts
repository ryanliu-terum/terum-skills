import { describe, expect, it } from 'vitest';
import { allowedTools, handleSchema, parseJson, parseOrExplain, parseSkillFrontmatter, personSchema, teamNameSchema, teamSchema } from '../schema.js';

const FRONT = (extra = '') => `---\nname: x\ndescription: x\nlicense: x\nmetadata:\n  id: 4e80fd2a-04bc-4d9f-88f7-a849d92879f1\n  author: A <a@b.test>\n  terum-category: docs\n${extra}---\n\n# Title\n\nBody: with a colon\n- and a list\n`;

describe('allowed-tools normalization (§5.4)', () => {
  it('absent, empty, a bare key, a sequence, and a comma string all hash; order never matters', () => {
    expect(allowedTools(undefined)).toMatchObject({ ok: true, normalized: 'none' });
    expect(allowedTools(null)).toMatchObject({ ok: true, normalized: 'none' });
    expect(allowedTools('')).toMatchObject({ ok: true, normalized: 'none' });
    expect(allowedTools([])).toMatchObject({ ok: true, normalized: 'none' });
    expect(allowedTools(', ,')).toMatchObject({ ok: true, normalized: 'none' });
    expect(allowedTools(['Bash(*)', ' Read(*) ', 'Bash(*)'])).toMatchObject({ ok: true, normalized: 'Bash(*)\nRead(*)' });
    expect(allowedTools('Read(*), Bash(*)')).toMatchObject({ ok: true, normalized: 'Bash(*)\nRead(*)' });
    expect((allowedTools(['Read(*)', 'Bash(*)']) as { hash: string }).hash).toBe((allowedTools('Bash(*),Read(*)') as { hash: string }).hash);
    expect((allowedTools(['Read(*)']) as { hash: string }).hash).not.toBe((allowedTools(['Read(*)', 'Bash(*)']) as { hash: string }).hash);
  });

  it('malformed is never none: mapping, number, boolean, nested sequence, unparseable YAML', () => {
    expect(allowedTools({ Bash: '*' })).toEqual({ ok: false, raw: { Bash: '*' } });
    expect(allowedTools(42)).toEqual({ ok: false, raw: 42 });
    expect(allowedTools(true)).toEqual({ ok: false, raw: true });
    expect(allowedTools([['Bash(*)']])).toMatchObject({ ok: false });
    expect(parseSkillFrontmatter(FRONT('allowed-tools: [\n'))).toMatchObject({ ok: false });
    expect(parseSkillFrontmatter(FRONT('allowed-tools:\n  Bash: "*"\n'))).toMatchObject({ ok: true, grants: { ok: false } });
  });
});

describe('frontmatter (§5.3)', () => {
  it('parses a whole SKILL.md, rejects unknown top-level keys, and reads a bare allowed-tools line as none', () => {
    expect(parseSkillFrontmatter(FRONT())).toMatchObject({ ok: true, data: { name: 'x' }, grants: { normalized: 'none' } });
    expect(parseSkillFrontmatter(FRONT('allowed-tools:\n'))).toMatchObject({ ok: true, grants: { normalized: 'none' } });
    expect(parseSkillFrontmatter(FRONT('allowed-tools: Read(*)\n'))).toMatchObject({ ok: true, grants: { normalized: 'Read(*)' } });
    expect(parseSkillFrontmatter(FRONT('custom: no\n'))).toMatchObject({ ok: false });
    expect(parseSkillFrontmatter('# no frontmatter\n')).toMatchObject({ ok: false, error: expect.stringContaining('no YAML frontmatter') });
  });

  it('preserves unknown team.json fields', () => {
    expect(teamSchema.parse({ layout_version: 2, name: 'x', categories: [], global: [], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' }, future: true }).future).toBe(true);
  });
});

describe('handles and team names (§5.4)', () => {
  it('lowercases, allows single internal hyphens, and rejects everything else', () => {
    expect(handleSchema.parse('RyanLiu')).toBe('ryanliu');
    expect(handleSchema.parse('  ajay-t ')).toBe('ajay-t');
    for (const bad of ['a--b', '-a', 'a-', '', 'a b', 'a'.repeat(40), 'ryan_liu']) expect(handleSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('validation errors read as rules, never as a JSON issue dump', () => {
    expect(() => parseOrExplain(handleSchema, 'a--b', 'team handle')).toThrow(/^Invalid team handle: .*single internal hyphens/);
    expect(() => parseJson(personSchema, '{"handle":"me"}', 'people/me.json')).toThrow(/^Invalid people\/me\.json: display_name: /);
    expect(() => parseJson(personSchema, '{not json', 'people/me.json')).toThrow(/^Invalid people\/me\.json: /);
    expect(() => parseOrExplain(teamNameSchema, '../x', 'team name')).not.toThrow(/\[/);
  });

  it('accepts only GitHub-login syntax in people records', () => {
    const valid = { handle: 'me', display_name: 'Me', email: 'me@example.com', github: 'me-gh', bio: '', installed: [], declined: [] };
    expect(personSchema.safeParse(valid).success).toBe(true);
    for (const github of ['x/../repos/acme/other', 'bad--login', ' ']) expect(personSchema.safeParse({ ...valid, github }).success, github).toBe(false);
    // Optional (rev 9): a generic-git member may have no GitHub account; an empty value is never identity evidence.
    expect(personSchema.safeParse({ ...valid, github: '' }).success).toBe(true);
  });

  it('team names are safe directory and repository names', () => {
    expect(teamNameSchema.safeParse('team-skills-terum').success).toBe(true);
    for (const bad of ['../x', '.hidden', 'a/b', '', 'a b', 'x'.repeat(101)]) expect(teamNameSchema.safeParse(bad).success, bad).toBe(false);
  });
});
