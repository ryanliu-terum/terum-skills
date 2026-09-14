import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import type { Backend } from '../../backend/Backend';
import type { PublishResult, Result, SkillCard } from '../../backend/types';
import { localActionReason, localRef } from '../../components/domain/skill-card-actions';
import { rowText } from './bulk-publish';

// Batch E (2026-09-13): Library selection mode (`?select=1`) and the bulk "Publish to team" dialog. The CLI's
// `publish <ref>` takes one ref and the team clone is write-locked, so the queue is strictly sequential.
function openWith(route: string, backend: Backend) { location.hash = route; return render(<Providers><BackendContext value={backend}><App /></BackendContext></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

const search = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
const modeButton = () => screen.getByRole('button', { name: /^(Select|Done)$/ });
const checkbox = (name: string) => screen.getByRole('checkbox', { name: 'Select ' + name });
const checkboxes = () => screen.queryAllByRole('checkbox', { name: /^Select / });
const countLine = () => screen.getByText(/^\d+ of \d+ selected$/);
const cardNames = () => screen.getAllByTestId(/^skill-card-/).map(el => el.getAttribute('data-testid')?.replace('skill-card-', '') ?? '');
async function globalCards(backend: Backend): Promise<SkillCard[]> { const result = await backend.library({ scope: { kind: 'global' } }); if (!result.ok) throw new Error(result.error); return result.value.skills; }
const sendable = (cards: SkillCard[]) => cards.filter(card => localActionReason(card, 'publish') === null);
async function enterSelection(backend: Backend) { openWith('#/library/global', backend); await screen.findByText('15 skills'); fireEvent.click(modeButton()); await screen.findByText('0 of 15 selected'); }
function published(ref: string): Result<PublishResult> { return { ok: true, value: { name: ref.split('/').at(-1) ?? ref, project: 'Global', version: 'v3', created: true, identicalTo: null, attachedEvals: 0, evalAssets: 0, profileAdded: false, projectAdded: false } }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function openDialog(count: number) { fireEvent.click(screen.getByRole('button', { name: `Publish ${count} skill${count === 1 ? '' : 's'} to team…` })); const dialog = await screen.findByRole('dialog'); expect(search().get('dialog')).toBe('publish'); return dialog; }
const rowState = (name: string) => within(screen.getByTestId('bulk-row-' + name)).getAllByText(/./).at(-1)?.textContent ?? '';

it('Select enters selection mode in the URL, draws a checkbox per card, and Done drops the selection', async () => {
  const backend = createMockBackend();
  await enterSelection(backend);
  expect(search().get('select')).toBe('1');
  expect(modeButton()).toHaveTextContent('Done');
  expect(modeButton()).toHaveAttribute('aria-pressed', 'true');
  expect(checkboxes()).toHaveLength(15);
  fireEvent.click(checkbox('deploy-check'));
  expect(countLine()).toHaveTextContent('1 of 15 selected');
  expect(screen.getByTestId('skill-card-deploy-check')).toHaveAttribute('data-selected', 'true');
  fireEvent.click(modeButton());
  expect(search().get('select')).toBeNull();
  expect(checkboxes()).toHaveLength(0);
  expect(screen.queryByText(/of \d+ selected$/)).toBeNull();
  // Re-entering starts from nothing: Done dropped the set, it did not park it.
  fireEvent.click(modeButton());
  expect(await screen.findByText('0 of 15 selected')).toBeInTheDocument();
  expect(screen.getByTestId('skill-card-deploy-check')).not.toHaveAttribute('data-selected');
});

it('a card click toggles the card instead of navigating while selecting', async () => {
  const backend = createMockBackend();
  await enterSelection(backend);
  const link = within(screen.getByTestId('skill-card-deploy-check')).getByRole('link', { name: 'deploy-check' });
  fireEvent.click(link);
  expect(location.hash).toBe('#/library/global?select=1');
  expect(countLine()).toHaveTextContent('1 of 15 selected');
  expect(checkbox('deploy-check')).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(link);
  expect(countLine()).toHaveTextContent('0 of 15 selected');
  expect(checkbox('deploy-check')).toHaveAttribute('aria-checked', 'false');
});

it('Select all takes every drawn card, Clear empties the set, and the count follows the query', async () => {
  const backend = createMockBackend();
  await enterSelection(backend);
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
  expect(countLine()).toHaveTextContent('15 of 15 selected');
  expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: /^Search/ }), { target: { value: 'deploy' } });
  const drawn = cardNames().length;
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(15);
  // Hidden cards stay selected but are neither counted nor offered: the button never promises more than the grid shows.
  expect(countLine()).toHaveTextContent(`${drawn} of ${drawn} selected`);
  expect(screen.getByRole('button', { name: `Publish ${drawn} skills to team…` })).toBeEnabled();
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' }).at(-1)!);
  expect(await screen.findByText('15 of 15 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(countLine()).toHaveTextContent('0 of 15 selected');
  expect(screen.getByRole('button', { name: 'Publish to team…' })).toBeDisabled();
});

it('Escape leaves selection mode, but yields to a field the person is typing in', async () => {
  const backend = createMockBackend();
  await enterSelection(backend);
  const field = screen.getByRole('textbox', { name: /^Search/ });
  field.focus();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(search().get('select')).toBe('1');
  field.blur();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(search().get('select')).toBeNull();
  expect(checkboxes()).toHaveLength(0);
});

it('lists Ready and Skipped rows and never sends a skipped one', async () => {
  const backend = createMockBackend();
  const cards = await globalCards(backend);
  const broken = cards.find(card => localActionReason(card, 'publish') !== null);
  if (!broken) throw new Error('The mock Library has no unpublishable card to skip.');
  const publish = vi.spyOn(backend, 'publish').mockImplementation(args => createRun(async () => published(args.ref)));
  await enterSelection(backend);
  fireEvent.click(checkbox('deploy-check'));
  fireEvent.click(checkbox(broken.name));
  const dialog = await openDialog(2);
  expect(within(dialog).getByRole('heading', { name: 'Publish 2 skills to the team?' })).toBeInTheDocument();
  expect(rowState('deploy-check')).toBe('Ready');
  expect(rowState(broken.name)).toBe(`Skipped · ${localActionReason(broken, 'publish')}`);
  // The hint's command is drawn across several spans, so match the dialog's text as a whole.
  expect(dialog.textContent).toContain('npx -y terum-skills@latest publish deploy-check');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 1 skill' }));
  await within(dialog).findByText('Published 1 of 1 skill');
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0]?.[0]).toEqual({ ref: localRef(cards.find(card => card.name === 'deploy-check')!), project: 'Global' }); // Settings ▸ Publishing ▸ Defaults (2026-09-14): the dialog's target is always sent
  expect(rowState(broken.name)).toBe(`Skipped · ${localActionReason(broken, 'publish')}`);
});

