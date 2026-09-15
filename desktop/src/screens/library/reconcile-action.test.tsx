import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import type { SyncResult } from '../../backend/types';

beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

function open() {
  location.hash = '#/library/global';
  const backend = createMockBackend();
  const sync = vi.spyOn(backend, 'sync');
  const list = vi.spyOn(backend.reconcile, 'list');
  render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
  return { backend, sync, list };
}

it('the Library Sync fetches first, then compares, and opens the reconcile dialog', async () => {
  const { sync, list } = open();
  fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
  expect(await screen.findByRole('dialog', { name: 'Sync' })).toBeInTheDocument();
  expect(sync).toHaveBeenCalledExactlyOnceWith({});
  expect(list).toHaveBeenCalledOnce();
  expect(sync.mock.invocationCallOrder[0]).toBeLessThan(list.mock.invocationCallOrder[0]!);
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
});

it('a failed fetch still compares, and the dialog says the comparison is against the copy on this machine', async () => {
  const { sync, list } = open();
  sync.mockImplementation(() => createRun<SyncResult>(async () => ({ ok: false, error: 'terum: could not reach the remote' })));
  fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
  const dialog = await screen.findByRole('dialog', { name: 'Sync' });
  expect(list).toHaveBeenCalledOnce();
  expect(dialog).toContainElement(screen.getByRole('note'));
  expect(screen.getByRole('note')).toHaveTextContent('The team could not be fetched (terum: could not reach the remote). This compares your skills against the team copy already on this machine.');
});

it('a team the fetch skipped is named in the dialog', async () => {
  const { sync } = open();
  sync.mockImplementation(() => createRun<SyncResult>(async () => ({ ok: true, value: { notices: [], changed: false, teams: [{ team: 'terum', state: 'unreachable', detail: 'DNS lookup failed' }] } })));
  fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
  await screen.findByRole('dialog', { name: 'Sync' });
  expect(screen.getByRole('note')).toHaveTextContent('terum: could not reach the remote · DNS lookup failed. This compares your skills against the team copy already on this machine.');
});

it('nothing to reconcile is a notice, not an error', async () => {
  const { backend } = open();
  vi.spyOn(backend.reconcile, 'list').mockResolvedValue({ ok: true, value: { identical: [], differing: [], renamed: [], adopted: [], published: [] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
  const notice = await screen.findByText('Nothing to reconcile: none of your skills match a team skill by bytes or by name.');
  expect(notice).toHaveAttribute('role', 'status');
  expect(screen.queryByText('Nothing to reconcile.')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
