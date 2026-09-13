import { vi } from 'vitest';
import type { AppState, Bridge, LineEvent } from '../bridge';

export const STATE: AppState = { schema: 1, node: '/usr/local/bin/node', entry: '/usr/local/lib/node_modules/terum-skills/dist/index.js', version: '0.1.6', writtenAt: '2026-09-08T00:00:00Z' };
/** The home directory the fake shell reports. A recording made under a scratch fixture is moved here by `underFakeHome` (recording.ts). */
export const FAKE_HOME = '/Users/teddy';

export interface FakeBridgeOptions {
  /**
   * What a `serve` spawn does. 'emulate' (the default) plays the CLI's read session the way the real
   * CLI does once its hello advertises `serve` (src/lib/serve-verbs.ts, ../session.ts): the child greets
   * with the last hello any script emitted and answers every `{t:'request'}` written to it by running the
   * script for that argv, tagging each frame with the request id — so a fixture written per one-shot argv
   * needs nothing extra when its recording is from a CLI that serves. 'script' hands `['serve']` to the
   * script like any other argv, for a test that drives the session protocol by hand (session.test.ts).
   */
  serve?: 'emulate' | 'script';
}

/** A fake shell: records spawns, session requests and writes, replays scripted CLI stdout lines, honours cancel/kill. */
export function fakeBridge(script: (args: readonly string[], emit: (e: LineEvent) => void, writes: string[]) => void | Promise<void>, state: AppState | null = STATE, options: FakeBridgeOptions = {}) {
  const spawns: { id: string; args: readonly string[]; cwd: string | undefined }[] = [];
  /** Reads answered over the emulated session, in order — the counterpart of `spawns` for a serving CLI. */
  const requests: { id: string; argv: readonly string[]; cwd: string | undefined }[] = [];
  /** Every process the adapter asked for, spawns and session requests interleaved in the order they happened. */
  const calls: { kind: 'spawn' | 'request'; args: readonly string[] }[] = [];
  const writes: string[] = [];
  const kills: string[] = [];
  const unlisten = vi.fn();
  const quit = vi.fn(async () => {});
  const listeners = new Map<string, (e: LineEvent) => void>();
  const sessions = new Set<string>();
  let hello: string | undefined;
  let emit: ((e: LineEvent) => void) | undefined;
  const launchListeners = new Set<() => void>();
  // The session child greets with whatever hello the CLI last printed: the recordings' own hello.
  const observing = (onEvent: (e: LineEvent) => void) => (event: LineEvent) => {
    if (event.kind === 'stdout' && event.line.includes('"hello"')) { try { if ((JSON.parse(event.line) as { t?: unknown }).t === 'hello') hello = event.line; } catch { /* not a frame */ } }
    onEvent(event);
  };
  const bridge: Bridge = {
    quit,
    async onLaunchRequest(listener) { launchListeners.add(listener); return () => { launchListeners.delete(listener); }; },
    async spawn(id, _state, args, cwd, onEvent) {
      spawns.push({ id, args, cwd }); calls.push({ kind: 'spawn', args }); listeners.set(id, onEvent); emit = onEvent;
      await Promise.resolve();
      if ((options.serve ?? 'emulate') === 'emulate' && args[0] === 'serve') {
        sessions.add(id);
        if (hello !== undefined) onEvent({ kind: 'stdout', line: hello });
        return unlisten;
      }
      await script(args, observing(onEvent), writes);
      return unlisten;
    },
    async write(id, line) {
      writes.push(line);
      if (!sessions.has(id)) return;
      let request: { t?: unknown; id?: unknown; argv?: unknown; cwd?: unknown };
      try { request = JSON.parse(line) as typeof request; } catch { return; }
      if (request.t !== 'request' || typeof request.id !== 'string' || !Array.isArray(request.argv)) return;
      const argv = request.argv as string[], requestId = request.id, session = listeners.get(id)!;
      requests.push({ id: requestId, argv, cwd: typeof request.cwd === 'string' ? request.cwd : undefined }); calls.push({ kind: 'request', args: argv });
      const reply = (event: LineEvent) => {
        if (event.kind === 'exit') return; // a one-shot process ends here; the session child lives on
        if (event.kind !== 'stdout') { session(event); return; }
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(event.line) as Record<string, unknown>; } catch { session(event); return; }
        if (frame.t === 'hello') return; // the child greeted once already
        session({ kind: 'stdout', line: JSON.stringify({ ...frame, id: requestId }) });
      };
      // A script that cannot answer this argv is, one-shot, a spawn that rejects (run.ts: "Could not start
      // terum-skills: …"); over the session the same fixture gap is reported on the request, not the child.
      try { await script(argv, reply, writes); }
      catch (error) { session({ kind: 'stdout', line: JSON.stringify({ t: 'result', id: requestId, verb: argv[0], ok: false, exitCode: 1, error: `Could not start terum-skills: ${error instanceof Error ? error.message : String(error)}` }) }); }
    },
    async kill(id) { kills.push(id); sessions.delete(id); (listeners.get(id) ?? emit)?.({ kind: 'exit', code: null }); },
    async readAppState() { return state; },
    async hostPlatform() { return 'macos'; },
    async homeDirectory() { return FAKE_HOME; },
  };
  return {
    reopen: () => { for (const listener of launchListeners) listener(); },
    bridge, spawns, requests, calls, writes, kills, unlisten, quit,
    /** Inject an event into the most recently spawned child. */
    emit: (event: LineEvent) => emit?.(event),
    /** Inject an event into one child by its spawn id — the right target once a background `sync` or the session child has been spawned after it. */
    emitTo: (id: string, event: LineEvent) => listeners.get(id)?.(event),
  };
}
