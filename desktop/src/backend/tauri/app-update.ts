import { z } from 'zod';
import type { AppUpdateStaged, AppUpdateStatus, ChangeSource, ReadOptions, Result, Run } from '../types';
import { isNewer } from '../../lib/version-compare';

const marker = z.strictObject({ schema: z.literal(1), version: z.string(), phase: z.enum(['waiting','installing','launched','failed']), at: z.string(), error: z.string().nullable() });
export const cliAppUpdateCheck = z.strictObject({ mode: z.literal('check'), platform: z.string(), supported: z.boolean(), cliVersion: z.string().nullable(), latest: z.string().nullable(), latestAt: z.string().nullable(), probe: z.enum(['ok','skipped','cached','failed']), probeError: z.string().nullable(), staged: z.string().nullable(), installed: z.array(z.string()), lastApply: marker.nullable(), ppid: z.number() });
export const cliAppUpdateStage = z.strictObject({ mode: z.literal('stage'), version: z.string(), platform: z.string(), staged: z.boolean(), notPublished: z.boolean(), alreadyStaged: z.boolean(), asset: z.string(), bytes: z.number(), path: z.string().nullable() });
export const cliAppUpdateApply = z.strictObject({ mode: z.literal('apply'), version: z.string(), platform: z.string(), awaitPid: z.number().nullable(), handedOff: z.literal(true) });

export interface AppUpdateDeps {
  run<TIn, TOut>(argv: readonly string[], schema: z.ZodType<TIn>, map: (value: TIn) => TOut, touches: ChangeSource[]): Run<TOut>;
  read<T>(job: Run<T>, options?: ReadOptions): Promise<Result<T>>;
  result<T>(value: Result<T>): Promise<Result<T>>;
  appVersion: string;
}
export function createAppUpdate(deps: AppUpdateDeps): {
  check(q?: { force?: boolean }, options?: ReadOptions): Promise<Result<AppUpdateStatus>>;
  stage(version: string): Run<AppUpdateStaged>;
  apply(version: string): Promise<Result<void>>;
} {
  return {
    check: (q, options) => deps.read(deps.run(['app-update', '--check', ...(q?.force ? ['--force'] : [])], cliAppUpdateCheck, value => ({ ...value, appVersion: deps.appVersion, newer: isNewer(value.latest, deps.appVersion), lastApply: value.lastApply === null ? null : { version: value.lastApply.version, phase: value.lastApply.phase, at: value.lastApply.at, error: value.lastApply.error } }), []), options).then(deps.result),
    stage: version => deps.run(['app-update', '--stage', '--release', version], cliAppUpdateStage, value => ({ version: value.version, staged: value.staged, notPublished: value.notPublished, alreadyStaged: value.alreadyStaged }), []),
    apply: version => deps.run(['app-update', '--apply', '--release', version], cliAppUpdateApply, () => undefined, []).done.then(r => r.ok ? { ok: true as const, value: undefined } : r).then(deps.result),
  };
}
