import { join } from 'node:path';
import { mapWithConcurrency } from './concurrency.js';
import { canonicalDigest } from './skills.js';
import { skillVersions } from './teamRepo.js';

/** One committed version's content identity: the digest of `skills/<name>/<folder>/` as it sits in the clone. */
export interface VersionDigest { name: string; folder: string; n: number; digest: string; }

/**
 * The content digest of every version folder of the named skills — the byte-level join between a
 * Library folder and the team's published versions (cross-mirror overlays spec §4.2). A folder on
 * disk whose `canonicalDigest` equals one of these IS that version, whatever its folder name or
 * ledger state says; the Marketplace's stale-copy line and the Library's version slot both rest on it.
 *
 * Same digest function as `publish` and `eval` (`canonicalDigest` delegates to `skillContentDigest`,
 * one implementation), so a match here is exactly the equality publish's identical-republish refusal
 * tests. Uncached: one walk per version folder, eight at a time; the spec gates a stamp-keyed cache on
 * a measured 500 ms Library load.
 *
 * Its own leaf because `skills.ts` already imports `teamRepo.ts` (for `listVersions`), and the reverse
 * import this needs would close a cycle.
 */
export async function versionDigests(clone: string, names: readonly string[]): Promise<Map<string, VersionDigest>> {
  const versions = await skillVersions(clone, names);
  const jobs = [...versions.entries()].flatMap(([name, list]) => list.map((version) => ({ name, version })));
  const digests = await mapWithConcurrency(jobs, 8, async ({ name, version }) => ({ name, folder: version.folder, n: version.n, digest: await canonicalDigest(join(clone, 'skills', name, version.folder)) }));
  return new Map(digests.map((entry) => [`${entry.name}/${entry.folder}`, entry]));
}
