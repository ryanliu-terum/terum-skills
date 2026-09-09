import { describe, expect, it, vi } from 'vitest';
import type { Frame } from '../../types';
import type { LineEvent } from '../bridge';
import { fakeBridge, STATE } from './fake-bridge';
import { parseCliFrame } from '../frames';
import { cliRun, NO_STATE } from '../run';
import { createTauriBackend } from '../index';

const line = (frame: object) => JSON.stringify(frame);
const hello = line({ t: 'hello', protocol: 1, version: '0.1.6', verbs: ['status'], features: {} });
async function collect(frames: AsyncIterable<Frame>) { const out: Frame[] = []; for await (const f of frames) out.push(f); return out; }

describe('parseCliFrame', () => {
  it('accepts the five frame kinds and rejects anything else', () => {
    expect(parseCliFrame(hello)?.t).toBe('hello');
    expect(parseCliFrame(line({ t: 'print', level: 'warn', line: 'x' }))).toEqual({ t: 'print', level: 'warn', line: 'x' });
    expect(parseCliFrame(line({ t: 'ask', id: 'q1', kind: 'select', question: 'Pick', choices: ['a', 'b'] }))).toEqual({ t: 'ask', id: 'q1', kind: 'select', question: 'Pick', choices: ['a', 'b'] });
    expect(parseCliFrame(line({ t: 'progress', step: 'clone', current: 2, total: 5 }))).toEqual({ t: 'progress', step: 'clone', current: 2, total: 5 });
    expect(parseCliFrame(line({ t: 'result', verb: 'status', ok: false, exitCode: 1, error: 'Connect was declined.', declined: true }))).toEqual({ t: 'result', verb: 'status', ok: false, exitCode: 1, error: 'Connect was declined.', declined: true });
    for (const bad of ['not json', '{}', line({ t: 'ask', id: 1 }), line({ t: 'print', line: 'no level' }), line({ t: 'nope' })]) expect(parseCliFrame(bad), bad).toBeNull();
  });
});

