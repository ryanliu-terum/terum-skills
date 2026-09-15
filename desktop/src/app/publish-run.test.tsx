import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { Providers } from './providers';
import { useUiStore } from './store';
import * as backendModule from '../backend/index.js';
import { createMockBackend } from '../backend/mock';
import { createRun } from '../backend/mock/run';
import type { Backend } from '../backend/Backend';
import type { EvalManyResult, PublishResult, Result, Run, SkillCard } from '../backend/types';
import { localActionReason } from '../components/domain/skill-card-actions';
import { usePublishRun } from './publish-run-context';

// The publish run host across the app (spec 2026-09-14 §6, new 6–8): the production stack, with the mock backend where
// `pickBackend` looks, because `Providers` hosts the run above the routes. Runs that outlive a test are cancelled here.
const runs: Run<unknown>[] = [];
function openWith(route: string, backend: Backend) { vi.spyOn(backendModule, 'pickBackend').mockReturnValue(backend); location.hash = route; return render(<Providers><App /></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(async () => { for (const run of runs.splice(0)) await run.cancel(); cleanup(); location.hash = ''; vi.restoreAllMocks(); });

function published(name: string): Result<PublishResult> { return { ok: true, value: { name, project: null, version: 'v3', created: true, identicalTo: null, attachedEvals: 0, evalAssets: 0, profileAdded: false, projectAdded: false } }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const chip = (label: string) => screen.getByRole('button', { name: label });
/** A skill page whose Publish is the on-disk-only case, as progress.test.tsx sets it up. */
async function openSkillPublish(backend: Backend) {
  const detail = await backend.skill({ ref: 'deploy-check' });
  if (!detail.ok) throw new Error(detail.error);
  vi.spyOn(backend, 'skill').mockResolvedValue({ ok: true, value: { ...detail.value, installed: 'placed', placed: false, onDiskOnly: true, path: '/skills/deploy-check', unidentifiedLocal: null } });
  openWith('#/skill/deploy-check?dialog=publish', backend);
  return await screen.findByRole('dialog');
}
async function sendableCards(backend: Backend): Promise<SkillCard[]> { const result = await backend.library({ scope: { kind: 'global' } }); if (!result.ok) throw new Error(result.error); return result.value.skills.filter(card => localActionReason(card, 'publish') === null); }
/** Selects one card in the Library and presses the question's Publish; resolves with the board. */
async function publishFromLibrary(name: string) {
  await screen.findByText('15 skills');
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select ' + name }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish 1 skill to team…' }));
  await screen.findByTestId('bulk-publish-dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Publish 1 skill' }));
  await waitFor(() => expect(screen.queryByTestId('bulk-publish-dialog')).toBeNull());
  return await screen.findByRole('dialog', { name: 'Publish 1 skill to the team?' });
}

