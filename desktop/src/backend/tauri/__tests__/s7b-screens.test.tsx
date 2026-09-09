import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

afterEach(() => { cleanup(); location.hash = ''; localStorage.clear(); });
function open(route: string, change?: (frame: Record<string, unknown>, name: string) => void) {
  useUiStore.setState({ railOpen: true, overviewHidden: false });
  const f = fakeBridge((args, emit) => {
    const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : args[1] === 'member' ? `ls-member-${args.at(-1)}` : 'ls' : args[0]!;
    const lines = readFileSync(resolve('../.planning/codex-runs/m7-S7b/frames', name + '.jsonl'), 'utf8').trim().split('\n');
    for (const line of lines) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      change?.(frame, name);
      emit({ kind: 'stdout', line: JSON.stringify(frame) });
    }
  });
  const backend = createTauriBackend(f.bridge);
  location.hash = route;
  render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
  return backend;
}
it('serves Share with committed labels and Teams while hiding the permission chip', async () => {
  open('#/share');
  const row = await screen.findByTestId('member-row-0');
  expect(row).toHaveTextContent('Mira Chen');
  expect(row).toHaveTextContent('mira · Platform');
  expect(within(row).getByText('terum')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Role for mira' })).toBeNull();
  expect(within(row).getByRole('button', { name: 'Remove from team' })).toBeVisible();
});
it('drops the dangling role separator for a member without a role', async () => {
  open('#/share');
  const row = await screen.findByTestId('member-row-2');
  expect(row).toHaveTextContent('Seed');
  expect(within(row).getByText('seed')).toBeVisible();
  expect(row).not.toHaveTextContent('seed ·');
});
it('does not repeat the handle when the display name is just the handle', async () => {
  open('#/share', (frame, name) => {
    if (name !== 'status' || frame.t !== 'result') return;
    const value = frame.value as { teams: { members: { handle: string; displayName: string }[] }[] };
    const ravi = value.teams[0]?.members.find(member => member.handle === 'ravi');
    if (ravi) ravi.displayName = 'ravi';
  });
  const row = await screen.findByTestId('member-row-1');
  expect(within(row).getAllByText('ravi')).toHaveLength(1);
  expect(row).not.toHaveTextContent('·');
});
it('renders a person heading without a duplicate handle or a dangling role separator', async () => {
  open('#/marketplace/people/ravi', (frame, name) => {
    if (name !== 'status' || frame.t !== 'result') return;
    const value = frame.value as { teams: { members: { handle: string; displayName: string }[] }[] };
    const ravi = value.teams[0]?.members.find(member => member.handle === 'ravi');
    if (ravi) ravi.displayName = 'ravi';
  });
  await screen.findByRole('heading', { name: 'ravi' });
  const heading = document.querySelector('.market-person-heading') as HTMLElement;
  expect(within(heading).getAllByText('ravi')).toHaveLength(1);
  expect(heading.querySelector('.board-small')?.textContent).toBe('acme');
});
it('keeps a person card identity clean when the member has no role', async () => {
  open('#/marketplace/people');
  const card = await screen.findByTestId('person-card-ravi');
  expect(card).toHaveTextContent('Ravi Patel');
  expect(within(card).getByText('ravi')).toBeVisible();
  expect(card).not.toHaveTextContent('· ravi');
});
it('serves Marketplace people with real labels, installs and projects, and no follow control', async () => {
  open('#/marketplace/people');
  const card = await screen.findByTestId('person-card-mira');
  expect(card).toHaveTextContent('Platform · mira');
  expect(card).toHaveTextContent('2 installs');
  expect(card).toHaveTextContent('terum');
  expect(screen.queryByRole('button', { name: /Follow/ })).toBeNull();
  expect(screen.queryByText('Teddy Zhang')).toBeNull();
});
it('opens a real project install dialog without inventing an unavailable bulk grant preview', async () => {
  open('#/marketplace/projects/terum?dialog=install');
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Install project terum');
  expect(within(dialog).getByRole('button', { name: 'Install 1 skills' })).toBeVisible();
  expect(within(dialog).queryByText(/Tool grants to approve/)).toBeNull();
});
