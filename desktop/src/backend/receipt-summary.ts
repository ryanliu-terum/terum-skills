/**
 * One receipt's comparison, reduced to the numbers a surface may show: the W/L/T record, the net
 * lift as whole percent, the verdict that bands it, and the sign p. Every value is that one
 * receipt's own — nothing here derives a statistic across receipts (eval-engine spec §12).
 *
 * Both receipt sources map through this: `eval-report` on a skill detail, and the `receipt` limb
 * `ls` carries for each card. They read the same field names, so there is one mapping and not two.
 */
import type { ReceiptSummary } from './types';

export interface ReceiptComparison { win: number; loss: number; tie: number; net_lift: number; sign_p: number }
/** The receipt fields a summary needs — satisfied by a full receipt and by `ls`'s subset alike. */
export interface SummarisableReceipt {
  verdict: ReceiptSummary['verdict'];
  execution_status: 'complete' | 'partial' | 'failed';
  expected_rows: number;
  scored_rows: number;
  comparisons: Record<string, ReceiptComparison>;
}

/** A comparison's own numbers under the verdict that bands it; null when there is no comparison. */
export function comparisonSummary(comparison: ReceiptComparison | null | undefined, verdict: ReceiptSummary['verdict'], partial: ReceiptSummary['partial'] = null): ReceiptSummary | null {
  return comparison ? { w: comparison.win, l: comparison.loss, t: comparison.tie, n: comparison.win + comparison.loss + comparison.tie, lift: Math.round(comparison.net_lift * 100), verdict, partial, signP: comparison.sign_p.toFixed(3) } : null;
}

/**
 * A receipt's headline summary: its candidate-vs-baseline comparison. A partial run carries its
 * scored/expected rows so the surface can grey the verdict rather than present it as complete.
 */
export function receiptSummary(receipt: SummarisableReceipt | null | undefined): ReceiptSummary | null {
  return receipt ? comparisonSummary(receipt.comparisons['candidate-vs-baseline'], receipt.verdict, receipt.execution_status === 'partial' ? [receipt.scored_rows, receipt.expected_rows] : null) : null;
}
