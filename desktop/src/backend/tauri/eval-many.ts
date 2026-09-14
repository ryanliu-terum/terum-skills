import { z } from 'zod';
import type { EvalManyArgs, EvalManyResult, PrefStore } from '../types';
import { evalPrefFlags } from './eval-flags';
import { cliEvalQueueItem } from './eval-queue';

/** Mirror of the CLI's EvalManyResult (src/commands/eval.ts); the contract in desktop/contracts pins it. */
export const cliEvalMany = z.object({ mode: z.enum(['ran', 'queued']), team: z.string().nullable(), skills: z.array(z.string()), ok: z.number(), failed: z.number(), queued: z.array(cliEvalQueueItem), stoppedAfter: z.number().optional() });

/**
 * The CLI line for several skills at once: `eval [--team t] [--batch n | --window w] [--pending] -- <skill>…`, the
 * wizard's Now / In batches / Overnight choices as flags. The two requests the CLI would refuse on sight are refused
 * here too, before a child is spawned, with the CLI's own words so the dialog and the terminal agree.
 */
export function evalManyArgv(args: EvalManyArgs, prefs: PrefStore): string[] {
  if (args.refs.length === 0 && !args.pending) throw new Error('Provide at least one skill, or --pending.');
  if (args.mode === 'batches' && (!Number.isSafeInteger(args.batch) || (args.batch ?? 0) < 1)) throw new Error('--batch must be a positive integer.');
  return [
    'eval', ...evalPrefFlags(prefs),
    ...(args.team ? ['--team', args.team] : []),
    ...(args.mode === 'batches' ? ['--batch', String(args.batch)] : []),
    ...(args.mode === 'overnight' || args.mode === 'later' ? ['--window', args.mode] : []),
    ...(args.pending ? ['--pending'] : []),
    ...(args.refs.length ? ['--', ...args.refs] : []),
  ];
}

export function mapEvalMany(value: z.infer<typeof cliEvalMany>): EvalManyResult {
  return { mode: value.mode, team: value.team, skills: value.skills, ok: value.ok, failed: value.failed, queued: value.queued, ...(value.stoppedAfter === undefined ? {} : { stoppedAfter: value.stoppedAfter }) };
}
