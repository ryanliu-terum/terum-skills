import { z } from 'zod';
import type { EvalQueueService } from '../eval-queue';
import type { PrefStore } from '../types';
import type { AppUpdateDeps } from './app-update';
import { evalPrefFlags } from './eval-flags';

// §6.6: the CLI emits `contentHash` where it emitted `version`, and `team` is optional.
export const cliEvalQueueItem = z.object({ skill: z.string(), path: z.string(), contentHash: z.string(), requestedAt: z.string(), window: z.enum(['overnight', 'later']), team: z.string().optional(), lastError: z.string().optional() });
const queue = z.object({ items: z.array(cliEvalQueueItem), attempted: z.number().optional(), completed: z.number().optional(), failures: z.array(z.object({ item: cliEvalQueueItem, error: z.string() })).optional() });
export function createEvalQueue(deps: Pick<AppUpdateDeps, 'run' | 'read' | 'result'> & { prefs: PrefStore }): EvalQueueService {
  return {
    list: () => deps.read(deps.run(['eval', '--queue-list'], queue, value => value, [])).then(deps.result),
    // The drain carries the Settings ▸ Evals defaults like every other eval the app starts: until now an overnight
    // receipt was made with the CLI's own k while Settings promised the person's, so the two disagreed by morning.
    drain: () => deps.run(['eval', ...evalPrefFlags(deps.prefs), '--drain', '--parallel', '4'], queue, value => value, ['clone']),
  };
}
