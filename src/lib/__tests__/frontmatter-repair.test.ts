import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { repairFrontmatter } from '../frontmatter-repair.js';
import { inspectSkillSource } from '../skill-source.js';

const DESCRIPTION = 'Cross-model spec auditor. Same four dimensions as /ultraspec (cross-spec drift, spec-vs-code reality), but the FINDERS run on OpenAI Codex — the mirror image of /hybrid-review. Use when a spec was written by Claude and you don\'t want the author\'s blind spots. The default flow ends in a triage: every confirmed finding is sorted into mechanical / clear / fork / declined, so the run finishes with "apply this batch on one confirmation" — never with an autonomous rewrite. Args: <path-to-spec> [--dims <list>] [--tier astra|sol|terra|luna] [--no-triage].';
const BODY = '\n\nAudit a planning spec with **Codex finding and Claude verifying**.\n\n## Why: this exists\n\nkey: value lines in the body stay alone.\n';

function skill(frontmatter: string, eol = '\n'): string { return `---${eol}${frontmatter.split('\n').join(eol)}${eol}---${BODY.split('\n').join(eol)}`; }

describe('repairFrontmatter', () => {
  it('quotes a description whose prose contains colon-space and leaves every other byte alone', () => {
    const raw = skill(`name: codex-spec\ndescription: ${DESCRIPTION}\nmetadata:\n  terum-category: review # keep\nallowed-tools: Bash, Read`);
    expect(inspectSkillSource(raw, 'codex-spec')).toMatchObject({ ok: false, reason: 'invalid-yaml' });
    const result = repairFrontmatter(raw);
    expect(result).toMatchObject({ ok: true, rewritten: ['description'] });
    if (!result.ok) return;
    expect(inspectSkillSource(result.source, 'codex-spec')).toMatchObject({ ok: true, description: DESCRIPTION });
    const lines = result.source.split('\n');
    expect(lines[1]).toBe('name: codex-spec');
    expect(lines[2]).not.toBe(`description: ${DESCRIPTION}`);
    expect(lines.slice(3, 7)).toEqual(['metadata:', '  terum-category: review # keep', 'allowed-tools: Bash, Read', '---']);
    expect(result.source.endsWith(BODY)).toBe(true);
    // The rewritten line is one line: the repair never folds a long description across lines.
    expect(lines[2]).toMatch(/^description: /);
  });

  it('repairs several culprit lines and reports each key', () => {
    const result = repairFrontmatter(skill('name: two\ndescription: Runs a: thing\nlicense: Apache: 2.0'));
    expect(result).toMatchObject({ ok: true, rewritten: ['description', 'license'] });
    if (!result.ok) return;
    expect(YAML.parse(/^---\n([\s\S]*?)\n---/.exec(result.source)![1]!)).toEqual({ name: 'two', description: 'Runs a: thing', license: 'Apache: 2.0' });
  });

  it('preserves CRLF line endings', () => {
    const result = repairFrontmatter(skill('name: crlf\ndescription: a: b', '\r\n'));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.source.startsWith('---\r\nname: crlf\r\ndescription: ')).toBe(true);
    expect(result.source).not.toMatch(/[^\r]\n/);
    expect(inspectSkillSource(result.source, 'crlf')).toMatchObject({ ok: true, description: 'a: b' });
  });

  it('does not touch a file that already parses, even one with a quoted colon', () => {
    expect(repairFrontmatter(skill('name: fine\ndescription: "a: b"'))).toEqual({ ok: false, reason: 'already-valid', detail: 'frontmatter is already valid YAML' });
    expect(repairFrontmatter(skill('name: fine\ndescription: plain'))).toMatchObject({ ok: false, reason: 'already-valid' });
  });

  it('refuses faults the colon rule does not explain instead of guessing', () => {
    expect(repairFrontmatter(skill('name: [\ndescription: x'))).toMatchObject({ ok: false, reason: 'unrepairable', detail: expect.stringMatching(/./) });
    // A nested culprit is not top-level: the rule leaves it and reports the original diagnostic.
    expect(repairFrontmatter(skill('name: n\ndescription: x\nmetadata:\n  note: a: b'))).toMatchObject({ ok: false, reason: 'unrepairable' });
    // A bad indentation fault in the same file as a colon culprit still fails closed.
    expect(repairFrontmatter(skill('name: n\ndescription: a: b\n  stray: indent'))).toMatchObject({ ok: false, reason: 'unrepairable' });
  });

  it('reports a file with no frontmatter', () => {
    expect(repairFrontmatter('# just a body\n')).toEqual({ ok: false, reason: 'no-frontmatter', detail: 'SKILL.md has no YAML frontmatter' });
  });
});
