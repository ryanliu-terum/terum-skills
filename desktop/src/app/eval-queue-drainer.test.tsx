import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackendContext, PromptContext, setupSession } from '../backend';
import { registerEvalQueue, type EvalQueueItem, type EvalQueueResult } from '../backend/eval-queue';
import { createMockBackend } from '../backend/mock';
import { createRun } from '../backend/mock/run';
import type { Result } from '../backend/types';
import { EvalQueueDrainer } from './EvalQueueDrainer';
import { EvalRunProvider } from './EvalRunProvider';
import { useEvalRun, type EvalRunApi } from './eval-run-context';

const minute = 60_000;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 10, 1)); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function harness({ enabled = true, failure = false, deferred = false } = {}) {
  const backend = createMockBackend(); backend.prefs.set('evals:overnight', enabled);
  const items: EvalQueueItem[] = ['alpha', 'beta'].map(skill => ({ team: 'team', skill, version: 'a'.repeat(40), requestedAt: '2026-09-10T00:00:00Z', window: 'overnight' }));
  let release: (() => void) | undefined;
  const cancelled = vi.fn();
  const drain = vi.fn(() => {
    const run = createRun<EvalQueueResult>(async ctx => {
      ctx.print(`Evaluating ${items[0]?.skill}`); await ctx.ask('confirm', 'Commit generated assets?');
      if (deferred) await new Promise<void>(resolve => { release = resolve; });
      if (failure) return { ok: false, error: 'eval failed' };
      items.splice(0); return { ok: true, value: { items: [...items], attempted: 2, completed: 2 } };
    });
    const cancel = run.cancel.bind(run); run.cancel = async () => { cancelled(); await cancel(); release?.(); };
    return run;
  });
  const list = vi.fn(async (): Promise<Result<EvalQueueResult>> => ({ ok: true, value: { items: [...items] } }));
  registerEvalQueue(backend, { list, drain });
  let host: EvalRunApi | undefined;
  function Observe() { host = useEvalRun(); return <div data-testid="host">{host.current?.state} {host.current?.lines.join(' ')}</div>; }
  const ask = vi.fn(async () => true);
  const view = render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PromptContext value={ask}><EvalRunProvider><EvalQueueDrainer/><Observe/></EvalRunProvider></PromptContext></QueryClientProvider></BackendContext>);
  return { backend, drain, list, items, ask, cancelled, view, host: () => host!, release: () => release?.() };
}
it('outside the window never drains', async () => {
  vi.setSystemTime(new Date(2026, 8, 10, 5)); const h = harness();
  await act(() => vi.advanceTimersByTimeAsync(60 * minute)); expect(h.drain).not.toHaveBeenCalled(); expect(h.list).not.toHaveBeenCalled();
});
it('drains only after thirty minutes idle, one visible parallel batch through the host', async () => {
  const h = harness({ deferred: true });
  await act(() => vi.advanceTimersByTimeAsync(29 * minute)); expect(h.drain).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(minute)); expect(h.drain).toHaveBeenCalledTimes(1);
  expect(h.host().current).toMatchObject({ queue: true, state: 'running', name: 'alpha' }); expect(h.host().dialogOpen).toBe(true);
  expect(screen.getByTestId('host')).toHaveTextContent('Evaluating alpha'); expect(h.ask).toHaveBeenCalledWith({ kind: 'confirm', question: 'Commit generated assets?' });
  await act(async () => { h.release(); }); expect(h.drain).toHaveBeenCalledTimes(1);
  await act(async () => { h.release(); }); expect(h.host().current?.state).toBe('done'); expect(h.items).toHaveLength(0);
});
it('preference off never schedules work; switching it off prevents another batch', async () => {
  const off = harness({ enabled: false }); await act(() => vi.advanceTimersByTimeAsync(30 * minute)); expect(off.drain).not.toHaveBeenCalled(); off.view.unmount();
  const h = harness({ deferred: true }); await act(() => vi.advanceTimersByTimeAsync(30 * minute)); expect(h.drain).toHaveBeenCalledTimes(1);
  act(() => h.backend.prefs.set('evals:overnight', false)); await act(async () => { h.release(); }); expect(h.drain).toHaveBeenCalledTimes(1);
});
it('activity before the deadline resets idle and during a run never starts another batch', async () => {
  const h = harness({ deferred: true }); await act(() => vi.advanceTimersByTimeAsync(20 * minute)); fireEvent.pointerMove(window);
  await act(() => vi.advanceTimersByTimeAsync(20 * minute)); expect(h.drain).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(10 * minute)); expect(h.drain).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window); await act(async () => { h.release(); }); expect(h.drain).toHaveBeenCalledTimes(1);
});
it('Stop cancels the hosted CLI run and prevents another batch that night', async () => {
  const h = harness({ deferred: true }); await act(() => vi.advanceTimersByTimeAsync(30 * minute));
  await act(async () => { await h.host().stop(); }); expect(h.cancelled).toHaveBeenCalledTimes(1); expect(h.host().current?.state).toBe('stopped');
  await act(() => vi.advanceTimersByTimeAsync(30 * minute)); expect(h.drain).toHaveBeenCalledTimes(1);
});
it('a failure stays visible in the host and does not spin on the failed item', async () => {
  const h = harness({ failure: true }); await act(() => vi.advanceTimersByTimeAsync(30 * minute));
  expect(h.host().current).toMatchObject({ state: 'failed', result: { ok: false, error: 'eval failed' } });
  await act(() => vi.advanceTimersByTimeAsync(60 * minute)); expect(h.drain).toHaveBeenCalledTimes(1);
});
it('does not launch another batch after the window closes or the component unmounts', async () => {
  vi.setSystemTime(new Date(2026, 8, 10, 4, 29)); const h = harness({ deferred: true });
  await act(() => vi.advanceTimersByTimeAsync(30 * minute)); expect(h.drain).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(minute)); await act(async () => { h.release(); }); expect(h.drain).toHaveBeenCalledTimes(1);
});
it('reports list failures instead of silently dropping the queue', async () => {
  const h = harness(); h.list.mockResolvedValue({ ok: false, error: 'invalid queue' });
  await act(() => vi.advanceTimersByTimeAsync(30 * minute)); expect(screen.getByRole('alert')).toHaveTextContent('invalid queue'); expect(h.drain).not.toHaveBeenCalled();
});

it('does not start paid work while setup is active',async()=>{
 const h=harness();vi.spyOn(h.backend,'setup').mockImplementation(()=>createRun(async ctx=>{await ctx.sleep(60*minute);return {ok:true,value:{team:'team',role:'creator'}};}));
 const session=setupSession(h.backend,{writtenAt:'2026-09-10T01:00:00Z'});const running=session.start(async()=>false);
 await act(()=>vi.advanceTimersByTimeAsync(30*minute));expect(h.list).not.toHaveBeenCalled();expect(h.drain).not.toHaveBeenCalled();await act(async()=>{await session.stop();await running;});
});
it.each(['activity','unmount','disable'] as const)('rechecks eligibility after a pending queue read: %s',async reason=>{
 const h=harness();let finish!:(value:Result<EvalQueueResult>)=>void;h.list.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await act(()=>vi.advanceTimersByTimeAsync(30*minute));expect(h.list).toHaveBeenCalledOnce();
 if(reason==='activity')fireEvent.pointerMove(window);else if(reason==='unmount')h.view.unmount();else act(()=>h.backend.prefs.set('evals:overnight',false));
 await act(async()=>{finish({ok:true,value:{items:h.items}});});expect(h.drain).not.toHaveBeenCalled();
});
