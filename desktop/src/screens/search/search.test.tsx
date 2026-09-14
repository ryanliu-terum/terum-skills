import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { Backend } from '../../backend/Backend';
import type { Library, LibraryScope, ReadOptions, Result, SearchHit } from '../../backend/types';

const FIELD = 'Search skills, people, projects';
function openWith(route: string, backend: Backend) { location.hash = route; return render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>); }
function open(route: string) { return openWith(route, createMockBackend()); }
function field() { return screen.getByRole('textbox', { name: FIELD }); }
/** The screen body, so a label like "Projects" is not confused with the sidebar's section of that name. */
function page() { return within(screen.getByRole('main')); }
/** The panel's rows in draw order — the order ↑/↓ walk. */
function rowIds() { return screen.queryAllByRole('button').map(button => button.getAttribute('data-testid')).filter((id): id is string => id !== null && id.startsWith('search-hit-')); }
/** One group's block, so an error line is read under the label the page filed it under. */
function group(label: string) { const block = page().getByText(label).closest('.search-page-group'); if (block === null) throw new Error(`No group labelled ${label}.`); return block as HTMLElement; }
/** The results panel itself, which carries the highlight and busy flags. */
function panel() { const node = screen.getByRole('main').querySelector('.search-page-panel'); if (node === null) throw new Error('No results panel.'); return node as HTMLElement; }
/** A `search` hit with every field the real adapter can fill; the mock's own hits carry none of them. */
function hit(over: Partial<SearchHit> = {}): SearchHit { return { kind: 'skill', ref: 'deploy-check', name: 'deploy-check', description: '', team: null, category: null, author: null, installs: null, latest: null, ...over }; }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

it('asks for a term before it searches anything', async () => {
  const backend = createMockBackend(), search = vi.spyOn(backend, 'search');
  openWith('#/search', backend);
  expect(await screen.findByText('Type to search skills, people and projects.')).toBeVisible();
  expect(field()).toHaveValue('');
  expect(rowIds()).toEqual([]);
  expect(search).not.toHaveBeenCalled();
  await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true'));
});

it('groups the mock’s hits under Skills, Your library and Projects', async () => {
  open('#/search?q=deploy');
  // The team's copy of the skill, from the CLI's own `search`.
  expect(await screen.findByTestId('search-hit-skill-deploy-check')).toHaveAccessibleName('deploy-check');
  expect(screen.getByTestId('search-hit-skill-incident-triage')).toBeVisible();
  // Every mock Library card is a local folder (`localProjection` sets `teamed:false`), so each root that
  // holds a match contributes one row and says which root it is.
  const globalRow = screen.getByTestId('search-hit-library-~/.claude/skills/deploy-check');
  expect(globalRow).toHaveTextContent('Global');
  expect(screen.getByTestId('search-hit-library-/Users/you/code/terum/.claude/skills/deploy-check')).toHaveTextContent('Terum');
  // The mock's search hits carry no author/installs/category, so the Skills meta stays empty rather than printing nulls.
  expect(screen.getByTestId('search-hit-skill-deploy-check')).not.toHaveAccessibleDescription();
  expect(screen.getByTestId('search-hit-project-terum')).toHaveAccessibleDescription('8 skills');
  expect(page().getByText('Skills')).toBeVisible();
  expect(page().getByText('Your library')).toBeVisible();
  expect(page().getByText('Projects')).toBeVisible();
  // Nobody's name or role holds "deploy": the group is absent rather than empty.
  expect(page().queryByText('People')).toBeNull();
});

it('unions a member hit with the catalog person and prints the identity sub-line', async () => {
  open('#/search?q=ryan');
  const row = await screen.findByTestId('search-hit-member-ryan');
  expect(row).toHaveAccessibleName('Ryan Liu');
  expect(row).toHaveAccessibleDescription('founder · ryan');
  // One row, not two: the search hit and the catalog person are the same handle.
  expect(rowIds().filter(id => id.startsWith('search-hit-member-'))).toEqual(['search-hit-member-ryan']);
});

it.each([
  ['search-hit-skill-deploy-check', '#/skill/deploy-check?root=marketplace'],
  ['search-hit-library-~/.claude/skills/deploy-check', '#/skill/local?path=' + encodeURIComponent('~/.claude/skills/deploy-check')],
  ['search-hit-library-/Users/you/code/terum/.claude/skills/deploy-check', '#/skill/local?path=' + encodeURIComponent('/Users/you/code/terum/.claude/skills/deploy-check') + '&root=' + encodeURIComponent('/Users/you/code/terum')],
  ['search-hit-project-terum', '#/marketplace/projects/terum'],
])('opens %s at %s', async (testId, hash) => {
  open('#/search?q=deploy');
  fireEvent.click(await screen.findByTestId(testId));
  await waitFor(() => expect(location.hash).toBe(hash));
});

