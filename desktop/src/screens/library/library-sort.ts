import type { SkillCard } from '../../backend/types';

/**
 * The Library's sort, committed to the URL as `?sort=` ('updated' is the default and is never written).
 * There is deliberately no receipt-derived order here (invariant 6): no verdict, lift or W/L/T option.
 */
export type LibrarySort = 'updated' | 'name' | 'category';

const SORT_VALUES = ['updated', 'name', 'category'] as const;
export const SORT_LABELS: Record<LibrarySort, string> = { updated: 'Recently updated', name: 'Name', category: 'Category' };
/** Menu order, with the default first; the visible Sort button reads the current option's label. */
export const SORT_OPTIONS: readonly { value: LibrarySort; label: string }[] = SORT_VALUES.map(value => ({ value, label: SORT_LABELS[value] }));

function isLibrarySort(value: string): value is LibrarySort { return (SORT_VALUES as readonly string[]).includes(value); }

/** Absent or unknown `sort` reads as the default, so a hand-typed URL degrades to the drawn state. */
export function parseSort(params: URLSearchParams): LibrarySort {
  const raw = params.get('sort');
  return raw !== null && isLibrarySort(raw) ? raw : 'updated';
}

/** The card's last-changed instant as a number, or null when it carries no parsable stamp. */
function stampOf(card: SkillCard): number | null {
  if (!card.updated) return null;
  const parsed = Date.parse(card.updated);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A stable sort that returns a NEW array. Stability is this module's own contract, not the engine's:
 * every comparator falls through to the incoming index, so equal keys keep the order the backend served.
 * That is what keeps the Library boards pixel-identical — every card the mock serves has `updated: null`,
 * so the default 'updated' order is the identity permutation of the fixture list.
 */
export function sortCards(cards: readonly SkillCard[], sort: LibrarySort): SkillCard[] {
  const rows = cards.map((card, index) => ({ card, index }));
  if (sort === 'name') rows.sort((a, b) => a.card.name.localeCompare(b.card.name) || a.index - b.index);
  else if (sort === 'category') rows.sort((a, b) => a.card.category.localeCompare(b.card.category) || a.card.name.localeCompare(b.card.name) || a.index - b.index);
  // 'updated': newest first; a card with no parsable stamp is never guessed at — it keeps its incoming
  // relative order AFTER every dated card rather than being sorted as if it were the epoch.
  else rows.sort((a, b) => {
    const left = stampOf(a.card), right = stampOf(b.card);
    if (left === null && right === null) return a.index - b.index;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || a.index - b.index;
  });
  return rows.map(row => row.card);
}
