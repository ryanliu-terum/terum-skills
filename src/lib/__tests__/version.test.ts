import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfigStore } from '../config.js';
import { materializeVersion, resolveVersion } from '../version.js';
import { bareTeam, cloneWithIdentity, git, pushFromSeed } from './fixtures.js';

describe('version cache (§7)', () => {
  it('requires the full tree object returned by git for latest resolution', async () => {
    const tree = await resolveVersion('/clone', 'sample', undefined, { run: async () => ({ code: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' }) });
    expect(tree).toBe('a'.repeat(40));
  });

  it('rejects commits, the repository root tree, 39-character values, and non-hex pins while accepting a skill tree', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', '---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Me <me@example.com>\n  terum-category: testing\n---\n');
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone-pins'));
    const skillTree = (await git(['rev-parse', 'HEAD:skills/sample'], clone)).trim();
    const commit = (await git(['rev-parse', 'HEAD'], clone)).trim();
    const root = (await git(['rev-parse', 'HEAD^{tree}'], clone)).trim();
    await expect(resolveVersion(clone, 'sample', commit)).rejects.toThrow('skill tree');
    await expect(resolveVersion(clone, 'sample', root)).rejects.toThrow('SKILL.md');
    await expect(resolveVersion(clone, 'sample', skillTree.slice(0, 39))).rejects.toThrow();
    await expect(resolveVersion(clone, 'sample', 'z'.repeat(40))).rejects.toThrow();
    await expect(resolveVersion(clone, 'sample', skillTree.slice(0, 8))).resolves.toBe(skillTree);
  });

  it('materializes an immutable skill tree from a real bare repository', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', '---\nname: sample\ndescription: old\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Me <me@example.com>\n  terum-category: testing\n---\nold\n');
    await mkdir(join(fixture.seed, 'skills', 'sample', 'references'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'sample', 'references', 'note.md'), 'old note');
    await git(['add', '--all'], fixture.seed);
    await git(['commit', '-q', '-m', 'add reference'], fixture.seed);
    await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const store = createConfigStore(join(fixture.root, 'state'));
    const tree = await resolveVersion(clone, 'sample', undefined);
    const cached = await materializeVersion(store, 'team', clone, 'sample', tree);
    expect(await readFile(join(cached, 'SKILL.md'), 'utf8')).toContain('description: old');
    expect(await readFile(join(cached, 'references', 'note.md'), 'utf8')).toBe('old note');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', '---\nname: sample\ndescription: new\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Me <me@example.com>\n  terum-category: testing\n---\nnew\n');
    expect(await materializeVersion(store, 'team', clone, 'sample', tree)).toBe(cached);
    expect(await readFile(join(cached, 'SKILL.md'), 'utf8')).toContain('description: old');
  });
});