// §6.7 — D1: single publish rides the host too, so the most-used path can no longer be cancelled by leaving the page.
it('a single publish survives leaving the skill page, and the page shows its notice when the person returns', async () => {
  const backend = createMockBackend();
  const gate = deferred(), cancel = vi.fn(async () => {});
  vi.spyOn(backend, 'publish').mockImplementation(() => { const run = createRun<PublishResult>(async ctx => { ctx.progress(1, 3, 'Reading the team clone'); await gate.promise; return published('deploy-check'); }); vi.spyOn(run, 'cancel').mockImplementation(cancel); runs.push(run); return run; });
  const dialog = await openSkillPublish(backend);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
  // D4: the page's own dialog is the board — the CLI step in its status, the primary disabled, Cancel enabled.
  expect(await within(dialog).findByRole('status')).toHaveTextContent('Reading the team clone');
  expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();
  expect(chip('Publishing · deploy-check · Reading the team clone')).toBeInTheDocument();
  act(() => { location.hash = '#/library/global'; });
  await screen.findByText('15 skills');
  // The page (and its dialog) unmounted; the run did not notice.
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(cancel).not.toHaveBeenCalled();
  expect(chip('Publishing · deploy-check · Reading the team clone')).toBeInTheDocument();
  gate.resolve();
  const finished = await screen.findByRole('button', { name: 'Publish finished · deploy-check' });
  expect(finished).toHaveAttribute('title', 'Publish finished · deploy-check — deploy-check was published to the marketplace as Version 3.');
  expect(cancel).not.toHaveBeenCalled();
  act(() => { location.hash = '#/skill/deploy-check'; });
  await screen.findByRole('heading', { name: 'deploy-check' });
  expect(await screen.findByText('deploy-check was published to the marketplace as Version 3.')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('after a settled publish the page can publish again: the URL drops the dialog, and the confirmation reopens on request', async () => {
  const backend = createMockBackend();
  const publish = vi.spyOn(backend, 'publish').mockImplementation(() => { const run = createRun<PublishResult>(async () => published('deploy-check')); runs.push(run); return run; });
  const dialog = await openSkillPublish(backend);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('deploy-check was published to the marketplace as Version 3.')).toBeVisible();
  // The settled run stays on the provider (its chip is up), and the page's URL no longer names the dialog.
  expect(chip('Publish finished · deploy-check')).toBeInTheDocument();
  await waitFor(() => expect(new URLSearchParams(location.hash.split('?')[1] ?? '').get('dialog')).toBeNull());
  // Asking again opens the confirmation, enabled — not hidden behind the run that already finished.
  act(() => { location.hash = '#/skill/deploy-check?dialog=publish'; });
  const again = await screen.findByRole('dialog', { name: 'Publish deploy-check to the team?' });
  expect(within(again).getByRole('button', { name: 'Publish' })).toBeEnabled();
  fireEvent.click(within(again).getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // And forgetting the chip while the page is up pops nothing open.
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss publish status' }));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('the settle continuation drops only `dialog`: a tab switched during the run stays in the URL', async () => {
  const backend = createMockBackend();
  const gate = deferred();
  vi.spyOn(backend, 'publish').mockImplementation(() => { const run = createRun<PublishResult>(async () => { await gate.promise; return published('deploy-check'); }); runs.push(run); return run; });
  const dialog = await openSkillPublish(backend);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(chip('Publishing · deploy-check')).toBeInTheDocument());
  // Escape hands the run to the host board; the person then moves to the Evals tab while it runs.
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await screen.findByRole('dialog', { name: 'Publish 1 skill to the team?' });
  fireEvent.click(screen.getByRole('button', { name: 'Keep running' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  act(() => { location.hash = '#/skill/deploy-check?tab=evals'; });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Evals' })).toHaveAttribute('aria-selected', 'true'));
  gate.resolve();
  expect(await screen.findByText('deploy-check was published to the marketplace as Version 3.')).toBeVisible();
  await new Promise(resolve => setTimeout(resolve, 30));
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  expect(params.get('tab')).toBe('evals');
  expect(params.get('dialog')).toBeNull();
});

it('a publish that fails on the page lands on its error board once, and leaving the page clears it', async () => {
  const backend = createMockBackend();
  vi.spyOn(backend, 'publish').mockImplementation(() => { const run = createRun<PublishResult>(async () => ({ ok: false, error: 'The team repository is unavailable.' })); runs.push(run); return run; });
  const dialog = await openSkillPublish(backend);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
  expect(await screen.findByText('The team repository is unavailable.')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(chip('Publish failed · deploy-check')).toBeInTheDocument();
  // The board is the page's own, so a fresh visit starts clean; the chip keeps the failure.
  act(() => { location.hash = '#/library/global'; });
  await screen.findByText('15 skills');
  act(() => { location.hash = '#/skill/deploy-check'; });
  await screen.findByRole('heading', { name: 'deploy-check' });
  expect(screen.queryByText('The team repository is unavailable.')).toBeNull();
  expect(chip('Publish failed · deploy-check')).toHaveAttribute('title', 'Publish failed · deploy-check — The team repository is unavailable.');
});

it('dismissing the skill page dialog backgrounds the run: the board is drawn once, by the host', async () => {
  const backend = createMockBackend();
  const gate = deferred();
  vi.spyOn(backend, 'publish').mockImplementation(() => { const run = createRun<PublishResult>(async () => { await gate.promise; return published('deploy-check'); }); runs.push(run); return run; });
  const dialog = await openSkillPublish(backend);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(chip('Publishing · deploy-check')).toBeInTheDocument());
  // Only the page's dialog is open while it is the board.
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  // The handoff: the page dialog leaves and the host's board takes over the same run, still running.
  const board = await screen.findByRole('dialog', { name: 'Publish 1 skill to the team?' });
  expect(within(board).getByRole('button', { name: 'Stop' })).toBeEnabled();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  gate.resolve();
  await within(board).findByText('Published 1 of 1 skill');
});

// §6.8 — the provider sits inside PromptProvider and the host outside the routes: a backgrounded publish's questions
// still render as app-level modals, wherever the person has gone.
it("a backgrounded publish's question renders as an app-level modal on another route, and answering it lets the run finish", async () => {
  const backend = createMockBackend();
  const asked = deferred();
  vi.spyOn(backend, 'publish').mockImplementation(() => { const run = createRun<PublishResult>(async ctx => { await asked.promise; const yes = await ctx.ask('confirm', 'Push deploy-check to the team?'); return yes ? published('deploy-check') : { ok: false, error: 'Declined.' }; }); runs.push(run); return run; });
  openWith('#/library/global', backend);
  const [card] = await sendableCards(backend);
  const board = await publishFromLibrary(card!.name);
  fireEvent.click(within(board).getByRole('button', { name: 'Keep running' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  act(() => { location.hash = '#/marketplace'; });
  asked.resolve();
  const question = await screen.findByRole('dialog', { name: 'Push deploy-check to the team?' });
  fireEvent.click(within(question).getByRole('button', { name: 'Yes' }));
  await screen.findByRole('button', { name: `Publish finished · ${card!.name}` });
});

// §6.6 — D3b: the clone's writer lock is held inside safeWrite for seconds, not for the run, so neither run refuses the other.
it('a publish starts while an eval is running', async () => {
  const backend = createMockBackend();
  const evalMany = vi.spyOn(backend, 'evalMany').mockImplementation(() => { const run = createRun<EvalManyResult>(async ctx => { await ctx.sleep(600_000); return { ok: false, error: 'never' }; }); runs.push(run); return run; });
  const publish = vi.spyOn(backend, 'publish').mockImplementation(args => { const run = createRun<PublishResult>(async () => published(args.ref)); runs.push(run); return run; });
  openWith('#/library/global?dialog=bulk-eval&ref=deploy-check&ref=migration-guard', backend);
  const ask = await screen.findByRole('dialog', { name: 'Evaluate 2 skills?' });
  fireEvent.click(within(ask).getByRole('button', { name: 'Run evals' }));
  expect(evalMany).toHaveBeenCalledTimes(1);
  const evaluating = await screen.findByRole('dialog', { name: 'Evaluating 2 skills' });
  fireEvent.keyDown(evaluating, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const [card] = await sendableCards(backend);
  const board = await publishFromLibrary(card!.name);
  await within(board).findByText('Published 1 of 1 skill');
  expect(publish).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
  // Both chips share the bar.
  expect(screen.getByRole('button', { name: /^(Starting|Evaluating)/ })).toBeInTheDocument();
  expect(chip(`Publish finished · ${card!.name}`)).toBeInTheDocument();
});

it('an eval starts while a publish is running', async () => {
  const backend = createMockBackend();
  const gate = deferred();
  const evalMany = vi.spyOn(backend, 'evalMany').mockImplementation(() => { const run = createRun<EvalManyResult>(async ctx => { await ctx.sleep(600_000); return { ok: false, error: 'never' }; }); runs.push(run); return run; });
  vi.spyOn(backend, 'publish').mockImplementation(args => { const run = createRun<PublishResult>(async () => { await gate.promise; return published(args.ref); }); runs.push(run); return run; });
  openWith('#/library/global', backend);
  const [card] = await sendableCards(backend);
  const board = await publishFromLibrary(card!.name);
  fireEvent.click(within(board).getByRole('button', { name: 'Keep running' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  act(() => { location.hash = '#/library/global?dialog=bulk-eval&ref=deploy-check&ref=migration-guard'; });
  const ask = await screen.findByRole('dialog', { name: 'Evaluate 2 skills?' });
  fireEvent.click(within(ask).getByRole('button', { name: 'Run evals' }));
  expect(evalMany).toHaveBeenCalledTimes(1);
  await screen.findByRole('dialog', { name: 'Evaluating 2 skills' });
  expect(chip(`Publishing · ${card!.name}`)).toBeInTheDocument();
  // Two runs, two Stops, each named for what it stops.
  expect(screen.getByRole('button', { name: 'Stop publish' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThanOrEqual(1);
  gate.resolve();
  await screen.findByRole('button', { name: `Publish finished · ${card!.name}` });
});

/** A page-less starter for the provider itself: presses call `start` with the given cards and origin. */
function Starter({ cards, origin }: { cards: SkillCard[]; origin: 'library' | 'skill' }) {
  const publishRun = usePublishRun();
  return <button onClick={() => publishRun.start({ cards, flags: {}, origin })}>start-{origin}</button>;
}

// Codex review F1 (2026-09-15): fix-and-republish hands `start` the page's card, whose query data still says `broken`
// until the refetch lands. The skill page gates its own button on live data, so the provider must not re-gate for it.
it('a skill-page start publishes a card the stale query still flags as broken; a Library start still skips it', async () => {
  const backend = createMockBackend();
  const publish = vi.spyOn(backend, 'publish').mockImplementation(args => { const run = createRun<PublishResult>(async () => published(args.ref.split('/').at(-1) ?? args.ref)); runs.push(run); return run; });
  const [card] = await sendableCards(backend);
  const broken = { ...card!, flags: [...card!.flags, 'broken' as const], flagText: { ...card!.flagText, broken: 'SKILL.md is missing its frontmatter.' } };
  expect(localActionReason(broken, 'publish')).not.toBeNull();
  vi.spyOn(backendModule, 'pickBackend').mockReturnValue(backend);
  render(<Providers><Starter cards={[broken]} origin="skill" /><Starter cards={[broken]} origin="library" /><App /></Providers>);
  fireEvent.click(await screen.findByRole('button', { name: 'start-skill' }));
  await screen.findByRole('button', { name: `Publish finished · ${card!.name}` });
  expect(publish).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss publish status' }));
  fireEvent.click(screen.getByRole('button', { name: 'start-library' }));
  // Nothing sendable: the run settles at once with the row skipped and no CLI call. (The Library's question disables
  // Publish when no row is ready, so this is the provider's contract, not a screen the person can reach.)
  await screen.findByRole('button', { name: /^Publish finished/ });
  expect(publish).toHaveBeenCalledTimes(1);
});

// Codex review F3: after the second Stop the app has stopped waiting; a question the abandoned child asks later is
// withdrawn, never shown as an app-level modal for a run the bar reports as stopped.
it("a force-abandoned run's later question is withdrawn, not shown", async () => {
  const backend = createMockBackend();
  const gate = deferred();
  vi.spyOn(backend, 'publish').mockImplementation(() => { const run = createRun<PublishResult>(async ctx => { await gate.promise; const yes = await ctx.ask('confirm', 'Late question from an abandoned run?'); return yes ? published('deploy-check') : { ok: false, error: 'Declined.' }; }); vi.spyOn(run, 'cancel').mockResolvedValue(undefined); runs.push({ ...run, cancel: async () => { gate.resolve(); } } as Run<unknown>); return run; });
  openWith('#/library/global', backend);
  const [card] = await sendableCards(backend);
  const board = await publishFromLibrary(card!.name);
  fireEvent.click(within(board).getByRole('button', { name: 'Stop' }));
  fireEvent.click(within(board).getByRole('button', { name: 'Stop' }));
  await screen.findByRole('button', { name: 'Publish stopped · 0 published' });
  gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByRole('dialog', { name: 'Late question from an abandoned run?' })).toBeNull();
});
