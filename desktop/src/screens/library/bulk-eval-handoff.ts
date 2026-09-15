import type { SkillCard } from '../../backend/types';
import { localActionReason, localRef } from '../../components/domain/skill-card-actions';

/**
 * "Evaluate N…" in the Library's selection bar (batch E follow-up, 2026-09-14). The Library runs nothing itself:
 * it hands the drawn selection to the app-wide bulk-eval question (`?dialog=bulk-eval&ref=a&ref=b`, PR #206),
 * which asks Now / In batches / Overnight and streams the run through the eval host. Only what that dialog can
 * actually run is handed over — a card the ⋯ menu refuses to evaluate is left out with the menu's own reason,
 * so the button never counts a skill the CLI would reject and the bar says which ones stayed behind.
 */
export type EvalCandidate = Pick<SkillCard, 'teamed' | 'path' | 'name' | 'flags' | 'flagText'>;
export interface BulkEvalHandoff { refs: string[]; leftOut: { name: string; reason: string }[] }

export function bulkEvalHandoff(cards: readonly EvalCandidate[]): BulkEvalHandoff {
  const refs: string[] = [], leftOut: { name: string; reason: string }[] = [];
  for (const card of cards) {
    const reason = localActionReason(card, 'eval');
    if (reason === null) refs.push(localRef(card)); else leftOut.push({ name: card.name, reason });
  }
  return { refs, leftOut };
}

/** The URL the host answers. The Library's own state (`select=1`, query, sort) rides along, so closing the question lands back on the same view; a stale `ref` or `pending` from a pasted link is dropped rather than merged. */
export function bulkEvalSearch(search: URLSearchParams, refs: readonly string[]): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete('ref'); next.delete('pending'); next.set('dialog', 'bulk-eval');
  for (const ref of refs) next.append('ref', ref);
  return next;
}

/** One line under the bar, names grouped by reason; `null` when every selected card can be evaluated. */
export function leftOutText(leftOut: readonly { name: string; reason: string }[]): string | null {
  if (leftOut.length === 0) return null;
  const groups = new Map<string, string[]>();
  for (const { name, reason } of leftOut) groups.set(reason, [...(groups.get(reason) ?? []), name]);
  return 'Left out of the eval · ' + [...groups].map(([reason, names]) => `${names.join(', ')}: ${reason}`).join(' · ');
}

/**
 * The CLI's reason with its instance-specific tail removed, so folders that failed the same way share one heading
 * (UI policy §6): quoted paths become `'…'`, a YAML parser's line/column and its echoed source are dropped. The full
 * reason stays on each name (hover and copy); the heading is for grouping and reading.
 */
export function reasonHeading(reason: string): string {
  return reason
    .replace(/'[^']*'/g, "'…'")
    .replace(/\s+at line \d+, column \d+:.*$/s, '')
    .replace(/:\s*Nested mappings.*$/s, ': nested mappings are not allowed in compact mappings')
    .trim();
}

export interface LeftOutGroup { heading: string; rows: { name: string; reason: string }[] }

/** The left-out folders grouped under their shared heading, largest group first, names in the selection's order. */
export function groupLeftOut(leftOut: readonly { name: string; reason: string }[]): LeftOutGroup[] {
  const groups = new Map<string, LeftOutGroup>();
  for (const row of leftOut) {
    const heading = reasonHeading(row.reason);
    const group = groups.get(heading) ?? { heading, rows: [] };
    group.rows.push(row);
    groups.set(heading, group);
  }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
}