it('opens a person at their marketplace page', async () => {
  open('#/search?q=ryan');
  fireEvent.click(await screen.findByTestId('search-hit-member-ryan'));
  await waitFor(() => expect(location.hash).toBe('#/marketplace/people/ryan'));
});

it('walks the highlight across every group with the arrows and opens it with Enter', async () => {
  open('#/search?q=deploy');
  await screen.findByTestId('search-hit-skill-deploy-check');
  const ids = rowIds();
  expect(ids[0]).toBe('search-hit-skill-deploy-check');
  expect(ids.at(-1)).toBe('search-hit-project-terum');
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(screen.getByTestId(ids[0]!)).toHaveAttribute('data-hovered');
  // The order is flat: three downs cross out of Skills and into Your library.
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(screen.getByTestId(ids[2]!)).toHaveAttribute('data-hovered');
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(screen.getByTestId(ids[1]!)).toHaveAttribute('data-hovered');
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(screen.getByTestId(ids[0]!)).toHaveAttribute('data-hovered');
  // The caret never leaves the field.
  expect(field()).toHaveFocus();
  fireEvent.keyDown(field(), { key: 'Enter' });
  await waitFor(() => expect(location.hash).toBe('#/skill/deploy-check?root=marketplace'));
});

it('highlights the row the mouse is over', async () => {
  open('#/search?q=deploy');
  const row = await screen.findByTestId('search-hit-project-terum');
  fireEvent.mouseEnter(row);
  expect(row).toHaveAttribute('data-hovered');
  expect(screen.getByTestId('search-hit-skill-deploy-check')).not.toHaveAttribute('data-hovered');
});

it('reports a failed search under Skills and keeps the other groups', async () => {
  const backend = createMockBackend();
  vi.spyOn(backend, 'search').mockResolvedValue({ ok: false, error: 'boom' });
  openWith('#/search?q=ryan', backend);
  expect(await screen.findByText('boom')).toBeVisible();
  expect(screen.getByTestId('search-hit-member-ryan')).toBeVisible();
  expect(screen.getByTestId('search-hit-library-~/.claude/skills/pr-review')).toBeVisible();
  expect(screen.queryByText(/No results for/)).toBeNull();
  await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true'));
});

it('reports a failed catalog under People and Projects and keeps Skills', async () => {
  const backend = createMockBackend();
  vi.spyOn(backend, 'catalog').mockResolvedValue({ ok: false, error: 'catalog unreadable' });
  openWith('#/search?q=deploy', backend);
  expect(await screen.findByTestId('search-hit-skill-deploy-check')).toBeVisible();
  await waitFor(() => expect(screen.getAllByText('catalog unreadable')).toHaveLength(2));
  expect(page().getByText('People')).toBeVisible();
  expect(page().getByText('Projects')).toBeVisible();
});

it('names the Library root that could not be read and still lists the others', async () => {
  const backend = createMockBackend(), library = backend.library.bind(backend);
  vi.spyOn(backend, 'library').mockImplementation((query: { scope: LibraryScope; team?: string }, options?: ReadOptions): Promise<Result<Library>> =>
    query.scope.kind === 'checkout' && query.scope.root === '/Users/you/code/terum'
      ? Promise.resolve({ ok: false, error: 'ENOENT: no such file or directory' })
      : library(query, options));
  openWith('#/search?q=deploy', backend);
  expect(await screen.findByText('Terum: ENOENT: no such file or directory')).toBeVisible();
  expect(screen.getByTestId('search-hit-library-~/.claude/skills/deploy-check')).toBeVisible();
  expect(screen.queryByTestId('search-hit-library-/Users/you/code/terum/.claude/skills/deploy-check')).toBeNull();
});

/** The shape a machine with no team really answers: the two team-backed reads refuse, the two offline
 *  ones (`status`, `library`) still report this machine's own folders. */
function noTeamMachine(backend: Backend, sentence = 'No team is configured on this machine.') {
  const answer = { ok: false, error: sentence, reason: 'no-team' } as const;
  vi.spyOn(backend, 'search').mockResolvedValue(answer);
  vi.spyOn(backend, 'catalog').mockResolvedValue(answer);
  return backend;
}

