import { describe, expect, it } from 'vitest';
import { hygieneFrontmatter, inspectHygiene } from '../hygiene.js';

const ID = '11111111-1111-4111-8111-111111111111';
const skill = (extra = '', body = '') => `---\nname: sample\ndescription: useful skill\nlicense: Apache-2.0\nmetadata:\n  id: ${ID}\n  author: Author <author@authors.test>\n  terum-category: docs\n${extra}---\n${body}`;
const inspect = (files: Record<string, string | Buffer>, executable: readonly string[] = [], policy = 'Apache-2.0') => {
  const mapped = new Map(Object.entries(files).map(([path, contents]) => [path, Buffer.isBuffer(contents) ? contents : Buffer.from(contents)]));
  return inspectHygiene({ name: 'sample', frontmatter: hygieneFrontmatter(mapped.get('SKILL.md')!), files: mapped, executable: new Set(executable), policy: { skill_license: policy } });
};
const codes = (findings: ReturnType<typeof inspect>) => findings.errors.map((finding) => finding.code);

describe('inspectHygiene (§9)', () => {
  it('uses the existing line-numbered malformed allowed-tools message', () => {
    const findings = inspect({ 'SKILL.md': skill('allowed-tools:\n  bash: true\n') });
    expect(findings.errors).toMatchObject([{ code: 'HYG1', path: 'SKILL.md', line: 9, message: expect.stringContaining('allowed-tools is malformed (SKILL.md line 9)') }]);
  });

  it('flags bidi, zero-width, and mixed-script tokens while allowing multilingual prose', () => {
    for (const body of ['safe\u202Etext', 'safe\u200Btext', 'paypаl']) expect(codes(inspect({ 'SKILL.md': skill('', body) }))).toContain('HYG2');
    expect(codes(inspect({ 'SKILL.md': skill('', 'café Ελληνικά العربية 日本語') }))).not.toContain('HYG2');
  });

  it('allows the author email and placeholders but refuses third-party email addresses', () => {
    expect(codes(inspect({ 'SKILL.md': skill('', 'Author <author@authors.test>; hello@example.com') }))).not.toContain('HYG3');
    expect(codes(inspect({ 'SKILL.md': skill('', 'contact: third.party@company.com') }))).toContain('HYG3');
  });

  it('recognizes every HYG4 boundary: extension, shebang, binary scope, and executable mode', () => {
    expect(codes(inspect({ 'SKILL.md': skill(), 'notes.md': 'plain notes' }))).not.toContain('HYG4');
    expect(codes(inspect({ 'SKILL.md': skill(), 'payload.exe': 'not executable' }))).toContain('HYG4');
    expect(codes(inspect({ 'SKILL.md': skill(), 'tool.sh': '#!/bin/sh\necho ok' }))).toContain('HYG4');
    const binary = inspect({ 'SKILL.md': skill(), 'payload.exe': Buffer.from([0, 255, 7]) });
    expect(codes(binary)).toEqual(['HYG4']);
    const executable = inspect({ 'SKILL.md': skill(), 'script.js': 'export const x = 1;' }, ['script.js']);
    expect(codes(executable)).toEqual(['HYG4']);
  });

  it('compares normalized SPDX identifiers across frontmatter, policy, and bundled LICENSE files', () => {
    expect(codes(inspect({ 'SKILL.md': skill(), LICENSE: 'SPDX-License-Identifier: apache-2.0\n' }, [], ' apache-2.0 '))).not.toContain('HYG5');
    expect(codes(inspect({ 'SKILL.md': skill(), LICENSE: 'SPDX-License-Identifier: MIT\n' }))).toContain('HYG5');
    expect(codes(inspect({ 'SKILL.md': skill() }, [], 'MIT'))).toContain('HYG5');
  });

  it('enforces the SKILL.md character cap exactly and requires a non-blank description', () => {
    const prefix = skill('', ''); const atCap = `${prefix}${'x'.repeat(20_000 - prefix.length)}`;
    expect(codes(inspect({ 'SKILL.md': atCap }))).not.toContain('HYG6');
    expect(inspect({ 'SKILL.md': `${atCap}x` }).warnings.map((warning) => warning.code)).toContain('HYG6');
    expect(codes(inspect({ 'SKILL.md': skill().replace('description: useful skill', 'description: "   "') }))).toContain('HYG6');
  });
});

// Rev 16: callers cannot accidentally gate on a combined array length.
it('exposes separate error and warning tiers at the exact UTF-16 boundary', () => {
  const atCap = skill().padEnd(20_000, 'x');
  expect(inspect({ 'SKILL.md': atCap })).toEqual({ errors: [], warnings: [] });
  const assessment = inspect({ 'SKILL.md': `${atCap}x` });
  expect(assessment.errors).toEqual([]);
  expect(assessment.warnings).toEqual([{ code: 'HYG6', path: 'SKILL.md', message: 'SKILL.md is 20,001 characters, 1 over the 20,000-character guideline (~5k tokens). Size alone does not block this operation; loading this skill uses that much more context.' }]);
  // @ts-expect-error HygieneAssessment is not an array; errors alone gate.
  void inspectHygiene({ name: 'sample', frontmatter: {}, files: new Map(), executable: new Set(), policy: { skill_license: 'Apache-2.0' } }).length;
});
it.each([false, true])('blank description stays an error (oversized: %s)', (oversized) => {
  const text = skill().replace('description: useful skill', 'description: "   "');
  const assessment = inspect({ 'SKILL.md': oversized ? text.padEnd(20_001, 'x') : text });
  expect(assessment.errors).toEqual([expect.objectContaining({ code: 'HYG6', message: 'description must not be empty.' })]);
  expect(assessment.warnings).toHaveLength(oversized ? 1 : 0);
});
it('counts supplementary characters as two UTF-16 units', () => {
  const assessment = inspect({ 'SKILL.md': skill('', '\u{1D54F}'.repeat(10_001)) });
  expect(assessment.errors).toEqual([]);
  expect(assessment.warnings).toEqual([expect.objectContaining({ code: 'HYG6' })]);
});
