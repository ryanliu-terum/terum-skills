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
/** Cross-mirror overlays spec §3.2 — the Marketplace version slot, always filled once the team's latest is known:
 *  installed at latest, installed behind (Reinstall), a copy on disk whose bytes match no version (Publish), or
 *  plainly "Version N" for a skill the viewer has not installed (§8.3's third state). The identity line is never
 *  what this replaces. */
export function marketplaceVersionLabel(card: Pick<SkillCard, 'installedVersion' | 'latestVersion' | 'localMatch'>): string | null {
 const latest = card.latestVersion === null ? null : parseVersionFolder(card.latestVersion);
 if (latest === null) return null;
 const installed = card.installedVersion === null ? null : parseVersionFolder(card.installedVersion);
 return installed === latest ? `${versionLabel(latest)} · installed`
  : installed !== null && installed < latest ? `${versionLabel(latest)} · you have ${versionLabel(installed)}`
  : card.localMatch === 'differs' ? `${versionLabel(latest)} · your copy differs`
  : versionLabel(latest);
}
/** Cross-mirror overlays spec §3.1 — the Library version slot, top to bottom, first match wins: the version the
 *  folder's bytes ARE (ledger or byte match); a placed copy that has drifted from the version the ledger recorded;
 *  a drifted copy with no recorded version, or one the team knows only by uuid; a folder no team has seen. A row
 *  from a CLI that predates the byte match (localMatch null) says nothing rather than guessing "Unpublished". */
export function libraryVersionLabel(card: Pick<SkillCard, 'installedVersion' | 'localMatch' | 'placed' | 'knownToTeam'>): string | null {
 const version = card.installedVersion === null ? null : parseVersionFolder(card.installedVersion);
 if (card.localMatch === 'identical') return version === null ? null : versionLabel(version);
 if (card.localMatch === 'differs') return card.placed && version !== null ? `Edited from ${versionLabel(version)}` : 'Edited';
 if (card.localMatch === 'none') return 'Unpublished';
 return null;
}
export function profileVersionLabel(card: Pick<SkillCard, 'profileVersion'>): string | null {
 const n = card.profileVersion === null ? null : parseVersionFolder(card.profileVersion);
 return n === null ? null : `On profile · ${versionLabel(n)}`;
}
