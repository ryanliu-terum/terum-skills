import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';

function open(route: string) { location.hash = route; return render(<Providers><App/></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const cardNames = () => screen.getAllByTestId(/^skill-card-/).map(el => el.getAttribute('data-testid')?.replace('skill-card-', '') ?? '');
const search = () => new URLSearchParams(location.hash.split('?')[1] ?? '');

// Batch B (2026-09-13): the Library's Sort menu and live search over the mock's 15 cards. The facet popover that
// landed beside them went with #212 (2026-09-14, every facet out of the search rows), so the row only searches and sorts.

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

it('pushes for the navigation-worthy write: changing the sort', async () => {
  open('#/library/global');
  await screen.findByText('15 skills');
  const push = vi.spyOn(window.history, 'pushState');
  fireEvent.click(screen.getByRole('button', { name: 'Recently updated' }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Category' }));
  await waitFor(() => expect(search().get('sort')).toBe('category'));
  expect(push).toHaveBeenCalledTimes(1);
});
it('keeps the drawn toolbar on an empty library and offers no filter with it', async () => {
  open('#/library/global?__mock=empty');
  expect(await screen.findByText('No skills in your global library')).toBeInTheDocument();
  // The row is part of the empty board, so it stays; what must not happen is it claiming anything.
  expect(screen.getByLabelText('Search skills')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recently updated' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull();
});
it('renders the error state instead of the toolbar when the read fails, even with a sort in the URL', async () => {
  open('#/library/global?__mock=error&sort=name');
  expect(await screen.findByText("Couldn't read your library")).toBeInTheDocument();
  expect(screen.getByText("EACCES: permission denied, scandir '~/.terum/skills'")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recently updated' })).toBeNull();
  expect(screen.queryByLabelText(/^Search/)).toBeNull();
});

