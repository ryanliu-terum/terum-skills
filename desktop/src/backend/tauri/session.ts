// The leaf, never frames.js: frames.js reaches node: builtins transitively and the browser bundle
// externalises them, which threw `node:tty.isatty` in the page. src/lib/serve-verbs.ts imports nothing.
import { SERVE_READ_VERBS } from '../../../../src/lib/serve-verbs.js';
import type { Result, Run } from '../types.js';
import type { AppState, Bridge, LineEvent } from './bridge.js';
import { parseCliFrame, type CliFrame } from './frames.js';
import { cliRun, NO_STATE } from './run.js';

type Hello = Extract<CliFrame, { t: 'hello' }>;
export interface SessionRead { result: Result<unknown>; lines: string[]; }
export interface SessionOptions {
  state(): Promise<AppState | null>;
  read(job: Run<unknown>): Promise<SessionRead>;
  onHello?(hello: Hello): void;
  helloTimeoutMs?: number;
}
interface Child {
  id: string;
  state: AppState;
  ready: Promise<Hello>;
  accept(hello: Hello): void;
  reject(error: Error): void;
  pending: Map<string, (event: LineEvent) => void>;
  hello?: Hello;
  stopped: boolean;
  stoppedReason?: string;
  unsupported?: boolean;
  unlisten?: () => void;
  spawned: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  diagnostics: string[];
}
let sequence = 0;
const sameVersion = (a: AppState, b: AppState) => a.entry === b.entry && a.node === b.node && a.version === b.version;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** One lazily started stdio child. Each request still uses cliRun's existing wire-to-Run mapping. */
export function createReadSession(bridge: Bridge, options: SessionOptions) {
  let bound: AppState | undefined;
  let advertised = false;
  let child: Child | undefined;
  let failures = 0;
  let unavailableReason: string | undefined;
  let retirement: Promise<void> = Promise.resolve();

  function retire(current: Child, why: string) {
    if (current.stopped) return;
    current.stopped = true;
    current.stoppedReason = why;
    clearTimeout(current.timer);
    current.reject(new Error(why));
    for (const emit of current.pending.values()) emit({ kind: 'error', message: why });
    current.pending.clear();
    current.unlisten?.();
    // Await spawn admission before killing: a child is not registered until spawn resolves.
    retirement = current.spawned.then(async () => {
      try { await bridge.kill(current.id); }
      catch (error) { unavailableReason = `Could not retire read session: ${message(error)}`; }
    });
    if (child === current) child = undefined;
  }
  function failed(current: Child, why: string) {
    if (current.stopped) return;
    failures++;
    if (failures >= 2) unavailableReason = why;
    retire(current, why);
  }
  function bind(state: AppState) {
    if (bound && !sameVersion(bound, state)) {
      if (child) retire(child, 'terum-skills installation changed; the read session was retired.');
      advertised = false;
    }
    bound = state;
  }
  function observe(hello: Hello) { advertised = hello.protocol === 1 && hello.features.serve === true; }

  function start(state: AppState): Child {
    let accept!: (hello: Hello) => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<Hello>((resolve, fail) => { accept = resolve; reject = fail; });
    // A spawn can fail before any virtual request attaches; ready still records that failure.
    void ready.catch(() => { /* The requesting cliRun receives the same rejection from ready. */ });
    const current: Child = { id: `serve-${++sequence}`, state, ready, accept, reject, pending: new Map(), stopped: false, spawned: Promise.resolve(), diagnostics: [] };
    child = current;
    const onEvent = (event: LineEvent) => {
      if (current.stopped) return;
      if (event.kind === 'error') { failed(current, event.message); return; }
      if (event.kind === 'exit') {
        failed(current, `terum-skills read session exited${event.code === null ? '' : ` with code ${event.code}`} ${current.hello ? 'before reporting a result.' : 'without a hello frame.'}${current.diagnostics.length ? ` ${current.diagnostics.join(' ')}` : ''}`);
        return;
      }
      if (event.kind === 'stderr') {
        current.diagnostics.push(event.line);
        if (current.diagnostics.length > 3) current.diagnostics.shift();
        return;
      }
      const frame = parseCliFrame(event.line);
      if (!frame) { current.diagnostics.push(`Malformed session frame: ${event.line.slice(0, 200)}`); current.diagnostics = current.diagnostics.slice(-3); return; }
      if (frame.t === 'hello') {
        if (current.hello) return;
        clearTimeout(current.timer);
        if (frame.protocol !== 1 || frame.features.serve !== true) {
          advertised = false;
          current.unsupported = true;
          retire(current, 'This terum-skills does not advertise serve over protocol 1.');
          return;
        }
        current.hello = frame;
        options.onHello?.(frame);
        current.accept(frame);
        return;
      }
      // parseCliFrame intentionally ignores additive fields. Read the routing envelope
      // separately and leave all content validation and mapping on the existing cliRun path.
      const envelope = JSON.parse(event.line) as { id?: unknown };
      if (typeof envelope.id !== 'string') return;
      const emit = current.pending.get(envelope.id);
      if (!emit) return;
      emit(event);
      if (frame.t === 'result') {
        current.pending.delete(envelope.id);
        emit({ kind: 'exit', code: frame.exitCode });
      }
    };
    current.timer = setTimeout(() => failed(current, 'terum-skills read session did not produce a hello frame before the startup deadline.'), options.helloTimeoutMs ?? 10_000);
    current.spawned = Promise.resolve().then(async () => {
      try {
        const stop = await bridge.spawn(current.id, state, ['serve'], undefined, onEvent);
        current.unlisten = stop;
        if (current.stopped) stop();
      } catch (error) { failed(current, `Could not start terum-skills read session: ${message(error)}`); }
    });
    return current;
  }

  async function request(argv: readonly string[], cwd?: string): Promise<SessionRead | null> {
    const state = await options.state();
    if (!state) return { result: { ok: false, error: NO_STATE }, lines: [] };
    bind(state);
    if (unavailableReason || !advertised || !SERVE_READ_VERBS.includes(argv[0] ?? '')) return null;
    await retirement;
    if (unavailableReason) return null;
    const current = child ?? start(state);
    // A virtual one-shot bridge reuses cancellation, questions, diagnostics, and result
    // mapping without spawning a process per request. Only the transport is multiplexed.
    const transport: Bridge = {
      ...bridge,
      async spawn(id, _state, args, at, emit) {
        const hello = await current.ready;
        await current.spawned;
        if (current.stopped) throw new Error(current.stoppedReason ?? 'terum-skills read session ended.');
        current.pending.set(id, emit);
        emit({ kind: 'stdout', line: JSON.stringify(hello) });
        try { await bridge.write(current.id, JSON.stringify({ t: 'request', id, argv: args, ...(at === undefined ? {} : { cwd: at }) })); }
        catch (error) { failed(current, `Could not write to terum-skills read session: ${message(error)}`); }
        return () => { current.pending.delete(id); };
      },
      async write(id, line) {
        const frame = JSON.parse(line) as { t: string; id?: string };
        try { await bridge.write(current.id, JSON.stringify({ ...frame, id })); }
        catch (error) { failed(current, `Could not write to terum-skills read session: ${message(error)}`); throw error; }
      },
      async kill(id) {
        // cliRun already sent the request-scoped cancel; never kill sibling reads.
        current.pending.delete(id);
      },
    };
    const response = await options.read(cliRun(transport, Promise.resolve(state), argv, { cwd, map: value => value }));
    return current.unsupported ? null : response;
  }
  return { request, observe, bind, get unavailableReason() { return unavailableReason; } };
}
