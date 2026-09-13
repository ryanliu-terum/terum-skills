import { z } from 'zod';
import type { EvalQueueService } from '../eval-queue';
import type { AppUpdateDeps } from './app-update';

// §6.6: the CLI emits `contentHash` where it emitted `version`, and `team` is optional.
const item = z.object({ skill: z.string(), path: z.string(), contentHash: z.string(), requestedAt: z.string(), window: z.enum(['overnight', 'later']), team: z.string().optional(), lastError: z.string().optional() });
const queue = z.object({ items: z.array(item), attempted: z.number().optional(), completed: z.number().optional(), failures: z.array(z.object({ item, error: z.string() })).optional() });
export function createEvalQueue(deps: Pick<AppUpdateDeps, 'run' | 'read' | 'result'>): EvalQueueService {
  return {
    list: () => deps.read(deps.run(['eval', '--queue-list'], queue, value => value, [])).then(deps.result),
    drain: () => deps.run(['eval', '--drain', '--parallel', '4'], queue, value => value, ['clone']),
  };
}