describe('cliRun — a CLI process as a seam Run<T>', () => {
  it('settles from result before exit and unlistens exactly once after exit', async () => {
    const f = fakeBridge(() => undefined);
    const map = vi.fn((value: unknown) => value);
    const onSettled = vi.fn();
    const run = cliRun(f.bridge, Promise.resolve(STATE), ['status'], { map, onSettled });
    await vi.waitFor(() => expect(f.spawns).toHaveLength(1));
    f.emit({ kind: 'stdout', line: line({ t: 'result', verb: 'status', ok: true, exitCode: 0, value: 'ready' }) });
    expect(await run.done).toEqual({ ok: true, value: 'ready' });
    expect(f.unlisten).not.toHaveBeenCalled();
    // Trailing stdout is diagnostic only, even if it looks like another result.
    f.emit({ kind: 'stdout', line: line({ t: 'result', verb: 'status', ok: false, exitCode: 1, error: 'late' }) });
    f.emit({ kind: 'stderr', line: 'late diagnostic' });
    f.emit({ kind: 'exit', code: 0 });
    f.emit({ kind: 'exit', code: 0 });
    expect(f.unlisten).toHaveBeenCalledTimes(1);
    expect(map).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: true, value: 'ready' });
    expect(await collect(run.frames)).toEqual([{ t: 'result', ok: true }]);
  });

  it('ignores a late result after exit without throwing or settling twice (the old race)', async () => {
    const f = fakeBridge(() => undefined);
    const map = vi.fn(() => { throw new Error('must not map a late result'); });
    const onSettled = vi.fn();
    const run = cliRun(f.bridge, Promise.resolve(STATE), ['status'], { map, onSettled });
    await vi.waitFor(() => expect(f.spawns).toHaveLength(1));
    f.emit({ kind: 'exit', code: 0 });
    const expected = { ok: false, error: 'terum-skills exited with code 0 before reporting a result.' };
    expect(await run.done).toEqual(expected);
    expect(() => f.emit({ kind: 'stdout', line: line({ t: 'result', verb: 'status', ok: true, exitCode: 0, value: 'late' }) })).not.toThrow();
    expect(await run.done).toEqual(expected);
    expect(map).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(expected);
    expect(await collect(run.frames)).toEqual([{ t: 'result', ...expected }]);
    expect(f.unlisten).toHaveBeenCalledTimes(1);
  });

  it('unlistens when spawn returns after result and exit already arrived', async () => {
    const f = fakeBridge((_args, emit) => {
      emit({ kind: 'stdout', line: line({ t: 'result', verb: 'status', ok: true, exitCode: 0, value: 'ready' }) });
      emit({ kind: 'exit', code: 0 });
    });
    const run = cliRun(f.bridge, Promise.resolve(STATE), ['status'], { map: (value) => value });
    expect(await run.done).toEqual({ ok: true, value: 'ready' });
    await vi.waitFor(() => expect(f.unlisten).toHaveBeenCalledTimes(1));
    await run.cancel();
    expect(f.unlisten).toHaveBeenCalledTimes(1);
  });

  it('maps hello/print/ask/progress/result to seam frames, forwards the answer, settles done with the mapped value', async () => {
    const { bridge, spawns, writes } = fakeBridge(async (_args, emit, w) => {
      emit({ kind: 'stdout', line: hello });
      emit({ kind: 'stdout', line: line({ t: 'print', level: 'info', line: 'Installing…' }) });
      emit({ kind: 'stdout', line: line({ t: 'print', level: 'warn', line: 'careful' }) });
      emit({ kind: 'stdout', line: line({ t: 'ask', id: 'q1', kind: 'confirm', question: 'Approve?' }) });
      while (!w.length) await new Promise((r) => setTimeout(r, 1));
      expect(JSON.parse(w[0]!)).toEqual({ t: 'answer', id: 'q1', value: true });
      emit({ kind: 'stdout', line: line({ t: 'progress', step: 'place', current: 1, total: 1 }) });
      emit({ kind: 'stderr', line: 'diagnostic noise' });
      emit({ kind: 'stdout', line: line({ t: 'result', verb: 'install', ok: true, exitCode: 0, value: [{ id: 'a', team: 't' }] }) });
      emit({ kind: 'exit', code: 0 });
    });
    const run = cliRun<{ id: string }[], string[]>(bridge, Promise.resolve(STATE), ['install', 'a'], { cwd: '/ws', map: (v) => v.map((x) => x.id) });
    const framesP = collect(run.frames);
    // answer the question when it appears
    for await (const f of run.frames) if (f.t === 'ask') run.answer(f.id, true);
    const frames = await framesP;
    expect(frames).toEqual([
      { t: 'print', line: 'Installing…' }, { t: 'print', line: 'warn: careful' },
      { t: 'ask', id: 'q1', kind: 'confirm', question: 'Approve?' },
      { t: 'progress', done: 1, total: 1, label: 'place' },
      { t: 'result', ok: true },
    ]);
    expect(await run.done).toEqual({ ok: true, value: ['a'] });
    expect(spawns).toEqual([{ id: expect.stringMatching(/^r\d+-/), args: ['install', 'a'], cwd: '/ws' }]);
    expect(writes).toHaveLength(1);
  });

  it('a failing result frame settles done with the CLI error and ends the frames with ok:false', async () => {
    const { bridge } = fakeBridge((_a, emit) => { emit({ kind: 'stdout', line: line({ t: 'result', verb: 'connect', ok: false, exitCode: 1, error: 'Connect was declined.', declined: true }) }); emit({ kind: 'exit', code: 1 }); });
    const run = cliRun(bridge, Promise.resolve(STATE), ['connect'], { map: (v) => v });
    expect(await collect(run.frames)).toEqual([{ t: 'result', ok: false, error: 'Connect was declined.', declined: true }]);
    expect(await run.done).toEqual({ ok: false, error: 'Connect was declined.', cancelled: true });
  });

  it('exit without a result is a failure that quotes the last stderr lines', async () => {
    const { bridge } = fakeBridge((_a, emit) => { emit({ kind: 'stderr', line: 'node: cannot find module' }); emit({ kind: 'exit', code: 1 }); });
    const run = cliRun(bridge, Promise.resolve(STATE), ['status'], { map: (v) => v });
    expect(await run.done).toEqual({ ok: false, error: expect.stringContaining('exited with code 1 before reporting a result. node: cannot find module') });
  });

  it('cancel writes a cancel frame, kills the process, and settles Cancelled', async () => {
    const { bridge, writes, kills, unlisten, emit } = fakeBridge((_a, emit) => { emit({ kind: 'stdout', line: line({ t: 'ask', id: 'q1', kind: 'text', question: 'Name' }) }); });
    const onSettled = vi.fn();
    const run = cliRun(bridge, Promise.resolve(STATE), ['setup'], { map: (v) => v, onSettled });
    for await (const f of run.frames) { if (f.t === 'ask') { await run.cancel(); } }
    expect(await run.done).toEqual({ ok: false, error: 'Cancelled.' });
    expect(writes.map((w) => JSON.parse(w))).toEqual([{ t: 'cancel' }]);
    expect(kills).toHaveLength(1);
    emit({ kind: 'exit', code: null });
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'Cancelled.' });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('keeps Cancelled when the CLI sends a result during graceful cancellation', async () => {
    const f = fakeBridge(() => undefined);
    f.bridge.kill = async () => {
      f.emit({ kind: 'stdout', line: line({ t: 'result', verb: 'setup', ok: true, exitCode: 0, value: 'stopped' }) });
    };
    const run = cliRun(f.bridge, Promise.resolve(STATE), ['setup'], { map: (value) => value });
    await vi.waitFor(() => expect(f.spawns).toHaveLength(1));
    await run.cancel();
    expect(await run.done).toEqual({ ok: false, error: 'Cancelled.' });
    expect(f.unlisten).toHaveBeenCalledTimes(1);
    f.emit({ kind: 'exit', code: 0 });
    expect(f.unlisten).toHaveBeenCalledTimes(1);
  });

  it('releases the listener once when cancellation finishes before spawn returns', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const f = fakeBridge(() => pending);
    const run = cliRun(f.bridge, Promise.resolve(STATE), ['setup'], { map: (value) => value });
    await vi.waitFor(() => expect(f.spawns).toHaveLength(1));
    await run.cancel();
    expect(await run.done).toEqual({ ok: false, error: 'Cancelled.' });
    expect(f.unlisten).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(f.unlisten).toHaveBeenCalledTimes(1));
    f.emit({ kind: 'exit', code: null });
    expect(f.unlisten).toHaveBeenCalledTimes(1);
  });

  it('without the app state file, nothing is spawned and the failure tells the person what to run', async () => {
    const { bridge, spawns } = fakeBridge(() => undefined, null);
    const run = cliRun(bridge, bridge.readAppState(), ['status'], { map: (v) => v });
    expect(await run.done).toEqual({ ok: false, error: NO_STATE });
    expect(spawns).toEqual([]);
  });

  it('a result the mapper cannot read is a failure, not a crash', async () => {
    const { bridge } = fakeBridge((_a, emit) => { emit({ kind: 'stdout', line: line({ t: 'result', verb: 'install', ok: true, exitCode: 0, value: 'garbage' }) }); });
    const run = cliRun<string[], number>(bridge, Promise.resolve(STATE), ['install', 'x'], { map: (v) => { if (!Array.isArray(v)) throw new Error('expected an array'); return v.length; } });
    expect(await run.done).toEqual({ ok: false, error: expect.stringContaining('could not read the result: expected an array') });
  });
});

