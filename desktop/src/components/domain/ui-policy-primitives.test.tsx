import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { ContextMenuProvider } from './ContextMenu';
import { AdviceBlock, CollapsibleCommand, PathText } from './Primitives';
import { evalManyCommand, evalManyCommandSummary } from './bulk-eval';

// UI policy (docs/ui-policy.md, 2026-09-14) §1–§3: every printed command is copyable, a path is never prose, a long list collapses.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(node: React.ReactNode) {
  const backend = createMockBackend();
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient()}><ContextMenuProvider>{node}</ContextMenuProvider></QueryClientProvider></BackendContext>);
  return { backend, writeText };
}

it('AdviceBlock keeps prose as prose, gives every command its own copy, and copies the CLI printout whole', async () => {
  const advice = ['Cache request recorded as: terum-skills@latest', "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'];
  const { writeText } = mount(<AdviceBlock lines={advice} all={['terum-skills 0.17.0', ...advice]}/>);
  expect(document.querySelectorAll('.advice-text')).toHaveLength(3);
  expect(document.querySelectorAll('.cli-box')).toHaveLength(1);
  expect(document.querySelector('pre')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('npx -y terum-skills@latest <command>'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(['terum-skills 0.17.0', ...advice].join('\n')));
  expect(await screen.findByRole('status')).toHaveTextContent('Copied advice');
});

it('AdviceBlock offers Copy all commands only past one command when it has no full printout', () => {
  mount(<AdviceBlock lines={['a', '  one']}/>);
  expect(screen.queryByRole('button', { name: /Copy all/ })).toBeNull();
  cleanup();
  mount(<AdviceBlock lines={['a', '  one', '  two']}/>);
  expect(screen.getByRole('button', { name: 'Copy all commands' })).toBeInTheDocument();
});

it('CollapsibleCommand reads as the summary, copies the full command, and expands to the exact line', async () => {
  const refs = Array.from({ length: 28 }, (_, i) => `\\\\wsl.localhost\\Ubuntu\\home\\t\\.claude\\skills\\skill-${i}`);
  const args = { refs, mode: 'batches' as const, batch: 4 };
  const full = evalManyCommand(args), summary = evalManyCommandSummary(args);
  expect(summary).toBe('npx -y terum-skills@latest eval <28 skills> --batch 4');
  expect(evalManyCommandSummary({ refs: refs.slice(0, 2), mode: 'now' })).toBeNull();
  const { writeText } = mount(<CollapsibleCommand command={full} summary={summary}/>);
  const box = document.querySelector('.cli-box .board-mono')!;
  expect(box).toHaveTextContent('npx -y terum-skills@latest eval <28 skills> --batch 4');
  expect(box).not.toHaveTextContent('skill-27');
  fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(full));
  fireEvent.click(screen.getByRole('button', { name: 'Show full command' }));
  expect(document.querySelector('.cli-box .board-mono')).toHaveTextContent('skill-27');
  fireEvent.click(screen.getByRole('button', { name: 'Hide full command' }));
  expect(document.querySelector('.cli-box .board-mono')).not.toHaveTextContent('skill-27');
});

it('PathText shortens in the middle, keeps the full path on hover, copies it on click and reveals it on right-click', async () => {
  const path = '\\\\wsl.localhost\\Ubuntu\\home\\teniroo\\Projects\\terum\\.claude\\skills\\handoff';
  const { backend, writeText } = mount(<PathText path={path} max={40}/>);
  const reveal = vi.spyOn(backend, 'revealPath');
  const shown = screen.getByTitle(path);
  expect(shown.textContent!.length).toBeLessThanOrEqual(40);
  expect(shown).toHaveTextContent(/…/);
  expect(shown).toHaveTextContent(/handoff$/);
  fireEvent.click(screen.getByRole('button', { name: shown.textContent! }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(path));
  fireEvent.contextMenu(shown);
  fireEvent.click(await screen.findByRole('menuitem', { name: /Show in/ }));
  await waitFor(() => expect(reveal).toHaveBeenCalledWith(path));
});
