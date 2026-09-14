import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { App } from '../../app/App';
import { EvalRunProvider } from '../../app/EvalRunProvider';
import { useUiStore } from '../../app/store';
import { BackendContext, PrintContext, PromptContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { Backend } from '../../backend/Backend';
import type { SkillCard } from '../../backend/types';
import { localActionReason, localRef } from '../../components/domain/skill-card-actions';
import { bulkEvalHandoff, bulkEvalSearch, leftOutText, type EvalCandidate } from './bulk-eval-handoff';

// Batch E follow-up (2026-09-14): "Evaluate N…" in the Library's selection bar hands the drawn selection to the
// app-wide bulk-eval question (`?dialog=bulk-eval&ref=…`, PR #206) and runs nothing itself. The question, the run
// dialog and the eval host are pinned by src/app/bulk-eval.test.tsx; this file pins the Library's side of the seam.
// The same tree as src/app/bulk-eval.test.tsx: `Providers` builds its own backend ABOVE the eval host, so a backend
// handed in below it would be seen by the Library and not by the host that starts the run. Here one backend serves both.
function openWith(route: string, backend: Backend) {
  location.hash = route;
  return render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tooltip.Provider><PromptContext value={async () => true}><PrintContext value={() => {}}><EvalRunProvider><App /></EvalRunProvider></PrintContext></PromptContext></Tooltip.Provider></QueryClientProvider></BackendContext>);
}
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

const search = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
const checkbox = (name: string) => screen.getByRole('checkbox', { name: 'Select ' + name });
const evaluateButton = () => within(screen.getByRole('toolbar', { name: 'Selection' })).getByRole('button', { name: /^Evaluate/ });
async function globalCards(backend: Backend): Promise<SkillCard[]> { const result = await backend.library({ scope: { kind: 'global' } }); if (!result.ok) throw new Error(result.error); return result.value.skills; }
async function enterSelection(backend: Backend) { openWith('#/library/global', backend); await screen.findByText('15 skills'); fireEvent.click(screen.getByRole('button', { name: 'Select' })); await screen.findByText('0 of 15 selected'); }
const evaluable = (cards: SkillCard[]) => cards.filter(card => localActionReason(card, 'eval') === null);

it('the button is disabled with nothing selected and counts the drawn selection the ⋯ menu could evaluate', async () => {
  const backend = createMockBackend();
  const cards = await globalCards(backend);
  await enterSelection(backend);
  expect(evaluateButton()).toBeDisabled();
  expect(evaluateButton()).toHaveTextContent('Evaluate…');
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
  await screen.findByText('15 of 15 selected');
  const n = evaluable(cards).length;
  expect(n).toBeGreaterThan(1);
  expect(evaluateButton()).toBeEnabled();
  expect(evaluateButton()).toHaveTextContent(`Evaluate ${n} skills…`);
  // A card hidden by the query is neither counted nor handed over, exactly like the publish set.
  fireEvent.change(screen.getByRole('textbox', { name: /^Search/ }), { target: { value: evaluable(cards)[0]!.name } });
  await screen.findByText(/^1 of \d+ selected$/);
  expect(evaluateButton()).toHaveTextContent('Evaluate 1 skill…');
});

it('a selected card that cannot be evaluated here is left out, and the bar says which and why', async () => {
  const backend = createMockBackend(), real = backend.library.bind(backend);
  // The first Global card becomes a team skill with no folder on this machine — the Library's "recorded" state.
  vi.spyOn(backend, 'library').mockImplementation(async (args, opts) => { const result = await real(args, opts); return result.ok ? { ...result, value: { ...result.value, skills: result.value.skills.map((card, i) => i === 0 ? { ...card, path: null, teamed: true } : card) } } : result; });
  const cards = await globalCards(backend);
  const absent = cards[0]!, other = evaluable(cards)[0]!;
  expect(localActionReason(absent, 'eval')).not.toBeNull();
  await enterSelection(backend);
  expect(screen.queryByRole('note')).toBeNull();
  fireEvent.click(checkbox(absent.name));
  fireEvent.click(checkbox(other.name));
  await screen.findByText('2 of 15 selected');
  expect(evaluateButton()).toHaveTextContent('Evaluate 1 skill…');
  expect(screen.getByRole('note')).toHaveTextContent(`Left out of the eval · ${absent.name}: Install it first — evals run against the copy on your machine.`);
  fireEvent.click(evaluateButton());
  expect(search().getAll('ref')).toEqual([localRef(other)]);
  // The question names only what it was handed.
  expect(await screen.findByRole('dialog', { name: 'Evaluate 1 skill?' })).toBeVisible();
});

