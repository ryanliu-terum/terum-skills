/**
 * The version vocabulary (refactor spec §3.2). Nothing else in the codebase parses or formats a
 * version segment.
 *
 * **This module imports nothing — not even a type.** The desktop bundle imports it by relative path
 * exactly as `desktop/src/backend/tauri/session.ts` imports `src/lib/serve-verbs.js`, so
 * `VERSION_FOLDER` and `versionLabel` exist once on both sides of the process boundary and no desktop
 * file re-declares the regex or the `Version N` string. `desktop/src/backend/tauri/__tests__/
 * cli-tree-imports.test.ts` admits a cross-tree import only from a leaf that imports nothing at all,
 * so an import added here breaks the desktop bundle, not just this file. The fs-using `listVersions`
 * therefore lives in `src/lib/teamRepo.ts` beside `skillVersions`, not here.
 */

export const VERSION_FOLDER = /^v[1-9][0-9]*$/;

export interface SkillVersion {
  folder: string;
  n: number;
}

/**
 * The ordinal of a version folder name, or `null` when the name is not one.
 *
 * `v0`, `v03`, `V3`, `version 3`, `v1.0` and `v-1` are all `null`: the leading-zero and
 * leading-`[1-9]` clauses of `VERSION_FOLDER` make the mapping from ordinal to folder name a
 * bijection, so two spellings can never name the same version.
 */
export function parseVersionFolder(name: string): number | null {
  if (!VERSION_FOLDER.test(name)) return null;
  const n = Number(name.slice(1));
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export function versionFolderName(n: number): string {
  return `v${n}`;
}

/** The only form a version takes in any user-facing string, CLI or desktop (D1). */
export function versionLabel(n: number): string {
  return `Version ${n}`;
}

/**
 * A skill's versions, newest first, derived from a tree's post-image rather than from disk — for
 * callers inside a `safeWrite` mutation, which may only see the post-image (§5.1 step 7).
 *
 * The parameter is structural on purpose: this leaf imports nothing, so it cannot name `MutableTree`
 * even as a type. `paths()` returns `readonly string[]`, which `MutableTree` satisfies without a cast.
 *
 * **The sort is numeric on `n`, never lexicographic.** `['v10','v2'].sort()` puts `v10` first, which
 * would pin every skill past its tenth publish to the wrong version — for the card, the eval, the
 * README and install — and would only start failing after a team's tenth publish. `listVersions`
 * shares this parser and this sorter.
 */
export function versionsInTree(tree: { paths(prefix?: string): readonly string[] }, skillName: string): SkillVersion[] {
  const prefix = `skills/${skillName}/`;
  const found = new Map<number, string>();
  for (const path of tree.paths(prefix)) {
    // `paths(prefix)` returns full repo-relative paths and does not strip the prefix.
    const folder = path.slice(prefix.length).split('/')[0];
    if (folder === undefined) continue;
    const n = parseVersionFolder(folder);
    // A version folder is only a version when it holds something; `skills/<name>/v1` on its own is a
    // path to the folder, not a file in it, and `tree.paths()` lists files.
    if (n !== null && path.length > prefix.length + folder.length) found.set(n, folder);
  }
  return [...found.entries()]
    .sort(([a], [b]) => b - a)
    .map(([n, folder]) => ({ folder, n }));
}
