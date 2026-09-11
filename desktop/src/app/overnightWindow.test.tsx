import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { msUntilWindow, useOvernightWindow } from './overnightWindow';
const minute = 60_000;
const at = (hour: number, minutes = 0) => new Date(2026, 8, 10, hour, minutes);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at(0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
it.each([[0, 60], [1, 0], [4, 0], [5, 20 * 60], [23, 2 * 60]])('window delay at %s:00 is %s minutes', (hour, minutes) => {
  expect(msUntilWindow(at(hour!), 1, 5)).toBe(minutes! * minute);
});
it('uses local dates across year rollover and daylight saving time', () => {
  expect(msUntilWindow(new Date(2026, 11, 31, 23), 1, 5)).toBe(2 * 60 * minute);
  vi.stubEnv('TZ', 'America/Los_Angeles');
  expect(msUntilWindow(new Date(2026, 2, 7, 5), 3, 5)).toBe(21 * 60 * minute);
  expect(msUntilWindow(new Date(2026, 9, 31, 5), 3, 5)).toBe(23 * 60 * minute);
});
it.each([[5, 1], [-1, 5], [1.5, 5], [1, 25]])('rejects invalid hours %s / %s', (start, end) => {
  expect(() => msUntilWindow(at(0), start!, end!)).toThrow(RangeError);
});
it('rejects an invalid clock', () => { expect(() => msUntilWindow(new Date(NaN), 1, 5)).toThrow(RangeError); });
it('waits outside the window and fires once for an idle person at its start', async () => {
  const onFire = vi.fn(); renderHook(() => useOvernightWindow({ enabled: true, onFire }));
  expect(vi.getTimerCount()).toBe(1); await advance(59 * minute); expect(onFire).not.toHaveBeenCalled();
  await advance(minute); expect(onFire).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
  await advance(24 * 60 * minute); expect(onFire).toHaveBeenCalledTimes(2);
});
it('starts the idle clock when enabled inside the window', async () => {
  vi.setSystemTime(at(2)); const onFire = vi.fn(); renderHook(() => useOvernightWindow({ enabled: true, onFire }));
  await advance(29 * minute); expect(onFire).not.toHaveBeenCalled(); await advance(minute); expect(onFire).toHaveBeenCalledOnce();
});
it.each(['pointerdown', 'pointermove', 'keydown', 'wheel'])('%s resets idleness', async event => {
  vi.setSystemTime(at(1)); const onFire = vi.fn(); renderHook(() => useOvernightWindow({ enabled: true, onFire }));
  await advance(29 * minute); act(() => { fireEvent(window, new Event(event)); });
  await advance(29 * minute); expect(onFire).not.toHaveBeenCalled(); await advance(minute); expect(onFire).toHaveBeenCalledOnce();
});
it('does not fire at the exclusive end and waits until the next night', async () => {
  vi.setSystemTime(at(4, 30)); const onFire = vi.fn(); renderHook(() => useOvernightWindow({ enabled: true, onFire }));
  await advance(30 * minute); expect(onFire).not.toHaveBeenCalled(); await advance(20 * 60 * minute); expect(onFire).toHaveBeenCalledOnce();
});
it('checks elapsed idleness on activity after a suspended timer', async () => {
  vi.setSystemTime(at(0)); const onFire = vi.fn(); renderHook(() => useOvernightWindow({ enabled: true, onFire }));
  vi.setSystemTime(at(2)); await act(async () => { fireEvent.pointerMove(window); }); expect(onFire).toHaveBeenCalledOnce();
});
it('disabled and unmounted hooks have no timer or activity listener', async () => {
  const onFire = vi.fn(); const view = renderHook(({ enabled }) => useOvernightWindow({ enabled, onFire }), { initialProps: { enabled: false } });
  expect(vi.getTimerCount()).toBe(0); view.rerender({ enabled: true }); expect(vi.getTimerCount()).toBe(1);
  view.rerender({ enabled: false }); expect(vi.getTimerCount()).toBe(0); await advance(2 * 60 * minute); fireEvent.keyDown(window); expect(onFire).not.toHaveBeenCalled();
  view.rerender({ enabled: true }); view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
it('callback changes retain idleness, and re-enabling cannot fire twice that night', async () => {
  vi.setSystemTime(at(1)); const first = vi.fn(), second = vi.fn();
  const view = renderHook(({ enabled, onFire }) => useOvernightWindow({ enabled, onFire }), { initialProps: { enabled: true, onFire: first } });
  await advance(29 * minute); view.rerender({ enabled: true, onFire: second }); await advance(minute);
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  view.rerender({ enabled: false, onFire: second }); view.rerender({ enabled: true, onFire: second }); await advance(30 * minute); expect(second).toHaveBeenCalledOnce();
});
it.each([true, false])('reports %s synchronous failure once, without an unhandled rejection', async sync => {
  vi.setSystemTime(at(1)); const error = new Error('apply failed'), onError = vi.fn();
  const onFire = vi.fn(() => { if (sync) throw error; return Promise.reject(error); });
  renderHook(() => useOvernightWindow({ enabled: true, onFire, onError }));
  await advance(30 * minute); expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  await advance(60 * minute); expect(onFire).toHaveBeenCalledOnce();
});
it('honors custom hours, idle duration, and the clock seam', async () => {
  const now = () => new Date(Date.now() + 60 * minute), onFire = vi.fn();
  renderHook(() => useOvernightWindow({ enabled: true, onFire, startHour: 2, endHour: 3, idleMs: 10 * minute, now }));
  await advance(60 * minute); expect(onFire).toHaveBeenCalledOnce();
});

it('does not fire on a wake event after the window has ended',async()=>{
 const onFire=vi.fn();renderHook(()=>useOvernightWindow({enabled:true,onFire}));vi.setSystemTime(at(6));
 await act(async()=>{fireEvent.pointerDown(window);});expect(onFire).not.toHaveBeenCalled();
 await advance(19*60*minute);expect(onFire).toHaveBeenCalledOnce();
});
it('absorbs a rejected callback when no error handler is supplied',async()=>{
 vi.setSystemTime(at(1));const onFire=vi.fn(async()=>{throw new Error('failed');});
 renderHook(()=>useOvernightWindow({enabled:true,onFire}));await advance(30*minute);expect(onFire).toHaveBeenCalledOnce();
});
