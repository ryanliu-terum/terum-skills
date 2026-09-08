import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';

/** One line or lifecycle event from the child process, as the Rust bridge emits it on `cli:<id>`. */
export type LineEvent =
  | { kind: 'stdout'; line: string }
  | { kind: 'stderr'; line: string }
  | { kind: 'exit'; code: number | null }
  | { kind: 'error'; message: string };

/** `~/.terum/skills/run/app.json`, written by `terum-skills app` on every launch (decision walk D1). */
export const appStateSchema = z.object({ schema: z.literal(1), node: z.string().min(1), entry: z.string().min(1), version: z.string().min(1), writtenAt: z.string().optional() });
export type AppState = z.infer<typeof appStateSchema>;

/** Everything the adapter needs from the shell, behind an interface so the adapter is testable without Tauri. */
export interface Bridge {
  spawn(id: string, state: AppState, args: readonly string[], cwd: string | undefined, onEvent: (event: LineEvent) => void): Promise<() => void>;
  write(id: string, line: string): Promise<void>;
  kill(id: string): Promise<void>;
  readAppState(): Promise<AppState | null>;
  hostPlatform(): Promise<string>;
  homeDirectory(): Promise<string>;
}

export function tauriBridge(): Bridge {
  return {
    async spawn(id, state, args, cwd, onEvent) {
      // Subscribe first: the id is ours, so no line can be emitted before the listener exists.
      const unlisten = await listen<LineEvent>(`cli:${id}`, (event) => {
        onEvent(event.payload);
      });
      try {
        await invoke('cli_spawn', { id, node: state.node, entry: state.entry, args: [...args], cwd: cwd ?? null });
        return unlisten;
      } catch (error) {
        unlisten();
        throw error;
      }
    },
    write: (id, line) => invoke('cli_write', { id, line }),
    kill: (id) => invoke('cli_kill', { id }),
    async readAppState() {
      const text = await invoke<string | null>('read_app_state');
      if (text === null) return null;
      const parsed = appStateSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(`app.json is not a state file this app understands: ${parsed.error.issues.map((issue) => issue.path.join('.') + ' ' + issue.message).join('; ')}`);
      return parsed.data;
    },
    hostPlatform: () => invoke<string>('host_platform'),
    homeDirectory: homeDir,
  };
}