it('keeps the local folders a machine with no team still has', async () => {
  const backend = noTeamMachine(createMockBackend());
  openWith('#/search?q=deploy', backend);
  // `status` and `library` need no team, and the folders they report are the only thing such a machine
  // can search — so they list, instead of the whole page being replaced by one sentence.
  expect(await screen.findByTestId('search-hit-library-~/.claude/skills/deploy-check')).toBeVisible();
  expect(screen.getByTestId('search-hit-library-/Users/you/code/terum/.claude/skills/deploy-check')).toBeVisible();
  expect(screen.queryByText('No team on this machine')).toBeNull();
  // The sentence stands under the source that needs a team, not over the groups that do not.
  expect(within(group('Skills')).getByText('No team is configured on this machine.')).toBeVisible();
});

it('renders the no-team state when the machine has nothing else to show', async () => {
  const backend = noTeamMachine(createMockBackend());
  openWith('#/search?q=zzzznope', backend);
  expect(await screen.findByText('No team on this machine')).toBeVisible();
  expect(page().queryByText('Skills')).toBeNull();
  expect(rowIds()).toEqual([]);
  // `CommandText` splits the command across spans, so the hint is read off the rendered text.
  expect(screen.getByRole('main')).toHaveTextContent('npx -y terum-skills@latest setup');
});

it('starts setup from the no-team state', async () => {
  const backend = createMockBackend();
  vi.spyOn(backend, 'roster').mockResolvedValue({ ok: false, error: 'No team.', reason: 'no-team' });
  vi.spyOn(backend, 'catalog').mockResolvedValue({ ok: false, error: 'No team.', reason: 'no-team' });
  openWith('#/search?q=zzzznope', backend);
  fireEvent.click(await screen.findByRole('button', { name: 'Start setup' }));
  await waitFor(() => expect(location.hash).toBe('#/onboarding/boot?start=1'));
});

const copyOutcomes: [Result<void>, 'alert' | 'status', string][] = [
  [{ ok: false, error: 'Clipboard unavailable.' }, 'alert', 'Clipboard unavailable.'],
  [{ ok: false, error: 'Copy was declined.', cancelled: true }, 'status', 'Copy was declined.'],
];
it.each(copyOutcomes)('reports how the no-team copy ended: %j', async (result, role, text) => {
  const backend = createMockBackend();
  vi.spyOn(backend, 'catalog').mockResolvedValue({ ok: false, error: 'No team.', reason: 'no-team' });
  vi.spyOn(backend, 'copyToClipboard').mockResolvedValue(result);
  openWith('#/search?q=zzzznope', backend);
  fireEvent.click(await screen.findByRole('button', { name: 'Copy terminal command' }));
  expect(await screen.findByRole(role)).toHaveTextContent(text);
});

it('says there is nothing rather than drawing empty groups', async () => {
  open('#/search?q=zzzznope');
  expect(await screen.findByText('No results for “zzzznope”')).toBeVisible();
  expect(screen.getByText('Try a shorter term. Skills are searched by name, description and category.')).toBeVisible();
  expect(rowIds()).toEqual([]);
});

it('debounces a keystroke into ?q= and replaces instead of pushing history', async () => {
  vi.useFakeTimers();
  const backend = createMockBackend();
  openWith('#/search', backend);
  // Fake timers are on, so the queries are flushed by hand rather than by an async matcher.
  await act(async () => { await Promise.resolve(); });
  const push = vi.spyOn(window.history, 'pushState'), replace = vi.spyOn(window.history, 'replaceState');
  fireEvent.change(field(), { target: { value: 'dep' } });
  act(() => { vi.advanceTimersByTime(200); });
  expect(location.hash).toBe('#/search');
  fireEvent.change(field(), { target: { value: 'depl' } });
  act(() => { vi.advanceTimersByTime(200); });
  // The second keystroke restarted the wait; the first one never reached the URL.
  expect(location.hash).toBe('#/search');
  act(() => { vi.advanceTimersByTime(50); });
  expect(location.hash).toBe('#/search?q=depl');
  expect(replace).toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  expect(field()).toHaveValue('depl');
});

it('commits on Enter without waiting for the debounce', async () => {
  open('#/search');
  await screen.findByText('Type to search skills, people and projects.');
  fireEvent.change(field(), { target: { value: 'deploy' } });
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(location.hash).toBe('#/search?q=deploy');
  expect(await screen.findByTestId('search-hit-skill-deploy-check')).toBeVisible();
});

