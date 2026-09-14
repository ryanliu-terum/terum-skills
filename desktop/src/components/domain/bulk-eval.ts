import type { EvalManyArgs, EvalManyResult, Result } from '../../backend/types';

/** The dialog's three choices — the wizard's Now / In batches / Overnight, offered past setup. 'later' exists in the CLI for a manual drain and is not offered here: the app drains the whole queue overnight anyway. */
export type BulkEvalMode = Extract<EvalManyArgs['mode'], 'now' | 'batches' | 'overnight'>;
export const BULK_EVAL_MODES: readonly { mode: BulkEvalMode; label: string; description: string }[] = [
  { mode: 'now', label: 'Now', description: 'All at once, four at a time.' },
  { mode: 'batches', label: 'In batches', description: 'A few at a time; the app asks before each further batch, and declining queues the rest for later.' },
  { mode: 'overnight', label: 'Overnight', description: 'Queued for the app to run between 01:00 and 05:00 while it is open and idle.' },
];

/** What the run is called in the top-bar chip and the dialog title: the one name, a count, or the pending set. */
export function evalManyLabel(args: Pick<EvalManyArgs, 'refs' | 'pending'>): string {
  const n = args.refs.length;
  if (args.pending) return n === 0 ? 'pending skills' : `${n} skill${n === 1 ? '' : 's'} and pending skills`;
  return n === 1 ? args.refs[0]! : `${n} skills`;
}

/** The terminal line that does the same thing, shown under every choice so the app never hides the verb. */
export function evalManyCommand(args: EvalManyArgs): string {
  const quote = (ref: string) => (/\s/.test(ref) ? `"${ref}"` : ref);
  const flags = [
    ...(args.team ? ['--team', args.team] : []),
    ...(args.mode === 'batches' ? ['--batch', String(args.batch ?? '')] : []),
    ...(args.mode === 'overnight' || args.mode === 'later' ? ['--window', args.mode] : []),
    ...(args.pending ? ['--pending'] : []),
  ];
  return ['npx -y terum-skills@latest eval', ...args.refs.map(quote), ...flags].join(' ');
}

export function isEvalManyResult(value: unknown): value is EvalManyResult {
  return typeof value === 'object' && value !== null && 'mode' in value && 'skills' in value && Array.isArray((value as { skills: unknown }).skills);
}

/** The one line the finished dialog shows: the CLI's counts, or its error when it reported one. */
export function evalManyStatus(result: Result<unknown>, args: Pick<EvalManyArgs, 'mode'>): string {
  if (!result.ok) return result.error;
  const value = result.value;
  if (!isEvalManyResult(value)) return 'Finished';
  if (value.mode === 'queued') return `Queued ${value.queued.length} eval${value.queued.length === 1 ? '' : 's'} for ${args.mode === 'later' ? 'later' : 'overnight'}.`;
  const total = value.skills.length, rest = value.stoppedAfter === undefined ? '' : ` ${value.queued.length} queued for later.`;
  return `Evaluated ${value.ok} of ${total}; ${value.failed} failed.${rest}`;
}
