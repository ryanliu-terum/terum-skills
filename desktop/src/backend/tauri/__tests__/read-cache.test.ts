import type { Backend } from '../../Backend.js';
import type { ChangeSource, Run } from '../../types.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineEvent } from '../bridge';
import { createTauriBackend, READ_CACHE_TTL_MS } from '../index';
import { fakeBridge } from './fake-bridge';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const framesDirectory = resolve('../.planning/codex-runs/m7-S7g/frames');
const recorded = (name: string) => readFileSync(resolve(framesDirectory, `${name}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
/** `status` / `status --team` replay status.jsonl, `ls --local` replays ls-local.jsonl, `ls --team` replays ls.jsonl. */
function frames(args: readonly string[]) {
  const mutations: Record<string, unknown> = {
    install: [{ id: 'deploy-check', team: 'acme' }],
    'uninstall-skill': [{ id: 'deploy-check', team: 'acme', removed: 1 }],
    connect: { id: 'deploy-check', name: 'deploy-check' },
    profile: { handle: 'teddy', changed: ['display_name'] },
    publish: { name: 'deploy-check', branch: null, prUrl: null },
    sync: { placed: 1, deferred: [], notices: [], changed: true, teams: [] },
    eval: { name: 'deploy-check', runDir: '/runs/1', executionStatus: 'complete', commit: null },
    setup: { role: 'joiner', team: 'acme' },
    team: { team: 'acme' },
    uninstall: { teams: ['acme'], removedPlacements: 1, hookRemoved: true, wrapperRemoved: true, configRemoved: true, kept: [], record: '/backups/1', advice: [] },
  };
  if (args[0] && Object.hasOwn(mutations, args[0])) return [{ t: 'result', verb: args[0], ok: true, exitCode: 0, value: mutations[args[0]] }];
  if (args[0] === 'checkout') return [{ t: 'result', verb: 'checkout', ok: true, exitCode: 0, value: { path: args[3], registered: true } }];
  if (args[0] === 'status') return recorded('status');
  return recorded(args[1] === '--local' ? 'ls-local' : 'ls');
}

/** Every read verb replays a recording; `hold` keeps a verb open until released so concurrency can be observed. */
function bridge(options: { fail?: string[]; hold?: string; ask?: string; holdAfter?: number; mutate?: (frame: Record<string, unknown>, occurrence: number, verb: string) => void } = {}) {
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const counts = new Map<string, number>();
  const f = fakeBridge(async (args, emit) => {
    const verb = args.join(' ');
    const occurrence = (counts.get(verb) ?? 0) + 1; counts.set(verb, occurrence);
    if (options.hold === verb && occurrence > (options.holdAfter ?? 0)) await held;
    const ok = !(options.fail ?? []).includes(verb);
    for (const frame of frames(args)) {
      options.mutate?.(frame, occurrence, verb);
      if (frame.t === 'result') {
        if (options.ask === verb) { emit({ kind: 'stdout', line: JSON.stringify({ t: 'ask', id: 'q1', kind: 'confirm', question: 'Really?' }) }); return; }
        emit({ kind: 'stdout', line: JSON.stringify({ t: 'print', level: 'info', line: `ran ${verb}` }) });
        if (!ok) Object.assign(frame, { ok: false, exitCode: 1, error: `${verb} failed.` });
      }
      emit({ kind: 'stdout', line: JSON.stringify(frame) });
    }
    emit({ kind: 'exit', code: ok ? 0 : 1 } as LineEvent);
  });
  return { ...f, release: () => release?.() };
}
const argv = (f: ReturnType<typeof bridge>) => f.spawns.map(s => s.args.join(' '));

describe('read cache (BUGS.md L18/M24: one CLI process per read verb per render)', () => {
  it('a render burst shares one status and one ls --local across status, settings and the Library', async () => {
    const f = bridge(); const backend = createTauriBackend(f.bridge);
    const [a, b, c] = await Promise.all([backend.status(), backend.settings(), backend.library({ scope: { kind: 'global' }, team: 'acme' })]);
    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(argv(f).sort()).toEqual(['ls --local', 'ls --team acme', 'status', 'status --team acme']);
    // Sequential reads inside the window spawn nothing new.
    expect((await backend.status()).ok).toBe(true);
    expect((await backend.library({ scope: { kind: 'global' }, team: 'acme' })).ok).toBe(true);
    expect(f.spawns).toHaveLength(4);
  });

  it('expires after the TTL and re-reads', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = bridge(); const backend = createTauriBackend(f.bridge);
    await backend.status(); await backend.status();
    expect(argv(f)).toEqual(['status', 'ls --local']);
    vi.setSystemTime(Date.now() + READ_CACHE_TTL_MS + 1);
    await backend.status();
    expect(argv(f)).toEqual(['status', 'ls --local', 'status', 'ls --local']);
  });

  it('a mutation clears it, so the next read sees the change', async () => {
    const f = bridge(); const backend = createTauriBackend(f.bridge);
    await backend.status();
    await backend.checkouts.add('/work/x').done;
    await backend.status();
    expect(argv(f)).toEqual(['status', 'ls --local', 'checkout add -- /work/x', 'status', 'ls --local']);
  });

  it('window focus serves the cached value and refreshes it behind the screen', async () => {
    const f = bridge({hold:'status',holdAfter:1}); const backend = createTauriBackend(f.bridge);
    const before=await backend.status(); window.dispatchEvent(new Event('focus'));
    expect(await backend.status()).toEqual(before);
    await vi.waitFor(()=>expect(argv(f).filter(v=>v==='status')).toHaveLength(2));
    f.release();
  });

  it('a failed read is not kept: the next call retries', async () => {
    const f = bridge({ fail: ['status'] }); const backend = createTauriBackend(f.bridge);
    expect((await backend.status()).ok).toBe(false);
    expect((await backend.status()).ok).toBe(false);
    expect(argv(f).filter(v => v === 'status')).toHaveLength(2);
  });

  it('one caller aborting does not cancel the shared process for the other', async () => {
    const f = bridge({ hold: 'status' }); const backend = createTauriBackend(f.bridge);
    const controller = new AbortController();
    const aborted = backend.status(undefined, { signal: controller.signal });
    const kept = backend.status();
    await vi.waitFor(() => expect(f.spawns.length).toBeGreaterThanOrEqual(1));
    controller.abort();
    expect(await aborted).toEqual({ ok: false, error: 'Cancelled.' });
    f.release();
    expect((await kept).ok).toBe(true);
    expect(f.kills).toEqual([]);
    expect(argv(f).filter(v => v === 'status')).toHaveLength(1);
  });

  it('an already-aborted read spawns nothing and touches nothing', async () => {
    const f = bridge(); const backend = createTauriBackend(f.bridge);
    const controller = new AbortController(); controller.abort();
    expect(await backend.status(undefined, { signal: controller.signal })).toEqual({ ok: false, error: 'Cancelled.' });
    expect(f.spawns).toHaveLength(0);
  });

  it('a question during a shared read fails every caller and is not kept', async () => {
    const f = bridge({ ask: 'status' }); const backend = createTauriBackend(f.bridge);
    const [a, b] = await Promise.all([backend.status(), backend.status()]);
    expect(a).toMatchObject({ ok: false, error: expect.stringContaining('asked "Really?" during a read-only call') });
    expect(b).toMatchObject({ ok: false, error: expect.stringContaining('asked "Really?"') });
    await backend.status();
    expect(argv(f).filter(v => v === 'status')).toHaveLength(2);
  });

  it('print lines of a shared read reach every caller (eval-report needs them)', async () => {
    const f = bridge({ fail: ['ls --local'] }); const backend = createTauriBackend(f.bridge);
    const [a, b] = await Promise.all([backend.status(), backend.settings()]);
    expect(a).toMatchObject({ ok: false, error: expect.stringContaining('ran ls --local') });
    expect(b).toMatchObject({ ok: false, error: expect.stringContaining('ran ls --local') });
  });
});


describe('W-02 stale revalidation',()=>{
  it('notifies subscribers exactly once when the refreshed value differs',async()=>{
    const f=bridge({mutate:(frame,n,verb)=>{if(n>1&&verb==='status'&&frame.t==='result'){const value=frame.value as {version:string};value.version='9.9.9';}}});const backend=createTauriBackend(f.bridge);const listener=vi.fn();backend.subscribe(listener);
    await backend.status();window.dispatchEvent(new Event('focus'));await backend.status();await vi.waitFor(()=>expect(listener).toHaveBeenCalledExactlyOnceWith('config'));
    const count=f.spawns.length;await backend.status();expect(f.spawns).toHaveLength(count);
  });
  it('does not notify when only print lines differ',async()=>{
    const f=bridge({mutate:(frame,n)=>{if(frame.t==='print')frame.line=`different prose ${n}`;}});const backend=createTauriBackend(f.bridge);const listener=vi.fn();backend.subscribe(listener);
    await backend.status();window.dispatchEvent(new Event('focus'));await backend.status();await vi.waitFor(()=>expect(f.spawns).toHaveLength(4));await new Promise(resolve=>setTimeout(resolve,10));expect(listener).not.toHaveBeenCalled();
  });
  it('drops the entry and notifies when the background refresh fails',async()=>{
    const f=bridge({mutate:(frame,n,verb)=>{if(n>1&&verb==='status'&&frame.t==='result')Object.assign(frame,{ok:false,exitCode:1,error:'CLI denied the read.'});}});const backend=createTauriBackend(f.bridge);const listener=vi.fn();backend.subscribe(listener);
    const before=await backend.status();window.dispatchEvent(new Event('focus'));expect(await backend.status()).toEqual(before);await vi.waitFor(()=>expect(listener).toHaveBeenCalledExactlyOnceWith('config'));
    expect(await backend.status()).toMatchObject({ok:false,error:expect.stringContaining('CLI denied the read.')});expect(argv(f).filter(v=>v==='status')).toHaveLength(3);
  });
  it('refreshLaunch marks stale instead of clearing',async()=>{
    const f=bridge({hold:'status',holdAfter:1});const backend=createTauriBackend(f.bridge);const before=await backend.status();await backend.refreshLaunch();expect(await backend.status()).toEqual(before);await vi.waitFor(()=>expect(argv(f).filter(v=>v==='status')).toHaveLength(2));f.release();
  });
  it('only one refresh runs while a stale entry is being revalidated',async()=>{
    const f=bridge({hold:'status',holdAfter:1});const backend=createTauriBackend(f.bridge);await backend.status();window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'));await Promise.all([backend.status(),backend.status(),backend.status()]);await vi.waitFor(()=>expect(argv(f).filter(v=>v==='status')).toHaveLength(2));f.release();
  });
  it('a mutation cannot be overwritten by an older background refresh',async()=>{
    const f=bridge({hold:'status',holdAfter:1});const backend=createTauriBackend(f.bridge);await backend.status();window.dispatchEvent(new Event('focus'));await backend.status();await vi.waitFor(()=>expect(argv(f).filter(v=>v==='status')).toHaveLength(2));await backend.checkouts.add('/work/new').done;f.release();await backend.status();expect(argv(f).filter(v=>v==='status')).toHaveLength(3);
  });
});


/** Audit regressions assert the public notification as well as spawn argv: blanket clearing alone
 * would hide an omitted family, but could not satisfy these subscription assertions. */
describe('mutation write-family audit', () => {
  const cases: { verb: string; run: (backend: Backend) => Run<unknown>; sources: ChangeSource[] }[] = [
    { verb: 'install', run: backend => backend.install({ ref: 'deploy-check' }), sources: ['config', 'placed', 'clone'] },
    { verb: 'uninstall-skill', run: backend => backend.uninstallSkill({ ref: 'deploy-check' }), sources: ['config', 'placed', 'clone'] },
    { verb: 'connect', run: backend => backend.connect({ path: '/work/deploy-check' }), sources: ['config', 'clone', 'placed'] },
    { verb: 'profile', run: backend => backend.profile({ name: 'New name' }), sources: ['config', 'clone'] },
    { verb: 'publish', run: backend => backend.publish({ ref: 'deploy-check' }), sources: ['config', 'clone'] },
    { verb: 'sync', run: backend => backend.sync({}), sources: ['config', 'clone', 'placed', 'stamp'] },
    { verb: 'eval', run: backend => backend.eval({ ref: 'deploy-check', commit: true }), sources: ['config', 'clone', 'placed'] },
  ];
  it.each(cases)('$verb notifies every family its CLI can write', async ({ run, sources }) => {
    const f = bridge(); const backend = createTauriBackend(f.bridge); const listener = vi.fn();
    backend.subscribe(listener);
    expect((await run(backend).done).ok).toBe(true);
    expect(listener.mock.calls.map(([source]) => source)).toEqual(sources);
  });
  it.each(cases)('$verb also invalidates after a partial failure carrying a result', async ({ verb, run, sources }) => {
    const f = bridge({ mutate: (frame, _n, argv) => {
      if (argv.split(' ')[0] === verb && frame.t === 'result') Object.assign(frame, { ok: false, exitCode: 1, error: 'Partial write.' });
    } });
    const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
    expect(await run(backend).done).toMatchObject({ ok: false, error: 'Partial write.' });
    expect(listener.mock.calls.map(([source]) => source)).toEqual(sources);
  });
  it.each(['install', 'setup', 'team', 'uninstall'] as const)('%s drops all three cached families, each re-read exactly once', async verb => {
    const f = bridge(); const backend = createTauriBackend(f.bridge);
    const read = () => Promise.all([backend.status(), backend.library({ scope: { kind: 'global' }, team: 'acme' })]);
    expect((await read()).every(value => value.ok)).toBe(true);
    const before = f.spawns.length;
    const job = verb === 'install' ? backend.install({ ref: 'deploy-check' }) : verb === 'setup' ? backend.setup({}) : verb === 'team' ? backend.team({ kind: 'join', remote: 'acme/skills' }) : backend.uninstallMachine({});
    expect((await job.done).ok).toBe(true);
    expect((await read()).every(value => value.ok)).toBe(true);
    expect(argv(f).slice(before + 1).sort()).toEqual(['ls --local', 'ls --team acme', 'status', 'status --team acme']);
    const after = f.spawns.length; await read(); expect(f.spawns).toHaveLength(after);
  });
});


it('automatic sync broadcasts config changes alongside clone, placement and stamp changes', async () => {
  const f = bridge({ mutate: frame => {
    if (frame.t === 'hello') (frame.features as Record<string, unknown>).autoSync = true;
  } });
  const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
  await backend.status();
  await vi.waitFor(() => expect(listener.mock.calls.map(([source]) => source)).toEqual(['config', 'clone', 'placed', 'stamp']));
  expect(argv(f).filter(value => value.startsWith('sync '))).toEqual(['sync --auto --fresh-ms 600000']);
});
