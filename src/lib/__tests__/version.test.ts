import { describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfigStore } from '../config.js';
import { systemRunner } from '../runner.js';
import { contentVersion, materializeVersion, resolveSkillTrees, resolveVersion } from '../version.js';
import { hasSkillTree } from '../content-tree.js';
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

describe('a version is the skill without its eval assets (Ajay, 2026-09-13)', () => {
  const SKILL = '---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Me <me@example.com>\n  terum-category: testing\n---\n';
  const pull = async (clone: string) => { await git(['fetch', '-q', 'origin'], clone); await git(['reset', '-q', '--hard', 'origin/main'], clone); };

  it('holds still while eval assets change, and moves when the skill changes', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', SKILL);
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    // A skill with no eval assets hashes to exactly the tree it already had: nothing about it moves.
    const version = await resolveVersion(clone, 'sample', undefined);
    expect(version).toBe((await git(['rev-parse', 'HEAD:skills/sample'], clone)).trim());

    await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    await pull(clone);
    expect(await resolveVersion(clone, 'sample', undefined)).toBe(version);
    expect((await git(['rev-parse', 'HEAD:skills/sample'], clone)).trim()).not.toBe(version);
    const trees = await resolveSkillTrees(clone, 'sample');
    expect(trees).toMatchObject({ content: version, evalAssets: (await git(['rev-parse', 'HEAD:skills/sample/evals'], clone)).trim() });

    // What a version materializes is the skill a teammate runs — the eval dataset never places.
    expect(await readdir(await materializeVersion(store, 'team', clone, 'sample', version))).toEqual(['SKILL.md']);

    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `${SKILL}Deploy carefully.\n`);
    await pull(clone);
    expect(await resolveVersion(clone, 'sample', undefined)).not.toBe(version);
  });

  it('re-mints a version another machine wrote, from the hash alone', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', SKILL);
    await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    // Edit the skill AFTER its assets exist: this content tree never stood alone in history, so
    // nothing but a re-mint can produce it — the case a plain object lookup cannot rescue.
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `${SKILL}Deploy carefully.\n`);
    const theirs = await cloneWithIdentity(fixture.bare, join(fixture.root, 'theirs'));
    const version = await resolveVersion(theirs, 'sample', undefined);
    const store = createConfigStore(join(fixture.root, 'state'));
    const mine = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    // A content tree is minted locally and never pushed, so a fresh clone does not have the object
    // their receipt names — every consumer of a version has to be able to rebuild it.
    expect((await systemRunner.run('git', ['cat-file', '-t', version], { cwd: mine })).code).not.toBe(0);
    expect(await readdir(await materializeVersion(store, 'team', mine, 'sample', version))).toEqual(['SKILL.md']);
    await expect(resolveVersion(mine, 'sample', version)).resolves.toBe(version);
    expect(await contentVersion(mine, (await git(['rev-parse', 'HEAD:skills/sample'], mine)).trim())).toBe(version);
  });

  it('answers "is this version in the repository" from history, not the object database', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', SKILL);
    await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `${SKILL}Deploy carefully.\n`);
    const theirs = await cloneWithIdentity(fixture.bare, join(fixture.root, 'theirs'));
    const version = await resolveVersion(theirs, 'sample', undefined);
    const mine = await cloneWithIdentity(fixture.bare, join(fixture.root, 'mine'));
    // An install pin travels in people/*.json, so a teammate's version reaches a clone that never
    // minted it. Sync's blocked sub-case must keep meaning "newer than this clone, or rewritten".
    await expect(hasSkillTree(mine, 'sample', version)).resolves.toBe(true);
    await expect(hasSkillTree(mine, 'sample', 'b'.repeat(40))).resolves.toBe(false);
  });
});
