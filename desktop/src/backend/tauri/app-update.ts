import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AppUpdateStaged, AppUpdateStatus, ChangeSource, PrefStore, ReadOptions, Result, Run } from '../types';
import { isNewer } from '../../lib/version-compare';

const marker = z.strictObject({ schema: z.literal(1), version: z.string(), phase: z.enum(['waiting','installing','launched','failed']), at: z.string(), error: z.string().nullable(), reason: z.enum(['on-close','overnight','manual']).optional() });
export const cliAppUpdateCheck = z.strictObject({ mode: z.literal('check'), platform: z.string(), supported: z.boolean(), cliVersion: z.string().nullable(), latest: z.string().nullable(), latestAt: z.string().nullable(), probe: z.enum(['ok','skipped','cached','failed']), probeError: z.string().nullable(), staged: z.string().nullable(), installed: z.array(z.string()), lastApply: marker.nullable(), ppid: z.number() });
export const cliAppUpdateStage = z.strictObject({ mode: z.literal('stage'), version: z.string(), platform: z.string(), staged: z.boolean(), notPublished: z.boolean(), alreadyStaged: z.boolean(), asset: z.string(), bytes: z.number(), path: z.string().nullable() });
export const cliAppUpdateApply = z.strictObject({ mode: z.literal('apply'), version: z.string(), platform: z.string(), awaitPid: z.number().nullable(), handedOff: z.literal(true) });

export interface AppUpdateDeps {
  run<TIn, TOut>(argv: readonly string[], schema: z.ZodType<TIn>, map: (value: TIn) => TOut, touches: ChangeSource[]): Run<TOut>;
  read<T>(job: Run<T>, options?: ReadOptions): Promise<Result<T>>;
  result<T>(value: Result<T>): Promise<Result<T>>;
  appVersion: string;
  prefs: PrefStore;
  invoke?: (command: 'app_update_on_close', args: { version: string | null }) => Promise<void>;
}
export function createAppUpdate(deps: AppUpdateDeps): {
  check(q?: { force?: boolean }, options?: ReadOptions): Promise<Result<AppUpdateStatus>>;
  stage(version: string): Run<AppUpdateStaged>;
  apply(version: string, reason?: 'manual' | 'overnight'): Promise<Result<void>>;
  armOnClose(version: string): Promise<Result<void>>;
  disarmOnClose(): Promise<Result<void>>;
} {
  const shown = new Set<string>();
  // Serialize arm/disarm so a slow arm cannot race a policy change or a manual install.
  let pending: Promise<Result<void>> = Promise.resolve({ ok: true, value: undefined });
  function arm(version: string | null): Promise<Result<void>> {
    pending = pending.then(async () => {
      try { await (deps.invoke ?? invoke)('app_update_on_close', { version }); return { ok: true as const, value: undefined }; }
      catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) }; }
    });
    return pending.then(deps.result);
  }
  return {
    armOnClose: version => arm(version),
    disarmOnClose: () => arm(null),
    check: async (q, options) => {
      await deps.prefs.ready;
      const checked = await deps.read(deps.run(['app-update', '--check', ...(q?.force ? ['--force'] : [])], cliAppUpdateCheck, value => ({ ...value, appVersion: deps.appVersion, ...(value.lastApply?.reason === undefined ? {} : { reason: value.lastApply.reason }), newer: isNewer(value.latest, deps.appVersion), lastApply: value.lastApply === null ? null : { version: value.lastApply.version, phase: value.lastApply.phase, at: value.lastApply.at, error: value.lastApply.error, ...(value.lastApply.reason === undefined ? {} : { reason: value.lastApply.reason }) } }), []), options);
      if (checked.ok && checked.value.lastApply?.phase === 'launched' && checked.value.lastApply.version === deps.appVersion) {
        const token = `${checked.value.lastApply.version}:${checked.value.lastApply.at}`;
        if (!shown.has(token) && deps.prefs.get('updates:app:lastShown', '') === token) checked.value.lastApply = null;
        else {
          shown.add(token);
          try { deps.prefs.set('updates:app:lastShown', token); await deps.prefs.flush?.(); }
          catch (error) {
            // Do not pretend the one-session acknowledgement was saved. Settings can retry explicitly.
            return deps.result({ ok: false, error: `Could not save update acknowledgement: ${String(error)}` });
          }
        }
      }
      return deps.result(checked);
    },
    stage: version => deps.run(['app-update', '--stage', '--release', version], cliAppUpdateStage, value => ({ version: value.version, staged: value.staged, notPublished: value.notPublished, alreadyStaged: value.alreadyStaged }), []),
    apply: async (version, reason) => {
      const disarmed = await arm(null);
      if (!disarmed.ok) return disarmed;
      return deps.run(['app-update', '--apply', '--release', version, ...(reason === undefined ? [] : ['--reason', reason])], cliAppUpdateApply, () => undefined, []).done.then(r => r.ok ? { ok: true as const, value: undefined } : r).then(deps.result);
    },
  };
}
