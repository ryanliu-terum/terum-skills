import type { SyncResult } from '../../backend/types';

/** The CLI's per-team `state` tokens (src/commands/refresh.ts RefreshState), said for a person. */
export const REFRESH_STATE_COPY: Readonly<Record<string, string>> = {
  refreshed: 'fetched',
  fresh: 'fetched within the hour; left alone',
  busy: 'another process holds this clone; try again in a moment',
  unreachable: 'could not reach the remote',
  'no-clone': 'no usable clone on this machine',
  error: 'the fetch failed',
};
/** Never lets a token this app does not know pass as prose: the token is shown and named as unrecognised. */
export function describeRefreshState(state: string): string {
  return REFRESH_STATE_COPY[state] ?? `${state} (a state this app does not recognise; update the app)`;
}
/** The one status line for a finished run, derived from what happened rather than from having finished. */
export function syncSummary(outcome: SyncResult): string {
  const total = outcome.teams.length, fetched = outcome.teams.filter(team => team.state === 'refreshed' || team.state === 'fresh').length;
  if (total === 0) return 'No team to fetch on this machine.';
  if (fetched === total) return 'Sync finished.';
  if (fetched === 0) return 'Sync did not fetch any team.';
  return `Fetched ${fetched} of ${total} teams.`;
}
