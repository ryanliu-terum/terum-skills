import type { EvalChip } from './eval-run-status';
import type { PublishRunState } from './publish-run-context';

/** The publish chip is the eval chip's shape: `state` is read whole, `subject` may be shortened, `label` joins them. */
export type PublishChip = EvalChip;

/**
 * The top-bar chip for every state of a publish run: running (one skill, or a count of several), stopping, then
 * finished / failed / stopped. `null` when there is nothing to show. The North Star's second clause lives here: a
 * run that finishes or fails while the board is dismissed still reads out in the bar, and `title` carries the whole
 * story — the outcome sentence for one skill, the CLI's own error for a failure — so it is one hover away.
 */
export function publishChip(current: PublishRunState | null): PublishChip | null {
 if (!current) return null;
 const one = current.rows.length === 1, name = current.rows[0]?.card.name ?? 'skill';
 const chip = (state: string, subject: string | null, tone: PublishChip['tone'], running: boolean, detail?: string): PublishChip => {
  const label = subject === null ? state : `${state} · ${subject}`;
  return { state, subject, label, title: detail ? `${label} — ${detail}` : label, tone, running };
 };
 // Rows the queue can send; a skipped row was never part of the count.
 const sendable = current.rows.filter(row => row.state.kind !== 'skipped').length;
 const settled = current.rows.filter(row => row.state.kind === 'done' || row.state.kind === 'failed' || row.state.kind === 'cancelled').length;
 if (current.state === 'running') {
  if (one) return chip('Publishing', current.progress?.label ? `${name} · ${current.progress.label}` : name, 'running', true);
  return chip(`Publishing · ${settled} of ${sendable}`, null, 'running', true);
 }
 // Stopping still offers Stop: a second press force-abandons a run whose cancel is ignored (D2).
 if (current.state === 'stopping') return chip('Stopping', one ? name : `${sendable} skills`, 'running', true);
 if (current.state === 'stopped') return chip('Publish stopped', `${current.summary?.published ?? 0} published`, 'stopped', false);
 if (current.state === 'failed') {
  // Named for the row that failed — the first row may be a skipped one.
  const failed = current.rows.find(row => row.state.kind === 'failed');
  return chip('Publish failed', failed?.card.name ?? name, 'failed', false, failed?.state.kind === 'failed' ? failed.state.error : undefined);
 }
 if (one) {
  const row = current.rows[0];
  return chip('Publish finished', name, 'done', false, row?.state.kind === 'done' ? row.state.text : undefined);
 }
 const published = current.summary?.published ?? 0, attempted = current.summary?.attempted ?? sendable, failed = current.summary?.failed ?? 0;
 return chip(`Published · ${published} of ${attempted}`, failed > 0 ? `${failed} failed` : null, failed > 0 ? 'failed' : 'done', false);
}
