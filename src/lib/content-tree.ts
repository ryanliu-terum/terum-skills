import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Runner, systemRunner } from './runner.js';

/**
 * Eval assets live inside `skills/<name>/evals/` (eval-engine §16.2), but a version must mean
 * "the skill changed" — it drives update prompts, placements, pins and the publish gate, and an
 * eval that only adds cases must not move it (Ajay, 2026-09-13; overrides §16.2's second clause,
 * "dataset digest = version"). A version is therefore the skill tree with its top-level `evals/`
 * entry removed: a REAL tree object, minted once per skill tree through a disposable index and
 * kept resolvable by a local `refs/terum/content/<skill-tree>` ref, so a hash alone still pins,
 * materializes and resolves. A skill with no eval assets hashes to exactly the tree it already
 * had, so nothing about it changes. What the receipt pins instead is `provenance.eval_assets`.
 */
export const EVAL_ASSETS_DIR = 'evals';
const CONTENT_REF = 'refs/terum/content';
/** Commits scanned when a content tree must be re-minted from a hash alone (see `recoverContentTree`). */
const RECOVERY_COMMITS = 50;
/**
 * Process-local half of the ref cache: one skill tree hash → its content tree hash, PER CLONE.
 * A content tree is an object in one clone's database, so a hash another clone happens to know
 * proves nothing here — a shared memo would report a version this clone cannot read.
 */
const minted = new Map<string, string>();
const memoKey = (clone: string, full: string): string => `${clone}\u0000${full}`;

interface TreeEntry { mode: string; type: string; object: string; name: string }
function parseTree(stdout: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const line of stdout.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, object] = line.slice(0, tab).trim().split(/\s+/);
    if (mode && type && object) entries.push({ mode, type, object: object.toLowerCase(), name: line.slice(tab + 1) });
  }
  return entries;
}

/**
 * Record a mapping. The ref both caches it across processes and keeps an otherwise unreachable
 * content tree from being pruned by `git gc`; it lives under `refs/terum/`, is never pushed
 * (push() names its branch) and never fetched. Best effort: a read-only clone recomputes.
 */
async function remember(clone: string, full: string, content: string, runner: Runner): Promise<string> {
  minted.set(memoKey(clone, full), content);
  await runner.run('git', ['update-ref', `${CONTENT_REF}/${full}`, content], { cwd: clone });
  return content;
}

async function cached(clone: string, full: string, runner: Runner): Promise<string | undefined> {
  const memo = minted.get(memoKey(clone, full));
  if (memo !== undefined) return memo;
  const ref = await runner.run('git', ['rev-parse', '--verify', '--quiet', `${CONTENT_REF}/${full}`], { cwd: clone });
  const tree = ref.stdout.trim().toLowerCase();
  if (ref.code !== 0 || !/^[0-9a-f]{40}$/.test(tree)) return undefined;
  minted.set(memoKey(clone, full), tree);
  return tree;
}

/**
 * Mint the skill tree minus `evals/`. The permitted `git` executable does it through a disposable
 * index — no shell pipeline, no second executable, and the clone's worktree is never touched
 * (`--cached` only ever edits the index this call created).
 */
async function mint(clone: string, full: string, runner: Runner): Promise<string> {
  const index = join(tmpdir(), `terum-content-${randomUUID()}.index`);
  try {
    const env = { GIT_INDEX_FILE: index };
    const read = await runner.run('git', ['read-tree', full], { cwd: clone, env });
    if (read.code !== 0) throw new Error(`git read-tree ${full} failed: ${(read.stderr || read.stdout).trim()}`);
    const removed = await runner.run('git', ['rm', '-r', '--cached', '-q', '-f', '--ignore-unmatch', '--', EVAL_ASSETS_DIR], { cwd: clone, env });
    if (removed.code !== 0) throw new Error(`git rm --cached ${EVAL_ASSETS_DIR} failed: ${(removed.stderr || removed.stdout).trim()}`);
    const written = await runner.run('git', ['write-tree'], { cwd: clone, env });
    const tree = written.stdout.trim().toLowerCase();
    if (written.code !== 0 || !/^[0-9a-f]{40}$/.test(tree)) throw new Error(`git write-tree failed: ${(written.stderr || written.stdout).trim()}`);
    return await remember(clone, full, tree, runner);
  } finally {
    await rm(index, { force: true });
  }
}

/**
 * The version of one skill tree. A skill with no eval assets IS its own version, so the common
 * case costs one `ls-tree` and writes nothing — read-only verbs (`ls`, `eval-report`) must not
 * touch a clone to answer a question they already know the answer to.
 */
export async function contentVersion(clone: string, full: string, runner: Runner = systemRunner): Promise<string> {
  const memo = minted.get(memoKey(clone, full));
  if (memo !== undefined) return memo;
  const listed = await runner.run('git', ['ls-tree', full], { cwd: clone });
  if (listed.code !== 0) throw new Error(`git ls-tree ${full} failed: ${(listed.stderr || listed.stdout).trim()}`);
  if (assetsEntry(listed.stdout) === null) { minted.set(memoKey(clone, full), full); return full; }
  return (await cached(clone, full, runner)) ?? mint(clone, full, runner);
}

function assetsEntry(listed: string): string | null {
  return parseTree(listed).find((entry) => entry.name === EVAL_ASSETS_DIR && entry.type === 'tree')?.object ?? null;
}

/**
 * Versions for many skill trees at once. One `for-each-ref` answers every tree this machine has
 * already seen, so the batched reader `ls` and setup's scan use stays at two child processes in
 * the steady state; only a tree that is new to this machine costs anything.
 */
