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
