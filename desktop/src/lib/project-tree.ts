import type { Root } from '../backend/types';

/**
 * Sub-projects: the checkout rows in tree order — a sub-project under the project whose folder holds
 * it — with the depth to indent by. Order within a level is the order given, which is the CLI's own
 * tree order (`ls --local`, `project list`). A row whose `parent` is not in the list draws at the top
 * level, so a partial or older payload still draws every project. Pure: no node:path, no platform
 * probe, so screens may use it (desktop/AGENTS.md invariant 1).
 */
export function projectTree(roots: readonly Root[]): { root: Root; depth: number }[] {
  const checkouts = roots.filter(root => root.kind === 'checkout');
  const ids = new Set(checkouts.map(root => root.id));
  const parentOf = (root: Root): string | null => root.parent != null && ids.has(root.parent) ? root.parent : null;
  const rows: { root: Root; depth: number }[] = [];
  const visit = (parent: string | null, depth: number): void => {
    for (const root of checkouts) if (parentOf(root) === parent) { rows.push({ root, depth }); visit(root.id, depth + 1); }
  };
  visit(null, 0);
  return rows;
}