it('clears the term on Escape and leaves the page on a second Escape', async () => {
  open('#/library/global');
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  await waitFor(() => expect(location.hash).toBe('#/search'));
  fireEvent.change(field(), { target: { value: 'deploy' } });
  fireEvent.keyDown(field(), { key: 'Enter' });
  await screen.findByTestId('search-hit-skill-deploy-check');
  fireEvent.keyDown(field(), { key: 'Escape' });
  await waitFor(() => expect(location.hash).toBe('#/search'));
  expect(field()).toHaveValue('');
  fireEvent.keyDown(field(), { key: 'Escape' });
  await waitFor(() => expect(location.hash).toBe('#/library/global'));
});

it('follows a ?q= that changed underneath it', async () => {
  open('#/search?q=deploy');
  await screen.findByTestId('search-hit-skill-deploy-check');
  expect(field()).toHaveValue('deploy');
  // The top bar's own link is a plain #/search: the field must not keep the stale term.
  fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: /Search skills, people, projects/ }));
  await waitFor(() => expect(field()).toHaveValue(''));
  expect(await screen.findByText('Type to search skills, people and projects.')).toBeVisible();
});

it('keeps the whole page pending until every enabled read has settled', async () => {
  open('#/search?q=deploy&__mock=slow');
  expect(await screen.findByLabelText('Loading results')).toBeVisible();
  expect(document.documentElement.dataset.appReady).toBeUndefined();
  expect(rowIds()).toEqual([]);
});

it('reports a status that could not be read under Your library', async () => {
  const backend = createMockBackend();
  vi.spyOn(backend, 'status').mockResolvedValue({ ok: false, error: 'config.json is not readable.' });
  openWith('#/search?q=deploy', backend);
  expect(await screen.findByText('config.json is not readable.')).toBeVisible();
  // Without roots there is no folder to list, and the groups that do not depend on status still render.
  expect(screen.getByTestId('search-hit-skill-deploy-check')).toBeVisible();
  expect(screen.queryByTestId('search-hit-library-~/.claude/skills/deploy-check')).toBeNull();
});

it.each([
  [{ author: 'ryan', installs: 12, category: 'ops' }, 'ryan · 12 installs · ops'],
  [{ author: null, installs: 0, category: 'ops' }, '0 installs · ops'],
  [{ author: 'ryan', installs: 1, category: null }, 'ryan · 1 install'],
] as const)('composes the Skills meta from what the hit reports: %j', async (parts, meta) => {
  // The mock's own hits carry no author/installs/category — this is the real adapter's shape, where the
  // CLI fills them. A real 0 is a count, not a missing part: it prints, and only nulls are dropped.
  const backend = createMockBackend();
  vi.spyOn(backend, 'search').mockResolvedValue({ ok: true, value: [hit(parts)] });
  openWith('#/search?q=deploy', backend);
  expect(await screen.findByTestId('search-hit-skill-deploy-check')).toHaveAccessibleDescription(meta);
});

it('finds a person by the role only `search` matches on', async () => {
  open('#/search?q=founder');
  // The catalog filters people by name and handle, so `founder` reaches this row through `search` alone.
  expect(await screen.findByTestId('search-hit-member-ryan')).toHaveAccessibleName('Ryan Liu');
});

it('reports a failed search under People too, where its member hits would have been', async () => {
  const backend = createMockBackend();
  vi.spyOn(backend, 'search').mockResolvedValue({ ok: false, error: 'boom' });
  openWith('#/search?q=founder', backend);
  // Without that line the row above just vanishes and the only message on the page says "Skills".
  expect(await screen.findByText('Team search: boom')).toBeVisible();
  expect(within(group('People')).getByText('Team search: boom')).toBeVisible();
  expect(within(group('Skills')).getByText('boom')).toBeVisible();
  expect(screen.queryByTestId('search-hit-member-ryan')).toBeNull();
  // Projects lose nothing to a failed `search` — both sources filter name and desc — so no line there.
  expect(page().queryByText('Projects')).toBeNull();
});

/** A read that rejects instead of answering `{ok:false}` — the other half of `messageOf`, which the
 *  adapter reaches when a model builder throws outside the Result envelope. */
const THROWN = 'the desktop app could not reach terum-skills';
const rejecting: [string, (backend: Backend) => void, string][] = [
  ['search', backend => { vi.spyOn(backend, 'search').mockRejectedValue(new Error(THROWN)); }, 'Skills'],
  ['catalog', backend => { vi.spyOn(backend, 'catalog').mockRejectedValue(new Error(THROWN)); }, 'People'],
  ['status', backend => { vi.spyOn(backend, 'status').mockRejectedValue(new Error(THROWN)); }, 'Your library'],
];
it.each(rejecting)('surfaces a %s that rejects rather than returning a Result, under %s', async (_source, reject, label) => {
  const backend = createMockBackend();
  reject(backend);
  openWith('#/search?q=deploy', backend);
  // The thrown message itself, not an empty line and not `[object Object]`.
  expect((await screen.findAllByText(THROWN)).length).toBeGreaterThan(0);
  expect(within(group(label)).getByText(THROWN)).toBeVisible();
  expect(screen.getByTestId('search-hit-project-terum')).toBeVisible();
});

