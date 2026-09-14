// §3.2: the version vocabulary exists once — the desktop imports the leaf by relative path and no
// file here re-declares the folder regex or the `Version N` string.
import { cardVersionLabel as cardVersion, parseVersionFolder, recordedVersionLabel, versionLabel } from '../../../../src/lib/versions.js';

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

/** Cross-mirror overlays review walk D4b: on a CARD a version is `vN` (`cardVersionLabel` in the vocabulary
 *  leaf), so the longest slot string (`v10 · you have v2 (edited)`) rarely wraps. Prose — dialogs, the
 *  terminal, README, detail screens — keeps `versionLabel`'s "Version N"; the two are never mixed on one
 *  line. Every card builder below formats through the leaf and nothing else. */
/** A recorded version FOLDER in card form; a legacy tree hash keeps the prose rendering rather than
 *  gaining a bare `v` in front of twelve hex characters. */
export function cardRecordedVersion(folder: string): string {
 const n = parseVersionFolder(folder);
 return n === null ? recordedVersionLabel(folder) : cardVersion(n);
}

/** The score's version must remain visible on the card face, including an unreadable latest. */
export function evalVersionLabel(card: Pick<SkillCard, 'evalVersion' | 'latestVersion' | 'evalStale' | 'latestEvalState'>): string | null {
 if (!card.evalStale || card.evalVersion === null || card.latestVersion === null) return null;
 const latest = parseVersionFolder(card.latestVersion);
 if (latest === null) return null;
 return `from ${cardVersion(card.evalVersion)} · ${card.latestEvalState === 'invalid' ? `${cardVersion(latest)} unreadable` : `latest ${cardVersion(latest)}`}`;
}
/** §3.2 state 3b (review walk D2b): an installed copy whose bytes match no published version. The label's
 *  first branch and the card's Publish button both key on this one predicate — Publish belongs only to the
 *  never-installed drifted copy (state 4), never beside Reinstall on an edited install (review walk D2). */
export function editedInstall(card: Pick<SkillCard, 'installedVersion' | 'localMatch'>): boolean {
 return card.installedVersion !== null && parseVersionFolder(card.installedVersion) !== null && card.localMatch === 'differs';
}
export function installedVersionBehind(card: Pick<SkillCard, 'installedVersion' | 'latestVersion'>): boolean {
 const installed = card.installedVersion === null ? null : parseVersionFolder(card.installedVersion);
 const latest = card.latestVersion === null ? null : parseVersionFolder(card.latestVersion);
 return installed !== null && latest !== null && installed < latest;
}
/** Cross-mirror overlays spec §3.2 — the Marketplace version slot, always filled once the team's latest is known.
 *  First match wins: an installed copy whose bytes match no version says so, even on the latest (state 3b, review
 *  walk D2b — "installed" is reserved for exact bytes); installed at latest; installed behind (Reinstall); a copy
 *  on disk that was never installed and matches no version (Publish); or plainly `vN` for a skill the viewer has
 *  not installed. The identity line is never what this replaces. */
export function marketplaceVersionLabel(card: Pick<SkillCard, 'installedVersion' | 'latestVersion' | 'localMatch'>): string | null {
 const latest = card.latestVersion === null ? null : parseVersionFolder(card.latestVersion);
 if (latest === null) return null;
 const installed = card.installedVersion === null ? null : parseVersionFolder(card.installedVersion);
 if (installed !== null && editedInstall(card)) return `${cardVersion(latest)} · you have ${cardVersion(installed)} (edited)`;
 return installed === latest ? `${cardVersion(latest)} · installed`
  : installed !== null && installed < latest ? `${cardVersion(latest)} · you have ${cardVersion(installed)}`
  : card.localMatch === 'differs' ? `${cardVersion(latest)} · your copy differs`
  : cardVersion(latest);
}
/** Cross-mirror overlays spec §3.1 — the Library version slot, top to bottom, first match wins: the version the
 *  folder's bytes ARE (the byte match, else the ledger — review walk D1); a placed copy that has drifted from the
 *  version the ledger recorded, `vM (edited)`; a drifted copy with no recorded version, or one the team knows only
 *  by uuid; a folder no team has seen. A row from a CLI that predates the byte match (localMatch null) says
 *  nothing rather than guessing "Unpublished". */
export function libraryVersionLabel(card: Pick<SkillCard, 'installedVersion' | 'localMatch' | 'placed' | 'knownToTeam'>): string | null {
 const version = card.installedVersion === null ? null : parseVersionFolder(card.installedVersion);
 if (card.localMatch === 'identical') return version === null ? null : cardVersion(version);
 if (card.localMatch === 'differs') return card.placed && version !== null ? `${cardVersion(version)} (edited)` : 'Edited';
 if (card.localMatch === 'none') return 'Unpublished';
 return null;
}
/** The Library card's local-eval note. The lift figure already draws the verdict — "Not evaluated" when a folder
 *  has no receipt — wherever `liftOnCards` is on, so the footer must not say it a second time, and it must never
 *  say both halves at once: until 2026-09-14 a folder whose only receipt predates its last edit read
 *  "Not evaluated · evaluated before your last edit", which contradicts itself and took 239px of a ~347px footer
 *  (the row then wrapped and the card spilled — see library.css). A stale receipt now says only the true half;
 *  "Not evaluated" survives only where nothing else on the card says it. */
export function localEvalNote(card: Pick<SkillCard, 'teamed' | 'localEval' | 'localEvalStale'>, verdictShown: boolean): string | null {
 if (card.teamed || card.localEval !== null) return null;
 if (card.localEvalStale) return 'Evaluated before your last edit';
 return verdictShown ? null : 'Not evaluated';
}
/** The installs chip's text, or null when there is no count to show. Every Library card carries the `—` sentinel
 *  (`localCard` in the Tauri adapter and the mock's `localProjection` both set it), so on a local card the chip
 *  stated nothing while costing 29px of the footer; a real count — including a truthful `0 installs` — still draws. */
export function installsChip(card: Pick<SkillCard, 'installs'>): string | null {
 return card.installs === '—' ? null : card.installs;
}
export function profileVersionLabel(card: Pick<SkillCard, 'profileVersion'>): string | null {
 const n = card.profileVersion === null ? null : parseVersionFolder(card.profileVersion);
 return n === null ? null : `On profile · ${cardVersion(n)}`;
}
