import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createTauriBackend } from '../../backend/tauri';
import { fakeBridge } from '../../backend/tauri/__tests__/fake-bridge';
import { Sidebar } from './Sidebar';
import { Shell } from './Shell';

afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

it('omits the entire Inbox group when its surface is unavailable', async () => {
  const surfaces = { ...await createMockBackend().surfaces(), inbox: false };
  render(<QueryClientProvider client={new QueryClient()}><Sidebar selected="Global" counts={null} machine={undefined} surfaces={surfaces}/></QueryClientProvider>);
  for (const name of ['Inbox', 'Pushes', 'Updates', 'Alerts']) expect(screen.queryByRole('link', { name })).toBeNull();
  expect(screen.getByRole('link', { name: 'Share' })).toBeVisible();
});

it.each([true, false])('renders all navigation with mock surfaces or while surfaces load: %s', async loaded => {
  const status = await createMockBackend().status();
  render(<QueryClientProvider client={new QueryClient()}><Sidebar selected="Global" counts={null} machine={undefined} surfaces={loaded ? await createMockBackend().surfaces() : undefined} projects={status.ok ? status.value.projects ?? undefined : undefined}/></QueryClientProvider>);
  for (const name of ['Global', 'Projects', 'Terum', 'SSM', 'MRF', 'Inbox', 'Pushes', 'Updates', 'Alerts', 'Marketplace', 'Share']) expect(screen.getByRole('link', { name })).toBeVisible();
  expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
});

it('renders only Global navigation for the real adapter, retaining the settings gear', async () => {
  const backend = createTauriBackend(fakeBridge(() => undefined).bridge);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
  // The real adapter serves no project list here (status has no frames), so the Projects row never renders; wait for the surfaces read instead.
  await waitFor(() => expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(1));
  expect(screen.queryByRole('link', { name: 'Projects' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Global' })).toBeVisible();
  expect(screen.queryByText('Team')).toBeNull();
  expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
  expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible();
});

it('reads sidebar counts exclusively from the served status result and omits missing counts', async () => {
  const backend = createMockBackend();
  const status = await backend.status();
  if (!status.ok) throw new Error(status.error);
  vi.spyOn(backend, 'status').mockResolvedValue({ ok: true, value: { ...status.value, counts: { Global: '917', Pushes: '0' } } });
  render(<QueryClientProvider client={new QueryClient()}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole('link', { name: 'Global 917' })).toBeVisible());
  expect([...document.querySelectorAll('.nav-count')].map(node => node.textContent)).toEqual(['917', '0']);
});

it('passes the query signal to status and aborts it when the shell unmounts', async () => {
  const backend = createMockBackend();
  let signal: AbortSignal | undefined;
  vi.spyOn(backend, 'status').mockImplementation((_query, options) => { signal = options?.signal; return new Promise(() => {}); });
  const view = render(<QueryClientProvider client={new QueryClient()}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
  expect(signal).toBeDefined();
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
