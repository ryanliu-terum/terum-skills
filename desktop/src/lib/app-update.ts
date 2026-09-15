import type { QueryClient } from '@tanstack/react-query';
import type { AppUpdateStatus } from '../backend/types';
export { appUpdatePolicy } from '../backend/prefs';
export function stagedAppUpdate(status: AppUpdateStatus | null | undefined): string | null {
  return status?.supported && status.newer && status.latest !== null && status.staged === status.latest && !status.installed.includes(status.latest) ? status.latest : null;
}
export type AppUpdateErrors = Partial<Record<'preferences' | 'launch' | 'stage' | 'arm' | 'apply', string>>;
export function recordAppUpdateError(client: QueryClient, concern: keyof AppUpdateErrors, error: unknown): void {
  client.setQueryData<AppUpdateErrors>(['app-update-policy-outcome'], previous => ({ ...previous, [concern]: error instanceof Error ? error.message : String(error) }));
}
/** Versions a download was started for in this session, by the launch hook's policy or by Update and relaunch. One
 *  record serves both so a download the user cancelled or watched fail is not restarted automatically a moment later;
 *  the next launch starts clean, and the explicit action always tries regardless. */
export function attemptedAppUpdates(client: QueryClient): string[] {
  return client.getQueryData<string[]>(['app-update-attempted']) ?? [];
}
export function recordAppUpdateAttempt(client: QueryClient, version: string): void {
  client.setQueryData<string[]>(['app-update-attempted'], previous => previous?.includes(version) ? previous : [...(previous ?? []), version]);
}
