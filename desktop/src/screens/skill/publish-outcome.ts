// §3.2: the version vocabulary exists ONCE. This leaf imports nothing from the desktop tree, which is the only
// shape `cli-tree-imports.test.ts` admits across the tree boundary.
import { parseVersionFolder, versionLabel } from '../../../../src/lib/versions.js';
import type { PublishResult } from '../../backend/types';

/**
 * The sentence the app shows for one finished publish — shared by the skill page's dialog and the Library's
 * bulk dialog so the two can never drift (batch E, 2026-09-13). §5.2: a publish lands on main. What varies is
 * whether it MINTED a version, matched one that already existed and only added the skill to a project, only
 * attached eval runs to an existing version, or changed nothing — four different things to have done, each
 * named for what the CLI reported and nothing more.
 */
export function publishOutcomeText(name: string, published: PublishResult): string {
  const label = (folder: string | null): string => {
    const n = folder === null ? null : parseVersionFolder(folder);
    return n === null ? 'an existing version' : versionLabel(n);
  };
  if (published.created && published.version) return `${name} was published to ${published.project} as ${label(published.version)}.`;
  if (published.projectAdded) return `${name} was added to ${published.project}; its bytes are identical to ${label(published.identicalTo)}.`;
  if (published.attachedEvals > 0) return `Attached ${published.attachedEvals} eval run(s) to ${label(published.identicalTo)} in ${published.project}; identical skill bytes minted no version.`;
  return `${name} is already ${label(published.identicalTo)} in ${published.project}; nothing to publish.`;
}