export async function contentVersions(clone: string, trees: Iterable<string>, runner: Runner = systemRunner): Promise<Map<string, string>> {
  const wanted = [...new Set(trees)];
  if (wanted.some((tree) => !minted.has(memoKey(clone, tree)))) {
    const refs = await runner.run('git', ['for-each-ref', '--format=%(refname:lstrip=3) %(objectname)', CONTENT_REF], { cwd: clone });
    if (refs.code === 0) {
      for (const line of refs.stdout.split('\n')) {
        const [full, content] = line.trim().split(' ');
        if (full && content && /^[0-9a-f]{40}$/.test(full) && /^[0-9a-f]{40}$/.test(content)) minted.set(memoKey(clone, full), content.toLowerCase());
      }
    }
  }
  const versions = new Map<string, string>();
  for (const tree of wanted) versions.set(tree, await contentVersion(clone, tree, runner));
  return versions;
}

/**
 * Every skill's version for one ref, in two child processes: one directory listing says which
 * skills carry eval assets at all, and only those cost a lookup. A team whose skills have no
 * eval assets never mints, never writes a ref, and never pays per skill — the batched reader
 * `ls` and setup's scan use (phase-1 RM-10) keeps its constant cost.
 */
export async function skillContentVersions(clone: string, ref: string, trees: Map<string, string>, runner: Runner = systemRunner): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  const listed = await runner.run('git', ['ls-tree', '-d', '-r', '-t', '--name-only', `${ref}:skills`], { cwd: clone });
  const withAssets = new Set<string>();
  // A listing this fails on is not worth a roster: fall back to whole skill trees, which is what
  // a version already is for every skill that carries no eval assets (§6 per-skill degradation).
  if (listed.code === 0) {
    for (const line of listed.stdout.split('\n')) {
      const path = line.trim();
      const slash = path.indexOf('/');
      if (slash > 0 && path.slice(slash + 1) === EVAL_ASSETS_DIR) withAssets.add(path.slice(0, slash));
    }
  }
  const assetTrees = [...trees].filter(([name]) => withAssets.has(name)).map(([, tree]) => tree);
  const minted = assetTrees.length === 0 ? new Map<string, string>() : await contentVersions(clone, assetTrees, runner);
  for (const [name, tree] of trees) versions.set(name, minted.get(tree) ?? tree);
  return versions;
}

export interface SkillTrees {
  /** The whole skill tree: what an eval run reads its cases and triggers from. */
  full: string;
  /** The version: the same tree without `evals/`. */
  content: string;
  /** The `evals/` subtree hash a receipt records, or null when the skill has no eval assets. */
  evalAssets: string | null;
}

/** Both halves of a skill's current tree, from one `ls-tree`. */
export async function resolveSkillTrees(clone: string, name: string, runner: Runner = systemRunner): Promise<SkillTrees> {
  const full = await latestTree(clone, name, runner);
  const listed = await runner.run('git', ['ls-tree', full], { cwd: clone });
  if (listed.code !== 0) throw new Error(`git ls-tree ${full} failed: ${(listed.stderr || listed.stdout).trim()}`);
  const evalAssets = assetsEntry(listed.stdout);
  let content = full;
  if (evalAssets === null) minted.set(memoKey(clone, full), full);
  else content = (await cached(clone, full, runner)) ?? await mint(clone, full, runner);
  return { full, content, evalAssets };
}

export async function latestTree(clone: string, name: string, runner: Runner): Promise<string> {
  const result = await runner.run('git', ['rev-parse', '--verify', `HEAD:skills/${name}`], { cwd: clone });
  if (result.code !== 0) throw new Error(`Could not resolve version latest for ${name}: ${(result.stderr || result.stdout).trim()}`);
  const tree = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(tree)) throw new Error(`Resolved version for ${name} is not a full tree hash.`);
  return tree.toLowerCase();
}

/**
 * A content tree is minted locally and never pushed, so a version another machine wrote — the one
 * in a teammate's receipt, or in a hash someone pasted — can be absent here. Re-mint it from this
 * skill's recent history; every mint anchors its ref, so a version costs this walk at most once
 * per machine. Bounded on purpose: §7 keeps resolution off the history walk, and this runs only
 * after a direct lookup has already missed.
 */
/**
 * Whether this clone can materialize one exact skill tree. A version is minted locally and never
 * pushed, but install pins travel in `people/*.json` — so a hash a teammate wrote is routinely a
 * version this clone has not built yet, and "absent" must mean absent from the HISTORY, not merely
 * from the object database (sync's §6 blocked sub-case would otherwise block every teammate's pin).
 */
export async function hasSkillTree(clone: string, name: string, version: string, runner: Runner = systemRunner): Promise<boolean> {
  if ((await runner.run('git', ['cat-file', '-e', `${version}^{tree}`], { cwd: clone })).code === 0) return true;
  return /^[0-9a-f]{40}$/i.test(version) && recoverContentTree(clone, name, version.toLowerCase(), runner);
}

export async function recoverContentTree(clone: string, name: string, target: string, runner: Runner): Promise<boolean> {
  const log = await runner.run('git', ['log', '--format=%H', '-n', String(RECOVERY_COMMITS), '--', `skills/${name}`], { cwd: clone });
  if (log.code !== 0) return false;
  const seen = new Set<string>();
  for (const commit of log.stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
    const resolved = await runner.run('git', ['rev-parse', '--verify', `${commit}:skills/${name}`], { cwd: clone });
    const full = resolved.stdout.trim().toLowerCase();
    if (resolved.code !== 0 || !/^[0-9a-f]{40}$/.test(full) || seen.has(full)) continue;
    seen.add(full);
    if (await contentVersion(clone, full, runner) === target) return true;
  }
  return false;
}
