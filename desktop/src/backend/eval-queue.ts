import type { Backend } from './Backend';
import type { Result, Run } from './types';

/**
 * §6.6 — a queued eval names the BYTES it was queued against. `version` is gone because a local
 * folder has no version number at queue time, and `team` is optional because §6.3 made a folder
 * belonging to no team evaluable. Both were REQUIRED here, so every item failed the parse after the
 * CLI changed, `list()` returned ok:false and the drainer silently scheduled nothing.
 */
export interface EvalQueueItem { skill: string; path: string; contentHash: string; requestedAt: string; window: 'overnight' | 'later'; team?: string | undefined; lastError?: string | undefined; }
export interface EvalQueueResult { items: EvalQueueItem[]; attempted?: number | undefined; completed?: number | undefined; failures?: { item: EvalQueueItem; error: string }[] | undefined; }
export interface EvalQueueService {
  list(): Promise<Result<EvalQueueResult>>;
  drain(): Run<EvalQueueResult>;
}
// This additive seam keeps the shared Backend contract stable across the parallel batches.
// A backend without a queue service (including the browser fixture backend) schedules no work.
const services = new WeakMap<Backend, EvalQueueService>();
export function registerEvalQueue(backend: Backend, service: EvalQueueService): void { services.set(backend, service); }
export function evalQueueFor(backend: Backend): EvalQueueService | undefined { return services.get(backend); }
