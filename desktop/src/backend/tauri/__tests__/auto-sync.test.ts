import { describe, expect, it, vi } from 'vitest';
import { AUTO_SYNC_MIN_INTERVAL_MS, createAutoSyncPolicy } from '../auto-sync';
import type { Result, SyncResult } from '../../types';
const unchanged: SyncResult = { changed:false, placed:0, deferred:[], notices:[], teams:[] };
function setup() {
  let clock = 100, supported = true, busy = false;
  const run = vi.fn<() => Promise<Result<SyncResult>>>().mockResolvedValue({ ok:true, value:unchanged });
  const onChanged = vi.fn(), onStatusChanged = vi.fn();
  const policy = createAutoSyncPolicy({ run, supported:()=>supported, busy:()=>busy, onChanged, onStatusChanged, now:()=>clock });
  return { policy, run, onChanged, onStatusChanged, advance:()=>{clock+=AUTO_SYNC_MIN_INTERVAL_MS;}, supported:(value:boolean)=>{supported=value;}, busy:(value:boolean)=>{busy=value;}, backwards:()=>{clock=0;} };
}
describe('automatic sync policy', () => {
  it('throttles launch and repeated focus triggers without timers', async () => {
    vi.useFakeTimers();
    const f=setup(); f.policy.trigger(); await f.policy.settled();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_MIN_INTERVAL_MS * 2);
    expect(f.run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    f.policy.trigger(); await f.policy.settled(); expect(f.run).toHaveBeenCalledTimes(1);
    f.advance(); expect(f.run).toHaveBeenCalledTimes(1);
    f.policy.trigger(); await f.policy.settled(); expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.onChanged).not.toHaveBeenCalled(); expect(f.policy.last()?.state).toBe('synced');
  });
  it('is single-flight even when the interval elapsed', async () => {
    const f=setup(); let resolve!: (value:Result<SyncResult>)=>void;
    f.run.mockReturnValue(new Promise(done=>{resolve=done;}));
    f.policy.trigger(); f.advance(); f.policy.trigger(); expect(f.run).toHaveBeenCalledTimes(1);
    resolve({ok:true,value:unchanged}); await f.policy.settled();
  });
  it('gates the feature and skips busy workflows without consuming the interval', async () => {
    const f=setup(); f.supported(false); f.policy.trigger(); expect(f.run).not.toHaveBeenCalled();
    f.supported(true); f.busy(true); f.policy.trigger(); expect(f.run).not.toHaveBeenCalled();
    f.busy(false); f.policy.trigger(); await f.policy.settled(); expect(f.run).toHaveBeenCalledTimes(1);
  });
  it('relaunch resets the throttle; a backwards clock also recovers', async () => {
    const f=setup(); f.policy.trigger(); await f.policy.settled();
    f.policy.reset(); f.policy.trigger(); await f.policy.settled(); expect(f.run).toHaveBeenCalledTimes(2);
    f.backwards(); f.policy.trigger(); await f.policy.settled(); expect(f.run).toHaveBeenCalledTimes(3);
  });
  it.each([{changed:true,placed:0},{changed:false,placed:1}])('invalidates changed/placed results %j', async delta => {
    const f=setup(); f.run.mockResolvedValue({ok:true,value:{...unchanged,...delta}});
    f.policy.trigger(); await f.policy.settled(); expect(f.onChanged).toHaveBeenCalledTimes(1);
  });
  it('records the CLI first error line, swallows failure and still invalidates partial changes', async () => {
    const f=setup(); f.run.mockResolvedValue({ok:false,error:'Fetch failed\nDetails',value:{...unchanged,changed:true}});
    f.policy.trigger(); await expect(f.policy.settled()).resolves.toBeUndefined();
    expect(f.policy.last()).toEqual({at:100,state:'failed',detail:'Fetch failed',notices:[]});
    expect(f.onChanged).toHaveBeenCalledTimes(1); expect(f.onStatusChanged).not.toHaveBeenCalled();
    f.policy.trigger(); expect(f.run).toHaveBeenCalledTimes(1);
  });
  it('records thrown errors without rejecting into focus', async () => {
    const f=setup(); f.run.mockRejectedValue(new Error('Spawn failed\nDetails'));
    f.policy.trigger(); await expect(f.policy.settled()).resolves.toBeUndefined();
    expect(f.policy.last()?.detail).toBe('Spawn failed');
  });
});

it.each([true, false])('cache callback failure never changes CLI success=%s or its first-line diagnostic', async ok => {
  const error = new Error('cache callback failed\nsecond line');
  const policy = createAutoSyncPolicy({
    supported: () => true, busy: () => false,
    run: async () => ok ? { ok:true, value:{...unchanged,changed:true} } : { ok:false,error:'CLI failure\ncontext',value:{...unchanged,notices:['Permission denied']} },
    onChanged: () => { throw error; }, onStatusChanged: () => { throw error; },
  });
  policy.trigger(); await expect(policy.settled()).resolves.toBeUndefined();
  expect(policy.last()).toMatchObject(ok ? {state:'synced'} : {state:'failed',detail:'CLI failure',notices:['Permission denied']});
  expect(policy.notificationError()).toBe(error);
});
it('notifies status only for failed outcomes or recovery, never twice for changed results', async () => {
  const f=setup(); f.policy.trigger(); await f.policy.settled(); expect(f.onStatusChanged).not.toHaveBeenCalled();
  f.advance(); f.run.mockResolvedValue({ok:false,error:'failure'}); f.policy.trigger(); await f.policy.settled(); expect(f.onStatusChanged).toHaveBeenCalledTimes(1);
  f.advance(); f.run.mockResolvedValue({ok:true,value:unchanged}); f.policy.trigger(); await f.policy.settled(); expect(f.onStatusChanged).toHaveBeenCalledTimes(2);
  f.advance(); f.policy.trigger(); await f.policy.settled(); expect(f.onStatusChanged).toHaveBeenCalledTimes(2);
});
it('cooldown begins after a slow run, and a real relaunch forces the CLI freshness gate too', async () => {
  let now=0, finish!:(value:Result<SyncResult>)=>void;
  const run=vi.fn<() => Promise<Result<SyncResult>>>().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({ok:true,value:unchanged});
  const policy=createAutoSyncPolicy({run,supported:()=>true,busy:()=>false,onChanged:()=>{},now:()=>now});
  policy.trigger(); now=5_000; finish({ok:true,value:unchanged}); await policy.settled();
  now=600_001; expect(policy.trigger()).toBe(false);
  now=605_000; expect(policy.trigger()).toBe(true); await policy.settled();
  expect(run).toHaveBeenNthCalledWith(2,false);
  policy.reset(); expect(policy.trigger()).toBe(true); await policy.settled(); expect(run).toHaveBeenNthCalledWith(3,true);
});
it('workflow bookkeeping releases synchronous failures and ignores unknown reads', async () => {
  const {createWorkflowGate}=await import('../auto-sync'); const idle=vi.fn(),gate=createWorkflowGate(idle);
  gate.start(['future-read'])(); expect(gate.busy()).toBe(false); expect(idle).not.toHaveBeenCalled();
  const finish=gate.start(['eval']); expect(gate.busy()).toBe(true);
  try { throw new Error('synchronous preparation error'); } catch { finish(); } // Simulate run's error cleanup.
  finish(); expect(gate.busy()).toBe(false); expect(idle).toHaveBeenCalledTimes(1);
});