it('with runEvalInApp off, neither the button nor the left-out line renders — a hidden control leaves no trace', async () => {
  const backend = createMockBackend(), real = backend.library.bind(backend), features = await backend.features();
  vi.spyOn(backend, 'features').mockResolvedValue({ ...features, runEvalInApp: false });
  vi.spyOn(backend, 'library').mockImplementation(async (args, opts) => { const result = await real(args, opts); return result.ok ? { ...result, value: { ...result.value, skills: result.value.skills.map((card, i) => i === 0 ? { ...card, path: null, teamed: true } : card) } } : result; });
  const cards = await globalCards(backend);
  await enterSelection(backend);
  fireEvent.click(checkbox(cards[0]!.name));
  fireEvent.click(checkbox(evaluable(cards)[0]!.name));
  await screen.findByText('2 of 15 selected');
  const bar = screen.getByRole('toolbar', { name: 'Selection' });
  expect(within(bar).queryByRole('button', { name: /^Evaluate/ })).toBeNull();
  expect(within(bar).getByRole('button', { name: 'Publish 2 skills to team…' })).toBeEnabled();
  expect(screen.queryByRole('note')).toBeNull();
});

it('hands the selection to the app-wide question by URL and keeps the selection when the question closes', async () => {
  const backend = createMockBackend();
  const pick = evaluable(await globalCards(backend)).slice(0, 2);
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  await screen.findByText('2 of 15 selected');
  fireEvent.click(evaluateButton());
  expect(search().get('dialog')).toBe('bulk-eval');
  expect(search().getAll('ref')).toEqual(pick.map(localRef));
  expect(search().get('select')).toBe('1');
  expect(evaluateButton()).toHaveAttribute('data-state', 'pressed');
  const question = await screen.findByRole('dialog', { name: 'Evaluate 2 skills?' });
  // Escape closes the question alone: selection mode and the selected set survive.
  fireEvent.keyDown(question, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(search().get('dialog')).toBeNull();
  expect(search().getAll('ref')).toEqual([]);
  expect(search().get('select')).toBe('1');
  expect(screen.getByText('2 of 15 selected')).toBeVisible();
  for (const card of pick) expect(checkbox(card.name)).toBeChecked();
  // So does its Cancel button.
  fireEvent.click(evaluateButton());
  const again = await screen.findByRole('dialog', { name: 'Evaluate 2 skills?' });
  fireEvent.click(within(again).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(location.hash).toBe('#/library/global?select=1');
  expect(screen.getByText('2 of 15 selected')).toBeVisible();
});

it('Run evals sends the refs the skill page would send, streams the run, and the Library refetches when it ends', async () => {
  const backend = createMockBackend(), evalMany = vi.spyOn(backend, 'evalMany'), library = vi.spyOn(backend, 'library');
  const pick = evaluable(await globalCards(backend)).slice(0, 2);
  await enterSelection(backend);
  for (const card of pick) fireEvent.click(checkbox(card.name));
  await screen.findByText('2 of 15 selected');
  fireEvent.click(evaluateButton());
  const question = await screen.findByRole('dialog', { name: 'Evaluate 2 skills?' });
  const reads = library.mock.calls.length;
  fireEvent.click(within(question).getByRole('button', { name: 'Run evals' }));
  expect(evalMany).toHaveBeenCalledWith({ refs: pick.map(localRef), mode: 'now' });
  const running = await screen.findByRole('dialog', { name: 'Evaluating 2 skills' });
  await within(running).findByText('Evaluated 2 of 2; 0 failed.', { selector: '[role=status]' });
  // The host invalidates every clone-backed read when a run ends, so the verdict chips can change under the selection.
  await waitFor(() => expect(library.mock.calls.length).toBeGreaterThan(reads));
  expect(search().get('select')).toBe('1');
  expect(search().get('dialog')).toBeNull();
  expect(screen.getByText('2 of 15 selected')).toBeVisible();
});

it('bulkEvalSearch keeps the Library state, replaces stale refs and never carries a pasted pending flag', () => {
  const next = bulkEvalSearch(new URLSearchParams('select=1&q=deploy&sort=name&ref=stale&pending=1'), ['a', 'b']);
  expect(next.toString()).toBe('select=1&q=deploy&sort=name&dialog=bulk-eval&ref=a&ref=b');
  expect(bulkEvalSearch(new URLSearchParams(), []).toString()).toBe('dialog=bulk-eval');
});

it('bulkEvalHandoff splits the cards by the ⋯ menu reason and leftOutText groups the names by reason', () => {
  const cards: EvalCandidate[] = [
    { name: 'a', teamed: false, path: '/p/a', flags: [], flagText: {} },
    { name: 'b', teamed: true, path: null, flags: [], flagText: {} },
    { name: 'c', teamed: false, path: '/p/c', flags: ['broken'], flagText: { broken: 'Frontmatter is unreadable.' } },
    { name: 'd', teamed: true, path: '/p/d', flags: ['broken'], flagText: {} },
    { name: 'e', teamed: true, path: null, flags: [], flagText: {} },
  ];
  // 'a' belongs to no team, so its path is the ref; 'd' is a team skill and is named, even though a folder exists.
  expect(bulkEvalHandoff(cards)).toEqual({ refs: ['/p/a', 'd'], leftOut: [
    { name: 'b', reason: 'Install it first — evals run against the copy on your machine.' },
    { name: 'c', reason: 'Frontmatter is unreadable.' },
    { name: 'e', reason: 'Install it first — evals run against the copy on your machine.' },
  ] });
  expect(leftOutText([])).toBeNull();
  expect(leftOutText(bulkEvalHandoff(cards).leftOut)).toBe('Left out of the eval · b, e: Install it first — evals run against the copy on your machine. · c: Frontmatter is unreadable.');
});