it('publishes the rows one at a time, reports each outcome, and Done refreshes the Library', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 3);
  const gate = deferred(), refs: string[] = [];
  vi.spyOn(backend, 'publish').mockImplementation(args => { refs.push(args.ref); return createRun(async ctx => { if (args.ref === localRef(pick[0]!)) await gate.promise; ctx.progress(1, 1, 'committing'); return published(args.ref); }); });
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  const dialog = await openDialog(3);
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 3 skills' }));
  await waitFor(() => expect(rowState(pick[0]!.name)).toMatch(/^Publishing…/));
  expect(rowState(pick[1]!.name)).toBe('Queued');
  expect(rowState(pick[2]!.name)).toBe('Queued');
  expect(within(dialog).getByRole('button', { name: 'Publish 3 skills' })).toBeDisabled();
  // The second ref is not even requested until the first run has settled.
  expect(refs).toEqual([localRef(pick[0]!)]);
  gate.resolve();
  await waitFor(() => expect(refs).toEqual(pick.map(localRef)));
  await within(dialog).findByText('Published 3 of 3 skills');
  for (const card of pick) expect(rowState(card.name)).toBe(`${card.name} was published to Global as Version 3.`);
  expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull();
  const library = vi.spyOn(backend, 'library');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  const notice = await screen.findByText('Published 3 of 3 skills', { selector: '.library-notice' });
  expect(search().get('dialog')).toBeNull();
  expect(search().get('select')).toBeNull();
  expect(checkboxes()).toHaveLength(0);
  await waitFor(() => expect(library).toHaveBeenCalled());
  // Done unmounted the button focus would return to; the status line took focus so Tab does not restart at the top.
  await waitFor(() => expect(document.activeElement).toBe(notice));
  // The notice belongs to the library it reports: entering a new selection clears it.
  fireEvent.click(modeButton());
  await screen.findByText('0 of 15 selected');
  expect(screen.queryByText('Published 3 of 3 skills', { selector: '.library-notice' })).toBeNull();
});

