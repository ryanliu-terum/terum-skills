import { describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfigStore } from '../config.js';
import { systemRunner } from '../runner.js';
import { materializeVersion, resolveVersion } from '../version.js';
import { bareTeam, cloneWithIdentity, git, pushFromSeed, wrapRunner } from './fixtures.js';

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

  it('lets two processes materialize the same tree at once (a hook sync racing a manual install), leaving one complete entry and no staging litter', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', '---\nname: sample\ndescription: race\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Me <me@example.com>\n  terum-category: testing\n---\nrace\n');
    await mkdir(join(fixture.seed, 'skills', 'sample', 'references'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'sample', 'references', 'note.md'), 'note');
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'add reference'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const store = createConfigStore(join(fixture.root, 'state'));
    const tree = await resolveVersion(clone, 'sample', undefined);
    const [a, b] = await Promise.all([materializeVersion(store, 'team', clone, 'sample', tree), materializeVersion(store, 'team', clone, 'sample', tree)]);
    const expected = join(store.root, 'cache', 'team', tree, 'sample');
    expect(a).toBe(expected); expect(b).toBe(expected);
    expect(await readFile(join(expected, 'SKILL.md'), 'utf8')).toContain('description: race');
    expect(await readFile(join(expected, 'references', 'note.md'), 'utf8')).toBe('note');
    expect(await readdir(join(store.root, 'cache', 'team', tree))).toEqual(['sample']);
  });

  it('leaves no staging directory or index file behind when the checkout fails', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', '---\nname: sample\ndescription: fail\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Me <me@example.com>\n  terum-category: testing\n---\n');
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const store = createConfigStore(join(fixture.root, 'state'));
    const tree = await resolveVersion(clone, 'sample', undefined);
    const failing = wrapRunner(systemRunner, async (command, args, _options, next) => (command === 'git' && args[0] === 'checkout-index' ? { code: 1, stdout: '', stderr: 'boom' } : next()));
    await expect(materializeVersion(store, 'team', clone, 'sample', tree, failing)).rejects.toThrow('git checkout-index failed');
    expect(await readdir(join(store.root, 'cache', 'team', tree))).toEqual([]);
  });
});
