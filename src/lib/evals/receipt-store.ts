/** Local receipt-store primitives shared by eval readers. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { receiptSchema, type Receipt } from './receipt.js';

export type StoredReceipt = { file: string; receipt: Receipt };

export async function receiptFiles(directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names;
}

/** The newest lexical run id is the displayed/gating receipt for one version. */
export async function newestReceiptAt(directory: string): Promise<StoredReceipt | undefined> {
  const file = (await receiptFiles(directory)).at(-1);
  if (file === undefined) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(directory, file), 'utf8')); }
  catch { throw new Error(`schema-invalid receipt ${join(directory, file)}: invalid JSON.`); }
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`schema-invalid receipt ${join(directory, file)}.`);
  return { file, receipt: parsed.data };
}

export interface SelectedCardEval {
  eval: { receipt: StoredReceipt; version: number; stale: boolean } | null;
  /** Whether the LATEST version's own eval is usable — `invalid` is what the card discloses (§8.2). */
  latestEvalState: 'ok' | 'none' | 'invalid';
}

/**
 * §8.1's fallback, verbatim: walk a skill's versions newest-first and show the newest version that
 * has a usable receipt, marking it `stale` when it is not the latest.
 *
 * **A schema-invalid or misfiled newest receipt fails closed for THAT VERSION ONLY and the walk
 * continues** — one corrupt file must not blank a skill that has three good older evals. It is
 * reported through `onProblem` so the corruption is visible rather than silently skipped.
 *
 * `latestEvalState` is about the latest version alone, and is what lets the card say
 * `Version 5 unreadable` rather than silently presenting v3's score as current (§8.2).
 *
 * The misfiled check is only safe because publish *stamps* `skill_id` and `version` into the copy it
 * attaches (§5.1 step 9) — attach is never a plain file copy.
 */
export async function selectCardEval(
  clone: string,
  skillId: string,
  versions: readonly { folder: string; n: number }[],
  onProblem?: (message: string) => void,
): Promise<SelectedCardEval> {
  const latestN = versions[0]?.n;
  if (latestN === undefined) return { eval: null, latestEvalState: 'none' };
  const root = join(clone, 'evals', skillId);
  let present: Set<string>;
  try { present = new Set((await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { eval: null, latestEvalState: 'none' }; throw error; }

  let latestEvalState: SelectedCardEval['latestEvalState'] = 'none';
  for (const version of versions) {
    if (!present.has(version.folder)) continue;
    let newest: StoredReceipt | undefined;
    try { newest = await newestReceiptAt(join(root, version.folder)); }
    catch (error) {
      onProblem?.(error instanceof Error ? error.message : String(error));
      if (version.n === latestN) latestEvalState = 'invalid';
      continue;
    }
    if (newest === undefined) continue;
    if (newest.receipt.skill_id !== skillId || newest.receipt.version !== version.folder) {
      onProblem?.(`misfiled receipt ${join(root, version.folder, newest.file)}.`);
      if (version.n === latestN) latestEvalState = 'invalid';
      continue;
    }
    if (version.n === latestN) latestEvalState = 'ok';
    return { eval: { receipt: newest, version: version.n, stale: version.n !== latestN }, latestEvalState };
  }
  return { eval: null, latestEvalState };
}
