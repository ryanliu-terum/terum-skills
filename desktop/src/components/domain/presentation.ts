// §3.2: the version vocabulary exists once — the desktop imports the leaf by relative path and no
// file here re-declares the folder regex or the `Version N` string.
import { parseVersionFolder, versionLabel } from '../../../../src/lib/versions.js';

/** The one place a version becomes display text. Before layout 3 these fields held a 40-hex tree
 *  hash, which is why every call site sliced them and why the surfaces wrote a bare `v` in front;
 *  they now hold a version FOLDER (`v1`), where a slice means nothing and `v` + `v1` reads "v v1".
 *  `fallback` covers the fields that are already a label or the `—` sentinel. The hex arm keeps the
 *  legacy rendering for the tree hashes the byte-locked design fixtures still carry. */
export function versionText(version: string | null | undefined, fallback: string): string {
  const n = version === null || version === undefined ? null : parseVersionFolder(version);
  if (n !== null) return versionLabel(n);
  const parsedFallback = parseVersionFolder(fallback);
  if (parsedFallback !== null) return versionLabel(parsedFallback);
  return /^[0-9a-f]{7,40}$/.test(fallback) ? `v ${fallback.slice(0, 12)}` : fallback;
}

import type { SkillCard, TokenKey } from '../../backend/types';
export const token=(key:TokenKey)=>`var(--tk-${key})`;

/** The score's version must remain visible on the card face, including an unreadable latest. */
export function evalVersionLabel(card: Pick<SkillCard, 'evalVersion' | 'latestVersion' | 'evalStale' | 'latestEvalState'>): string | null {
 if (!card.evalStale || card.evalVersion === null || card.latestVersion === null) return null;
 const latest = parseVersionFolder(card.latestVersion);
 if (latest === null) return null;
 return `from ${versionLabel(card.evalVersion)} · ${card.latestEvalState === 'invalid' ? `${versionLabel(latest)} unreadable` : `latest ${versionLabel(latest)}`}`;
}
export function installedVersionBehind(card: Pick<SkillCard, 'installedVersion' | 'latestVersion'>): boolean {
 const installed = card.installedVersion === null ? null : parseVersionFolder(card.installedVersion);
 const latest = card.latestVersion === null ? null : parseVersionFolder(card.latestVersion);
 return installed !== null && latest !== null && installed < latest;
}
/** §8.3's two states, both about a copy on this machine. A card the viewer has not installed says
 *  nothing here — the spec names no third state — and the identity line is never what this replaces. */
export function marketplaceVersionLabel(card: Pick<SkillCard, 'installedVersion' | 'latestVersion'>): string | null {
 const latest = card.latestVersion === null ? null : parseVersionFolder(card.latestVersion);
 if (latest === null) return null;
 const installed = card.installedVersion === null ? null : parseVersionFolder(card.installedVersion);
 return installed === latest ? `${versionLabel(latest)} · installed`
  : installed !== null && installed < latest ? `${versionLabel(latest)} · you have ${versionLabel(installed)}` : null;
}
export function profileVersionLabel(card: Pick<SkillCard, 'profileVersion'>): string | null {
 const n = card.profileVersion === null ? null : parseVersionFolder(card.profileVersion);
 return n === null ? null : `On profile · ${versionLabel(n)}`;
}
