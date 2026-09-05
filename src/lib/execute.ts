import type { Execute } from '../cli.js';
import type { SyncResult } from '../commands/sync.js';
import type { Prompter } from './prompt.js';

/** What the bin owns: where failure text goes and how the exit code is set. Injected so the contract is testable. */
export interface ExecuteSink {
  io: Prompter;
  stderr(line: string): void;
  setExitCode(code: number): void;
}

/**
 * The bin's contract (§3): a verb returns a Result and never exits. A failing Result is one
 * stderr line and exit code 1; a verb that throws (a closed prompt, an unexpected error) is the
 * same; success writes nothing here. A hook sync's notices go to stderr on either outcome, followed
 * by the one-line review count, so the hook's stdout stays reserved for the reload directive (§8).
 */
export function createExecute(sink: ExecuteSink): Execute {
  return async (invoke) => {
    try {
      const outcome = await invoke(sink.io);
      if (isHookSync(outcome.value)) writeHookNotices(outcome.value, sink);
      if (!outcome.ok) {
        sink.stderr(outcome.error);
        sink.setExitCode(1);
      }
    } catch (error) {
      sink.stderr(error instanceof Error ? error.message : String(error));
      sink.setExitCode(1);
    }
  };
}

function isHookSync(value: unknown): value is SyncResult {
  return Boolean(value) && typeof value === 'object' && (value as Partial<SyncResult>).hook === true && Array.isArray((value as Partial<SyncResult>).deferred) && Array.isArray((value as Partial<SyncResult>).notices);
}

function writeHookNotices(value: SyncResult, sink: ExecuteSink): void {
  for (const notice of value.notices) sink.stderr(notice);
  if (value.deferred.length) sink.stderr(`${value.deferred.length} skills need review — run \`terum-skills sync\``);
}
