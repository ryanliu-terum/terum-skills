import type { EvalRunState } from './eval-run-context';
import { localRef } from '../components/domain/skill-card-actions';
import type { SkillCard } from '../backend/types';

/**
 * Whether the run on screen includes this card (UI policy §5: work in flight is visible where it lands). A single
 * run names one skill (and its team); a several-skills run carries its refs — the folder path for a local card, the name for a
 * team card (`localRef`). A `--pending` run's set is decided by the CLI, so no card can claim it: conservative,
 * never a guess.
 */
export function evalRunCovers(current: EvalRunState | null, card: Pick<SkillCard, 'name' | 'teamed' | 'path'>): boolean {
  if (!current || current.state !== 'running') return false;
  if (current.many) {
    const mine = localRef(card);
    return current.many.refs.some(ref => ref === mine || ref === card.name || (card.path !== null && ref === card.path));
  }
  if (current.queue) return false;
  // A card has no team field of its own: a team-scoped run lights a team card of that name, a local run a local one. The
  // run's ref is the folder path for a local run, so a local card also matches by path.
  if (current.team !== undefined) return card.teamed && current.name === card.name;
  return !card.teamed && (current.name === card.name || (card.path !== null && current.ref === card.path));
}

export type EvalChip = { label: string; tone: 'running' | 'done' | 'failed' | 'stopped'; running: boolean };

/** The top-bar chip's text for every state of the run: starting, counting, finished, failed, stopped. `null` when there is nothing to show. */
export function evalChip(current: EvalRunState | null): EvalChip | null {
  if (!current) return null;
  const name = current.name;
  if (current.state === 'running') {
    if (current.progress) return { label: `Evaluating · ${current.progress.done} of ${current.progress.total}${current.many ? '' : ` · ${name}`}`, tone: 'running', running: true };
    if (current.lines.length === 0) return { label: `Starting eval · ${name}`, tone: 'running', running: true };
    return { label: `Evaluating · ${name}`, tone: 'running', running: true };
  }
  if (current.state === 'stopped') return { label: `Eval stopped · ${name}`, tone: 'stopped', running: false };
  if (current.state === 'failed') return { label: `Eval failed · ${name}`, tone: 'failed', running: false };
  return { label: `Eval finished · ${name}`, tone: 'done', running: false };
}
