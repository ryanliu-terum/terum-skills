import type { SkillCard } from '../../backend/types';

/**
 * The two things the Library knows about a folder that the marketplace's facets do not cover.
 *
 * "Shared with team" and "Local only" are deliberately NOT states here. Every card the Library can hold
 * reads `teamed:false` on BOTH backends — the real adapter builds Library cards only through localCard /
 * notOfferedCard, which make no team claim at all (`teamState:'unknown'`), and the mock's localProjection
 * sets the same — so a Shared chip could only ever empty the library and a Local chip could only ever be a
 * no-op that still bumped the Filter badge. COMMON §7: a control that cannot work on the real adapter must
 * not pretend, and `teamed:false` here means "unknown", not "no". A stale link that still carries
 * `state=shared` degrades to neutral through isLibraryState, like any unrecognised member of a closed set.
 * (Review 2026-09-13; the two chips the spec named were resolved out rather than shipped inert.)
 */
export type LibraryState = 'edited' | 'attention';
/** The filter popover's whole selection. Committed to the URL by serializeLibraryFacets and read back by
 *  parseLibraryFacets, so the popover, the Filter badge and the grid share one source of truth. */
export interface LibraryFacets { verdicts: string[]; categories: string[]; states: LibraryState[] }

export const LIBRARY_FACET_KEYS = ['verdicts', 'category', 'state'] as const;
/** "Not evaluated" is a first-class option here exactly as it is in the marketplace: a folder with no
 *  receipt is not missing data, it is a skill nobody has evaluated, and the user can ask for those. */
export const LIBRARY_VERDICTS = ['PASS', 'NEUTRAL', 'FAIL', 'Not evaluated'] as const;
export const LIBRARY_STATES = ['edited', 'attention'] as const;
export const LIBRARY_STATE_LABELS: Record<LibraryState, string> = { edited: 'Edited', attention: 'Needs attention' };

export function emptyFacets(): LibraryFacets { return { verdicts: [], categories: [], states: [] }; }

/** How many facet groups constrain anything — the number the Filter button shows and `active` carries. */
export function activeLibraryFacetCount(f: LibraryFacets): number {
  let n = 0;
  if (f.verdicts.length) n++;
  if (f.categories.length) n++;
  if (f.states.length) n++;
  return n;
}

/** Returns a copy of `params` with every facet param removed ("active" is left to the caller). */
export function stripLibraryFacets(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of LIBRARY_FACET_KEYS) next.delete(key);
  return next;
}

// A category is a CLI-supplied string, so it can contain the comma this list shape joins on. Each value
// is percent-encoded before joining and decoded after splitting: every ordinary value ('PASS', 'infra')
// is unchanged, and one that is not still round-trips instead of silently splitting into two facets.
function joinList(values: readonly string[]): string { return values.map(value => encodeURIComponent(value)).join(','); }
function splitList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').filter(Boolean).map(part => {
    // A hand-typed URL can carry a malformed escape ('%ZZ'), which decodeURIComponent throws on. The
    // raw segment is the honest fallback: it simply matches nothing, rather than losing the whole group.
    try { return decodeURIComponent(part); } catch { return part; }
  });
}

/** Serializes a selection: only constraining groups are written (neutral ones deleted) plus a real
 *  `active` count, so the URL stays short and `active` is always in lockstep with the facet params. */
export function serializeLibraryFacets(f: LibraryFacets, params: URLSearchParams): URLSearchParams {
  const next = stripLibraryFacets(params);
  const put = (key: string, value: string) => { if (value) next.set(key, value); };
  put('verdicts', joinList(f.verdicts));
  put('category', joinList(f.categories));
  put('state', joinList(f.states));
  next.set('active', String(activeLibraryFacetCount(f)));
  return next;
}

function isLibraryState(value: string): value is LibraryState { return (LIBRARY_STATES as readonly string[]).includes(value); }

/**
 * Reads a committed selection back out of the URL. Returns null when no facet param is present (nothing
 * was ever committed). A malformed value degrades to neutral rather than to "matches nothing": the
 * verdict and state groups are closed sets, so an unrecognised member is dropped, and a group left empty
 * by that constrains nothing. Categories are open (the CLI names them), so they pass through verbatim.
 */
export function parseLibraryFacets(params: URLSearchParams): LibraryFacets | null {
  if (!LIBRARY_FACET_KEYS.some(key => params.get(key) !== null)) return null;
  const verdicts = splitList(params.get('verdicts')).filter(value => (LIBRARY_VERDICTS as readonly string[]).includes(value));
  return { verdicts, categories: splitList(params.get('category')), states: splitList(params.get('state')).filter(isLibraryState) };
}

/** The verdict a card is filed under. A card with neither a team receipt nor a local one is "Not
 *  evaluated" — the same reading the VerdictChip renders and the marketplace's facetMatches uses. */
export function cardVerdict(card: SkillCard): string { return (card.summary ?? card.localEval)?.verdict ?? 'Not evaluated'; }

// Both predicates read a datum the Library card actually carries on both backends: `edited` is the CLI's
// own local-edit flag and `broken` is a flag it reports, so each chip can return a non-empty set on a real
// machine and each can also return an empty one honestly. Nothing here reads `teamed` — see LibraryState.
function cardInState(card: SkillCard, state: LibraryState): boolean {
  switch (state) {
    case 'edited': return card.edited;
    case 'attention': return card.flags.includes('broken');
  }
}

/**
 * The app-side facet predicate: OR within a group, AND between groups. Graceful degradation — a card
 * lacking a datum is never excluded by a facet that does not name it, because an empty group is skipped
 * entirely. A card whose category is the em dash placeholder is therefore untouched until the user
 * actually names a category, and the category chips never offer that placeholder as a choice.
 */
export function libraryFacetMatches(card: SkillCard, f: LibraryFacets): boolean {
  if (f.verdicts.length && !f.verdicts.includes(cardVerdict(card))) return false;
  if (f.categories.length && !f.categories.includes(card.category)) return false;
  if (f.states.length && !f.states.some(state => cardInState(card, state))) return false;
  return true;
}

/** The Library's search predicate, unchanged from the one the screen has always applied inline. Shared
 *  now by the grid and the popover's live CTA count so the "Show N skills" button can never disagree
 *  with the grid it is about to produce. An empty query matches every card. */
export function libraryQueryMatches(card: SkillCard, query: string): boolean {
  return (card.name + ' ' + card.desc).toLowerCase().includes(query.toLowerCase());
}

/** The distinct categories of a scope, A–Z. The em dash placeholder is not a category and is excluded:
 *  offering it as a chip would invite the user to filter on "we do not know". */
export function libraryCategories(cards: readonly SkillCard[]): string[] {
  return [...new Set(cards.map(card => card.category))].filter(category => category !== '' && category !== '—').sort((a, b) => a.localeCompare(b));
}

/** Per-verdict counts over a scope, in the fixed PASS · NEUTRAL · FAIL · Not evaluated order. */
export function libraryVerdictCounts(cards: readonly SkillCard[]): [string, number][] {
  return LIBRARY_VERDICTS.map((verdict): [string, number] => [verdict, cards.filter(card => cardVerdict(card) === verdict).length]);
}
