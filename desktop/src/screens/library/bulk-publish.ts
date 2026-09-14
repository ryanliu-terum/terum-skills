import type { SkillCard } from '../../backend/types';

/** One row's life: it is never sent unless it started `ready`, and every later state names what the CLI did. */
export type BulkRowState =
  | { kind: 'ready' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'queued' }
  | { kind: 'publishing'; label: string | null }
  | { kind: 'done'; text: string }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled' }
  | { kind: 'not-started' };

export interface BulkRow { key: string; card: SkillCard; state: BulkRowState }
export interface BulkPublishSummary { published: number; attempted: number; failed: number }

export function rowText(state: BulkRowState): string {
  switch (state.kind) {
    case 'ready': return 'Ready';
    case 'skipped': return `Skipped · ${state.reason}`;
    case 'queued': return 'Queued';
    case 'publishing': return state.label === null ? 'Publishing…' : `Publishing… ${state.label}`;
    case 'done': return state.text;
    case 'failed': return `Failed · ${state.error}`;
    case 'cancelled': return 'Cancelled';
    case 'not-started': return 'Not started';
  }
}

/** The same ref rule as the skill page's dialog: a folder the team has never seen is named by its path (the CLI accepts one since #193), a team skill by its name. `team` is omitted — one team per machine, exactly as `SkillScreen.publish` passes it when the detail carries none. */
export function publishRef(card: Pick<SkillCard, 'teamed' | 'path' | 'name'>): string { return !card.teamed && card.path ? card.path : card.name; }