describe('createTauriBackend — argv and result mapping per verb', () => {
  const ok = (verb: string, value: unknown) => (_a: readonly string[], emit: (e: LineEvent) => void) => { emit({ kind: 'stdout', line: line({ t: 'result', verb, ok: true, exitCode: 0, value }) }); emit({ kind: 'exit', code: 0 }); };
  it('capabilities: mac-overlay on macOS, every flagged gap false, editor and clipboard true', async () => {
    const backend = createTauriBackend(fakeBridge(ok('status', {})).bridge);
    expect(await backend.capabilities()).toEqual({ appVersion: import.meta.env.VITE_APP_VERSION, windowChrome: 'mac-overlay', disablePerMachine: false, inboxEventLog: false, offtargetKind: false, machineRegistry: false, perCaseEvalTables: false, openInEditor: true, clipboard: true });
  });
  it.each(['missing', 'malformed'] as const)('retries a %s state read on the next run, then memoises success', async (kind) => {
    const f = fakeBridge(ok('sync', { placed: 0, deferred: [] }));
    const read = vi.spyOn(f.bridge, 'readAppState');
    if (kind === 'missing') read.mockResolvedValueOnce(null);
    else read.mockRejectedValueOnce(new Error(`${NO_STATE} app.json could not be parsed: truncated`));
    const backend = createTauriBackend(f.bridge);
    expect(await backend.sync({}).done).toMatchObject({ ok: false, error: expect.stringContaining(NO_STATE) });
    expect(f.spawns).toHaveLength(0);
    expect((await backend.sync({}).done).ok).toBe(true);
    expect((await backend.sync({}).done).ok).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(f.spawns).toHaveLength(2);
  });
  it('shares concurrent state reads and exposes the target without consuming it', async () => {
    const f = fakeBridge(ok('sync', { placed: 0, deferred: [] }), { ...STATE, target: 'acme/team' });
    const read = vi.spyOn(f.bridge, 'readAppState');
    const backend = createTauriBackend(f.bridge);
    const [first, second, run] = await Promise.all([backend.launchTarget(), backend.launchTarget(), backend.sync({}).done]);
    expect(first).toEqual({ target: 'acme/team', writtenAt: STATE.writtenAt });
    expect(second).toEqual(first);
    expect(run.ok).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('has no launch target for missing or legacy state', async () => {
    for (const state of [null, STATE]) {
      expect(await createTauriBackend(fakeBridge(() => undefined, state).bridge).launchTarget()).toBeNull();
    }
  });
  it('install builds the three argv shapes and maps the CLI rows to the seam', async () => {
    const f = fakeBridge(ok('install', [{ id: 'deploy-check', team: 'terum', path: '/p', version: 'abc' }]));
    const backend = createTauriBackend(f.bridge);
    expect(await backend.install({ ref: 'deploy-check', scope: 'SSM', force: true }).done).toEqual({ ok: true, value: [{ id: 'deploy-check', name: 'deploy-check', scope: 'SSM' }] });
    await backend.install({ ref: '', kind: 'member', member: 'ryan' }).done;
    await backend.install({ ref: '', kind: 'project', project: 'ssm' }).done;
    expect(f.spawns.map((s) => s.args)).toEqual([['install', '--force', '--', 'deploy-check'], ['install', '--', 'member', 'ryan'], ['install', '--', 'project', 'ssm']]);
  });
  it('team, sync, connect, validate, search argv; sync never passes --hook', async () => {
    const f = fakeBridge(ok('x', { team: 't', placed: 2, deferred: [], id: 'a', name: 'a', findings: 0, warnings: 1 }));
    const backend = createTauriBackend(f.bridge);
    await backend.team({ kind: 'create', name: 'terum', remote: 'git@x:y.git' }).done;
    await backend.team({ kind: 'join', remote: 'o/r', name: 'local' }).done;
    await backend.team({ kind: 'leave', name: 'terum' }).done;
    await backend.team({ kind: 'remove', handle: 'bob', team: 'terum' }).done;
    await backend.sync({ prune: true, hook: true }).done;
    await backend.connect({ path: '~/.claude/skills/x', team: 'terum', allowPrivileged: true }).done;
    expect(f.spawns.map((s) => s.args)).toEqual([
      ['team', 'create', '--remote', 'git@x:y.git', '--', 'terum'], ['team', 'join', '--as', 'local', '--', 'o/r'], ['team', 'leave', '--', 'terum'], ['team', 'remove', '--team', 'terum', '--', 'bob'],
      ['sync', '--prune'], ['connect', '--team', 'terum', '--allow-privileged', '--', '~/.claude/skills/x'],
    ]);
  });
  it('search maps CLI hits to seam hits; read models the CLI lacks fail naming GAPS.md; a read that asks is refused', async () => {
    const hits = [{ description: 'Deploy safely', grants: null, grantsHash: null, updated: '—', team: 't', id: 'i', name: 'deploy-check', author: 'ryan', category: 'ops', installs: 3, latest: 'abc', endorsed: 'x', unresolved: false }];
    const backend = createTauriBackend(fakeBridge(ok('search', hits)).bridge);
    expect(await backend.search({ q: 'deploy' })).toEqual({ ok: true, value: [{ kind: 'skill', ref: 't/deploy-check', name: 'deploy-check', description: 'Deploy safely', team: 't', category: 'ops', author: 'ryan', installs: 3, latest: 'abc', endorsed: 'x', unresolved: false }] });
    expect(await backend.onboarding()).toEqual({ ok: false, error: expect.stringContaining('GAPS.md') });
    const asking = createTauriBackend(fakeBridge((_a, emit) => { emit({ kind: 'stdout', line: line({ t: 'ask', id: 'q1', kind: 'confirm', question: 'Really?' }) }); }).bridge);
    expect(await asking.search({ q: 'x' })).toEqual({ ok: false, error: expect.stringContaining('asked "Really?" during a read-only call') });
  });
  it('subscribe is notified after a successful run and not after a failure', async () => {
    const f = fakeBridge(ok('sync', { placed: 1, deferred: [] }));
    const backend = createTauriBackend(f.bridge);
    const seen: string[] = [];
    const off = backend.subscribe((source) => seen.push(source));
    await backend.sync({}).done;
    expect(seen).toEqual(['clone', 'placed', 'stamp']);
    off();
    await backend.sync({}).done;
    expect(seen).toHaveLength(3);
  });
});


describe('D13 home abbreviation at the native backend seam', () => {
  it('abbreviates every print level, result frame and done error', async () => {
    const { bridge } = fakeBridge((_args, emit) => {
      for (const level of ['info', 'warn', 'error']) emit({ kind: 'stdout', line: line({ t: 'print', level, line: 'Reading /Users/teddy/.terum/skills' }) });
      emit({ kind: 'stdout', line: line({ t: 'result', verb: 'sync', ok: false, exitCode: 1, error: 'Invalid /Users/teddy/.terum/skills/config.json' }) });
    });
    const run = createTauriBackend(bridge).sync({});
    expect(await collect(run.frames)).toEqual([
      { t: 'print', line: 'Reading ~/.terum/skills' },
      { t: 'print', line: 'warn: Reading ~/.terum/skills' },
      { t: 'print', line: 'error: Reading ~/.terum/skills' },
      { t: 'result', ok: false, error: 'Invalid ~/.terum/skills/config.json' },
    ]);
    expect(await run.done).toEqual({ ok: false, error: 'Invalid ~/.terum/skills/config.json' });
  });
  it('abbreviates read errors and startup errors without requiring frame consumption', async () => {
    const { bridge } = fakeBridge((_args, emit) => {
      emit({ kind: 'stderr', line: 'Cannot read /Users/teddy/.terum/skills' });
      emit({ kind: 'exit', code: 1 });
    });
    expect(await createTauriBackend(bridge).validate({ ref: 'a' })).toEqual({ ok: false, error: 'terum-skills exited with code 1 before reporting a result. Cannot read ~/.terum/skills' });
    bridge.readAppState = async () => { throw new Error('Missing /Users/teddy/.terum/skills/run/app.json'); };
    expect(await createTauriBackend(bridge).sync({}).done).toEqual({ ok: false, error: 'Missing ~/.terum/skills/run/app.json' });
  });
  it('preserves messages when the platform home is unavailable', async () => {
    const { bridge } = fakeBridge((_args, emit) => {
      emit({ kind: 'stdout', line: line({ t: 'print', level: 'info', line: '/Users/teddy/file' }) });
      emit({ kind: 'stdout', line: line({ t: 'result', verb: 'sync', ok: false, exitCode: 1, error: '/Users/teddy/file' }) });
    });
    bridge.homeDirectory = async () => { throw new Error('Unavailable'); };
    const run = createTauriBackend(bridge).sync({});
    expect(await collect(run.frames)).toEqual([{ t: 'print', line: '/Users/teddy/file' }, { t: 'result', ok: false, error: '/Users/teddy/file' }]);
    expect(await run.done).toEqual({ ok: false, error: '/Users/teddy/file' });
  });
});

it.each([
  [{ count: 3 }, { value: 6 }],
  [undefined, {}],
  ['invalid', {}],
])('retains a mapped failure value only when readable: %j', async (value, expected) => {
  const { bridge } = fakeBridge((_args, emit) => {
    emit({ kind: 'stdout', line: JSON.stringify({ t: 'result', verb: 'status', ok: false, exitCode: 1, error: 'Unreadable clone.', value }) });
  });
  const run = cliRun(bridge, Promise.resolve(STATE), ['status'], { map: (input: unknown) => {
    if (!input || typeof input !== 'object' || !('count' in input) || typeof input.count !== 'number') throw new Error('Invalid count');
    return input.count * 2;
  } });
  expect(await run.done).toEqual({ ok: false, error: 'Unreadable clone.', ...expected });
  expect(await collect(run.frames)).toEqual([{ t: 'result', ok: false, error: 'Unreadable clone.' }]);
});

it.each([true, false, undefined])('maps only a typed wire decline into both seam outcomes (%s)', async declined => {
  const error = 'Publish was cancelled.';
  const f = fakeBridge((_args, emit) => {
    emit({ kind: 'stdout', line: line({ t: 'result', verb: 'publish', ok: false, exitCode: 1, error, declined, value: 3 }) });
    emit({ kind: 'exit', code: 1 });
  });
  const run = cliRun(f.bridge, Promise.resolve(STATE), ['publish'], { map: value => value });
  expect(await run.done).toEqual({ ok: false, error, value: 3, ...(declined === true ? { cancelled: true } : {}) });
  expect(await collect(run.frames)).toEqual([{ t: 'result', ok: false, error, ...(declined === true ? { declined: true } : {}) }]);
});
