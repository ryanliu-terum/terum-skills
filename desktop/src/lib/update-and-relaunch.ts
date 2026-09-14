import type { AppUpdateStaged, AppUpdateStatus } from '../backend/types';
import { stagedAppUpdate } from './app-update';

/**
 * What the one-shot "Update and relaunch" does next, decided from one fresh (`--force`) check. Ordered from
 * "nothing can happen on this machine" to "download it": a plan never claims "up to date" unless github.com
 * answered, because the cache alone cannot vouch for it.
 */
export type UpdatePlan =
  | { kind: 'unsupported' }
  | { kind: 'not-checked' }
  | { kind: 'unreachable'; error: string | null }
  | { kind: 'up-to-date' }
  | { kind: 'installed'; version: string }
  | { kind: 'ready'; version: string }
  | { kind: 'download'; version: string };

export function planUpdate(status: AppUpdateStatus): UpdatePlan {
  if (!status.supported) return { kind: 'unsupported' };
  if (status.probe === 'skipped' && status.latest === null) return { kind: 'not-checked' };
  if (status.latest === null) return { kind: 'unreachable', error: status.probeError };
  if (!status.newer && status.probe === 'failed') return { kind: 'unreachable', error: status.probeError };
  if (!status.newer) return { kind: 'up-to-date' };
  if (status.installed.includes(status.latest)) return { kind: 'installed', version: status.latest };
  if (stagedAppUpdate(status) === status.latest) return { kind: 'ready', version: status.latest };
  return { kind: 'download', version: status.latest };
}

export type DownloadOutcome =
  | { kind: 'ready'; version: string }
  | { kind: 'not-published'; version: string }
  | { kind: 'failed'; version: string; error: string };

/** Reads the CLI's `--stage` answer; the contract has no state that is neither staged, unpublished nor an error. */
export function concludeDownload(result: AppUpdateStaged): DownloadOutcome {
  if (result.staged) return { kind: 'ready', version: result.version };
  if (result.notPublished) return { kind: 'not-published', version: result.version };
  return { kind: 'failed', version: result.version, error: `The download did not complete; nothing was staged for ${result.version}.` };
}
