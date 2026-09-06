import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalDigest, findSkill, injectManagedFields } from '../skills.js';
import { temporaryDirectory } from './fixtures.js';

describe('skills (§5.3 canonical frontmatter)', () => {
  it('ignores managed fields, retains YAML presentation, and rejects ambiguous ID prefixes', async () => {
    const root = await temporaryDirectory();
    const skill = join(root, 'skill');
    await mkdir(skill);
    const source = '---\n# keep this comment\nname: sample\ndescription: "quoted"\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Me <me@example.com>\n  terum-category: testing\n---\nbody one\n';
    await writeFile(join(skill, 'SKILL.md'), source);
    const baseline = await canonicalDigest(skill);
    const injected = injectManagedFields(source, { license: 'Apache-2.0', id: '22222222-2222-4222-8222-222222222222', author: 'New <new@example.com>' });
    expect(injected).toContain('# keep this comment');
    expect(injected).toContain('description: "quoted"');
    await writeFile(join(skill, 'SKILL.md'), injected);
    expect(await canonicalDigest(skill)).toBe(baseline);
    await writeFile(join(skill, 'SKILL.md'), `${injected}changed\n`);
    expect(await canonicalDigest(skill)).not.toBe(baseline);

    const clone = join(root, 'clone');
    for (const [name, id] of [['one', 'deadbeef-0000-4000-8000-000000000001'], ['two', 'deadbeef-0000-4000-8000-000000000002']] as const) {
      await mkdir(join(clone, 'skills', name), { recursive: true });
      await writeFile(join(clone, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Me <me@example.com>\n  terum-category: testing\n---\n`);
    }
    await expect(findSkill(clone, 'team', 'deadbeef')).rejects.toThrow('ambiguous');
  });
});
