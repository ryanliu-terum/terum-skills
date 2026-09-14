import { useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { useSearchParams } from 'react-router';
import type { SkillCard } from '../../backend/types';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { pluralWord } from '../marketplace/market-data';
import type { LibraryFacets, LibraryState } from './library-facets';
import { emptyFacets, libraryCategories, libraryFacetMatches, libraryQueryMatches, libraryVerdictCounts, LIBRARY_STATES, LIBRARY_STATE_LABELS, parseLibraryFacets, serializeLibraryFacets, stripLibraryFacets } from './library-facets';
// The popover's rules are the marketplace popover's, byte for byte, in their own file so both screens
// can import them: a fresh load of #/library/global never mounts MarketplaceScreen, and Vite would
// otherwise leave the Library's popover unstyled.
import '../marketplace/market-filters.css';

function Group({ label, children }: PropsWithChildren<{ label: string }>) { return <div className="market-filter-group"><span>{label}</span>{children}</div>; }

function Chips({ labels, selected, onChange }: { labels: readonly string[]; selected: readonly string[]; onChange: (next: string[]) => void }) {
  return <div className="market-filter-chips">{labels.map(label => <button type="button" key={label} aria-pressed={selected.includes(label)} onClick={() => onChange(selected.includes(label) ? selected.filter(value => value !== label) : [...selected, label])}>{selected.includes(label) && <Icon name="check" size={12} stroke="2.5"/>}{label}</button>)}</div>;
}

/**
 * The Library's filter popover, opened by `?filters=open` and rendered inside the SearchRow so it
 * anchors under the row's right edge. Its counts are the scope's own cards — never the marketplace
 * catalogue and never a fixture number — so it says nothing the current read model cannot support.
 *
 * `cards` is the whole scope BEFORE the query and before any committed facets: a verdict count that
 * shrank as you typed would be telling you about the query, not about the library.
 */
export function LibraryFilters({ cards, query, onClose }: { cards: readonly SkillCard[]; query: string; onClose: () => void }) {
  const [params, setParams] = useSearchParams();
  const [facets, setFacets] = useState<LibraryFacets>(() => parseLibraryFacets(params) ?? emptyFacets());
  const region = useRef<HTMLDivElement>(null);
  /**
   * Focus starts inside the popover, the way the marketplace's does (market-components.tsx, review C2).
   * This region is a SIBLING of the Filter button inside `.board-search-row`, so with focus left on that
   * button (what a click does) or on <body> (what a load straight at ?filters=open does) a keydown never
   * traverses this node and the Escape handler below never hears it: Escape did nothing until the user
   * happened to click a checkbox first — measured in Chromium against the mock, not reasoned about
   * (review 2026-09-13). Focusing on mount also puts Tab in the right place (the filters first, the row's
   * Sort button after them); `preventScroll` leaves the page where the user left it, and SearchRow hands
   * focus back to the Filter button when this unmounts. Mounting IS opening — no fidelity board opens the
   * Library popover — so nothing a board captures can move.
   */
  useEffect(() => { region.current?.focus({ preventScroll: true }); }, []);
  const patch = (part: Partial<LibraryFacets>) => setFacets(old => ({ ...old, ...part }));
  const categories = libraryCategories(cards);
  // Live CTA count over the DRAFT selection and the query that is actually in the field, so the number
  // on the button is exactly the number of cards the grid will hold once this commits.
  const matching = cards.filter(card => libraryQueryMatches(card, query) && libraryFacetMatches(card, facets)).length;
  const stateLabels = LIBRARY_STATES.map(state => LIBRARY_STATE_LABELS[state]);
  const stateOf = (label: string): LibraryState | undefined => LIBRARY_STATES.find(state => LIBRARY_STATE_LABELS[state] === label);

  /** Clear resets the draft AND commits the empty selection, so the grid behind the open popover
   *  matches what the popover now shows. `filters=open` is kept: clearing is not closing. */
  function clear() { setFacets(emptyFacets()); const next = stripLibraryFacets(params); next.set('active', '0'); setParams(next); }
  // Commit and close in ONE URL write: onClose() would issue a second setSearchParams from the caller's
  // (stale) render-scope params and clobber the freshly committed facets, so the commit deletes
  // filters=open itself. This is a push — a committed filter is navigation-worthy.
  function commit() { const next = serializeLibraryFacets(facets, params); next.delete('filters'); setParams(next); }

  return <div ref={region} tabIndex={-1} className="market-filters" role="region" aria-label="Library filters" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <div className="market-filters-head"><span>Filters</span><Button kind="ghost" onClick={clear}>Clear</Button></div>
    <div className="market-filters-columns">
      <div>
        <Group label="Verdict">
          <div className="market-verdicts">{libraryVerdictCounts(cards).map(([name, count]) => <label key={name} data-testid={'library-verdict-' + name}>
            <span>
              <input type="checkbox" checked={facets.verdicts.includes(name)} onChange={e => patch({ verdicts: e.target.checked ? [...facets.verdicts, name] : facets.verdicts.filter(verdict => verdict !== name) })}/>
              <span className="market-checkbox">{facets.verdicts.includes(name) && <Icon name="check" size={12} stroke="3"/>}</span>
              <span>{name}</span>
            </span>
            <span>{count}</span>
          </label>)}</div>
        </Group>
      </div>
      <div>
        {/* No chips is not an empty box: a scope whose folders carry no category has nothing to offer here, and saying so beats an invisible control. */}
        <Group label="Category">{categories.length ? <Chips labels={categories} selected={facets.categories} onChange={next => patch({ categories: next })}/> : <span className="board-small">No categories in this library</span>}</Group>
        <Group label="Status"><Chips labels={stateLabels} selected={facets.states.map(state => LIBRARY_STATE_LABELS[state])} onChange={next => patch({ states: next.flatMap(label => { const state = stateOf(label); return state === undefined ? [] : [state]; }) })}/></Group>
      </div>
    </div>
    <div className="market-filters-foot"><span/><Button kind="primary" onClick={commit}>Show {matching}{' ' + pluralWord(matching, 'skill')}</Button></div>
  </div>;
}
