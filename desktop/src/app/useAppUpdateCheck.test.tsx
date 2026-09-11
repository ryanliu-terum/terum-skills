import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BackendContext } from '../backend';
import { createMockBackend } from '../backend/mock';
import { createRun } from '../backend/mock/run';
import type { AppUpdateStatus, Result } from '../backend/types';
import { useAppUpdateCheck } from './useAppUpdateCheck';
const status: AppUpdateStatus = { appVersion: '0.12.1', supported: true, cliVersion: '0.12.1', latest: '0.12.2', latestAt: null, probe: 'cached', probeError: null, staged: null, installed: [], lastApply: null, newer: true, ppid: 42 };
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); for (const client of clients) client.clear(); clients.length = 0; localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });
function Probe() { useAppUpdateCheck(); return null; }
async function setup(policy: 'ask' | 'on-close' | 'overnight', patch: Partial<AppUpdateStatus> = {}) {
 const backend = createMockBackend(); backend.prefs.set('updates:app:policy', policy);
 vi.spyOn(backend, 'surfaces').mockResolvedValue({ ...await backend.surfaces(), appUpdate: true });
 vi.spyOn(backend, 'features').mockResolvedValue({ ...await backend.features(), appUpdate: true });
 const check = vi.spyOn(backend.appUpdate, 'check').mockResolvedValue({ ok: true, value: { ...status, ...patch } });
 const stage = vi.spyOn(backend.appUpdate, 'stage').mockImplementation(version => createRun(async () => ({ ok: true, value: { version, staged: true, notPublished: false, alreadyStaged: false } })));
 const arm = vi.spyOn(backend.appUpdate, 'armOnClose'), disarm = vi.spyOn(backend.appUpdate, 'disarmOnClose');
 const apply = vi.spyOn(backend.appUpdate, 'apply').mockResolvedValue({ ok: true, value: undefined }), quit = vi.spyOn(backend, 'quit').mockResolvedValue(undefined);
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
 const open = () => render(<StrictMode><QueryClientProvider client={client}><BackendContext value={backend}><Probe/></BackendContext></QueryClientProvider></StrictMode>);
 return { backend, check, stage, arm, disarm, apply, quit, client, open };
}
it('ask checks but never stages, arms, or installs, even with a staged release', async () => {
 const h = await setup('ask', { staged: '0.12.2' }); h.open(); await waitFor(() => expect(h.disarm).toHaveBeenCalled());
 expect(h.stage).not.toHaveBeenCalled(); expect(h.arm).not.toHaveBeenCalled(); expect(h.apply).not.toHaveBeenCalled();
});
it('on-close stages once and arms, then disarms on policy change without checking again', async () => {
 const h = await setup('on-close'); h.open(); await waitFor(() => expect(h.arm).toHaveBeenCalledWith('0.12.2'));
 expect(h.stage).toHaveBeenCalledOnce(); h.disarm.mockClear(); act(() => h.backend.prefs.set('updates:app:policy', 'ask'));
 await waitFor(() => expect(h.disarm).toHaveBeenCalled()); expect(h.check).toHaveBeenCalledOnce(); expect(h.apply).not.toHaveBeenCalled();
});
it('changing ask to on-close stages from the existing launch observation', async () => {
 const h = await setup('ask'); h.open(); await waitFor(() => expect(h.disarm).toHaveBeenCalled());
 act(() => h.backend.prefs.set('updates:app:policy', 'on-close')); await waitFor(() => expect(h.arm).toHaveBeenCalledWith('0.12.2')); expect(h.check).toHaveBeenCalledOnce();
});
it('disarms when the cached version is installed and when unmounted', async () => {
 const h = await setup('on-close', { staged: '0.12.2' }); const view = h.open(); await waitFor(() => expect(h.arm).toHaveBeenCalled()); h.disarm.mockClear();
 act(() => h.client.setQueryData<Result<AppUpdateStatus>>(['app-update'], { ok: true, value: { ...status, staged: '0.12.2', installed: ['0.12.2'] } }));
 await waitFor(() => expect(h.disarm).toHaveBeenCalled()); h.disarm.mockClear(); view.unmount(); expect(h.disarm).toHaveBeenCalled();
});
it('records arming failure for the Settings row without throwing', async () => {
 const h = await setup('on-close', { staged: '0.12.2' }); h.arm.mockResolvedValue({ ok: false, error: 'shell unavailable' }); h.open();
 await waitFor(() => expect(h.client.getQueryData(['app-update-policy-outcome'])).toEqual({ ok: false, error: 'shell unavailable' })); expect(h.apply).not.toHaveBeenCalled();
});
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
it('overnight stages, waits 30 idle minutes inside the window, then applies and quits once', async () => {
 const h = await setup('overnight'); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 10, 1));
 const order: string[] = []; h.apply.mockImplementation(async () => { order.push('apply'); return { ok: true, value: undefined }; }); h.quit.mockImplementation(async () => { order.push('quit'); });
 h.open(); await advance(100); expect(h.stage).toHaveBeenCalledOnce(); expect(h.arm).not.toHaveBeenCalled();
 await advance(29 * 60_000); expect(order).toEqual([]); act(() => { fireEvent.keyDown(window); }); await advance(29 * 60_000); expect(order).toEqual([]);
 await advance(60_000); expect(order).toEqual(['apply', 'quit']); expect(h.apply).toHaveBeenCalledExactlyOnceWith('0.12.2', 'overnight');
 await advance(60 * 60_000); expect(h.apply).toHaveBeenCalledOnce(); expect(h.check).toHaveBeenCalledOnce();
});
it('outside the window it waits for the next night', async () => {
 const h = await setup('overnight', { staged: '0.12.2' }); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 10, 5)); h.open();
 await advance(19 * 60 * 60_000); expect(h.apply).not.toHaveBeenCalled(); await advance(60 * 60_000 + 100); expect(h.apply).toHaveBeenCalledOnce();
});
it('switching policy cancels the pending overnight action', async () => {
 const h = await setup('overnight', { staged: '0.12.2' }); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 10, 1)); h.open(); await advance(100);
 act(() => h.backend.prefs.set('updates:app:policy', 'ask')); await advance(60 * 60_000); expect(h.apply).not.toHaveBeenCalled();
});
it.each(['failure', 'throw', 'quit'] as const)('overnight %s is recorded, never retried that night', async mode => {
 const h = await setup('overnight', { staged: '0.12.2' });
 if (mode === 'failure') h.apply.mockResolvedValue({ ok: false, error: 'failed' }); else if (mode === 'throw') h.apply.mockRejectedValue(new Error('failed')); else h.quit.mockRejectedValue(new Error('failed'));
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 10, 1)); h.open(); await advance(31 * 60_000);
 expect(h.client.getQueryData(['app-update-policy-outcome'])).toEqual({ ok: false, error: 'failed' }); if (mode !== 'quit') expect(h.quit).not.toHaveBeenCalled();
 await advance(60 * 60_000); expect(h.apply).toHaveBeenCalledOnce();
});