it('a failing row reports the CLI sentence and the queue goes on', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 3);
  vi.spyOn(backend, 'publish').mockImplementation(args => createRun(async () => args.ref === localRef(pick[1]!) ? { ok: false, error: 'fatal: the team clone is locked by another publish' } : published(args.ref)));
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  const dialog = await openDialog(3);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 3 skills' }));
  await within(dialog).findByText('Published 2 of 3 skills · 1 failed');
  expect(rowState(pick[0]!.name)).toBe(`${pick[0]!.name} was published to Global as Version 3.`);
  expect(rowState(pick[1]!.name)).toBe('Failed · fatal: the team clone is locked by another publish');
  expect(rowState(pick[2]!.name)).toBe(`${pick[2]!.name} was published to Global as Version 3.`);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(await screen.findByText('Published 2 of 3 skills · 1 failed', { selector: '.library-notice' })).toBeInTheDocument();
});

it('Cancel mid-queue stops after the active run and keeps the finished outcome', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 3);
  vi.spyOn(backend, 'publish').mockImplementation(args => createRun(async ctx => { if (args.ref === localRef(pick[1]!)) await ctx.sleep(60_000); return published(args.ref); }));
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  const dialog = await openDialog(3);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 3 skills' }));
  await waitFor(() => expect(rowState(pick[1]!.name)).toBe('Publishing…'));
  expect(rowState(pick[0]!.name)).toBe(`${pick[0]!.name} was published to Global as Version 3.`);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await within(dialog).findByText('Published 1 of 3 skills');
  expect(rowState(pick[1]!.name)).toBe('Cancelled');
  expect(rowState(pick[2]!.name)).toBe('Not started');
  expect(rowState(pick[0]!.name)).toBe(`${pick[0]!.name} was published to Global as Version 3.`);
  expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument();
});

it('a pasted URL with nothing selected renders the empty dialog with Cancel alone', async () => {
  const backend = createMockBackend();
  const publish = vi.spyOn(backend, 'publish');
  openWith('#/library/global?select=1&dialog=publish', backend);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'No skills selected.' })).toBeInTheDocument();
  expect(within(dialog).getAllByRole('button')).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(search().get('dialog')).toBeNull();
  expect(search().get('select')).toBe('1');
  expect(publish).not.toHaveBeenCalled();
});

it('a declined question mid-queue is a cancellation: that row reads Cancelled and the rest never start', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 3);
  // driveRun answers a declined PromptContext question with `cancelled:true`; nobody pressed the dialog's Cancel.
  const publish = vi.spyOn(backend, 'publish').mockImplementation(args => createRun(async () => args.ref === localRef(pick[1]!) ? { ok: false, error: 'Setup was cancelled.', cancelled: true } : published(args.ref)));
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  const dialog = await openDialog(3);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 3 skills' }));
  await within(dialog).findByText('Published 1 of 3 skills');
  expect(rowState(pick[0]!.name)).toBe(`${pick[0]!.name} was published to Global as Version 3.`);
  expect(rowState(pick[1]!.name)).toBe('Cancelled');
  expect(rowState(pick[2]!.name)).toBe('Not started');
  expect(publish).toHaveBeenCalledTimes(2);
});

