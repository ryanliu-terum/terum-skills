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
