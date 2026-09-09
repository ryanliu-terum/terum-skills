import { fromError } from './result.js';
import { invocation, type InvocationForm } from './invocation.js';
import type { Execute } from '../cli.js';
import type { SyncResult } from '../commands/sync.js';
import type { Prompter } from './prompt.js';
import type { ResultOutcome } from './frames.js';

/** What the bin owns: where failure text goes and how the exit code is set. Injected so the contract is testable. */
export interface ExecuteSink {
  form?: InvocationForm;
  io: Prompter;
  afterVerb?(): Promise<void>;
  stderr(line: string): void;
  setExitCode(code: number): void;
  /** Frame mode: the verb's outcome as one terminal frame (ok, error, value, exit code). Absent on a terminal. */
  result?(outcome: ResultOutcome): void;
}

/**
 * The bin's contract (§3): a verb returns a Result and never exits. A failing Result is one
 * stderr line and exit code 1; a verb that throws (a closed prompt, an unexpected error) is the
 * same; success writes nothing here. A hook sync's notices go to stderr on either outcome, followed
 * by the one-line review count, so the hook's stdout stays reserved for the reload directive (§8).
 */
export function createExecute(sink: ExecuteSink): Execute {
  return async (invoke, meta) => {
    try {
      const outcome = await invoke(sink.io);
      if (isHookSync(outcome.value)) writeHookNotices(outcome.value, sink);
      if (!outcome.ok) {
        sink.stderr(outcome.error);
        sink.setExitCode(1);
        sink.result?.({ verb: meta.verb, ok: false, error: outcome.error, ...(outcome.cancelled ? { cancelled: true } : {}), value: outcome.value, exitCode: 1 });
      } else {
        sink.result?.({ verb: meta.verb, ok: true, value: outcome.value, exitCode: 0 });
      }
    } catch (error) {
      const outcome = fromError(error);
      if (outcome.ok) return;
      const message = outcome.error;
      sink.stderr(message);
      sink.setExitCode(1);
      sink.result?.({ verb: meta.verb, ok: false, error: message, ...(outcome.cancelled ? { cancelled: true } : {}), exitCode: 1 });
    } finally {
      if (meta.notices) {
        try { await sink.afterVerb?.(); } catch { /* A notice must never replace the verb outcome. */ }
      }
    }
  };
}

function isHookSync(value: unknown): value is SyncResult {
  return Boolean(value) && typeof value === 'object' && (value as Partial<SyncResult>).hook === true && Array.isArray((value as Partial<SyncResult>).deferred) && Array.isArray((value as Partial<SyncResult>).notices);
}

function writeHookNotices(value: SyncResult, sink: ExecuteSink): void {
  for (const notice of value.notices) sink.stderr(notice);
  if (value.deferred.length) sink.stderr(`${value.deferred.length} skills need review — run \`${invocation(sink.form, 'sync')}\``);
}
