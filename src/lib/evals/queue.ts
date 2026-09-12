import { PACKAGE_NAME } from '../package.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { mkdirPrivate, writeJsonPrivate } from '../fs.js';

/**
 * §6.6 — a queued eval names the BYTES it was queued against, not an ordinal. A local folder has no
 * version number at queue time (it may never have been published), and `team` is optional because
 * §6.3 made a folder belonging to no team evaluable.
 */
const itemSchema = z.object({
  skill: z.string().min(1),
  /** The folder on this machine whose bytes were queued. */
  path: z.string().min(1),
  /** `skillContentDigest` of that folder — the dedupe identity and the drain's expectedVersion guard. */
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  requestedAt: z.iso.datetime(), window: z.enum(['overnight', 'later']),
  team: z.string().min(1).optional(),
  lastError: z.string().optional(),
});
/** Schema 1 items are the 40-hex tree-hash shape; they are dropped on read, never parsed. */
const queueSchema = z.object({ schema: z.union([z.literal(1), z.literal(2)]), items: z.array(itemSchema) });
const looseSchema = z.object({ schema: z.union([z.literal(1), z.literal(2)]), items: z.array(z.unknown()) });
export const QUEUE_SCHEMA_VERSION = 2;
export type EvalQueueItem = z.infer<typeof itemSchema>;
export type EvalQueue = z.infer<typeof queueSchema>;
const queuePath = (root: string): string => join(root, 'run', 'eval-queue.json');
/**
 * §6.6 — the dedupe identity, and it is the bytes. `team` is no longer part of it: with `team`
 * optional the old key collapsed every teamless item onto `undefined`, so two different skills
 * queued from outside a team would have been one item.
 */
export const queueKey = (item: EvalQueueItem): string => JSON.stringify([item.skill, item.contentHash]);

/**
 * Missing is empty; malformed or unreadable state is never overwritten.
 *
 * §6.6: an item that fails the v2 schema is DROPPED, not rethrown. A queue is a list of intentions to
 * spend money later, not data — and the old rethrow took the whole drainer down on the first read
 * after an upgrade, because every pre-upgrade item carries a 40-hex tree hash the new shape rejects.
 */
export async function readEvalQueue(root: string): Promise<EvalQueue> {
  let raw: string;
  try { raw = await readFile(queuePath(root), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: QUEUE_SCHEMA_VERSION, items: [] };
    throw error;
  }
  // A file that is not a queue at all is still never silently replaced: that throws as it always did.
  const file = looseSchema.parse(JSON.parse(raw));
  const items: EvalQueueItem[] = [];
  for (const item of file.items) {
    const parsed = itemSchema.safeParse(item);
    if (parsed.success) items.push(parsed.data);
  }
  return { schema: file.schema, items };
}

/** Separate drain and state locks: enqueue/dequeue remain available during a paid run. */
export async function withEvalQueueLock<T>(root: string, kind: 'state' | 'drain', action: (assertHeld: () => void) => Promise<T>): Promise<T> {
  await mkdirPrivate(join(root, 'run'));
  let compromised = false;
  // proper-lockfile keys its in-process bookkeeping by target, not lockfilePath.
  // Distinct targets prevent a nested state lock from replacing the active drain lock.
  const release = await lockfile.lock(`${queuePath(root)}.${kind}`, {
    realpath: false, lockfilePath: `${queuePath(root)}.${kind}.lock`,
    retries: kind === 'drain' ? 0 : { retries: 20, minTimeout: 25, maxTimeout: 250 },
    onCompromised: () => { compromised = true; },
  }).catch((error: unknown) => {
    if (kind === 'drain' && (error as NodeJS.ErrnoException).code === 'ELOCKED') throw new Error(`Another ${PACKAGE_NAME} drain is already running; wait for it to finish or stop it.`);
    throw error;
  });
  try { return await action(() => { if (compromised) throw new Error('Lost the eval queue lock; retry the command.'); }); }
  finally { await release().catch(() => undefined); } // Preserve the action's result if its lock was already lost.
}

export async function updateEvalQueue(root: string, mutate: (items: EvalQueueItem[]) => EvalQueueItem[]): Promise<EvalQueue> {
  return withEvalQueueLock(root, 'state', async assertHeld => {
    const queue = await readEvalQueue(root);
    // The next write upgrades the file: schema 1 items were already dropped on read.
    const next = queueSchema.parse({ schema: QUEUE_SCHEMA_VERSION, items: mutate(queue.items) });
    assertHeld();
    await writeJsonPrivate(queuePath(root), next);
    return next;
  });
}

export async function enqueueEvals(root: string, items: readonly EvalQueueItem[]): Promise<EvalQueue> {
  // Validate before entering the mutation, including duplicates that would otherwise be ignored.
  const added = z.array(itemSchema).parse(items);
  return updateEvalQueue(root, current => {
    const byKey = new Map(current.map(item => [queueKey(item), item]));
    for (const item of added) {
      const prior = byKey.get(queueKey(item));
      // An explicit new scheduling choice moves the existing item, never creates a second paid run.
      if (!prior || prior.window !== item.window) byKey.set(queueKey(item), { ...prior, ...item });
    }
    return [...byKey.values()];
  });
}

/**
 * `<team>/<skill>` or a bare `<skill>`. The bare form exists because §6.3 made a teamless folder
 * queueable, and an item with no team could never be named by the two-part form — you would be able
 * to see a queued paid run you had no way to cancel.
 */
export async function dequeueEvals(root: string, ref: string): Promise<EvalQueue> {
  const parts = ref.split('/');
  if (parts.length > 2 || parts.some(part => !part.trim())) throw new Error('--dequeue requires <skill> or <team>/<skill>.');
  const [team, skill] = parts.length === 2 ? parts : [undefined, parts[0]];
  return updateEvalQueue(root, items => items.filter(item => item.skill !== skill || (team !== undefined && item.team !== team)));
}
