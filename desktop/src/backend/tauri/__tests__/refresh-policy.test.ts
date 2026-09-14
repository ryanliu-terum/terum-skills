import { describe, expect, it, vi } from 'vitest';
import type { Result } from '../../types';
import { createRefreshPolicy, createWorkflowGate, REFRESH_MIN_INTERVAL_MS, type CliRefresh } from '../refresh';

const value = (changed = false): CliRefresh => ({ changed, notices: [], teams: [{ team: 't', state: 'refreshed', changed, head: 'a'.repeat(40) }] });
function setup(result: Result<CliRefresh> = { ok: true, value: value() }) {
  let now = 10_000_000;
  let busyNow = false;
  const run = vi.fn<() => Promise<Result<CliRefresh>>>().mockResolvedValue(result);
  const onChanged = vi.fn<() => Promise<void> | void>();
  const onRefreshed = vi.fn<() => Promise<void> | void>();
  const onFailed = vi.fn<() => Promise<void> | void>();
  const supported = vi.fn(() => true);
  const busy = vi.fn(() => busyNow);
  const policy = createRefreshPolicy({ run, onChanged, onRefreshed, onFailed, supported, busy, now: () => now });
  return { policy, run, onChanged, onRefreshed, onFailed, supported, busy, setBusy: (value: boolean) => { busyNow = value; }, setTime: (at: number) => { now = at; }, advance: (ms = REFRESH_MIN_INTERVAL_MS) => { now += ms; } };
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
    const { policy } = setup({ ok: true, value: { changed: false, notices: [], teams: [
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
    const { policy, onChanged } = setup({ ok: true, value: { changed: false, notices: [], teams: [] } }); policy.trigger(); await policy.settled();
    expect(policy.last()?.state).toBe('refreshed'); expect(onChanged).not.toHaveBeenCalled();
  });
  it('never fetches while a foreground write verb is running, and does not spend the throttle on the attempt', async () => {
    const { policy, run, setBusy } = setup(); setBusy(true);
    policy.trigger(); policy.trigger(); await policy.settled(); expect(run).not.toHaveBeenCalled(); expect(policy.last()).toBeNull();
    setBusy(false); policy.trigger(); await policy.settled(); expect(run).toHaveBeenCalledTimes(1);
  });
  it('the busy gate is consulted on every trigger, not once at construction', async () => {
    const { policy, run, busy, setBusy, advance } = setup();
    policy.trigger(); await policy.settled(); expect(run).toHaveBeenCalledTimes(1);
    setBusy(true); advance(REFRESH_MIN_INTERVAL_MS + 1); policy.trigger(); await policy.settled(); expect(run).toHaveBeenCalledTimes(1);
    setBusy(false); policy.trigger(); await policy.settled(); expect(run).toHaveBeenCalledTimes(2); expect(busy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it('calls onRefreshed after a run that moved nothing, without calling onChanged', async () => {
    const { policy, onChanged, onRefreshed, onFailed } = setup(); policy.trigger(); await policy.settled();
    expect(onRefreshed).toHaveBeenCalledTimes(1); expect(onChanged).not.toHaveBeenCalled(); expect(onFailed).not.toHaveBeenCalled();
  });
  it('calls onRefreshed after a skipped run, and after a changed one alongside onChanged', async () => {
    const skipped = setup({ ok: true, value: { changed: false, notices: [], teams: [{ team: 'a', state: 'busy', changed: false, head: null }] } });
    skipped.policy.trigger(); await skipped.policy.settled(); expect(skipped.policy.last()?.state).toBe('skipped'); expect(skipped.onRefreshed).toHaveBeenCalledTimes(1);
    const changed = setup({ ok: true, value: value(true) }); changed.policy.trigger(); await changed.policy.settled();
    expect(changed.onChanged).toHaveBeenCalledTimes(1); expect(changed.onRefreshed).toHaveBeenCalledTimes(1);
  });
  it('never calls onRefreshed for a failed run, and calls onFailed instead', async () => {
    const reported = setup({ ok: false, error: 'bad config' }); reported.policy.trigger(); await reported.policy.settled();
    expect(reported.onRefreshed).not.toHaveBeenCalled(); expect(reported.onFailed).toHaveBeenCalledTimes(1);
    const thrown = setup(); thrown.run.mockRejectedValueOnce(new Error('spawn failed')); thrown.policy.trigger(); await thrown.policy.settled();
    expect(thrown.onRefreshed).not.toHaveBeenCalled(); expect(thrown.onFailed).toHaveBeenCalledTimes(1);
  });
  it('an onFailed listener that throws neither rejects nor overwrites the CLI error the user must read', async () => {
    const { policy, run, onFailed, advance } = setup({ ok: false, error: 'bad config' }); onFailed.mockRejectedValueOnce(new Error('listener failed'));
    policy.trigger(); await expect(policy.settled()).resolves.toBeUndefined(); expect(policy.last()).toEqual({ at: 10_000_000, state: 'failed', detail: 'bad config' });
    run.mockResolvedValue({ ok: true, value: value() }); advance(); policy.trigger(); await policy.settled(); expect(policy.last()?.state).toBe('refreshed');
  });
  it('records the CLI notices on the outcome, and omits the key when there are none', async () => {
    const noisy = setup({ ok: true, value: { changed: false, notices: ['Skipping acme: Permission denied (publickey).'], teams: [{ team: 'a', state: 'error', changed: false, head: null, detail: 'no access' }] } });
    noisy.policy.trigger(); await noisy.policy.settled();
    expect(noisy.policy.last()).toEqual({ at: 10_000_000, state: 'skipped', detail: 'a: error — no access', notices: ['Skipping acme: Permission denied (publickey).'] });
    const clean = setup({ ok: true, value: { changed: false, notices: ['one team was already up to date'], teams: [] } }); clean.policy.trigger(); await clean.policy.settled();
    expect(clean.policy.last()).toEqual({ at: 10_000_000, state: 'refreshed', notices: ['one team was already up to date'] });
    const quiet = setup(); quiet.policy.trigger(); await quiet.policy.settled(); expect(quiet.policy.last()).not.toHaveProperty('notices');
  });
  it('keeps the notices of a failed run that still carried the CLI partial result', async () => {
    const { policy } = setup({ ok: false, error: 'Could not fetch team\nLong diagnostics', value: { changed: false, notices: ['Skipping acme: Permission denied (publickey).'], teams: [] } });
    policy.trigger(); await policy.settled();
    expect(policy.last()).toEqual({ at: 10_000_000, state: 'failed', detail: 'Could not fetch team\nLong diagnostics', notices: ['Skipping acme: Permission denied (publickey).'] });
  });
});

describe('createWorkflowGate', () => {
  it('counts write verbs only, ignores reads and the update check, and reports idle exactly once per busy period', () => {
    const onIdle = vi.fn(); const gate = createWorkflowGate(onIdle);
    expect(gate.busy()).toBe(false);
    const install = gate.start(['install', 'x']), evaluate = gate.start(['eval', '--', 'y']); expect(gate.busy()).toBe(true);
    const status = gate.start(['status']), check = gate.start(['app-update', '--check']); status(); check();
    expect(gate.busy()).toBe(true); expect(onIdle).not.toHaveBeenCalled();
    install(); install(); expect(gate.busy()).toBe(true); expect(onIdle).not.toHaveBeenCalled();
    evaluate(); expect(gate.busy()).toBe(false); expect(onIdle).toHaveBeenCalledTimes(1); evaluate(); expect(onIdle).toHaveBeenCalledTimes(1);
    gate.start(['app-update', '--stage', '--release', '1.0.0'])(); expect(onIdle).toHaveBeenCalledTimes(2); expect(gate.busy()).toBe(false);
  });
});
