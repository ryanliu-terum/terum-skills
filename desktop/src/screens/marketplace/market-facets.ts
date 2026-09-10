import type { Catalog, SkillCard } from '../../backend/types';

/** "Context · at most" slider ceiling. At 0 or at/beyond the cap the facet is an uncapped no-op: the drawn end stop reads "10k tokens" (everything), and the real adapter's filterDefault.tokens_max of 0 means "no cap" there. */
export const TOKENS_CAP = 10;
export const UPDATED_ANY = 'Any time';
const UPDATED_WINDOWS: Record<string, number> = { '7 days': 7, '30 days': 30 };

/** The filter popover's whole selection. Committed to the URL by serializeFacets and read back by parseFacets, so the popover, the badge and every skill list share one source of truth. */
export interface Facets { verdicts: string[]; liftMin: number; tokensMax: number; installsMin: number; updated: string; lists: string[]; categories: string[]; author: string; hide: boolean }

const FACET_KEYS = ['verdicts', 'lift', 'tokens', 'installs', 'updated', 'list', 'category', 'author', 'hide'] as const;

export function defaultFacets(catalog: Catalog): Facets { return { verdicts: [...catalog.filterDefault.verdicts], liftMin: catalog.filterDefault.lift_min, tokensMax: catalog.filterDefault.tokens_max, installsMin: catalog.filterDefault.installs_min, updated: UPDATED_ANY, lists: [], categories: [], author: '', hide: false }; }
export function clearedFacets(): Facets { return { verdicts: [], liftMin: 0, tokensMax: TOKENS_CAP, installsMin: 0, updated: UPDATED_ANY, lists: [], categories: [], author: '', hide: false }; }

function tokensCapped(tokensMax: number): boolean { return tokensMax > 0 && tokensMax < TOKENS_CAP; }

/** How many facet groups constrain anything — the number the filter badge shows. The mock's default selection (PASS · lift ≥ 20 · ≤ 5k tokens · installs ≥ 3) counts 4, matching the drawn "default 4 active" badge; the real adapter's all-neutral default counts 0. */
export function activeFacetCount(f: Facets): number {
  let n = 0;
  if (f.verdicts.length) n++;
  if (f.liftMin > 0) n++;
  if (tokensCapped(f.tokensMax)) n++;
  if (f.installsMin > 0) n++;
  if (f.updated !== UPDATED_ANY) n++;
  if (f.lists.length) n++;
  if (f.categories.length) n++;
  if (f.author) n++;
  if (f.hide) n++;
  return n;
}

/** Returns a copy of `params` with every facet param removed ("active" is left to the caller). */
export function stripFacets(params: URLSearchParams): URLSearchParams { const next = new URLSearchParams(params); for (const key of FACET_KEYS) next.delete(key); return next; }

/** Serializes a selection into search params: only constraining facets are written (neutral ones are deleted) plus a real `active` count, so the URL stays short and `active` is always in lockstep with the facet params. */
export function serializeFacets(f: Facets, params: URLSearchParams): URLSearchParams {
  const next = stripFacets(params);
  const put = (key: string, value: string) => { if (value) next.set(key, value); };
  put('verdicts', f.verdicts.join(','));
  put('lift', f.liftMin > 0 ? String(f.liftMin) : '');
  put('tokens', tokensCapped(f.tokensMax) ? String(f.tokensMax) : '');
  put('installs', f.installsMin > 0 ? String(f.installsMin) : '');
  put('updated', f.updated in UPDATED_WINDOWS ? f.updated : '');
  put('list', f.lists.join(','));
  put('category', f.categories.join(','));
  put('author', f.author);
  put('hide', f.hide ? '1' : '');
  next.set('active', String(activeFacetCount(f)));
  return next;
}

/** Reads a committed selection back out of the URL. Returns null when no facet param is present (nothing was ever committed); individual missing or malformed params fall back to their neutral value. */
export function parseFacets(params: URLSearchParams): Facets | null {
  if (!FACET_KEYS.some(key => params.get(key) !== null)) return null;
  const list = (raw: string | null) => raw ? raw.split(',').filter(Boolean) : [];
  const num = (raw: string | null, fallback: number) => { const n = raw === null || raw.trim() === '' ? Number.NaN : Number(raw); return Number.isFinite(n) && n >= 0 ? n : fallback; };
  const updated = params.get('updated');
  return { verdicts: list(params.get('verdicts')), liftMin: num(params.get('lift'), 0), tokensMax: num(params.get('tokens'), TOKENS_CAP), installsMin: num(params.get('installs'), 0), updated: updated !== null && updated in UPDATED_WINDOWS ? updated : UPDATED_ANY, lists: list(params.get('list')), categories: list(params.get('category')), author: params.get('author') ?? '', hide: params.get('hide') === '1' };
}

