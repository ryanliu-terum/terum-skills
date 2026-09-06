import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
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

  it.skipIf(sep === '\\')('keeps a POSIX backslash in a filename as its own digest key instead of folding it into a path separator', async () => {
    const root = await temporaryDirectory();
    const flat = join(root, 'flat'); const nested = join(root, 'nested');
    await mkdir(flat); await writeFile(join(flat, 'docs\\readme.md'), 'same bytes');
    await mkdir(join(nested, 'docs'), { recursive: true }); await writeFile(join(nested, 'docs', 'readme.md'), 'same bytes');
    expect(await canonicalDigest(flat)).not.toBe(await canonicalDigest(nested));
  });

  it.skipIf(sep === '\\')('gives two files and one file whose name spells their digest records different digests (the record stream is prefix-free)', async () => {
    const root = await temporaryDirectory();
    const two = join(root, 'two'); const one = join(root, 'one');
    await mkdir(two); await writeFile(join(two, 'x'), 'C1'); await writeFile(join(two, 'y'), 'C2');
    await mkdir(one); await writeFile(join(one, `x:${createHash('sha256').update('C1').digest('hex')}\ny`), 'C2');
    expect(await canonicalDigest(two)).not.toBe(await canonicalDigest(one));
  });
});
