import type { Root } from '../../backend/types';

/** Registered destinations only; an unreadable checkout remains the CLI's decision. */
export function destinationsFor(roots: Root[], remoteSlugs: string[], features: { checkouts: boolean }): { rows: [string, string][]; preselected: string | null; addRow: boolean } {
  const checkouts = roots.filter(root => root.kind === 'checkout' && root.registered);
  const matches = checkouts.filter(root => root.remote?.slug != null && remoteSlugs.includes(root.remote.slug));
  return {
    rows: [['Global', 'every session · ~/.claude/skills'], ...checkouts.map((root): [string, string] => [root.label, 'project · ' + root.root])],
    preselected: matches.length > 1 ? null : matches[0]?.label ?? 'Global',
    addRow: features.checkouts,
  };
}
