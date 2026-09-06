/**
 * Eval spec §4.2 / §5.3 / §6: local run trees, aggregation of comparison rows and arm samples
 * into the numbers a receipt carries, and the CLI report. No coercion anywhere (§5.3): unscored
 * holes stay visible, never averaged into a clean-looking number.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArmSample, ComparisonRow } from './execution.js';
import type { TriggerSummary } from './triggers.js';
import { netLift, signTest, summarize, verdictBand, type Verdict } from './stats.js';

/** §4.2: run ids are UTC timestamps, so lexicographic order is chronological (rev 5). */
export function runIdFrom(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Write `run.jsonl`: one meta line, then one row per comparison / arm sample / trigger block. */
export async function writeRunTree(runDir: string, meta: Record<string, unknown>, rows: readonly unknown[]): Promise<string> {
  await mkdir(join(runDir, 'transcripts'), { recursive: true });
  const path = join(runDir, 'run.jsonl');
  const lines = [JSON.stringify({ _meta: meta }), ...rows.map((row) => JSON.stringify(row))];
  await writeFile(path, lines.join('\n') + '\n', 'utf8');
  return path;
}

export interface ComparisonSummary {
  win: number;
  loss: number;
  tie: number;
  net_lift: number;
  sign_p: number;
}

export interface EfficiencySummary {
  turns: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
}

export interface Aggregate {
  verdict: Verdict;
  attribution: string;
  execution_status: 'complete' | 'partial' | 'failed';
  expected_rows: number;
  scored_rows: number;
  comparisons: Record<string, ComparisonSummary>;
  arm_scores: Record<string, number | null>;
  efficiency: Record<string, EfficiencySummary>;
}

/**
 * Roll rows and arm samples up into receipt numbers. `expectedRows` is k × opponents × cases;
 * a row decided by `both-arms-failed` is an unscored hole, and holes grey the verdict (§5.4).
 */
export function aggregate(rows: readonly ComparisonRow[], arms: readonly ArmSample[], expectedRows: number): Aggregate {
  const comparisons: Record<string, ComparisonSummary> = {};
  const counts = new Map<string, { win: number; loss: number; tie: number }>();
  for (const row of rows) {
    const count = counts.get(row.comparison) ?? { win: 0, loss: 0, tie: 0 };
    count[row.outcome] += 1;
    counts.set(row.comparison, count);
  }
  for (const [comparison, { win, loss, tie }] of counts) {
    comparisons[comparison] = { win, loss, tie, net_lift: netLift(win, loss, tie), sign_p: signTest(win, loss) };
  }

  const armScores: Record<string, number | null> = {};
  const efficiency: Record<string, EfficiencySummary> = {};
  for (const arm of new Set(arms.map((sample) => sample.arm))) {
    const mine = arms.filter((sample) => sample.arm === arm);
    const fractions = mine.map((sample) => sample.fraction).filter((value): value is number => value !== null);
    armScores[arm] = fractions.length ? fractions.reduce((sum, value) => sum + value, 0) / fractions.length : null;
    efficiency[arm] = {
      turns: mean(mine.map((sample) => sample.turns)),
      duration_ms: mean(mine.map((sample) => sample.duration_ms)),
      cost_usd: mean(mine.map((sample) => sample.cost_usd)),
    };
  }

  const scored = rows.filter((row) => row.decided_by !== 'both-arms-failed').length;
  const executionStatus = expectedRows === 0 ? 'complete' : scored === 0 ? 'failed' : scored < expectedRows ? 'partial' : 'complete';
  const headline = comparisons['candidate-vs-baseline'];
  const verdict = headline ? verdictBand(headline.win, headline.loss, headline.tie) : 'NEUTRAL';
  return {
    verdict,
    attribution: attributionLine(rows),
    execution_status: executionStatus,
    expected_rows: expectedRows,
    scored_rows: scored,
    comparisons,
    arm_scores: armScores,
    efficiency,
  };
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

/** §5.3 one-line why, from what actually decided the baseline rows. Deterministic, no LLM. */
function attributionLine(rows: readonly ComparisonRow[]): string {
  const baseline = rows.filter((row) => row.comparison === 'candidate-vs-baseline');
  if (baseline.length === 0) return 'no execution comparisons ran';
  const wins = baseline.filter((row) => row.outcome === 'win');
  const losses = baseline.filter((row) => row.outcome === 'loss');
  const part = (label: string, subset: readonly ComparisonRow[]): string | null => {
    if (subset.length === 0) return null;
    const byChecks = subset.filter((row) => row.decided_by === 'checks').length;
    const via = byChecks * 2 >= subset.length ? 'execution checks' : 'judge calls';
    return `${label} on ${via}`;
  };
  const pieces = [part('wins', wins), part('loses', losses)].filter((piece): piece is string => piece !== null);
  if (pieces.length === 0) return 'all comparisons tied';
  const ties = baseline.length - wins.length - losses.length;
  return pieces.join('; ') + (ties > 0 ? `; ${ties} tie${ties === 1 ? '' : 's'}` : '');
}

/** §6: the printed report — verdict, per-comparison record, arm scores, trigger failures, efficiency. */
export function renderReport(aggregateResult: Aggregate, triggers: TriggerSummary | null): string {
  const lines: string[] = [];
  const grey = aggregateResult.execution_status !== 'complete' ? ` [${aggregateResult.execution_status} — ${aggregateResult.scored_rows}/${aggregateResult.expected_rows} scored]` : '';
  lines.push(`verdict: ${aggregateResult.verdict}${grey}`);
  lines.push(`why: ${aggregateResult.attribution}`);
  for (const [comparison, summary] of Object.entries(aggregateResult.comparisons)) {
    lines.push(`${comparison}: ${summarize(summary.win, summary.loss, summary.tie)}`);
  }
  const scores = Object.entries(aggregateResult.arm_scores).map(([arm, score]) => `${arm} ${score === null ? 'n/a' : score.toFixed(2)}`);
  if (scores.length) lines.push(`arm scores: ${scores.join(' · ')}`);
  if (triggers) {
    const format = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(2));
    lines.push(`triggers: recall=${format(triggers.recall)} precision=${format(triggers.precision)} (tp=${triggers.tp} fn=${triggers.fn} fp=${triggers.fp} tn=${triggers.tn})`);
    for (const row of triggers.rows) {
      if (!row.correct) lines.push(`  ${row.expected ? 'MISS' : 'FALSE-FIRE'}: ${JSON.stringify(row.prompt)}${row.error ? ` (selection call errored: ${row.error.slice(0, 120)})` : ''}`);
    }
  }
  const efficiency = Object.entries(aggregateResult.efficiency)
    .map(([arm, sums]) => {
      const parts = [
        sums.turns !== null ? `${sums.turns.toFixed(1)} turns` : null,
        sums.duration_ms !== null ? `${(sums.duration_ms / 1000).toFixed(1)}s` : null,
        sums.cost_usd !== null ? `$${sums.cost_usd.toFixed(2)}` : null,
      ].filter((piece): piece is string => piece !== null);
      return parts.length ? `${arm} ${parts.join(' · ')}` : null;
    })
    .filter((piece): piece is string => piece !== null);
  if (efficiency.length) lines.push(`efficiency: ${efficiency.join(' | ')}`);
  return lines.join('\n');
}