function sameSet(a: string[], b: string[]): boolean { const x = [...a].sort(), y = [...b].sort(); return x.length === y.length && x.every((value, i) => value === y[i]); }
export function facetsEqual(a: Facets, b: Facets): boolean { return sameSet(a.verdicts, b.verdicts) && a.liftMin === b.liftMin && a.tokensMax === b.tokensMax && a.installsMin === b.installsMin && a.updated === b.updated && sameSet(a.lists, b.lists) && sameSet(a.categories, b.categories) && a.author === b.author && a.hide === b.hide; }

/** Days since a card was updated, from whichever form the adapter serves ("today", "3 days ago", an ISO date); null when the card carries no usable stamp. */
function updatedDays(text: string | null): number | null {
  if (!text) return null;
  if (text === 'today' || text === 'just now') return 0;
  if (text === 'yesterday') return 1;
  const relative = /^(\d+) days? ago$/.exec(text);
  if (relative) return Number(relative[1]);
  const stamp = Date.parse(text);
  return Number.isNaN(stamp) ? null : Math.max(0, Math.floor((Date.now() - stamp) / 86400000));
}

function listMatches(card: SkillCard, label: string, catalog: Catalog): boolean {
  if (card.project === label) return true;
  const project = catalog.projects.find(p => p.name === label);
  // A project chip matches by list membership (skillsIn) or by the card's own project key/name; the "Global" chip can only match cards the adapter marks project "Global" — per-card global-list membership is not in the catalog.
  return project ? project.key === card.project || project.name.toLowerCase() === card.project.toLowerCase() || project.skillsIn.includes(card.name) : false;
}

/**
 * The app-side facet predicate, mirroring the shape of filter_matches (backend/mock/derive.ts:51) for
 * verdict / lift / tokens / installs and extending it to the popover's other facets.
 * Graceful degradation: a facet whose backing datum is absent on a card never excludes that card —
 * no receipt (lift unknown), tokensK 0 (the real adapter serves size "—"), updated null, or an author
 * the catalog does not list. The exception is the verdict facet, where "Not evaluated" is itself a
 * first-class option, so a receiptless card counts as "Not evaluated" exactly as filter_matches does.
 */
export function facetMatches(card: SkillCard, f: Facets, catalog: Catalog): boolean {
  if (f.verdicts.length && !f.verdicts.includes(card.summary?.verdict ?? 'Not evaluated')) return false;
  if (f.liftMin > 0 && card.summary && card.summary.lift < f.liftMin) return false;
  if (tokensCapped(f.tokensMax) && card.tokensK > 0 && card.tokensK > f.tokensMax) return false;
  if (f.installsMin > 0 && Number.isFinite(card.installsN) && card.installsN < f.installsMin) return false;
  if (f.updated !== UPDATED_ANY) { const cap = UPDATED_WINDOWS[f.updated], days = updatedDays(card.updated); if (cap !== undefined && days !== null && days > cap) return false; }
  if (f.lists.length && !f.lists.some(label => listMatches(card, label, catalog))) return false;
  if (f.categories.length && !f.categories.includes(card.category)) return false;
  if (f.author) { const person = catalog.people.find(p => p.handle === f.author); if (person && !person.skills.includes(card.name)) return false; }
  // 'placed' and 'recorded' both count as installed here: hiding installed skills is about what the user already has.
  if (f.hide && card.installed !== 'absent') return false;
  return true;
}

/**
 * Predicate for the committed selection. Passes everything when nothing was committed OR when the
 * committed selection equals the catalog's default: the drawn boards show the full catalog alongside
 * the default chips, so committing the untouched default selection is deliberately a no-op on the
 * list — only a selection the user actually changed filters it.
 */
export function facetPredicate(catalog: Catalog, facets: Facets | null): (card: SkillCard) => boolean {
  if (!facets || facetsEqual(facets, defaultFacets(catalog))) return () => true;
  return card => facetMatches(card, facets, catalog);
}