it('a publish that finished before its cancel landed is reported as published, with the CLI sentence kept', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 2);
  const first = published(localRef(pick[0]!));
  if (!first.ok) throw new Error('fixture');
  // The real adapter's race settle: ok:false with the sentence AND the value (src/backend/tauri/run.ts).
  const race: Result<PublishResult> = { ok: false, error: 'Cancelled, but publish had already finished; its changes are on disk.', value: first.value };
  const gate = deferred();
  vi.spyOn(backend, 'publish').mockImplementation(args => {
    const run = createRun<PublishResult>(async () => { if (args.ref === localRef(pick[0]!)) { await gate.promise; return race; } return published(args.ref); });
    if (args.ref === localRef(pick[0]!)) vi.spyOn(run, 'cancel').mockImplementation(async () => { gate.resolve(); });
    return run;
  });
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  const dialog = await openDialog(2);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 2 skills' }));
  await waitFor(() => expect(rowState(pick[0]!.name)).toBe('Publishing…'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await within(dialog).findByText('Published 1 of 2 skills');
  expect(rowState(pick[0]!.name)).toBe(`${pick[0]!.name} was published to Global as Version 3. Cancelled, but publish had already finished; its changes are on disk.`);
  expect(rowState(pick[1]!.name)).toBe('Not started');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(await screen.findByText('Published 1 of 2 skills', { selector: '.library-notice' })).toBeInTheDocument();
});

it('any other CLI sentence after Cancel is the failure it says, shown verbatim', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 2);
  const gate = deferred();
  vi.spyOn(backend, 'publish').mockImplementation(args => {
    const run = createRun<PublishResult>(async () => { if (args.ref === localRef(pick[0]!)) { await gate.promise; return { ok: false, error: 'fatal: could not write the receipt' }; } return published(args.ref); });
    if (args.ref === localRef(pick[0]!)) vi.spyOn(run, 'cancel').mockImplementation(async () => { gate.resolve(); });
    return run;
  });
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  const dialog = await openDialog(2);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 2 skills' }));
  await waitFor(() => expect(rowState(pick[0]!.name)).toBe('Publishing…'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await within(dialog).findByText('Published 0 of 2 skills · 1 failed');
  expect(rowState(pick[0]!.name)).toBe('Failed · fatal: could not write the receipt');
  expect(rowState(pick[1]!.name)).toBe('Not started');
});

it('leaving mid-queue cancels the active run, starts nothing more, and refetches what already landed', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 3);
  const gate = deferred(), refs: string[] = [], cancels: string[] = [];
  vi.spyOn(backend, 'publish').mockImplementation(args => {
    refs.push(args.ref);
    const run = createRun<PublishResult>(async () => { if (args.ref === localRef(pick[1]!)) await gate.promise; return published(args.ref); });
    const cancel = run.cancel.bind(run);
    vi.spyOn(run, 'cancel').mockImplementation(async () => { cancels.push(args.ref); await cancel(); });
    return run;
  });
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  const dialog = await openDialog(3);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 3 skills' }));
  await waitFor(() => expect(rowState(pick[1]!.name)).toBe('Publishing…'));
  const library = vi.spyOn(backend, 'library');
  // Back over the dialog's entry: the Library stays mounted, the dialog does not.
  act(() => { location.hash = '#/library/global'; });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(cancels).toEqual([localRef(pick[1]!)]);
  gate.resolve();
  await waitFor(() => expect(library).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(refs).toEqual([localRef(pick[0]!), localRef(pick[1]!)]);
});

