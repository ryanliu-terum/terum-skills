import type { AutoSyncOutcome, Result, SyncResult } from '../types';

export const AUTO_SYNC_MIN_INTERVAL_MS = 10 * 60_000;
export interface AutoSyncPolicyOptions {
  run(force: boolean): Promise<Result<SyncResult>>;
  supported(): boolean;
  busy(): boolean;
  onChanged(): void | Promise<void>;
  onStatusChanged?(): void | Promise<void>;
  now?: () => number;
}
/** Launch/focus only. Busy workflows skip a trigger without spending the throttle. */
export function createAutoSyncPolicy(options: AutoSyncPolicyOptions) {
  const now = options.now ?? Date.now;
  let lastAt = Number.NEGATIVE_INFINITY;
  let last: AutoSyncOutcome | null = null;
  let inFlight: Promise<void> | undefined;
  let force = false;
  let notificationError: unknown;
  function trigger(): boolean {
    if (inFlight || !options.supported() || options.busy()) return false;
    const elapsed = now() - lastAt;
    // A clock stepped backwards must not wedge the throttle until wall time catches up.
    if (elapsed >= 0 && elapsed < AUTO_SYNC_MIN_INTERVAL_MS) return false;
    // Spend the trigger before spawning so a failed spawn cannot create a focus storm.
    lastAt = now();
    const forced = force; force = false;
    inFlight = (async () => {
      const previous = last;
      let changed = false;
      try {
        const result = await options.run(forced);
        last = result.ok ? { at: now(), state: 'synced' } : { at: now(), state: 'failed', detail: result.error.split('\n')[0] ?? '', notices: result.value?.notices ?? [] };
        changed = Boolean(result.value && (result.value.changed || result.value.placed > 0));
      } catch (error) {
        // A background run records its failure; it must never reject into the focus handler.
        last = { at: now(), state: 'failed', detail: (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '', notices: [] };
      }
      // The CLI stamps at completion. Starting the cooldown here avoids a second, stale-stamp
      // no-op consuming the next ten-minute window. Relaunch explicitly bypasses both gates.
      lastAt = force ? Number.NEGATIVE_INFINITY : now();
      notificationError = undefined;
      try {
        if (changed) await options.onChanged();
        else if (last.state === 'failed' || previous?.state === 'failed') await options.onStatusChanged?.();
      } catch (error) {
        // Cache notification can fail independently: retain diagnostics without falsifying the CLI outcome.
        notificationError = error;
      }
    })().finally(() => { inFlight = undefined; });
    return true;
  }
  return { trigger, reset: () => { lastAt = Number.NEGATIVE_INFINITY; force = true; }, last: () => last, notificationError: () => notificationError, settled: async () => { await inFlight; } };
}

/** Keep workflow bookkeeping beside the policy, including synchronous failures before a child exists. */
export function createWorkflowGate(onIdle: () => void) {
  let active = 0;
  const verbs = new Set(['sync', 'setup', 'team', 'install', 'uninstall', 'connect', 'publish', 'eval', 'validate', 'invite', 'profile', 'decline', 'login', 'checkout', 'project', 'uninstall-skill', 'app-update', 'diagnostics']);
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
