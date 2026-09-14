import type { ReconcileResult } from '../../backend/types';

export function reconcileHasRows(result: ReconcileResult | undefined): result is ReconcileResult {
  return result !== undefined && result.identical.length + result.differing.length + result.renamed.length > 0;
}
