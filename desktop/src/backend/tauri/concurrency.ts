/** The bridge admits 8 children; callers leave headroom and match its wrapped error by substring. */
export const BRIDGE_BUSY = 'too many pending terum-skills processes';

/**
 * Bounded-concurrency map for latency-bound work (W-02). Results retain input order.
 * On rejection, stop starting work, drain in-flight work, and reject with the lowest-indexed reason.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const width = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const results = new Array<R>(items.length);
  const failures = new Map<number, unknown>();
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (failures.size > 0) return;
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await fn(items[index]!, index); }
      catch (error) { failures.set(index, error); return; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  if (failures.size > 0) throw failures.get(Math.min(...failures.keys()));
  return results;
}
