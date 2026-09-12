import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVE_READ_VERBS } from '../../../../../src/lib/frames.js';
import type { Run } from '../../types.js';
import type { AppState, LineEvent } from '../bridge.js';
import { createReadSession } from '../session.js';
import { cliRun } from '../run.js';
import { createTauriBackend, read } from '../index.js';
import { fakeBridge, STATE } from './fake-bridge.js';

const hello = { t: 'hello' as const, protocol: 1, version: STATE.version, verbs: ['serve', ...SERVE_READ_VERBS], features: { serve: true } };
const stdout = (frame: object): LineEvent => ({ kind: 'stdout', line: JSON.stringify(frame) });
async function consume(job: Run<unknown>) { const lines: string[] = []; return { result: await read(job, undefined, lines), lines }; }
type Request = { t: string; id: string; argv: string[]; cwd?: string };
function fixture(options: { advertised?: boolean; silent?: boolean; onRequest?: (request: Request, emit: (e: LineEvent) => void) => void } = {}) {
  let state: AppState = { ...STATE };
  const events = new Map<string, (e: LineEvent) => void>();
  const f = fakeBridge((argv, emit) => {
    if (argv[0] === 'serve') { if (!options.silent) emit(stdout(hello)); }
    else { emit(stdout({ ...hello, features: { serve: options.advertised !== false } })); emit(stdout({ t: 'result', verb: argv[0], ok: true, value: argv })); emit({ kind: 'exit', code: 0 }); }
  });
  const spawn = f.bridge.spawn;
  f.bridge.spawn = async (id, at, argv, cwd, emit) => { events.set(id, emit); return spawn(id, at, argv, cwd, emit); };
  f.bridge.readAppState = async () => state;
  const write = f.bridge.write;
  const requests: Request[] = [];
  f.bridge.write = async (id, line) => {
    await write(id, line);
    const request = JSON.parse(line) as Request;
    if (request.t !== 'request') return;
    requests.push(request);
    const emit = events.get(id)!;
    if (options.onRequest) options.onRequest(request, emit);
    else { emit(stdout({ t: 'print', id: request.id, level: 'info', line: 'read' })); emit(stdout({ t: 'result', id: request.id, verb: request.argv[0], ok: true, value: request.argv })); }
  };
  // Track each child independently, including an old child's delayed events after retirement.
  f.bridge.kill = async id => { f.kills.push(id); events.get(id)?.({ kind: 'exit', code: null }); };
  const session = createReadSession(f.bridge, { state: () => f.bridge.readAppState(), read: consume, helloTimeoutMs: 1000 });
  session.observe({ ...hello, features: { serve: options.advertised !== false } });
  async function query(argv: string[], cwd?: string) {
    return await session.request(argv, cwd) ?? consume(cliRun(f.bridge, f.bridge.readAppState(), argv, { cwd, map: value => value }));
  }
  return { ...f, session, requests, query, events, setState: (next: AppState) => { state = next; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('desktop read session', () => {
  it('is lazy and reuses one child across two different read argvs', async () => {
    const f = fixture(); expect(f.spawns).toEqual([]);
    expect(await f.query(['status'], '/work/a')).toEqual({ result: { ok: true, value: ['status'] }, lines: ['read'] });
    expect(await f.query(['ls', '--local'], '/work/b')).toEqual({ result: { ok: true, value: ['ls', '--local'] }, lines: ['read'] });
    expect(f.spawns).toHaveLength(1); expect(f.spawns[0]?.args).toEqual(['serve']);
    expect(f.requests.map(request => request.cwd)).toEqual(['/work/a', '/work/b']);
    expect(new Set(f.requests.map(request => request.id)).size).toBe(2);
  });

  it('missing AppState fails once without re-reading state through fallback', async () => {
    const f = fixture();
    f.bridge.readAppState = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(STATE);
    expect((await f.query(['status'])).result).toMatchObject({ ok: false, error: expect.stringContaining('could not find where terum-skills is installed') });
    expect(f.bridge.readAppState).toHaveBeenCalledOnce();
    expect(f.spawns).toEqual([]);
    expect((await f.query(['status'])).result.ok).toBe(true);
  });

  it('an older CLI spawns each read exactly as before, with no serve probe', async () => {
    const f = fixture({ advertised: false });
    await f.query(['status']); await f.query(['ls']);
    expect(f.spawns.map(spawn => spawn.args)).toEqual([['status'], ['ls']]); expect(f.writes).toEqual([]);
  });

  it.each(['install', 'sync', 'eval', 'prune', 'publish', 'uninstall'])('%s never enters the shared session', async verb => {
    const f = fixture(); await f.query([verb]);
    expect(f.spawns.map(spawn => spawn.args)).toEqual([[verb]]);
  });

  it('routes simultaneous requests only by id and retains partial failure values and print lines', async () => {
    const f = fixture({ onRequest: () => undefined });
    const a = f.query(['status']), b = f.query(['ls']);
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    const emit = f.events.get(f.spawns[0]!.id)!;
    emit(stdout({ t: 'result', id: 'unknown', verb: 'status', ok: true, value: 'wrong' }));
    emit(stdout({ t: 'print', id: f.requests[1]!.id, level: 'warn', line: 'detail' }));
    emit(stdout({ t: 'result', id: f.requests[1]!.id, verb: 'ls', ok: false, error: 'denied', refused: true, value: { partial: true } }));
    emit(stdout({ t: 'result', id: f.requests[0]!.id, verb: 'status', ok: true, value: 'first' }));
    expect(await a).toEqual({ result: { ok: true, value: 'first' }, lines: [] });
    expect(await b).toEqual({ result: { ok: false, error: 'denied\nwarn: detail', refused: true, value: { partial: true } }, lines: ['warn: detail'] });
    expect(f.spawns).toHaveLength(1);
  });

  it('a child death fails all pending reads and the next read restarts once', async () => {
    const f = fixture({ onRequest: () => undefined });
    const a = f.query(['status']), b = f.query(['ls']);
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    f.emit({ kind: 'error', message: 'child pipe broke' });
    expect((await a).result).toEqual({ ok: false, error: 'child pipe broke' });
    expect((await b).result).toEqual({ ok: false, error: 'child pipe broke' });
    const retry = f.query(['search']);
    await vi.waitFor(() => expect(f.spawns).toHaveLength(2));
    await vi.waitFor(() => expect(f.requests).toHaveLength(3));
    f.emit(stdout({ t: 'result', id: f.requests[2]!.id, verb: 'search', ok: true, value: 'restarted' }));
    expect((await retry).result).toEqual({ ok: true, value: 'restarted' });
    expect(f.session.unavailableReason).toBeUndefined();
  });

  it('a second death disables the session permanently and subsequent reads fall back', async () => {
    const f = fixture({ onRequest: () => undefined });
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = f.query(['status']);
      await vi.waitFor(() => expect(f.requests).toHaveLength(attempt + 1));
      f.emit({ kind: 'exit', code: 9 });
      expect((await pending).result).toMatchObject({ ok: false, error: expect.stringContaining('code 9') });
    }
    expect(f.session.unavailableReason).toContain('code 9');
    await f.query(['ls']); await f.query(['search']);
    expect(f.spawns.map(spawn => spawn.args)).toEqual([['serve'], ['serve'], ['ls'], ['search']]);
    f.setState({ ...STATE, version: 'new' }); await f.query(['status']);
    expect(f.spawns.at(-1)?.args).toEqual(['status']);
  });

  it('a startup failure has one retry, then a recorded reason and one-shot fallback', async () => {
    const f = fixture();
    const spawn = f.bridge.spawn;
    f.bridge.spawn = async (...args) => { if (args[2][0] === 'serve') throw new Error('spawn denied'); return spawn(...args); };
    expect((await f.query(['status'])).result).toMatchObject({ ok: false, error: expect.stringContaining('spawn denied') });
    expect((await f.query(['ls'])).result).toMatchObject({ ok: false, error: expect.stringContaining('spawn denied') });
    expect(f.session.unavailableReason).toContain('spawn denied');
    await f.query(['search']); expect(f.spawns.at(-1)?.args).toEqual(['search']);
  });

  it('two missing hellos reach the startup deadline without a retry loop', async () => {
    vi.useFakeTimers(); const f = fixture({ silent: true });
    const a = f.query(['status']); await vi.advanceTimersByTimeAsync(1001);
    expect((await a).result).toMatchObject({ ok: false, error: expect.stringContaining('hello') });
    const b = f.query(['ls']); await vi.advanceTimersByTimeAsync(1001);
    expect((await b).result).toMatchObject({ ok: false, error: expect.stringContaining('hello') });
    expect(f.session.unavailableReason).toContain('startup deadline');
    expect(f.spawns).toHaveLength(2);
    await f.query(['search']); expect(f.spawns.at(-1)?.args).toEqual(['search']);
  });

  it('a session hello without serve falls back without sending a request', async () => {
    const f = fixture({ silent: true });
    const pending = f.query(['status']);
    await vi.waitFor(() => expect(f.spawns).toHaveLength(1));
    f.emit(stdout({ ...hello, features: {} }));
    expect((await pending).result).toEqual({ ok: true, value: ['status'] });
    await f.query(['ls']);
    expect(f.spawns.map(spawn => spawn.args)).toEqual([['serve'], ['status'], ['ls']]);
    expect(f.requests).toEqual([]);
  });

  it('waits for spawn admission before writing requests or retiring a failed child', async () => {
    const f = fixture();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const spawn = f.bridge.spawn;
    f.bridge.spawn = async (...args) => { const stop = await spawn(...args); await held; return stop; };
    const pending = f.query(['status']);
    await vi.waitFor(() => expect(f.spawns).toHaveLength(1));
    expect(f.writes).toEqual([]);
    f.emit({ kind: 'error', message: 'died during admission' });
    expect(f.kills).toEqual([]);
    release();
    expect((await pending).result).toMatchObject({ ok: false, error: expect.stringContaining('died during admission') });
    await vi.waitFor(() => expect(f.kills).toHaveLength(1));
    expect(f.writes).toEqual([]); expect(f.unlisten).toHaveBeenCalledOnce();
  });

  it.each(['entry', 'node', 'version'] as const)('changed AppState %s retires the old child and binds a new one', async field => {
    const f = fixture(); await f.query(['status']);
    const old = f.spawns[0]!.id;
    const state = { ...STATE, [field]: 'changed' };
    f.setState(state); f.session.bind(state); f.session.observe(hello);
    await f.query(['ls']);
    expect(f.kills).toEqual([old]); expect(f.spawns.map(spawn => spawn.args)).toEqual([['serve'], ['serve']]);
    // The retired child's late failure cannot poison its replacement.
    f.events.get(old)!({ kind: 'error', message: 'old late error' });
    expect(f.session.unavailableReason).toBeUndefined();
    await f.query(['search']); expect(f.spawns).toHaveLength(2);
  });

  it('a metadata-only AppState change does not retire the child', async () => {
    const f = fixture(); await f.query(['status']); f.setState({ ...STATE, writtenAt: 'later', path: '/new/path' });
    await f.query(['ls']); expect(f.spawns).toHaveLength(1); expect(f.kills).toEqual([]);
  });

  it('an unexpected read ask cancels only that request, preserving the session and siblings', async () => {
    const f = fixture({ onRequest: (request, emit) => {
      if (request.argv[0] === 'status') emit(stdout({ t: 'ask', id: request.id, kind: 'text', question: 'Name?' }));
      else emit(stdout({ t: 'result', id: request.id, verb: request.argv[0], ok: true, value: 'next' }));
    } });
    expect((await f.query(['status'])).result).toMatchObject({ ok: false, error: expect.stringContaining('asked "Name?"') });
    expect(f.writes.map(line => JSON.parse(line) as { t: string }).some(frame => frame.t === 'cancel')).toBe(true);
    expect((await f.query(['ls'])).result).toEqual({ ok: true, value: 'next' });
    expect(f.kills).toEqual([]); expect(f.spawns).toHaveLength(1);
  });

  it('a write failure fails the request and permits only the bounded restart', async () => {
    const f = fixture(); f.bridge.write = async () => { throw new Error('stdin closed'); };
    expect((await f.query(['status'])).result).toMatchObject({ ok: false, error: expect.stringContaining('stdin closed') });
    expect((await f.query(['ls'])).result).toMatchObject({ ok: false, error: expect.stringContaining('stdin closed') });
    expect(f.session.unavailableReason).toContain('stdin closed');
  });
});

it('adapter reads and stale revalidation reuse serve while old-CLI replay remains one-shot', async () => {
  const framesDirectory = resolve('../.planning/codex-runs/m7-S7g/frames');
  const transcript = (argv: readonly string[]) => {
    const file = argv[0] === 'status' ? 'status' : argv[1] === '--local' ? 'ls-local' : 'ls';
    return readFileSync(resolve(framesDirectory, `${file}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  };
  const f = fakeBridge((argv, emit) => {
    emit(stdout(hello));
    if (argv[0] !== 'serve') {
      for (const frame of transcript(argv)) if (frame.t !== 'hello') emit(stdout(frame));
      emit({ kind: 'exit', code: 0 });
    }
  });
  const requests: Request[] = [];
  f.bridge.write = async (_id, line) => {
    const request = JSON.parse(line) as Request;
    if (request.t !== 'request') return;
    requests.push(request);
    for (const frame of transcript(request.argv)) if (frame.t !== 'hello') f.emit(stdout({ ...frame, id: request.id }));
  };
  const backend = createTauriBackend(f.bridge);
  expect((await backend.status()).ok).toBe(true);
  window.dispatchEvent(new Event('focus'));
  expect((await backend.status()).ok).toBe(true);
  await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));
  expect(f.spawns.filter(spawn => spawn.args[0] === 'serve')).toHaveLength(1);
  const before = f.spawns.length;
  await backend.settings();
  expect(f.spawns).toHaveLength(before);
});
