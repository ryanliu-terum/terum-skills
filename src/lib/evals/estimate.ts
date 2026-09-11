import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { receiptSchema } from './receipt.js';
import { EVAL_PARALLEL_DEFAULT } from './batch.js';

export interface EvalEstimate { runs: number; costUsd: number; durationMs: number; }
function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}
/** Reconstruct run totals from per-arm means × cases × repetitions, as the desktop eval report does. */
export async function estimateFromReceipts(clone: string): Promise<EvalEstimate | null> {
  const costs: number[] = [], durations: number[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.isDirectory() && depth < 2) await walk(join(directory, entry.name), depth + 1);
      else if (entry.isFile() && depth === 2 && entry.name.endsWith('.json')) {
        const source = await readFile(join(directory, entry.name), 'utf8');
        let value: unknown;
        try { value = JSON.parse(source); } catch { continue; } // Invalid JSON supplies no measured data.
        const parsed = receiptSchema.safeParse(value);
        if (!parsed.success) continue;
        const arms = Object.values(parsed.data.efficiency), perArm = parsed.data.provenance.cases.length * parsed.data.provenance.k;
        if (!arms.length || !perArm || arms.some(arm => arm.cost_usd === null || arm.duration_ms === null || arm.cost_usd < 0 || arm.duration_ms < 0)) continue;
        const cost = arms.reduce((total, arm) => total + arm.cost_usd! * perArm, 0);
        const duration = arms.reduce((total, arm) => total + arm.duration_ms! * perArm, 0);
        if (!Number.isFinite(cost) || !Number.isFinite(duration)) continue;
        costs.push(cost); durations.push(duration);
      }
    }
  }
  await walk(join(clone, 'evals'), 0);
  return costs.length < 3 ? null : { runs: costs.length, costUsd: median(costs), durationMs: median(durations) };
}
export function duration(ms: number): string { return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`; }
export function estimateLine(count: number, estimate: EvalEstimate | null, parallel = EVAL_PARALLEL_DEFAULT): string {
  return estimate === null
    ? `Evaluating ${count} ${count === 1 ? 'skill' : 'skills'}, ${parallel} at a time: no earlier runs to estimate from; each eval runs the skill's cases against a baseline on this machine and bills your Claude account.`
    : `Evaluating ${count} ${count === 1 ? 'skill' : 'skills'}, ${parallel} at a time: about $${(count * estimate.costUsd).toFixed(2)} and ${duration(Math.ceil(count / parallel) * estimate.durationMs)} on this machine, from ${estimate.runs} earlier runs (median $${estimate.costUsd.toFixed(2)} · ${duration(estimate.durationMs)} each).`;
}
