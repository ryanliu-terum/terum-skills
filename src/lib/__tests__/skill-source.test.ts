import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectSkillSource, scanSkillFolder } from '../skill-source.js';
import { temporaryDirectory } from './fixtures.js';

describe('shared source inspection', () => {
  it('accepts stock sources and the stored frontmatter delimiter, including CRLF', () => {
    expect(inspectSkillSource('---\r\nname: stock\r\ndescription: x\r\n---\r\n', 'stock')).toEqual({ ok: true, description: 'x', id: null });
    expect(inspectSkillSource('---\nname: stock\ndescription: x\n---invalid', 'stock')).toMatchObject({ ok: false, reason: 'no-frontmatter', detail: 'SKILL.md has no YAML frontmatter' });
  });

  it.each([
    ['Bad', 'name: Bad\ndescription: x', 'illegal-name', 'folder name is not a legal skill name (1–64 lowercase alphanumerics or single hyphens)'],
    ['stock', 'name: other\ndescription: x', 'name-mismatch', 'SKILL.md name other does not equal folder stock'],
    ['stock', 'name: stock', 'description-missing', 'description is missing'],
    ['stock', 'name: stock\ndescription: x\nargument-hint: x', 'unsupported-field', 'unsupported top-level field argument-hint (only name, description, license, metadata, allowed-tools)'],
    ['stock', 'name: stock\ndescription: x\nallowed-tools: {bash: true}', 'malformed-allowed-tools', 'allowed-tools is malformed (SKILL.md line 4)'],
  ])('explains %s source refusal %s', (name, yaml, reason, detail) => {
    expect(inspectSkillSource(`---\n${yaml}\n---\n`, name)).toMatchObject({ ok: false, reason, detail });
  });

  it('returns a YAML diagnostic instead of throwing', () => {
    expect(inspectSkillSource('---\nname: [\n---\n', 'stock')).toMatchObject({ ok: false, reason: 'invalid-yaml', detail: expect.stringMatching(/^SKILL.md frontmatter is not valid YAML: /) });
  });

  it('one walk reports a nested link and privileged content without following links', async () => {
    const root = await temporaryDirectory(); await mkdir(join(root, 'hooks')); await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'hooks', 'hook.json'), '{}'); await symlink(root, join(root, 'assets', 'cycle'));
    expect(await scanSkillFolder(root)).toEqual({ symlink: join(root, 'assets', 'cycle'), privileged: true });
  });
});
