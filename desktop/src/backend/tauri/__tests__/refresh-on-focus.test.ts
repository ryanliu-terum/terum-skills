import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Window as NativeWindow } from '@tauri-apps/api/window';
import { createTauriBackend, READ_CACHE_TTL_MS } from '../index';
import { REFRESH_MIN_INTERVAL_MS } from '../refresh';
import { fakeBridge } from './fake-bridge';

// Mock the module boundary: native ESM exports cannot be spied on or redefined.
const currentWindow = vi.hoisted(() => vi.fn<() => Pick<NativeWindow, 'onFocusChanged'> | undefined>());
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: currentWindow }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); currentWindow.mockReset(); });
const recorded = (name: string) => readFileSync(resolve('../.planning/codex-runs/m7-S7g/frames', `${name}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
function fixture(options: { supported?: boolean; changed?: boolean; hold?: 'refresh' | 'status'; noHello?: boolean; laterHello?: boolean; failure?: boolean; ask?: boolean; invalid?: boolean } = {}) {
  let release!: () => void;
  let finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const refreshed = new Promise<void>(resolve => { finished = resolve; });
  let hellos = 0;
  const f = fakeBridge(async (args, emit) => {
    if (options.noHello) { emit({ kind: 'exit', code: 1 }); return; }
    const supported = options.laterHello ? hellos++ > 0 : options.supported !== false;
    emit({ kind: 'stdout', line: JSON.stringify({ t: 'hello', protocol: 1, verbs: [], features: supported ? { refresh: true } : {} }) });
    if (options.hold === args[0]) await held;
    if (args[0] === 'refresh') {
      if (options.ask) { emit({ kind: 'stdout', line: JSON.stringify({ t: 'ask', id: 'q1', kind: 'confirm', question: 'Refresh?' }) }); finished(); return; }
      const changed = options.changed ?? false;
      emit({ kind: 'stdout', line: JSON.stringify({ t: 'result', verb: 'refresh', ok: !options.failure, exitCode: options.failure ? 1 : 0, ...(options.failure ? { error: 'refresh failed' } : { value: options.invalid ? { changed: 'yes' } : { changed, teams: [{ team: 'acme', state: 'refreshed', changed, head: 'a'.repeat(40) }] } }) }) });
      emit({ kind: 'exit', code: options.failure ? 1 : 0 }); finished(); return;
    }
    for (const frame of recorded(args[0] === 'status' ? 'status' : 'ls-local')) if (frame.t !== 'hello') emit({ kind: 'stdout', line: JSON.stringify(frame) });
    emit({ kind: 'exit', code: 0 });
  });
  return { ...f, release, refreshed };
}
const refreshes = (f: ReturnType<typeof fixture>) => f.spawns.filter(s => s.args.join(' ') === 'refresh');
const focus = () => window.dispatchEvent(new Event('focus'));
/** Flush the finite frame/read/policy promise chain without a clock-driven wait. */
async function drain() { for (let i = 0; i < 50; i++) await Promise.resolve(); }
async function launch(f: ReturnType<typeof fixture>) {
  const backend = createTauriBackend(f.bridge);
  expect((await backend.status()).ok).toBe(true);
  await f.refreshed; await drain();
  return backend;
}

describe('adapter background refresh', () => {
  it('runs refresh once when the first hello reports the feature', async () => {
    const f = fixture(); await launch(f);
    await vi.waitFor(() => expect(refreshes(f)).toHaveLength(1));
  });
  it('does not invalidate reads when no clone moved', async () => {
    const f = fixture(); const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
    await backend.status(); await f.refreshed; await drain(); expect(listener).not.toHaveBeenCalled();
  });
  it('invalidates with clone only when a clone moved', async () => {
    const f = fixture({ changed: true }); const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
    await backend.status(); await vi.waitFor(() => expect(listener).toHaveBeenCalledExactlyOnceWith('clone'));
    await backend.status(); expect(f.spawns.filter(s => s.args[0] === 'status')).toHaveLength(2);
  });
  it('throttles: three focus events inside the interval spawn one refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(); await launch(f);
    focus(); focus(); focus(); await drain(); expect(refreshes(f)).toHaveLength(1);
  });
  it('refreshes again after the interval', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(); await launch(f);
    vi.setSystemTime(Date.now() + REFRESH_MIN_INTERVAL_MS + 1); focus();
    await vi.waitFor(() => expect(refreshes(f)).toHaveLength(2)); await drain();
  });
  it('is single-flight: a focus while a refresh is in flight spawns nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture({ hold: 'refresh' }); const backend = createTauriBackend(f.bridge);
    await backend.status(); await vi.waitFor(() => expect(refreshes(f)).toHaveLength(1));
    try { vi.setSystemTime(Date.now() + REFRESH_MIN_INTERVAL_MS + 1); focus(); await drain(); expect(refreshes(f)).toHaveLength(1); }
    finally { f.release(); await f.refreshed; await drain(); }
  });
  it('a CLI without the refresh feature never spawns refresh, at launch or on focus', async () => {
    const f = fixture({ supported: false }); const backend = createTauriBackend(f.bridge);
    expect((await backend.status()).ok).toBe(true); focus(); await drain(); expect(refreshes(f)).toHaveLength(0);
  });
  it('a CLI that emits no hello at all never spawns refresh', async () => {
    const f = fixture({ noHello: true }); const backend = createTauriBackend(f.bridge);
    expect((await backend.status()).ok).toBe(false); focus(); await drain(); expect(refreshes(f)).toHaveLength(0);
  });
  it('the launch trigger fires on the first hello only, never on a later verb hello', async () => {
    const f = fixture({ laterHello: true }); const backend = createTauriBackend(f.bridge);
    await backend.status(); await drain();
    expect(f.spawns.length).toBeGreaterThanOrEqual(2); expect(refreshes(f)).toHaveLength(0);
    expect((await backend.features()).refresh).toBe(true);
  });
  it('a failing refresh is silent and non-fatal', async () => {
    const f = fixture({ failure: true }); const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
    await backend.status(); await f.refreshed; await drain(); expect(listener).not.toHaveBeenCalled(); expect((await backend.status()).ok).toBe(true);
  });
  it('a refresh that asks a question is cancelled, never answered', async () => {
    const f = fixture({ ask: true }); const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
    await backend.status(); await vi.waitFor(() => expect(f.kills.length).toBeGreaterThan(0)); await drain();
    expect(f.writes.filter(line => line.includes('"t":"answer"'))).toEqual([]); expect(listener).not.toHaveBeenCalled();
  });
  it('a refresh whose result does not match the schema is a silent failure', async () => {
    const f = fixture({ invalid: true }); const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
    await backend.status(); await f.refreshed; await drain(); expect(listener).not.toHaveBeenCalled(); expect((await backend.status()).ok).toBe(true);
  });
  it('notify waits for the reads that were in flight when the refresh finished', async () => {
    const f = fixture({ changed: true, hold: 'status' }); const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
    const status = backend.status();
    try { await f.refreshed; await drain(); expect(refreshes(f)).toHaveLength(1); expect(listener).not.toHaveBeenCalled(); }
    finally { f.release(); }
    expect((await status).ok).toBe(true); await vi.waitFor(() => expect(listener).toHaveBeenCalledExactlyOnceWith('clone'));
  });
  it('a retired backend instance never spawns on a later focus event', async () => {
    // This lifecycle test necessarily constructs two instances, unlike every other test in this file.
    vi.useFakeTimers({ toFake: ['Date'] }); const a = fixture(); await launch(a);
    const b = fixture(); await launch(b); vi.setSystemTime(Date.now() + REFRESH_MIN_INTERVAL_MS + 1); focus();
    await vi.waitFor(() => expect(refreshes(b)).toHaveLength(2)); expect(refreshes(a)).toHaveLength(1); await drain();
  });
  it('refreshLaunch clears the throttle so the next focus refreshes immediately', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(); const backend = await launch(f);
    await backend.refreshLaunch(); await drain(); expect(refreshes(f)).toHaveLength(1); focus();
    await vi.waitFor(() => expect(refreshes(f)).toHaveLength(2)); await drain();
  });
  it('the refresh run is not memoised: it never enters the read cache', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const f = fixture(); const backend = await launch(f);
    vi.setSystemTime(Date.now() + READ_CACHE_TTL_MS - 1); await backend.refreshLaunch(); focus();
    await vi.waitFor(() => expect(refreshes(f)).toHaveLength(2)); await drain();
  });
});

/** Only the subscription method is exercised; the fake window deliberately has no native IPC capabilities. */
function nativeFocus() {
  type Handler = Parameters<NativeWindow['onFocusChanged']>[0];
  const handlers: Handler[] = [];
  const stop = vi.fn();
  const onFocusChanged = vi.fn<NativeWindow['onFocusChanged']>().mockImplementation(async handler => { handlers.push(handler); return stop; });
  currentWindow.mockReturnValue({ onFocusChanged });
  return { handlers, stop, onFocusChanged, emit: (payload: boolean, index = 0) => handlers[index]!({ event: 'tauri://focus', id: index, payload }) };
}
it('native focus refreshes only when focused and shares the DOM throttle', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const native = nativeFocus(); const f = fixture(); await launch(f);
  vi.setSystemTime(Date.now() + REFRESH_MIN_INTERVAL_MS); native.emit(false); await drain(); expect(refreshes(f)).toHaveLength(1);
  native.emit(true); focus(); await vi.waitFor(() => expect(refreshes(f)).toHaveLength(2)); await drain();
});
it('a late native subscription is unlistened when its backend was retired', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const native = nativeFocus(); let ready!: (stop: () => void) => void;
  native.onFocusChanged.mockImplementationOnce(handler => { native.handlers.push(handler); return new Promise(resolve => { ready = resolve; }); });
  const a = fixture(); await launch(a); const b = fixture(); await launch(b);
  ready(native.stop); await drain(); expect(native.stop).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + REFRESH_MIN_INTERVAL_MS); native.emit(true, 0); await drain(); expect(refreshes(a)).toHaveLength(1);
  native.emit(true, 1); await vi.waitFor(() => expect(refreshes(b)).toHaveLength(2)); await drain();
});
it('native subscription rejection leaves the DOM focus fallback working', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); const native = nativeFocus(); native.onFocusChanged.mockRejectedValueOnce(new Error('no native IPC'));
  const f = fixture(); await launch(f); vi.setSystemTime(Date.now() + REFRESH_MIN_INTERVAL_MS); focus();
  await vi.waitFor(() => expect(refreshes(f)).toHaveLength(2)); await drain();
});

it('autoSync replaces refresh at launch/focus, preserves timing data and invalidates sync keys', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const f = fakeBridge((args, emit) => {
    emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,verbs:[],features:{refresh:true,autoSync:true}})});
    if (args[0] === 'sync') emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'sync',ok:true,exitCode:0,value:{changed:true,placed:1,deferred:[],notices:[],teams:[],timings:[{team:'team',phase:'fetch',ms:2}]}})});
    else for (const frame of recorded(args[0] === 'status' ? 'status' : 'ls-local')) if(frame.t!=='hello')emit({kind:'stdout',line:JSON.stringify(frame)});
    emit({kind:'exit',code:0});
  });
  const backend=createTauriBackend(f.bridge), listener=vi.fn(); backend.subscribe(listener);
  await backend.status(); await drain();
  const syncs=()=>f.spawns.filter(spawn=>spawn.args[0]==='sync');
  expect(syncs()).toHaveLength(1); expect(syncs()[0]?.args).toEqual(['sync','--auto','--fresh-ms','600000']);
  expect(f.spawns.some(spawn=>spawn.args[0]==='refresh')).toBe(false);
  expect(listener.mock.calls.map(([key]) => key)).toEqual(['config','clone','placed','stamp']);
  focus(); focus(); await drain(); expect(syncs()).toHaveLength(1);
  vi.setSystemTime(Date.now()+600_000); await drain(); expect(syncs()).toHaveLength(1);
  focus(); await drain(); expect(syncs()).toHaveLength(2);
  await backend.refreshLaunch(); focus(); await drain(); expect(syncs()).toHaveLength(2);
  const stop = backend.onLaunchRequest(() => { void backend.refreshLaunch(); }); await drain();
  f.reopen(); await drain(); expect(syncs()).toHaveLength(3);
  expect(syncs()[2]?.args).toEqual(['sync','--auto','--fresh-ms','0']); stop();
});

it('automatic sync does not answer an unexpected CLI question and exposes the failure through settings', async () => {
  const f=fakeBridge((args,emit)=>{
    emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,verbs:[],features:{autoSync:true}})});
    if(args[0]==='sync'){emit({kind:'stdout',line:JSON.stringify({t:'ask',id:'unexpected',kind:'confirm',question:'Approve tools?'})});return;}
    for(const frame of recorded(args[0]==='status'?'status':'ls-local'))if(frame.t!=='hello')emit({kind:'stdout',line:JSON.stringify(frame)});
    emit({kind:'exit',code:0});
  });
  const backend=createTauriBackend(f.bridge); await backend.status(); await drain();
  expect(f.kills.length).toBeGreaterThan(0); expect(f.writes.some(line=>line.includes('"t":"answer"'))).toBe(false);
  const settings=await backend.settings(); expect(settings.value?.lastAutomatic?.state).toBe('failed');
});

it('defers the first hello launch sync until its workflow settles, without needing focus', async () => {
  let finish!:()=>void;
  const held=new Promise<void>(resolve=>{finish=resolve;});
  const f=fakeBridge(async(args,emit)=>{
    emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,verbs:[],features:{autoSync:true}})});
    if(args[0]==='sync')emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'sync',ok:true,exitCode:0,value:{changed:false,placed:0,deferred:[],notices:[],teams:[],timings:[{team:'team',phase:'place',ms:3}]}})});
    else {await held;emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'validate',ok:false,exitCode:1,error:'Validation failed'})});}
    emit({kind:'exit',code:args[0]==='sync'?0:1});
  });
  const backend=createTauriBackend(f.bridge);
  const workflow=backend.validate({ref:'team/sample'});await drain();focus();await drain();
  expect(f.spawns.map(spawn=>spawn.args[0])).toEqual(['validate']);
  finish();await workflow;await drain();
  expect(f.spawns.map(spawn=>spawn.args[0])).toEqual(['validate','sync']);
  const result=await backend.sync({auto:true}).done;
  expect(result.value?.timings).toEqual([{team:'team',phase:'place',ms:3}]);
});

it('manual sync waits for automatic completion and a cancelled queued sync never spawns', async () => {
  let finish!:()=>void; const held=new Promise<void>(resolve=>{finish=resolve;});
  const f=fakeBridge(async(args,emit)=>{
    emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,verbs:[],features:{autoSync:true}})});
    if(args[0]==='sync') {
      if(args.includes('--auto')) await held;
      emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'sync',ok:true,exitCode:0,value:{changed:false,placed:0,deferred:[],notices:[],teams:[]}})});
    } else for(const frame of recorded('status')) if(frame.t!=='hello')emit({kind:'stdout',line:JSON.stringify(frame)});
    emit({kind:'exit',code:0});
  });
  const backend=createTauriBackend(f.bridge); await backend.status(); await drain();
  const cancelled=backend.sync({}); const cancellation=cancelled.cancel();
  const manual=backend.sync({}); await drain(); expect(f.spawns.filter(s=>s.args[0]==='sync')).toHaveLength(1);
  finish(); await cancellation; expect(await cancelled.done).toMatchObject({ok:false,cancelled:true});
  expect(await manual.done).toMatchObject({ok:true});
  expect(f.spawns.filter(s=>s.args[0]==='sync').map(s=>s.args)).toEqual([['sync','--auto','--fresh-ms','600000'],['sync']]);
});
it('an unchanged automatic sync preserves cached reads and emits no invalidation wave', async () => {
  const f=fakeBridge((args,emit)=>{
    emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,verbs:[],features:{autoSync:true}})});
    if(args[0]==='sync')emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'sync',ok:true,exitCode:0,value:{changed:false,placed:0,deferred:[],notices:[],teams:[]}})});
    else for(const frame of recorded('status'))if(frame.t!=='hello')emit({kind:'stdout',line:JSON.stringify(frame)});
    emit({kind:'exit',code:0});
  });
  const backend=createTauriBackend(f.bridge),listener=vi.fn(); backend.subscribe(listener);
  await backend.status(); await drain(); await backend.status();
  expect(listener).not.toHaveBeenCalled(); expect(f.spawns.filter(s=>s.args[0]==='status')).toHaveLength(1);
});
