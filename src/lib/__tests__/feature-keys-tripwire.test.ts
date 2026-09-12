import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { FRAME_FEATURES } from '../frames.js';

/**
 * The CLI advertises its feature switches in the `hello` frame's `features` map (`FRAME_FEATURES`);
 * the desktop adapter reads them back key by key against its own list (`FEATURE_KEYS`) with
 * `hello?.features[key] ?? false`. Nothing guards that read: the `hello` frame has no zod mirror
 * (`tauri/index.ts` casts it bare), so a key renamed on one side and not the other does not throw,
 * does not fail a test, and does not print — the feature simply reads `false` forever and the
 * control it gates stays hidden. B2's `checkouts` -> `libraryProjects` rename was exactly this: it
 * would have hidden the sidebar's Add project button behind a fully green suite.
 *
 * This lives in the ROOT suite on purpose. Root gates run on every batch; desktop gates run only
 * when `desktop/` is touched, and the likelier break is a CLI-side rename in a batch that never
 * opens the desktop tree.
 *
 * `desktop/src/backend/types.ts` is read as TEXT rather than imported. `FEATURE_KEYS` is needed as
 * VALUES, and `desktop/` is a browser bundle behind its own tsconfig; reading the source is the
 * pattern every other cross-tree pin in this repo already uses (see `invocation-tripwire.test.ts`,
 * which reads `src/`, and `frames.test.ts` CP-19, which reads `docs/frame-protocol.md`).
 */

const desktopTypes = new URL('../../../desktop/src/backend/types.ts', import.meta.url);

/** The string literals of `export const FEATURE_KEYS = [...] as const;`. */
function desktopFeatureKeys(source: string): string[] {
  const declaration = /export const FEATURE_KEYS\s*=\s*\[([^\]]*)\]\s*as const;/.exec(source);
  if (!declaration) throw new Error('FEATURE_KEYS is no longer a single bracketed literal in desktop/src/backend/types.ts — this tripwire reads it as text and must be updated with it.');
  return [...declaration[1]!.matchAll(/'([^']+)'/g)].map(match => match[1]!);
}

it('every desktop FEATURE_KEYS entry is a key the CLI actually advertises, and vice versa', () => {
  const keys = desktopFeatureKeys(readFileSync(desktopTypes, 'utf8'));
  // A regex that quietly matched nothing would make the set comparison pass vacuously.
  expect(keys.length).toBeGreaterThan(10);
  expect(new Set(keys).size).toBe(keys.length);
  const advertised = Object.keys(FRAME_FEATURES);
  // Reported as the symmetric difference, so a failure names the key that drifted rather than
  // printing two truncated nineteen-element arrays.
  expect({
    readByTheDesktopButNotAdvertisedByTheCli: keys.filter(key => !advertised.includes(key)),
    advertisedByTheCliButNotReadByTheDesktop: advertised.filter(key => !keys.includes(key)),
  }).toEqual({ readByTheDesktopButNotAdvertisedByTheCli: [], advertisedByTheCliButNotReadByTheDesktop: [] });
});
