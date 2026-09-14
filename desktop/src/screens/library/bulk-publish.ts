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
