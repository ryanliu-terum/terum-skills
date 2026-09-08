import { vi } from 'vitest';
import type { AppState, Bridge, LineEvent } from '../bridge';

export const STATE: AppState = { schema: 1, node: '/usr/local/bin/node', entry: '/usr/local/lib/node_modules/terum-skills/dist/index.js', version: '0.1.6' };

/** A fake shell: records spawns and writes, replays scripted CLI stdout lines, honours cancel/kill. */
export function fakeBridge(script: (args: readonly string[], emit: (e: LineEvent) => void, writes: string[]) => void | Promise<void>, state: AppState | null = STATE) {
  const spawns: { id: string; args: readonly string[]; cwd: string | undefined }[] = [];
  const writes: string[] = [];
  const kills: string[] = [];
  const unlisten = vi.fn();
  let emit: ((e: LineEvent) => void) | undefined;
  const bridge: Bridge = {
    async spawn(id, _state, args, cwd, onEvent) { spawns.push({ id, args, cwd }); emit = onEvent; await Promise.resolve(); await script(args, onEvent, writes); return unlisten; },
    async write(_id, line) { writes.push(line); },
    async kill(id) { kills.push(id); emit?.({ kind: 'exit', code: null }); },
    async readAppState() { return state; },
    async hostPlatform() { return 'macos'; },
    async homeDirectory() { return '/Users/teddy'; },
  };
  return { bridge, spawns, writes, kills, unlisten, emit: (event: LineEvent) => emit?.(event) };
}