it('names a Library root whose read rejected', async () => {
  const backend = createMockBackend(), library = backend.library.bind(backend);
  vi.spyOn(backend, 'library').mockImplementation((query: { scope: LibraryScope; team?: string }, options?: ReadOptions): Promise<Result<Library>> =>
    query.scope.kind === 'checkout' ? Promise.reject(new Error('EIO: the checkout went away')) : library(query, options));
  openWith('#/search?q=deploy', backend);
  expect(await screen.findByText('Terum: EIO: the checkout went away')).toBeVisible();
  expect(screen.getByTestId('search-hit-library-~/.claude/skills/deploy-check')).toBeVisible();
});

it('does not erase a keystroke that lands while its own ?q= write settles', async () => {
  vi.useFakeTimers();
  openWith('#/search', createMockBackend());
  await act(async () => { await Promise.resolve(); });
  const input = field() as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'd' } });
  // The browser paints the next character on the node the moment the key lands, which can be after the
  // debounce has captured 'd' and before React runs the effect that follows the page's own write —
  // so the node holds 'de' while `?q=` says 'd'. Syncing then would erase the 'e' and jump the caret.
  input.value = 'de';
  act(() => { vi.advanceTimersByTime(250); });
  expect(location.hash).toBe('#/search?q=d');
  expect(input.value).toBe('de');
});

it('keeps the previous term’s rows on screen while the next answer is in flight', async () => {
  const backend = createMockBackend(), search = backend.search.bind(backend);
  let release = () => { /* replaced below */ };
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(backend, 'search').mockImplementation(async (args, options) => { if (args.q === 'deploy-check') await gate; return search(args, options); });
  openWith('#/search?q=deploy', backend);
  await screen.findByTestId('search-hit-skill-deploy-check');
  await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true'));
  fireEvent.change(field(), { target: { value: 'deploy-check' } });
  fireEvent.keyDown(field(), { key: 'Enter' });
  await waitFor(() => expect(panel()).toHaveAttribute('aria-busy', 'true'));
  // Refining does not blank the panel: what is on screen is the previous term's real answer, marked busy.
  expect(screen.getByTestId('search-hit-skill-deploy-check')).toBeVisible();
  expect(screen.queryByLabelText('Loading results')).toBeNull();
  // The page still does not claim to have settled until the new answer lands.
  expect(document.documentElement.dataset.appReady).toBeUndefined();
  await act(async () => { release(); await Promise.resolve(); });
  await waitFor(() => expect(panel()).not.toHaveAttribute('aria-busy'));
  expect(screen.getByTestId('search-hit-skill-deploy-check')).toBeVisible();
  await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true'));
});

it('scrolls the row the walk lands on into view', async () => {
  // jsdom implements no `scrollIntoView`; the screen checks for it, so the assertion supplies one.
  const seen: Element[] = [], options: unknown[] = [];
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: function (this: Element, arg: unknown) { seen.push(this); options.push(arg); } });
  try {
    open('#/search?q=deploy');
    await screen.findByTestId('search-hit-skill-deploy-check');
    const ids = rowIds();
    expect(seen).toEqual([]);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(seen.at(-1)).toBe(screen.getByTestId(ids[0]!));
    // `block:'nearest'` so a row already on screen does not move the page under the reader.
    expect(options.at(-1)).toEqual({ block: 'nearest' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(seen.at(-1)).toBe(screen.getByTestId(ids[1]!));
    // Walking back off the list scrolls nothing.
    const count = seen.length;
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(seen).toHaveLength(count + 1);
  } finally { Reflect.deleteProperty(Element.prototype, 'scrollIntoView'); }
});

it('stands the pointer’s own paint down while a row is highlighted', async () => {
  open('#/search?q=deploy');
  await screen.findByTestId('search-hit-skill-deploy-check');
  // jsdom applies no `:hover`, so what is pinned here is the flag search.css keys that rule on: with a
  // highlight live, a pointer resting on another row must not paint a second chosen-looking row.
  expect(panel()).not.toHaveAttribute('data-picked');
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(panel()).toHaveAttribute('data-picked');
  expect(rowIds().filter(id => screen.getByTestId(id).hasAttribute('data-hovered'))).toHaveLength(1);
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(panel()).not.toHaveAttribute('data-picked');
});