it('a run that never settles: a second Cancel leaves the dialog instead of trapping the person in it', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 1);
  vi.spyOn(backend, 'publish').mockImplementation(() => { const run = createRun<PublishResult>(async ctx => { await ctx.sleep(600_000); return published('never'); }); vi.spyOn(run, 'cancel').mockResolvedValue(undefined); return run; });
  await enterSelection(backend);
  fireEvent.click(checkbox(pick[0]!.name));
  const dialog = await openDialog(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 1 skill' }));
  await waitFor(() => expect(rowState(pick[0]!.name)).toBe('Publishing…'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(rowState(pick[0]!.name)).toBe('Publishing…');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(search().get('dialog')).toBeNull();
  expect(search().get('select')).toBe('1');
});

it("StrictMode's effect replay does not freeze the queue after its first row", async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 2);
  vi.spyOn(backend, 'publish').mockImplementation(args => createRun(async () => published(args.ref)));
  location.hash = '#/library/global';
  render(<StrictMode><Providers><BackendContext value={backend}><App /></BackendContext></Providers></StrictMode>);
  await screen.findByText('15 skills');
  fireEvent.click(modeButton());
  await screen.findByText('0 of 15 selected');
  for (const card of pick) fireEvent.click(checkbox(card.name));
  const dialog = await openDialog(2);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 2 skills' }));
  await within(dialog).findByText('Published 2 of 2 skills');
  for (const card of pick) expect(rowState(card.name)).toBe(`${card.name} was published to Global as Version 3.`);
  expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument();
});

it('Clear empties a selection the query is hiding', async () => {
  const backend = createMockBackend();
  await enterSelection(backend);
  fireEvent.click(checkbox('deploy-check'));
  await screen.findByText('1 of 15 selected');
  fireEvent.change(screen.getByRole('textbox', { name: /^Search/ }), { target: { value: 'nothing-matches-this' } });
  await screen.findByText('0 of 0 selected');
  const clear = screen.getByRole('button', { name: 'Clear' });
  expect(clear).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Publish to team…' })).toBeDisabled();
  fireEvent.click(clear);
  fireEvent.change(screen.getByRole('textbox', { name: /^Search/ }), { target: { value: '' } });
  await screen.findByText('0 of 15 selected');
  expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
});

it('the notice belongs to the library it reports: a checkout shows none, Global shows it again', async () => {
  const backend = createMockBackend();
  const pick = sendable(await globalCards(backend)).slice(0, 1);
  vi.spyOn(backend, 'publish').mockImplementation(args => createRun(async () => published(args.ref)));
  await enterSelection(backend);
  fireEvent.click(checkbox(pick[0]!.name));
  const dialog = await openDialog(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 1 skill' }));
  await within(dialog).findByText('Published 1 of 1 skill');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  await screen.findByText('Published 1 of 1 skill', { selector: '.library-notice' });
  // The two Library routes share one component instance; the count must not follow the person into a checkout.
  act(() => { location.hash = '#/library/checkout?root=' + encodeURIComponent('/Users/you/code/terum'); });
  await waitFor(() => expect(screen.getByRole('link', { name: /^Terum/ })).toHaveAttribute('aria-current', 'page'));
  expect(screen.queryByText('Published 1 of 1 skill', { selector: '.library-notice' })).toBeNull();
  act(() => { location.hash = '#/library/global'; });
  await waitFor(() => expect(screen.getByRole('link', { name: /^Global/ })).toHaveAttribute('aria-current', 'page'));
  expect(screen.getByText('Published 1 of 1 skill', { selector: '.library-notice' })).toBeInTheDocument();
});

it('names every row state', () => {
  expect(rowText({ kind: 'ready' })).toBe('Ready');
  expect(rowText({ kind: 'skipped', reason: 'no folder' })).toBe('Skipped · no folder');
  expect(rowText({ kind: 'queued' })).toBe('Queued');
  expect(rowText({ kind: 'publishing', label: null })).toBe('Publishing…');
  expect(rowText({ kind: 'publishing', label: 'committing' })).toBe('Publishing… committing');
  expect(rowText({ kind: 'done', text: 'x was published.' })).toBe('x was published.');
  expect(rowText({ kind: 'failed', error: 'boom' })).toBe('Failed · boom');
  expect(rowText({ kind: 'cancelled' })).toBe('Cancelled');
  expect(rowText({ kind: 'not-started' })).toBe('Not started');
});
