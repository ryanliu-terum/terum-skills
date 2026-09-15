import type { EvalRunState, EvalRunValue } from './eval-run-context';
import { localRef } from '../components/domain/skill-card-actions';
import type { Result, SkillCard } from '../backend/types';

/**
 * Whether the run on screen includes this card (UI policy §5: work in flight is visible where it lands). Every run is
 * started with `localRef` — the folder path for a local card, the name for a team card — so the same function is the
 * inverse: a card is covered when its own ref is the run's ref (one skill) or in the run's refs (several). A team run
 * lights only team cards and a local run only local ones, so two folders of one name in two roots never light
 * together. A queueing run (overnight / later) evaluates nothing now, and a `--pending` run's set is decided by the
 * CLI, so neither lights a card: conservative, never a guess.
 */
export function evalRunCovers(current: EvalRunState | null, card: Pick<SkillCard, 'name' | 'teamed' | 'path'>): boolean {
  if (!current || current.state !== 'running' || current.queue) return false;
  const mine = localRef(card);
  if (current.many) {
    if (current.many.mode === 'overnight' || current.many.mode === 'later') return false;
    return current.many.refs.includes(mine);
  }
  if (current.team !== undefined) return card.teamed && current.ref === mine;
  return !card.teamed && current.ref === mine;
}

/**
 * `state` is the part that must always be read whole (the verb and, while counting, the count); `subject` is the skill's
 * name or "N skills", the part the top bar may shorten with an ellipsis. `label` joins them for the accessible name.
 */
export type EvalChip = { state: string; subject: string | null; label: string; title: string; tone: 'running' | 'done' | 'failed' | 'stopped'; running: boolean };

/**
 * The top-bar chip for every state of the run: starting, printing, counting, then finished / failed / stopped. `null`
 * when there is nothing to show. `title` carries the whole label (the top bar may shorten the subject) and, for a
 * failed run, the CLI's own error, so the reason is one hover away even after the dialog is closed.
 */
export function evalChip(current: EvalRunState | null): EvalChip | null {
  if (!current) return null;
  const name = current.name;
  const chip = (state: string, subject: string | null, tone: EvalChip['tone'], running: boolean, detail?: string): EvalChip => {
    const label = subject === null ? state : `${state} · ${subject}`;
    return { state, subject, label, title: detail ? `${label} — ${detail}` : label, tone, running };
  };
  if (current.state === 'running') {
    // Several skills: the count is the whole story, so the subject ("N skills") gives way to it.
    if (current.progress) return chip(`Evaluating · ${current.progress.done} of ${current.progress.total}`, current.many ? null : name, 'running', true);
    if (current.lines.length === 0) return chip('Starting', name, 'running', true);
    return chip('Evaluating', name, 'running', true);
  }
  if (current.state === 'stopped') return chip('Eval stopped', name, 'stopped', false);
  if (current.state === 'failed') return chip('Eval failed', name, 'failed', false, current.result && !current.result.ok ? current.result.error : undefined);
  return chip('Eval finished', name, 'done', false);
}

/**
 * The one status line every eval dialog shows (UI policy §5): "Starting…" until the CLI prints, "Running…" while it
 * prints, the count once it counts, then Stopped / the CLI's error / `finished(result)` (default "Finished").
 */
export function runStatus(current: EvalRunState, finished: (result: Result<EvalRunValue>) => string = () => 'Finished'): string {
  if (current.state === 'running') return current.progress ? `${current.progress.done} of ${current.progress.total} evaluated` : current.lines.length ? 'Running…' : 'Starting…';
  if (current.state === 'stopped') return 'Stopped';
  if (current.result && !current.result.ok) return current.result.error;
  return current.result ? finished(current.result) : 'Finished';
}
