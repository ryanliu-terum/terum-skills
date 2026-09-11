import { PACKAGE_NAME } from '../package.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { mkdirPrivate, writeJsonPrivate } from '../fs.js';

const itemSchema = z.object({
  team: z.string().min(1), skill: z.string().min(1),
  version: z.string().regex(/^[0-9a-f]{40}$/),
  requestedAt: z.iso.datetime(), window: z.enum(['overnight', 'later']),
  lastError: z.string().optional(),
});
const queueSchema = z.object({ schema: z.literal(1), items: z.array(itemSchema) });
export type EvalQueueItem = z.infer<typeof itemSchema>;
export type EvalQueue = z.infer<typeof queueSchema>;
const queuePath = (root: string): string => join(root, 'run', 'eval-queue.json');
export const queueKey = (item: EvalQueueItem): string => JSON.stringify([item.team, item.skill, item.version]);

/** Missing is empty; malformed or unreadable state is never overwritten. */
export async function readEvalQueue(root: string): Promise<EvalQueue> {
  try { return queueSchema.parse(JSON.parse(await readFile(queuePath(root), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, items: [] };
    throw error;
  }
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
    const next = queueSchema.parse({ schema: 1, items: mutate(queue.items) });
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

export async function dequeueEvals(root: string, ref: string): Promise<EvalQueue> {
  const parts = ref.split('/');
  if (parts.length !== 2 || parts.some(part => !part.trim())) throw new Error('--dequeue requires <team>/<skill>.');
  return updateEvalQueue(root, items => items.filter(item => item.team !== parts[0] || item.skill !== parts[1]));
}
