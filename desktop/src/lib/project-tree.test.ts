import { expect, it } from 'vitest';
import type { Root } from '../backend/types';
import { projectTree } from './project-tree';

const root = (id: string, parent: string | null = null): Root => ({ id, kind: 'checkout', label: id, root: id, registered: true, parent });

it('draws a sub-project under its parent, one level deeper, and keeps the given order within a level', () => {
  const global: Root = { id: 'global', kind: 'global', label: 'Global', root: '~/.claude/skills', registered: false };
  const rows = projectTree([global, root('/a'), root('/a/apps/web', '/a'), root('/b'), root('/a/packages/api', '/a'), root('/a/apps/web/widgets', '/a/apps/web')]);
  expect(rows.map(({ root, depth }) => [root.id, depth])).toEqual([
    ['/a', 0], ['/a/apps/web', 1], ['/a/apps/web/widgets', 2], ['/a/packages/api', 1], ['/b', 0],
  ]);
});

it('draws a row whose parent is not listed at the top level, and reads an absent parent as top level', () => {
  const rows = projectTree([root('/a/apps/web', '/a'), { ...root('/b'), parent: undefined }]);
  expect(rows.map(({ root, depth }) => [root.id, depth])).toEqual([['/a/apps/web', 0], ['/b', 0]]);
});
