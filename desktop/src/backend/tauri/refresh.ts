/**
 * W-08: teammates' commits reach this machine only through a fetch, and every CLI read verb is contractually
 * fetch-free. The adapter therefore runs the CLI's own fetch-only `sync` verb — the smallest thing that fetches
 * and does nothing else — once when it first learns the CLI has it, and whenever the window regains focus: in
 * the background, at most once a minute, one at a time, never while a foreground write verb is running, and
 * never blocking a render (ledger D9: after the app's own actions and on focus, never on a timer). Every
 * completed attempt is published — a successful fetch wrote a fresh stamp, and a failed one has a line to show
 * in Settings ▸ Sync — while the Marketplace boards are invalidated only when a clone actually moved.
 *
 * There is no timer here on purpose: desktop/src/app/refresh-policy.test.tsx greps production source for
 * interval- or timeout-driven refetches. The throttle is a clock comparison; the fetch's time bound is the
 * CLI's own `deadlineMs`.
 */
import { z } from 'zod';
import type { Result } from '../types';

/** Tracks foreground workflows so a background refresh waits until no write is active. */
export function createWorkflowGate(onIdle: () => void) {
  let active = 0;
  const verbs = new Set(['sync', 'setup', 'team', 'install', 'uninstall', 'publish', 'eval', 'validate', 'invite', 'profile', 'login', 'checkout', 'project', 'uninstall-skill', 'prune', 'app-update', 'diagnostics']);
  return {
    busy: () => active > 0,
    start(argv: readonly (string | Promise<string>)[]): () => void {
      if (!verbs.has(String(argv[0])) || (argv[0] === 'app-update' && argv.includes('--check'))) return () => undefined;
      active++;
      let finished = false;
      return () => { if (finished) return; finished = true; active--; if (active === 0) onIdle(); };
    },
  };
}

/** The CLI's `sync` result (terum-skills src/commands/refresh.ts, registered as `sync` since B1). */
export const cliRefresh = z.object({
  changed: z.boolean(),
  notices: z.array(z.string()),
  teams: z.array(z.object({
    team: z.string(),
    state: z.enum(['refreshed', 'busy', 'unreachable', 'no-clone', 'error']),
    changed: z.boolean(),
    head: z.string().nullable(),
    detail: z.string().optional(),
  })),
}).passthrough();
export type CliRefresh = z.infer<typeof cliRefresh>;

/** One background refresh a minute, at human alt-tab rhythm; a real fetch costs about half a second. */
export const REFRESH_MIN_INTERVAL_MS = 60_000;

/** The last attempt. Settings ▸ Sync renders it: the cadence sentence always, and after a run that did not
 *  refresh every team, the CLI's own first error line plus any notices it printed. */
export interface RefreshOutcome { at: number; state: 'refreshed' | 'skipped' | 'failed'; detail?: string; notices?: string[] }

export interface RefreshPolicyOptions {
  /** Runs the fetch-only `sync` verb once and settles; it is driven read-only, so it never answers a question. */
  run(): Promise<Result<CliRefresh>>;
  /** Whether this CLI has the verb: `hello.features.refresh`. A CLI without it is never spawned for one. */
  supported(): boolean;
  /** Called after a refresh that moved a clone. Awaited, so the caller may settle in-flight reads first. */
  onChanged(): Promise<void> | void;
  /** Called after every run the CLI answered ok — 'refreshed' and 'skipped' alike, and in addition to
   *  onChanged. Every such run wrote a fresh fetch stamp, so the stamp-driven boards are stale even when
   *  no clone moved. */
  onRefreshed?(): Promise<void> | void;
  /** Called after every run recorded as 'failed', so the failure line reaches Settings ▸ Sync without
   *  waiting for the next fetch. Exactly one of onRefreshed and onFailed runs per completed attempt. */
  onFailed?(): Promise<void> | void;
  /** Whether a foreground write verb is running. A background fetch never competes with one. */
  busy?: () => boolean;
  minIntervalMs?: number;
  now?: () => number;
}

export interface RefreshPolicy {
  /** Fire and forget: at most one run in flight, at most one per interval, never throws. */
  trigger(): void;
  /** Clear the throttle so the next trigger runs (a deep-link relaunch is exactly that moment). */
  reset(): void;
  last(): RefreshOutcome | null;
  /** Resolves when the in-flight run, if any, has settled. Used by tests; harmless in production. */
  settled(): Promise<void>;
}

export function createRefreshPolicy(options: RefreshPolicyOptions): RefreshPolicy {
  const interval = options.minIntervalMs ?? REFRESH_MIN_INTERVAL_MS;
  const clock = options.now ?? (() => Date.now());
  let lastAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | undefined;
  let last: RefreshOutcome | null = null;
  const trigger = (): void => {
    if (inFlight) return;
    if (!options.supported()) return;
    // A foreground write verb holds the clone lock and the user's attention, so the fetch waits for it: the
    // workflow gate's own idle callback triggers this policy the moment the last one ends. The attempt is
    // abandoned before `lastAt` moves, so a fetch that never ran cannot spend the interval.
    if (options.busy?.()) return;
    const at = clock();
    const elapsed = at - lastAt;
    // A clock that jumped backwards (a system time change) must not wedge the throttle: only a
    // forward-and-recent last attempt suppresses this one.
    if (elapsed >= 0 && elapsed < interval) return;
    lastAt = at; // set before the spawn: a failing refresh must not retry-storm on every focus event
    inFlight = (async () => {
      try {
        const result = await options.run();
        // Read before the ok branch on purpose: a failed run still carries the CLI's partial result when it
        // printed one, and those notices are the lines that say which team could not be reached. Settings ▸ Sync
        // prints them under the error line, so they are kept whichever way the run ended.
        const notices = result.value?.notices?.length ? { notices: [...result.value.notices] } : {};
        if (result.ok) {
          const failures = result.value.teams.filter((team) => team.state !== 'refreshed');
          last = failures.length
            ? { at, state: 'skipped', detail: failures.map((team) => `${team.team}: ${team.state}${team.detail ? ` — ${team.detail}` : ''}`).join('; '), ...notices }
            : { at, state: 'refreshed', ...notices };
          if (result.value.changed) await options.onChanged();
          await options.onRefreshed?.();
          return;
        }
        last = { at, state: 'failed', detail: result.error, ...notices };
      } catch (error: unknown) {
        // A background refresh has no user-facing surface and must never reject into the caller's focus handler
        // or leave an unhandled rejection: the failure is recorded, published below exactly like a success, and
        // the next focus tries again. A listener that threw lands here too, and its message is the honest detail.
        last = { at, state: 'failed', detail: error instanceof Error ? error.message : String(error) };
      }
      // Reached only by a failed run — every ok one returned above.
      try { await options.onFailed?.(); }
      catch { /* Deliberate: the outcome is recorded and this is the run's last step. Replacing `detail` with the
                 listener's own message would hide the CLI error the user has to read, and nothing here can be
                 retried or undone; the next focus runs the whole attempt again. */ }
    })().finally(() => { inFlight = undefined; });
  };
  return { trigger, reset: () => { lastAt = Number.NEGATIVE_INFINITY; }, last: () => last, settled: async () => { await inFlight; } };
}
