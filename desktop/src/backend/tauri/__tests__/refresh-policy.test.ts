import { describe, expect, it, vi } from 'vitest';
import type { Result } from '../../types';
import { createRefreshPolicy, REFRESH_MIN_INTERVAL_MS, type CliRefresh } from '../refresh';

const value = (changed = false): CliRefresh => ({ changed, teams: [{ team: 't', state: 'refreshed', changed, head: 'a'.repeat(40) }] });
function setup(result: Result<CliRefresh> = { ok: true, value: value() }) {
  let now = 10_000_000;
  const run = vi.fn<() => Promise<Result<CliRefresh>>>().mockResolvedValue(result);
  const onChanged = vi.fn<() => Promise<void> | void>();
  const supported = vi.fn(() => true);
  const policy = createRefreshPolicy({ run, onChanged, supported, now: () => now });
  return { policy, run, onChanged, supported, setTime: (at: number) => { now = at; }, advance: (ms = REFRESH_MIN_INTERVAL_MS) => { now += ms; } };
}

describe('background refresh policy', () => {
  it('runs once and does not run again inside the interval', async () => {
    const { policy, run } = setup(); policy.trigger(); await policy.settled(); policy.trigger(); policy.trigger(); await policy.settled();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('runs again once the interval has passed', async () => {
    const { policy, run, advance } = setup(); policy.trigger(); await policy.settled(); advance(REFRESH_MIN_INTERVAL_MS + 1); policy.trigger(); await policy.settled();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('does not run at exactly the interval boundary minus one, and does at the boundary', async () => {
    const { policy, run, advance } = setup(); policy.trigger(); await policy.settled(); advance(REFRESH_MIN_INTERVAL_MS - 1); policy.trigger(); await policy.settled();
    expect(run).toHaveBeenCalledTimes(1); advance(1); policy.trigger(); await policy.settled(); expect(run).toHaveBeenCalledTimes(2);
  });
  it('a clock that jumps backwards does not wedge the throttle', async () => {
    const { policy, run, setTime } = setup(); policy.trigger(); await policy.settled(); setTime(10_000_000 - 3_600_000); policy.trigger(); await policy.settled();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('is single-flight: a trigger while a run is in flight starts nothing', async () => {
    const { policy, run, advance } = setup(); let release!: (result: Result<CliRefresh>) => void;
    run.mockReturnValue(new Promise(resolve => { release = resolve; }));
    policy.trigger(); advance(); policy.trigger(); expect(run).toHaveBeenCalledTimes(1);
    release({ ok: true, value: value() }); await expect(policy.settled()).resolves.toBeUndefined();
  });
  it('never spawns when the CLI does not support the verb', async () => {
    const { policy, run, supported } = setup(); supported.mockReturnValue(false);
    for (let i = 0; i < 10; i++) policy.trigger(); await policy.settled();
    expect(run).not.toHaveBeenCalled(); expect(policy.last()).toBeNull();
  });
  it('calls onChanged exactly once when a clone moved', async () => {
    const { policy, onChanged } = setup({ ok: true, value: value(true) }); policy.trigger(); await policy.settled();
    expect(onChanged).toHaveBeenCalledTimes(1); expect(policy.last()).toEqual({ at: 10_000_000, state: 'refreshed' });
  });
  it('never calls onChanged when nothing moved', async () => {
    const { policy, onChanged } = setup(); policy.trigger(); await policy.settled(); expect(onChanged).not.toHaveBeenCalled();
  });
  it('records a skipped outcome naming every team that did not refresh', async () => {
    const { policy } = setup({ ok: true, value: { changed: false, teams: [
      { team: 'a', state: 'busy', changed: false, head: null, detail: 'writer holds lock' },
      { team: 'b', state: 'unreachable', changed: false, head: null, detail: 'no access' },
    ] } }); policy.trigger(); await policy.settled();
    expect(policy.last()).toEqual({ at: 10_000_000, state: 'skipped', detail: 'a: busy — writer holds lock; b: unreachable — no access' });
  });
  it('records a failed outcome and does not throw when the run reports a failure', async () => {
    const { policy } = setup({ ok: false, error: 'bad config' }); policy.trigger(); await expect(policy.settled()).resolves.toBeUndefined();
    expect(policy.last()).toEqual({ at: 10_000_000, state: 'failed', detail: 'bad config' });
  });
  it('records a failed outcome and does not throw when the run rejects', async () => {
    const { policy, run, advance } = setup(); run.mockRejectedValueOnce(new Error('spawn failed')); policy.trigger(); await expect(policy.settled()).resolves.toBeUndefined();
    expect(policy.last()).toMatchObject({ state: 'failed', detail: 'spawn failed' }); advance(); policy.trigger(); await policy.settled();
    expect(run).toHaveBeenCalledTimes(2); expect(policy.last()?.state).toBe('refreshed');
  });
  it('does not reject when onChanged itself throws, and still clears the in-flight slot', async () => {
    const { policy, run, onChanged, advance } = setup({ ok: true, value: value(true) }); onChanged.mockRejectedValueOnce(new Error('listener failed'));
    policy.trigger(); await expect(policy.settled()).resolves.toBeUndefined(); expect(policy.last()).toMatchObject({ state: 'failed', detail: 'listener failed' });
    advance(); policy.trigger(); await policy.settled(); expect(run).toHaveBeenCalledTimes(2); expect(policy.last()?.state).toBe('refreshed');
  });
  it('a burnt attempt still counts: a failing run does not retry-storm', async () => {
    const { policy, run } = setup(); run.mockRejectedValue(new Error('offline'));
    policy.trigger(); await policy.settled(); policy.trigger(); await policy.settled(); policy.trigger(); await policy.settled(); expect(run).toHaveBeenCalledTimes(1);
  });
  it('reset clears the throttle so the next trigger runs immediately', async () => {
    const { policy, run } = setup(); policy.trigger(); await policy.settled(); policy.reset(); expect(run).toHaveBeenCalledTimes(1);
    policy.trigger(); await policy.settled(); expect(run).toHaveBeenCalledTimes(2);
  });
  it('treats an empty teams array as a clean refresh with nothing to invalidate', async () => {
    const { policy, onChanged } = setup({ ok: true, value: { changed: false, teams: [] } }); policy.trigger(); await policy.settled();
    expect(policy.last()?.state).toBe('refreshed'); expect(onChanged).not.toHaveBeenCalled();
  });
});
