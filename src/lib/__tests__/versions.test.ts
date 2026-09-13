import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION_FOLDER, parseVersionFolder, versionFolderName, versionLabel, versionsInTree } from '../versions.js';
import { listVersions } from '../teamRepo.js';

/** The `paths(prefix)` half of `MutableTree`: full repo-relative paths, unstripped (teamRepo.ts:325). */
function tree(paths: readonly string[]) {
  return { paths: (prefix = '') => paths.filter((path) => path.startsWith(prefix)).sort() };
}

describe('parseVersionFolder', () => {
  it('accepts only v<N> with no leading zero, N >= 1', () => {
    expect(parseVersionFolder('v1')).toBe(1);
    expect(parseVersionFolder('v2')).toBe(2);
    expect(parseVersionFolder('v10')).toBe(10);
    expect(parseVersionFolder('v137')).toBe(137);
  });

  it('rejects every near-miss spelling, so ordinal -> folder name stays a bijection', () => {
    for (const name of ['v0', 'v03', 'V3', 'version 3', 'v1.0', 'v-1', 'v', '3', 'v1a', ' v1', 'v1 ', 'v+1', 'v1/', 'evals', 'skills']) {
      expect(parseVersionFolder(name), name).toBeNull();
    }
  });

  it('rejects an ordinal too large to be a safe integer', () => {
    expect(parseVersionFolder(`v${'9'.repeat(25)}`)).toBeNull();
  });

  it('VERSION_FOLDER is not sticky or global, so repeated tests do not alternate', () => {
    expect(VERSION_FOLDER.test('v1')).toBe(true);
    expect(VERSION_FOLDER.test('v1')).toBe(true);
  });
});

describe('versionFolderName and versionLabel', () => {
  it('round-trips through the parser', () => {
    for (const n of [1, 2, 9, 10, 11, 100]) expect(parseVersionFolder(versionFolderName(n))).toBe(n);
  });

  it('renders the one UI form', () => {
    expect(versionLabel(1)).toBe('Version 1');
    expect(versionLabel(12)).toBe('Version 12');
  });
});

describe('versionsInTree', () => {
  it('sorts numerically descending, not lexicographically — the two-digit case', () => {
    const paths = ['skills/deploy-check/v2/SKILL.md', 'skills/deploy-check/v10/SKILL.md', 'skills/deploy-check/v1/SKILL.md'];
    expect(versionsInTree(tree(paths), 'deploy-check')).toEqual([
      { folder: 'v10', n: 10 }, { folder: 'v2', n: 2 }, { folder: 'v1', n: 1 },
    ]);
  });

  it('reports one entry per version however many files it holds', () => {
    const paths = [
      'skills/deploy-check/v1/SKILL.md',
      'skills/deploy-check/v1/evals/triggers.yaml',
      'skills/deploy-check/v1/evals/cases/a.yaml',
    ];
    expect(versionsInTree(tree(paths), 'deploy-check')).toEqual([{ folder: 'v1', n: 1 }]);
  });

  it('ignores other skills, and non-version folders under this one', () => {
    const paths = [
      'skills/deploy-check/v1/SKILL.md',
      'skills/deploy-check/evals/cases/legacy.yaml',
      'skills/deploy-check/SKILL.md',
      'skills/other-skill/v9/SKILL.md',
      'team.json',
    ];
    expect(versionsInTree(tree(paths), 'deploy-check')).toEqual([{ folder: 'v1', n: 1 }]);
  });

  it('does not confuse a skill whose name prefixes another', () => {
    const paths = ['skills/deploy/v3/SKILL.md', 'skills/deploy-check/v1/SKILL.md'];
    expect(versionsInTree(tree(paths), 'deploy')).toEqual([{ folder: 'v3', n: 3 }]);
  });

  it('is empty for a name with no versions', () => {
    expect(versionsInTree(tree(['skills/other/v1/SKILL.md']), 'deploy-check')).toEqual([]);
  });
});

describe('listVersions', () => {
  async function clone(layout: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'versions-'));
    for (const [path, content] of Object.entries(layout)) {
      await mkdir(join(root, path.split('/').slice(0, -1).join('/')), { recursive: true });
      await writeFile(join(root, path), content);
    }
    return root;
  }

  it('sorts numerically descending, not lexicographically — the two-digit case', async () => {
    const root = await clone({
      'skills/deploy-check/v1/SKILL.md': 'a',
      'skills/deploy-check/v2/SKILL.md': 'b',
      'skills/deploy-check/v10/SKILL.md': 'c',
    });
    expect(await listVersions(root, 'deploy-check')).toEqual([
      { folder: 'v10', n: 10 }, { folder: 'v2', n: 2 }, { folder: 'v1', n: 1 },
    ]);
  });

  it('is [] for an absent skill folder rather than throwing', async () => {
    const root = await clone({ 'team.json': '{}' });
    expect(await listVersions(root, 'deploy-check')).toEqual([]);
  });

  it('ignores files and non-version directories', async () => {
    const root = await clone({
      'skills/deploy-check/v1/SKILL.md': 'a',
      'skills/deploy-check/SKILL.md': 'legacy',
      'skills/deploy-check/evals/cases/a.yaml': 'legacy',
      'skills/deploy-check/v0/SKILL.md': 'invalid',
    });
    expect(await listVersions(root, 'deploy-check')).toEqual([{ folder: 'v1', n: 1 }]);
  });

  it('agrees with versionsInTree on the same layout', async () => {
    const layout = {
      'skills/deploy-check/v1/SKILL.md': 'a',
      'skills/deploy-check/v10/SKILL.md': 'b',
      'skills/deploy-check/v3/SKILL.md': 'c',
    };
    const root = await clone(layout);
    expect(await listVersions(root, 'deploy-check')).toEqual(versionsInTree(tree(Object.keys(layout)), 'deploy-check'));
  });
});
