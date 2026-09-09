import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRoster, canonicalDigest, declaredCategory, findSkill, injectManagedFields } from '../skills.js';
import { parseSkillFrontmatter } from '../schema.js';
import { bareTeam, person, TEAM_JSON, temporaryDirectory } from './fixtures.js';

describe('skills (§5.3 canonical frontmatter)', () => {
  it('generates the whole metadata block for an off-the-shelf SKILL.md — id, author, license, and misc as the category — and never overwrites a declared category', () => {
    const values = { license: 'UNLICENSED', id: '11111111-1111-4111-8111-111111111111', author: 'Me <me@example.com>' };
    // No `metadata:` block at all (what every stock Claude skill looks like), a bare `metadata:` (YAML
    // reads it as null), a scalar where the map should be, and a category key with no value.
    for (const [label, source] of [
      ['no block', '---\nname: sample\ndescription: stock skill\n---\nbody\n'],
      ['bare key', '---\nname: sample\ndescription: stock skill\nmetadata:\n---\nbody\n'],
      ['scalar', '---\nname: sample\ndescription: stock skill\nmetadata: nope\n---\nbody\n'],
      ['empty category', '---\nname: sample\ndescription: stock skill\nmetadata:\n  terum-category:\n---\nbody\n'],
    ] as const) {
      const injected = injectManagedFields(source, values);
      const parsed = parseSkillFrontmatter(injected);
      expect(parsed.ok, label).toBe(true);
      if (parsed.ok) expect(parsed.data.metadata, label).toMatchObject({ id: values.id, author: values.author, 'terum-category': 'misc' });
      expect(injected, label).toMatch(/\n---\nbody\n$/);
      expect(declaredCategory(source), label).toBeUndefined();
      expect(declaredCategory(injected), label).toBe('misc');
    }
    const declared = '---\nname: sample\ndescription: stock skill\nmetadata:\n  terum-category: testing\n---\n';
    expect(declaredCategory(declared)).toBe('testing');
    expect(injectManagedFields(declared, values)).toContain('terum-category: testing');
    expect(injectManagedFields(declared, values)).not.toContain('misc');
    expect(injectManagedFields(declared, { ...values, category: 'docs' })).toContain('terum-category: testing');
  });

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

  it.skipIf(sep === '\\')('pins the digest wire format: the persisted `config.shared[].baseline` is sha256 over sorted `path:<sha256>\\n` records, with a `:` in a filename left as it is', async () => {
    const root = await temporaryDirectory();
    const dir = join(root, 'skill');
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'a.md'), 'A\n'); await writeFile(join(dir, 'docs', 'b.md'), 'B\n');
    // This constant IS the on-disk record format of config.shared[].baseline: changing it moves every
    // stored baseline and needs a migration, so a red line here is not fixed by pasting the new hex.
    expect(await canonicalDigest(dir)).toBe('sha256:bfb8b2671c85b3fd72fc32d22dc345b5f09c3590e8cb996a6a89b6d884fdb3eb');
    await writeFile(join(dir, 'notes:2026-09.md'), 'N\n');
    const records = [['a.md', 'A\n'], ['docs/b.md', 'B\n'], ['notes:2026-09.md', 'N\n']].map(([path, content]) => `${path}:${createHash('sha256').update(content!).digest('hex')}\n`).join('');
    expect(await canonicalDigest(dir)).toBe(`sha256:${createHash('sha256').update(records).digest('hex')}`);
  });

  it.skipIf(sep === '\\')('gives two files and one file whose name spells their digest records different digests (the record stream is prefix-free)', async () => {
    const root = await temporaryDirectory();
    const two = join(root, 'two'); const one = join(root, 'one');
    await mkdir(two); await writeFile(join(two, 'x'), 'C1'); await writeFile(join(two, 'y'), 'C2');
    await mkdir(one); await writeFile(join(one, `x:${createHash('sha256').update('C1').digest('hex')}\ny`), 'C2');
    expect(await canonicalDigest(two)).not.toBe(await canonicalDigest(one));
  });
});

it('readRoster checks filename identity before archives, reports bad files, and sorts handles rather than filenames', async () => {
  const { seed } = await bareTeam();
  await writeFile(join(seed, 'team.json'), JSON.stringify({ ...TEAM_JSON, archived: ['old', 'seed'] }));
  for (const handle of ['a-b', 'a', 'b', 'a0']) await writeFile(join(seed, 'people', `${handle}.json`), JSON.stringify(person(handle)));
  await writeFile(join(seed, 'people', 'old.json'), JSON.stringify(person('new')));
  await writeFile(join(seed, 'people', 'broken.json'), '{');
  const result = await readRoster(seed);
  expect(result.roster).toEqual(['a', 'a-b', 'a0', 'b'].map((handle) => ({ handle, displayName: handle, role: null, projects: [] })));
  expect(result.problems.map((problem) => problem.file)).toEqual(['people/broken.json', 'people/old.json']);
  expect(result.problems.every((problem) => problem.message.length > 0)).toBe(true);
});
