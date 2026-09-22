import type { Root } from '../../backend/types';
import { isUnderRoot } from '../../lib/skill-path';

/** Registered destinations only; an unreadable checkout remains the CLI's decision. */
export function destinationsFor(roots: Root[], remoteSlugs: string[], features: { libraryProjects: boolean }): { rows: [string, string][]; preselected: string | null; addRow: boolean } {
  const checkouts = roots.filter(root => root.kind === 'checkout' && root.registered);
  const matches = checkouts.filter(root => root.remote?.slug != null && remoteSlugs.includes(root.remote.slug));
  // A sub-project reports its parent's origin (git walks up to the same repository), so among nested
  // matches only the outermost is the checkout the team project names — the CLI's own rule for its
  // `Install to` default (src/commands/install.ts resolveDestination). Unrelated matches still offer none.
  const outermost = matches.filter(root => !matches.some(other => other !== root && isUnderRoot(root.root, other.root)));
  return {
    rows: [['Global', 'every session · ~/.claude/skills'], ...checkouts.map((root): [string, string] => [root.label, 'project · ' + root.root])],
    preselected: outermost.length > 1 ? null : outermost[0]?.label ?? 'Global',
    addRow: features.libraryProjects,
  };
}
