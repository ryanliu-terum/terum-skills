import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { planRepairs } from '../skill-repair.js';

const buf = (text: string): Buffer => Buffer.from(text, 'utf8');
const fm = (yaml: string, body = 'Body\n'): string => `---\n${yaml}\n---\n${body}`;
function plan(files: Record<string, string | Buffer>, options: { name?: string; executable?: string[]; policyLicense?: string | null } = {}) {
  return planRepairs({ name: options.name ?? 'alpha', files: new Map(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? buf(value) : value])), executable: new Set(options.executable ?? []), policyLicense: options.policyLicense ?? null });
}
const frontmatterOf = (plan: ReturnType<typeof planRepairs>): Record<string, unknown> => YAML.parse(/^---\n([\s\S]*?)\n---/.exec(plan.writes.get('SKILL.md')!.toString('utf8'))![1]!) as Record<string, unknown>;

describe('planRepairs', () => {
  it('leaves a clean folder alone', () => {
    expect(plan({ 'SKILL.md': fm('name: alpha\ndescription: fine'), 'notes.txt': 'plain' })).toEqual({ writes: new Map(), clearExecutable: [], repaired: [] });
  });

  it('sets name to the folder name, but not when the folder name is itself illegal', () => {
    const fixed = plan({ 'SKILL.md': fm('name: other # keep me\ndescription: fine') });
    expect(fixed.repaired).toEqual(['Set name to `alpha` to match the folder (was `other`).']);
    expect(fixed.writes.get('SKILL.md')!.toString('utf8')).toBe(fm('name: alpha # keep me\ndescription: fine'));
    expect(plan({ 'SKILL.md': fm('name: other\ndescription: fine') }, { name: 'Bad Name' }).repaired).toEqual([]);
    expect(plan({ 'SKILL.md': fm('description: fine') }).repaired).toEqual(['Set name to `alpha` to match the folder.']);
  });

  it('sets license to the team policy only when a policy exists and the declared license differs after normalisation', () => {
    expect(plan({ 'SKILL.md': fm('name: alpha\ndescription: fine\nlicense: MIT') }).repaired).toEqual([]);
    expect(plan({ 'SKILL.md': fm('name: alpha\ndescription: fine\nlicense: MIT License') }, { policyLicense: 'MIT' }).repaired).toEqual([]);
    expect(plan({ 'SKILL.md': fm('name: alpha\ndescription: fine') }, { policyLicense: 'MIT' }).repaired).toEqual([]);
    const fixed = plan({ 'SKILL.md': fm('name: alpha\ndescription: fine\nlicense: MIT') }, { policyLicense: 'Apache-2.0' });
    expect(fixed.repaired).toEqual(["Set license to `Apache-2.0`, the team's policy (was `MIT`)."]);
    expect(frontmatterOf(fixed)).toEqual({ name: 'alpha', description: 'fine', license: 'Apache-2.0' });
  });

  it('strips HYG2 invisible characters from every text file and skips binaries', () => {
    const fixed = plan({ 'SKILL.md': fm('name: alpha\ndescription: fine', 'a\u200Bb\u202Ec\n'), 'ref.md': '\uFEFFbom and \u2060joiner', 'blob.bin': Buffer.from([0x50, 0x4b, 0x00, 0x01, 0xe2, 0x80, 0x8b]), 'clean.txt': 'nothing' });
    expect(fixed.repaired).toEqual(['Removed 2 invisible characters from SKILL.md.', 'Removed 2 invisible characters from ref.md.']);
    expect(fixed.writes.get('SKILL.md')!.toString('utf8')).toBe(fm('name: alpha\ndescription: fine', 'abc\n'));
    expect(fixed.writes.get('ref.md')!.toString('utf8')).toBe('bom and joiner');
    expect([...fixed.writes.keys()]).toEqual(['SKILL.md', 'ref.md']);
  });

  it('clears the executable mode on non-scripts and binaries but keeps a shebang script', () => {
    const fixed = plan({ 'SKILL.md': fm('name: alpha\ndescription: fine'), 'notes.txt': 'plain', 'run.sh': '#!/bin/sh\necho hi\n', 'tool.bin': Buffer.from([0, 1, 2]) }, { executable: ['notes.txt', 'run.sh', 'tool.bin'] });
    expect(fixed.clearExecutable).toEqual(['notes.txt', 'tool.bin']);
    expect(fixed.repaired).toEqual(['Cleared the executable mode on notes.txt.', 'Cleared the executable mode on tool.bin.']);
    expect(fixed.writes.size).toBe(0);
  });

  it('applies the colon quote first so name and license can be edited through the parsed document, keeping text, comments and body', () => {
    const description = 'Ends in a triage: every finding sorted. Args: <path>';
    const fixed = plan({ 'SKILL.md': fm(`name: other\ndescription: ${description}\nlicense: MIT\nmetadata:\n  terum-category: review # kept`, 'Body: stays\u200B\n') }, { policyLicense: 'Apache-2.0' });
    expect(fixed.repaired).toEqual([
      'Quoted `description` in SKILL.md so the frontmatter parses; the text is unchanged.',
      'Set name to `alpha` to match the folder (was `other`).',
      "Set license to `Apache-2.0`, the team's policy (was `MIT`).",
      'Removed 1 invisible character from SKILL.md.',
    ]);
    const text = fixed.writes.get('SKILL.md')!.toString('utf8');
    expect(frontmatterOf(fixed)).toEqual({ name: 'alpha', description, license: 'Apache-2.0', metadata: { 'terum-category': 'review' } });
    expect(text).toContain('  terum-category: review # kept\n');
    expect(text.endsWith('---\nBody: stays\n')).toBe(true);
  });

  it('does not touch a frontmatter it cannot parse even after quoting', () => {
    const fixed = plan({ 'SKILL.md': fm('name: [\ndescription: fine') });
    expect(fixed).toEqual({ writes: new Map(), clearExecutable: [], repaired: [] });
  });
});
