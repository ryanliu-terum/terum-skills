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
  if (args[0] === 'checkout') return [{ t: 'result', verb: 'checkout', ok: true, exitCode: 0, value: { path: args[3], registered: true } }];
  if (args[0] === 'status') return recorded('status');
  return recorded(args[1] === '--local' ? 'ls-local' : 'ls');
}

/** Every read verb replays a recording; `hold` keeps a verb open until released so concurrency can be observed. */
function bridge(options: { fail?: string[]; hold?: string; ask?: string } = {}) {
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const f = fakeBridge(async (args, emit) => {
    const verb = args.join(' ');
    if (options.hold === verb) await held;
    const ok = !(options.fail ?? []).includes(verb);
    for (const frame of frames(args)) {
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

  it('window focus clears it (a change made in a terminal shows on the next look)', async () => {
    const f = bridge(); const backend = createTauriBackend(f.bridge);
    await backend.status();
    window.dispatchEvent(new Event('focus'));
    await backend.status();
    expect(f.spawns).toHaveLength(4);
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
