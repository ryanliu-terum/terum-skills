import type { Backend } from './Backend';
import type { Result, Run } from './types';

export interface EvalQueueItem { team: string; skill: string; version: string; requestedAt: string; window: 'overnight' | 'later'; lastError?: string | undefined; }
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
