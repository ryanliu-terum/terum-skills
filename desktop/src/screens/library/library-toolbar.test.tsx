import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { Backend } from '../../backend/Backend';

function open(route: string) { location.hash = route; return render(<Providers><App/></Providers>); }
function openWith(route: string, backend: Backend) { location.hash = route; return render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const cardNames = () => screen.getAllByTestId(/^skill-card-/).map(el => el.getAttribute('data-testid')?.replace('skill-card-', '') ?? '');
const search = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
const filterButton = () => screen.getByRole('button', { name: /^Filter/ });
async function openFilters() { open('#/library/global'); await screen.findByText('15 skills'); fireEvent.click(filterButton()); return screen.findByRole('region', { name: 'Library filters' }); }

// The mock Library serves 15 cards: 7 PASS · 4 NEUTRAL · 2 FAIL · 2 Not evaluated, every one projected
// as a local folder (teamed false), one edited (migration-guard) and one broken (incident-triage).

it('opens the filter popover from the Filter button and puts it in the URL', async () => {
  const popover = await openFilters();
  expect(search().get('filters')).toBe('open');
  expect(within(popover).getByText('Filters')).toBeInTheDocument();
  // The button toggles, like the Marketplace's: a second click closes instead of re-writing the URL.
  fireEvent.click(filterButton());
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Library filters' })).toBeNull());
  expect(search().get('filters')).toBeNull();
  // Reachable straight from the URL too — no test-only branch opens it.
  cleanup();
  open('#/library/global?filters=open');
  expect(await screen.findByRole('region', { name: 'Library filters' })).toBeInTheDocument();
});

it('counts verdicts over the whole scope, not over the query or the committed facets', async () => {
  open('#/library/global?q=deploy&filters=open');
  const popover = await screen.findByRole('region', { name: 'Library filters' });
  const count = (verdict: string) => within(popover).getByTestId('library-verdict-' + verdict).textContent;
  await waitFor(() => expect(count('PASS')).toBe('PASS7'));
  expect(count('NEUTRAL')).toBe('NEUTRAL4');
  expect(count('FAIL')).toBe('FAIL2');
  expect(count('Not evaluated')).toBe('Not evaluated2');
  // The query narrowed the grid; the counts still describe the library.
  expect(cardNames()).toEqual(['deploy-check', 'incident-triage']);
});

it('commits PASS-only to the exact count its CTA promised and closes the popover in one write', async () => {
  const popover = await openFilters();
  expect(within(popover).getByRole('button', { name: 'Show 15 skills' })).toBeInTheDocument();
  fireEvent.click(within(popover).getByTestId('library-verdict-PASS').querySelector('input')!);
  const cta = await within(popover).findByRole('button', { name: 'Show 7 skills' });
  fireEvent.click(cta);
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Library filters' })).toBeNull());
  expect(search().get('verdicts')).toBe('PASS');
  expect(search().get('active')).toBe('1');
  expect(search().get('filters')).toBeNull();
  expect(cardNames()).toEqual(['deploy-check', 'pr-review', 'migration-guard', 'test-writer', 'csv-profiler', 'silent-failure-hunt', 'adr-writer']);
  expect(filterButton()).toHaveTextContent('Filter · 1');
});

it('ANDs a category with a status and counts the groups, not the values', async () => {
  open('#/library/global?category=infra&state=edited&active=2');
  // infra is three folders, edited is one: the AND is the folder in both, and the badge counts the groups.
  await waitFor(() => expect(cardNames()).toEqual(['migration-guard']));
  expect(filterButton()).toHaveTextContent('Filter · 2');
  cleanup();
  // Each Status chip returns a non-empty set of its own on the mock — and on the real adapter, where both
  // `edited` and the `broken` flag come off the CLI's own rows.
  open('#/library/global?state=attention&active=1');
  await waitFor(() => expect(cardNames()).toEqual(['incident-triage']));
  cleanup();
  // A combination the library genuinely cannot satisfy still says so, with the plural grammar.
  open('#/library/global?category=docs&state=edited&active=2');
  expect(await screen.findByText('No skills match with 2 filters on')).toBeInTheDocument();
});

it('offers no team Status chip, and reads a stale state=shared link as neutral', async () => {
  const popover = await openFilters();
  // Every Library card is teamed:false on BOTH backends (localCard/notOfferedCard on the real adapter,
  // localProjection on the mock), so "Shared with team" could only ever empty the library and "Local only"
  // could only ever be a no-op that still bumped the badge. COMMON §7: neither is offered.
  const status = within(popover).getByText('Status').parentElement!;
  expect(within(status).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Edited', 'Needs attention']);
  expect(within(popover).queryByRole('button', { name: 'Shared with team' })).toBeNull();
  expect(within(popover).queryByRole('button', { name: 'Local only' })).toBeNull();
  cleanup();
  // A link written before they were withdrawn degrades to neutral, not to an empty library under "Filter · 1".
  open('#/library/global?state=shared&active=1');
  await waitFor(() => expect(cardNames()).toHaveLength(15));
  expect(filterButton()).toHaveTextContent('Filter');
  expect(filterButton()).not.toHaveTextContent('·');
});

it('clears the filters from the empty state and restores all 15 cards', async () => {
  open('#/library/global?q=deploy%20prod&verdicts=PASS&active=1');
  expect(await screen.findByText('No skills match “deploy prod” with 1 filter on')).toBeInTheDocument();
  expect(screen.getByText('Try a shorter query, or clear the filters to search the whole library.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  // Clear filters drops the facets, the count and the popover — and keeps the query the user typed.
  await waitFor(() => expect(search().get('verdicts')).toBeNull());
  expect(search().get('active')).toBeNull();
  expect(search().get('q')).toBe('deploy prod');
  expect(await screen.findByText('No skills match “deploy prod”')).toBeInTheDocument();
  // Two controls carry that name once the grid is empty: the field's own ✕ and the state's primary.
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' }).at(-1)!);
  await waitFor(() => expect(cardNames()).toHaveLength(15));
  expect(filterButton()).toHaveTextContent('Filter');
  expect(filterButton()).not.toHaveTextContent('·');
});

it('clears the draft and the committed selection from inside the popover without closing it', async () => {
  open('#/library/global?verdicts=PASS&active=1&filters=open');
  const popover = await screen.findByRole('region', { name: 'Library filters' });
  fireEvent.click(within(popover).getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(search().get('verdicts')).toBeNull());
  expect(search().get('active')).toBe('0');
  expect(search().get('filters')).toBe('open');
  expect(await within(popover).findByRole('button', { name: 'Show 15 skills' })).toBeInTheDocument();
  expect(cardNames()).toHaveLength(15);
});

it('closes the popover on Escape from where the focus actually is, without committing the draft', async () => {
  const popover = await openFilters();
  // Opening moves focus INTO the popover. It is a SIBLING of the Filter button, so an Escape pressed with
  // focus still on that button never traverses this region and its handler never hears the key: pressing it
  // from the real focus is the only assertion that can see that (review 2026-09-13).
  expect(document.activeElement).toBe(popover);
  fireEvent.click(within(popover).getByTestId('library-verdict-FAIL').querySelector('input')!);
  expect(await within(popover).findByRole('button', { name: 'Show 2 skills' })).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Library filters' })).toBeNull());
  expect(search().get('verdicts')).toBeNull();
  expect(search().get('active')).toBeNull();
  expect(search().get('filters')).toBeNull();
  expect(cardNames()).toHaveLength(15);
  // …and focus comes back to the trigger, so the next Tab continues from the row instead of the page top.
  expect(document.activeElement).toBe(filterButton());
});

it('closes on Escape after a deep link and from the trigger itself, and ignores it when shut', async () => {
  open('#/library/global?filters=open');
  const popover = await screen.findByRole('region', { name: 'Library filters' });
  // A load straight at ?filters=open left focus on <body>, where Escape reached nothing at all.
  expect(document.activeElement).toBe(popover);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(search().get('filters')).toBeNull());
  cleanup();
  // Shift-Tab back out to the trigger and Escape still closes: the trigger carries the handler too.
  open('#/library/global?filters=open');
  await screen.findByRole('region', { name: 'Library filters' });
  filterButton().focus();
  fireEvent.keyDown(filterButton(), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Library filters' })).toBeNull());
  expect(search().get('filters')).toBeNull();
  expect(filterButton()).toHaveAttribute('aria-pressed', 'false');
  // With nothing open, Escape on the trigger is not the row's key to take: it opens nothing.
  fireEvent.keyDown(filterButton(), { key: 'Escape' });
  await waitFor(() => expect(cardNames()).toHaveLength(15));
  expect(search().get('filters')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Library filters' })).toBeNull();
});

it('offers exactly three orders, marks the current one, and reorders by name', async () => {
  open('#/library/global');
  await screen.findByText('15 skills');
  fireEvent.click(screen.getByRole('button', { name: 'Recently updated' }));
  const options = await screen.findAllByRole('menuitemradio');
  expect(options.map(o => o.textContent)).toEqual(['Recently updated', 'Name', 'Category']);
  expect(options.map(o => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  // Never an order derived from a receipt (invariant 6).
  expect(options.some(o => /lift|verdict|pass|W\/L\/T/i.test(o.textContent ?? ''))).toBe(false);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }));
  await waitFor(() => expect(search().get('sort')).toBe('name'));
  expect(cardNames()).toEqual(['adr-writer', 'api-docs', 'commit-msg', 'csv-profiler', 'deploy-check', 'env-audit', 'handoff-note', 'incident-triage', 'migration-guard', 'onboarding-tour', 'pr-review', 'release-notes', 'silent-failure-hunt', 'source-check', 'test-writer']);
  expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument();
});

it('drops the sort param when the default order is chosen again, and leaves the fixture order alone', async () => {
  open('#/library/global?sort=name');
  await waitFor(() => expect(cardNames()[0]).toBe('adr-writer'));
  fireEvent.click(screen.getByRole('button', { name: 'Name' }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Recently updated' }));
  await waitFor(() => expect(search().get('sort')).toBeNull());
  // Every mock card carries updated:null, so the default order is the backend's own order — this is the
  // pin that keeps the Library boards pixel-identical.
  expect(cardNames()).toEqual(['deploy-check', 'release-notes', 'pr-review', 'incident-triage', 'api-docs', 'migration-guard', 'test-writer', 'commit-msg', 'onboarding-tour', 'csv-profiler', 'silent-failure-hunt', 'handoff-note', 'source-check', 'env-audit', 'adr-writer']);
});

it('groups by category when asked, and keeps an unknown sort on the default order', async () => {
  open('#/library/global?sort=category');
  await waitFor(() => expect(cardNames()[0]).toBe('csv-profiler'));
  expect(cardNames().slice(0, 5)).toEqual(['csv-profiler', 'adr-writer', 'api-docs', 'release-notes', 'commit-msg']);
  cleanup();
  open('#/library/global?sort=lift');
  await waitFor(() => expect(cardNames()[0]).toBe('deploy-check'));
  expect(screen.getByRole('button', { name: 'Recently updated' })).toBeInTheDocument();
});

it('replaces history while typing in search and pushes when the query is cleared', async () => {
  open('#/library/global');
  await screen.findByText('15 skills');
  const push = vi.spyOn(window.history, 'pushState'), replace = vi.spyOn(window.history, 'replaceState');
  const field = screen.getByLabelText('Search 15 skills');
  for (const value of ['d', 'de', 'dep', 'depl', 'deplo', 'deploy']) fireEvent.change(field, { target: { value } });
  await waitFor(() => expect(search().get('q')).toBe('deploy'));
  expect(replace).toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  // Backspacing to empty is still typing. The last keystroke used to PUSH because the replace flag was read
  // off the resulting value, so Back returned to '?q=d' — a one-character query the user never meant to
  // visit — instead of leaving the screen (review 2026-09-13).
  for (const value of ['deplo', 'depl', 'dep', 'de', 'd', '']) fireEvent.change(field, { target: { value } });
  await waitFor(() => expect(search().get('q')).toBeNull());
  expect(push).not.toHaveBeenCalled();
  // The ✕ clears in one gesture, which IS a navigation the user should be able to undo, so it pushes.
  for (const value of ['d', 'de', 'dep', 'depl', 'deplo', 'deploy']) fireEvent.change(field, { target: { value } });
  await waitFor(() => expect(search().get('q')).toBe('deploy'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' }).at(-1)!);
  await waitFor(() => expect(search().get('q')).toBeNull());
  expect(push).toHaveBeenCalledTimes(1);
});

it('pushes for the navigation-worthy writes: opening filters, committing them and changing the sort', async () => {
  open('#/library/global');
  await screen.findByText('15 skills');
  const push = vi.spyOn(window.history, 'pushState');
  fireEvent.click(filterButton());
  const popover = await screen.findByRole('region', { name: 'Library filters' });
  fireEvent.click(within(popover).getByTestId('library-verdict-PASS').querySelector('input')!);
  fireEvent.click(await within(popover).findByRole('button', { name: 'Show 7 skills' }));
  await waitFor(() => expect(search().get('verdicts')).toBe('PASS'));
  fireEvent.click(screen.getByRole('button', { name: 'Recently updated' }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Category' }));
  await waitFor(() => expect(search().get('sort')).toBe('category'));
  expect(push).toHaveBeenCalledTimes(3);
});

it('counts the filters actually applied, never the URL\'s active string', async () => {
  // Deep links the app writes keep the two in lockstep; a hand-typed one cannot make the badge lie.
  open('#/library/global?active=7');
  await waitFor(() => expect(cardNames()).toHaveLength(15));
  expect(filterButton()).toHaveTextContent('Filter');
  expect(filterButton()).not.toHaveTextContent('7');
  cleanup();
  open('#/library/global?verdicts=PASS,FAIL&category=infra&active=0');
  await waitFor(() => expect(cardNames()).toEqual(['deploy-check', 'migration-guard', 'env-audit']));
  expect(filterButton()).toHaveTextContent('Filter · 2');
});

it('keeps the drawn toolbar on an empty library but makes the popover say zero', async () => {
  open('#/library/global?__mock=empty&filters=open');
  expect(await screen.findByText('No skills in your global library')).toBeInTheDocument();
  // The row is part of the empty board, so it stays; what must not happen is it claiming anything.
  expect(filterButton()).toHaveTextContent('Filter');
  expect(screen.getByLabelText('Search skills')).toBeInTheDocument();
  const popover = await screen.findByRole('region', { name: 'Library filters' });
  expect(within(popover).getByTestId('library-verdict-PASS')).toHaveTextContent('PASS0');
  expect(within(popover).getByTestId('library-verdict-Not evaluated')).toHaveTextContent('Not evaluated0');
  expect(within(popover).getByText('No categories in this library')).toBeInTheDocument();
  expect(within(popover).getByRole('button', { name: 'Show 0 skills' })).toBeInTheDocument();
});

it('renders the error state instead of the toolbar when the read fails, even with filters in the URL', async () => {
  open('#/library/global?__mock=error&filters=open&verdicts=PASS&active=1&sort=name');
  expect(await screen.findByText("Couldn't read your library")).toBeInTheDocument();
  expect(screen.getByText("EACCES: permission denied, scandir '~/.terum/skills'")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Library filters' })).toBeNull();
});

it('keeps the popover closed while the read is still pending', async () => {
  const backend = createMockBackend();
  vi.spyOn(backend, 'library').mockImplementation(() => new Promise(() => { /* never settles: the loading board has no completion */ }));
  openWith('#/library/global?filters=open', backend);
  expect(await screen.findByLabelText('Loading skills')).toBeInTheDocument();
  // Nothing to count and nothing to filter yet: drawing the popover over a skeleton would be a claim.
  expect(screen.queryByRole('region', { name: 'Library filters' })).toBeNull();
});
