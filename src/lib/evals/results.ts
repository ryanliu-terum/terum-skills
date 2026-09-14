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

/**
 * Check-quality diagnostics. A check that failed in every arm on every rep (dead) or passed in
 * every arm on every rep (vacuous) could not tell the versions apart, so a tie over it is not
 * evidence the skill made no difference. Entries are `<case> › <check name>`. Report-only: they
 * never enter the receipt and never change a score (§5.1 scoring is untouched).
 */
export interface CheckDiagnostics {
  dead: string[];
  vacuous: string[];
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
  /** Rev 8: cases skipped for missing host tools, case → missing requirements. Never scored, always visible. */
  environment_skips: Record<string, string[]>;
  check_diagnostics: CheckDiagnostics;
}

/**
 * Roll rows and arm samples up into receipt numbers. `expectedRows` is k × opponents × cases;
 * a row decided by `both-arms-failed` is an unscored hole, and holes grey the verdict (§5.4).
 */
export function aggregate(rows: readonly ComparisonRow[], arms: readonly ArmSample[], expectedRows: number, environmentSkips: Record<string, string[]> = {}): Aggregate {
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
    environment_skips: environmentSkips,
    check_diagnostics: diagnoseChecks(rows),
  };
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

/**
 * Tally every check's outcome across all arms and reps. An arm that failed to run was scored
 * against the empty transcript (§7.1), which says nothing about the check, so those results are
 * left out; a check seen fewer than twice is not classified either way.
 */
export function diagnoseChecks(rows: readonly ComparisonRow[]): CheckDiagnostics {
  const tally = new Map<string, { passed: number; total: number }>();
  for (const row of rows) {
    if (row.decided_by === 'both-arms-failed') continue;
    const observed = [
      ...(row.decided_by === 'candidate-run-failed' ? [] : row.checks_candidate),
      ...(row.decided_by === 'opponent-run-failed' ? [] : row.checks_opponent),
    ];
    for (const result of observed) {
      const key = `${row.case} › ${result.name}`;
      const entry = tally.get(key) ?? { passed: 0, total: 0 };
      entry.total += 1;
      if (result.passed) entry.passed += 1;
      tally.set(key, entry);
    }
  }
  const dead: string[] = [];
  const vacuous: string[] = [];
  for (const [key, { passed, total }] of tally) {
    if (total < 2) continue;
    if (passed === 0) dead.push(key);
    else if (passed === total) vacuous.push(key);
  }
  return { dead, vacuous };
}

/** Plain-language reason for each tie label in §7.1's `decided_by` vocabulary. */
const TIE_REASONS: Record<string, string> = {
  'checks-equal-no-judge': 'the checks named no winner and, with no rubric, no judge ran',
  'judge': 'the judge called it even',
  'judge-split': 'the judge split across the two orderings',
  'judge-unparseable': 'the judge returned no usable verdict',
  'judge-refused': 'the judge refused to compare',
  'judge-network-error': 'the judge could not be reached',
  'both-arms-failed': 'both versions failed to run',
};

/** `<reason>` when every tie shares a label, else `N where <reason>; M where <reason>`. */
function tieReasons(ties: readonly ComparisonRow[]): string {
  const counts = new Map<string, number>();
  for (const row of ties) counts.set(row.decided_by, (counts.get(row.decided_by) ?? 0) + 1);
  const reason = (label: string): string => TIE_REASONS[label] ?? `decided by ${label}`;
  if (counts.size === 1) return reason([...counts.keys()][0]!);
  return [...counts].map(([label, n]) => `${n} where ${reason(label)}`).join('; ');
}

/**
 * §5.3 one-line why, from what actually decided the baseline rows. Deterministic, no LLM. Ties say
 * why they tied: a `checks-equal-no-judge` round is not "the checks came out level" — one version
 * may have passed more checks than the other — it is a round where neither version passed every
 * check (§5.1: a partial lead does not win) and no rubric existed to send it to the judge.
 */
function attributionLine(rows: readonly ComparisonRow[]): string {
  const baseline = rows.filter((row) => row.comparison === 'candidate-vs-baseline');
  if (baseline.length === 0) return 'no execution comparisons ran';
  const wins = baseline.filter((row) => row.outcome === 'win');
  const losses = baseline.filter((row) => row.outcome === 'loss');
  const ties = baseline.filter((row) => row.outcome === 'tie');
  const part = (label: string, subset: readonly ComparisonRow[]): string | null => {
    if (subset.length === 0) return null;
    const byChecks = subset.filter((row) => row.decided_by === 'checks').length;
    const via = byChecks * 2 >= subset.length ? 'execution checks' : 'judge calls';
    return `${label} on ${via}`;
  };
  const pieces = [part('wins', wins), part('loses', losses)].filter((piece): piece is string => piece !== null);
  if (pieces.length === 0) {
    const rounds = ties.length === 1 ? 'the only round drew' : `all ${ties.length} rounds drew`;
    if (ties.every((row) => row.decided_by === 'checks-equal-no-judge')) {
      return `${rounds} — neither version passed every check in any case, and a partial lead doesn't win a round; with no rubric, no judge ran`;
    }
    return `${rounds} — ${tieReasons(ties)}`;
  }
  return pieces.join('; ') + (ties.length > 0 ? `; ${ties.length} tie${ties.length === 1 ? '' : 's'} (${tieReasons(ties)})` : '');
}

/** §6: the printed report — verdict, per-comparison record, arm scores, trigger failures, efficiency. */
export function renderReport(aggregateResult: Aggregate, triggers: TriggerSummary | null): string {
  const lines: string[] = [];
  const grey = aggregateResult.execution_status !== 'complete' ? ` [${aggregateResult.execution_status} — ${aggregateResult.scored_rows}/${aggregateResult.expected_rows} scored]` : '';
  lines.push(`verdict: ${aggregateResult.verdict}${grey}`);
  lines.push(`why: ${aggregateResult.attribution}`);
  for (const [caseName, missing] of Object.entries(aggregateResult.environment_skips)) {
    lines.push(`skipped (environment): ${caseName} — missing ${missing.join(', ')}`);
  }
  for (const [comparison, summary] of Object.entries(aggregateResult.comparisons)) {
    lines.push(`${comparison}: ${summarize(summary.win, summary.loss, summary.tie)}`);
  }
  const scores = Object.entries(aggregateResult.arm_scores).map(([arm, score]) => `${arm} ${score === null ? 'n/a' : score.toFixed(2)}`);
  if (scores.length) lines.push(`arm scores: ${scores.join(' · ')}`);
  const { dead, vacuous } = aggregateResult.check_diagnostics;
  if (dead.length || vacuous.length) {
    lines.push(`check quality: ${dead.length} dead (failed in every version) · ${vacuous.length} vacuous (passed in every version) — these checks could not tell the versions apart, so a tie over them is not evidence the skill made no difference`);
    for (const name of dead) lines.push(`  dead: ${name}`);
    for (const name of vacuous) lines.push(`  vacuous: ${name}`);
  }
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
