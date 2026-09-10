import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency } from '../concurrency';
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
describe('bounded concurrency', () => {
  it('returns results in input order, never completion order', async () => {
    expect(await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 10, async i => { await wait((10-i)*5); return i*2; })).toEqual(Array.from({ length: 10 }, (_, i) => i*2));
  });
  it('never runs more than limit at once', async () => {
    let active = 0, peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }), 4, async () => { peak = Math.max(peak, ++active); await wait(2); active--; });
    expect(peak).toBe(4);
  });
  it('resolves an empty array without calling fn', async () => {
    const fn = vi.fn(() => { throw new Error('never'); });
    expect(await mapWithConcurrency([], 4, fn)).toEqual([]); expect(fn).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity])('treats a %s limit as at least one worker', async limit => {
    let active = 0, peak = 0;
    expect(await mapWithConcurrency([0,1,2], limit, async i => { peak = Math.max(peak, ++active); await wait(1); active--; return i; })).toEqual([0,1,2]);
    expect(peak).toBeGreaterThanOrEqual(1); expect(peak).toBeLessThanOrEqual(3);
  });
  it('rejects with the lowest-indexed reason and starts no further work after a failure', async () => {
    const fn = vi.fn(async (i: number) => { await wait(i === 3 ? 20 : 1); if (i === 3 || i === 5) throw new Error(i === 3 ? 'three' : 'five'); return i; });
    await expect(mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 2, fn)).rejects.toThrow('three');
    expect(fn.mock.calls.length).toBeLessThan(10);
  });
  it('leaves no unhandled rejection when several items fail', async () => {
    const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
    try { await expect(mapWithConcurrency([0,1], 2, async i => { await wait(i+1); throw new Error(String(i)); })).rejects.toThrow('0'); await wait(5); expect(unhandled).not.toHaveBeenCalled(); }
    finally { process.off('unhandledRejection', unhandled); }
  });
});
