/**
 * W-08: teammates' commits reach this machine only through a fetch, and every CLI read verb is contractually
 * fetch-free. The adapter therefore runs the CLI's own `refresh` verb — the smallest thing that fetches and does
 * nothing else — once when it first learns the CLI has it, and whenever the window regains focus: in the
 * background, at most once a minute, one at a time, never blocking a render, and invalidating reads only when a
 * clone actually moved (ledger D9: after the app's own actions and on focus, never on a timer).
 *
 * There is no timer here on purpose: desktop/src/app/refresh-policy.test.tsx greps production source for
 * interval- or timeout-driven refetches. The throttle is a clock comparison; the fetch's time bound is the
 * CLI's own `deadlineMs`.
 */
import { z } from 'zod';
import type { Result } from '../types';

/** The CLI's `refresh` result (terum-skills src/commands/refresh.ts). Only the fields the adapter reads. */
export const cliRefresh = z.object({
  changed: z.boolean(),
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

/** The last attempt, kept for diagnosis. Nothing renders it today (a visible line needs a canvas redraw). */
export interface RefreshOutcome { at: number; state: 'refreshed' | 'skipped' | 'failed'; detail?: string }

export interface RefreshPolicyOptions {
  /** Runs the `refresh` verb once and settles; it is driven read-only, so it never answers a question. */
  run(): Promise<Result<CliRefresh>>;
  /** Whether this CLI has the verb: `hello.features.refresh`. A CLI without it is never spawned for one. */
  supported(): boolean;
  /** Called after a refresh that moved a clone. Awaited, so the caller may settle in-flight reads first. */
  onChanged(): Promise<void> | void;
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
    const at = clock();
    const elapsed = at - lastAt;
    // A clock that jumped backwards (a system time change) must not wedge the throttle: only a
    // forward-and-recent last attempt suppresses this one.
    if (elapsed >= 0 && elapsed < interval) return;
    lastAt = at; // set before the spawn: a failing refresh must not retry-storm on every focus event
    inFlight = (async () => {
      const result = await options.run();
      if (!result.ok) { last = { at, state: 'failed', detail: result.error }; return; }
      const failures = result.value.teams.filter((team) => team.state !== 'refreshed');
      last = failures.length
        ? { at, state: 'skipped', detail: failures.map((team) => `${team.team}: ${team.state}${team.detail ? ` — ${team.detail}` : ''}`).join('; ') }
        : { at, state: 'refreshed' };
      if (result.value.changed) await options.onChanged();
    })().catch((error: unknown) => {
      // A background refresh has no user-facing surface and must never reject into the caller's focus handler
      // or leave an unhandled rejection: the failure is recorded and the next focus tries again.
      last = { at, state: 'failed', detail: error instanceof Error ? error.message : String(error) };
    }).finally(() => { inFlight = undefined; });
  };
  return { trigger, reset: () => { lastAt = Number.NEGATIVE_INFINITY; }, last: () => last, settled: async () => { await inFlight; } };
}
