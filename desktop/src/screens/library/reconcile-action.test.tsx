import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';

beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

it('uses the reconcile feature for the Library Check against the team action', async () => {
  location.hash = '#/library/global';
  const backend = createMockBackend();
  const list = vi.spyOn(backend.reconcile, 'list');
  render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
  fireEvent.click(await screen.findByRole('button', { name: 'Check against the team' }));
  expect(await screen.findByRole('dialog', { name: 'Check against the team' })).toBeInTheDocument();
  expect(list).toHaveBeenCalledOnce();
});
