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

import type { TokenKey } from '../../backend/types';
export const token=(key:TokenKey)=>`var(--tk-${key})`;
