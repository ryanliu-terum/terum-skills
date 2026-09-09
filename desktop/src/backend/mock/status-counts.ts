import type { StatusResult } from '../types';
import { design } from './fixture';
import type { MockScenario } from './scenario';

export function statusCounts(hash: string, scenario: MockScenario): StatusResult['counts'] {
  const counts: StatusResult['counts'] = { ...design.COUNTS };
  const route = hash.split('?')[0] ?? '';
  if (scenario === 'empty') {
    if (route.startsWith('#/library/')) counts.Global = '0';
    if (route.startsWith('#/inbox')) {
      delete counts.Pushes;
      delete counts.Updates;
      delete counts.Alerts;
    }
  }
  return counts;
}
