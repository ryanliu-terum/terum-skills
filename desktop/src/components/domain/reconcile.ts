import type { ReconcileResult, Result, SyncResult } from '../../backend/types';
import { describeRefreshState } from './refresh-state-copy';

/**
 * What the Library's Sync says when the fetch before its comparison did not bring every team forward: the
 * comparison still runs, against the clone already on this machine, and the dialog says so. Null when every
 * team was fetched (or fetched within the hour), which is the only case where nothing needs saying.
 */
export function fetchNote(fetched: Result<SyncResult>): string | null {
  const suffix = 'This compares your skills against the team copy already on this machine.';
  if (!fetched.ok) return `The team could not be fetched (${fetched.error}). ${suffix}`;
  const stale = fetched.value.teams.filter((team) => team.state !== 'refreshed' && team.state !== 'fresh');
  if (stale.length === 0) return null;
  return `${stale.map((team) => `${team.team}: ${describeRefreshState(team.state)}${team.detail ? ' · ' + team.detail : ''}`).join('; ')}. ${suffix}`;
}

export function reconcileHasRows(result: ReconcileResult | undefined): result is ReconcileResult {
  return result !== undefined && result.identical.length + result.differing.length + result.renamed.length > 0;
}
