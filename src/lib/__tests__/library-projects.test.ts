import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { insideRoot, isLibraryProjectLabel, libraryProjectLabels, orderByProjectTree, projectParents } from '../schema.js';

const home = join(sep, 'home', 'me');
const repo = join(home, 'acme');
const web = join(repo, 'apps', 'web');
const api = join(repo, 'packages', 'api');
const deep = join(web, 'widgets');
const other = join(home, 'other');

describe('sub-projects: the tree is the folder structure', () => {
  it('nests a registered folder under the nearest registered folder above it, and nothing else', () => {
    expect(projectParents([repo, web, api, deep, other])).toEqual([undefined, repo, repo, web, undefined]);
    // Registration order does not decide the tree: a parent added last still owns its sub-projects.
    expect(projectParents([deep, other, web, repo])).toEqual([web, undefined, repo, undefined]);
  });
  it('requires the boundary separator, so a sibling whose name starts the same is not inside', () => {
    expect(insideRoot(join(home, 'acme-two'), repo)).toBe(false);
    expect(insideRoot(repo, repo)).toBe(false);
    expect(insideRoot(web, repo)).toBe(true);
    expect(projectParents([repo, join(home, 'acme-two')])).toEqual([undefined, undefined]);
  });
  it('orders depth-first, parents first in the order given, and keeps an orphan at the top level', () => {
    const rows = [{ path: api, parent: repo }, { path: other, parent: undefined }, { path: deep, parent: web }, { path: web, parent: repo }, { path: repo, parent: undefined }];
    expect(orderByProjectTree(rows, row => row.path, row => row.parent).map(({ item, depth }) => [item.path, depth])).toEqual([
      [other, 0], [repo, 0], [api, 1], [web, 1], [deep, 2],
    ]);
    expect(orderByProjectTree([{ path: deep, parent: web }], row => row.path, row => row.parent)).toEqual([{ item: { path: deep, parent: web }, depth: 0 }]);
  });
});

describe('labels: a sub-project is named by its path inside the parent', () => {
  it('labels a top-level project by its folder and a sub-project by its relative path', () => {
    expect(libraryProjectLabels([{ root: repo }, { root: web }, { root: api }, { root: deep }])).toEqual(['acme', join('apps', 'web'), join('packages', 'api'), 'widgets']);
  });
  it('qualifies a sub-project label that collides with another by its parent project, then by the whole root', () => {
    const second = join(home, 'beta');
    const secondApi = join(second, 'packages', 'api');
    expect(libraryProjectLabels([{ root: repo }, { root: api }, { root: second }, { root: secondApi }]))
      .toEqual(['acme', `${join('packages', 'api')} (acme)`, 'beta', `${join('packages', 'api')} (beta)`]);
    const twin = join(home, 'x', 'acme'), twinApi = join(twin, 'packages', 'api');
    expect(libraryProjectLabels([{ root: repo }, { root: api }, { root: twin }, { root: twinApi }]))
      .toEqual(['acme (me)', api, 'acme (x)', twinApi]);
  });
  it('keeps a chosen label as typed and moves the derived label that reads the same', () => {
    expect(libraryProjectLabels([{ root: repo, label: 'Payments', renamed_at: '2026-09-19' }, { root: join(home, 'payments') }]))
      .toEqual(['Payments', 'payments (me)']);
    // A chosen label is not qualified even when a derived one already reads the same before qualification.
    expect(libraryProjectLabels([{ root: join(home, 'payments') }, { root: repo, label: 'payments', renamed_at: '2026-09-19' }]))
      .toEqual(['payments (me)', 'payments']);
    // Without `renamed_at` a stored label is derived state and is recomputed like any other.
    expect(libraryProjectLabels([{ root: repo, label: 'Payments' }])).toEqual(['acme']);
  });
  it('accepts a trimmed name of 1 to 64 characters and refuses Global in any case', () => {
    expect(isLibraryProjectLabel('Payments')).toBe(true);
    expect(isLibraryProjectLabel('apps/web')).toBe(true);
    expect(isLibraryProjectLabel('a'.repeat(64))).toBe(true);
    for (const bad of ['', ' padded', 'padded ', 'a'.repeat(65), 'Global', 'global', 'GLOBAL']) expect(isLibraryProjectLabel(bad), bad).toBe(false);
  });
});
