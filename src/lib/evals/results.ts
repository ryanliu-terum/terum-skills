/**
 * Eval spec §4.2 / §5.3 / §6: local run trees, aggregation of comparison rows and arm samples
 * into the numbers a receipt carries, and the CLI report. No coercion anywhere (§5.3): unscored
 * holes stay visible, never averaged into a clean-looking number.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Arm, ArmSample, ComparisonRow, DroppedCase, Outcome } from './execution.js';
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
 * §5.3 rev 20: one arm's result on one (case × rep). `passed` is the §5.1 all-or-nothing verdict —
 * true when every deterministic check passed, false when one failed, null when it cannot be said
 * (the arm run failed twice, or the case has no checks). `checks` is [name, passed] per check; the
 * engine's `detail` string never crosses into a receipt (it can quote the transcript).
 */
export interface CaseRunArm { passed: boolean | null; checks: [string, boolean][] }
/** §5.3 rev 20: one (case × rep) — every arm's verdict plus each comparison's row outcome. */
export interface CaseRun { case: string; rep: number; arms: Partial<Record<Arm, CaseRunArm>>; outcomes: Record<string, Outcome> }
/** §5.3 rev 20: how many case-runs an arm passed, over the case-runs where `passed` is not null. */
export interface CaseRunTally { passed: number; total: number }

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
  /** Eval-gen D4: cases that never started (setup exited nonzero, files could not be staged), case → why. Never scored, always visible. */
  dropped_cases: Record<string, DroppedCase>;
  /** §5.3 rev 20: per-(case × rep) rows, in execution order. Display only — no statistic reads them. */
  per_case: CaseRun[];
  /** §5.3 rev 20: passed case-runs per arm, the card's Quality number. Same keys as `arm_scores`. */
  case_runs: Record<string, CaseRunTally>;
}

/**
 * Roll rows and arm samples up into receipt numbers. `expectedRows` is k × opponents × cases;
 * a row decided by `both-arms-failed` is an unscored hole, and holes grey the verdict (§5.4).
 */
export function aggregate(rows: readonly ComparisonRow[], arms: readonly ArmSample[], expectedRows: number, environmentSkips: Record<string, string[]> = {}, droppedCases: Record<string, DroppedCase> = {}, suiteRan = false): Aggregate {
  const comparisons: Record<string, ComparisonSummary> = {};
  const counts = new Map<string, { win: number; loss: number; tie: number }>();
  const scoredRows = rows.filter((row) => row.decided_by !== 'both-arms-failed' && !row.decided_by.endsWith('-run-failed'));
  for (const row of scoredRows) {
    const count = counts.get(row.comparison) ?? { win: 0, loss: 0, tie: 0 };
    count[row.outcome] += 1;
    counts.set(row.comparison, count);
  }
  for (const [comparison, { win, loss, tie }] of counts) {
    // Suite rows share one agent session, so they are not independent sign-test observations.
    comparisons[comparison] = { win, loss, tie, net_lift: netLift(win, loss, tie), sign_p: suiteRan ? 1.0 : signTest(win, loss) };
  }

  const armScores: Record<string, number | null> = {};
  const efficiency: Record<string, EfficiencySummary> = {};
  const scoredKeys = new Set(scoredRows.map((row) => `${row.case}\u0000${row.rep}`));
  // §2.2: a dead arm (no transcript) is unscored, so its empty-transcript fraction never enters an arm
  // score or an efficiency mean; the paired (case, rep) stays only where a row was actually scored.
  const scoredArms = arms.filter((sample) => !sample.failed && scoredKeys.has(`${sample.case}\u0000${sample.rep}`));
  for (const arm of new Set(scoredArms.map((sample) => sample.arm))) {
    const mine = scoredArms.filter((sample) => sample.arm === arm);
    const fractions = mine.map((sample) => sample.fraction).filter((value): value is number => value !== null);
    armScores[arm] = fractions.length ? fractions.reduce((sum, value) => sum + value, 0) / fractions.length : null;
    efficiency[arm] = {
      turns: mean(mine.map((sample) => sample.turns)),
      duration_ms: mean(mine.map((sample) => sample.duration_ms)),
      cost_usd: mean(mine.map((sample) => sample.cost_usd)),
    };
  }

  const scored = scoredRows.length;
  const executionStatus = expectedRows === 0 ? 'complete' : scored === 0 ? 'failed' : scored < expectedRows ? 'partial' : 'complete';
  const headline = comparisons['candidate-vs-baseline'];
  const verdict = headline ? verdictBand(headline.win, headline.loss, headline.tie) : 'NEUTRAL';
  // §2.2 (spec rev 2): an unscored row is omitted from per_case and the case_runs tally and shows only
  // as expected_rows − scored_rows; a dead suite session therefore empties every sub-case row at once.
  const perCase = perCaseRows(scoredRows, scoredArms);
  return {
    verdict,
    attribution: attributionLine(scoredRows),
    execution_status: executionStatus,
    expected_rows: expectedRows,
    scored_rows: scored,
    comparisons,
    arm_scores: armScores,
    efficiency,
    environment_skips: environmentSkips,
    dropped_cases: droppedCases,
    per_case: perCase,
    case_runs: caseRunTally(perCase, Object.keys(armScores)),
  };
}

/**
 * §5.3 rev 20: fold arm samples and comparison rows into one entry per (case × rep). Arm samples
 * seed the entries (a failed arm is `passed: null` with no checks — its checks ran against an empty
 * transcript and say nothing about the skill); rows then supply each arm's check list and the
 * comparison outcomes. Insertion order is execution order, so cases read top to bottom as they ran.
 */
export function perCaseRows(rows: readonly ComparisonRow[], arms: readonly ArmSample[]): CaseRun[] {
  const entries = new Map<string, CaseRun>();
  const failed = new Set<string>();
  const entry = (caseName: string, rep: number): CaseRun => {
    const key = `${caseName}\u0000${rep}`;
    let found = entries.get(key);
    if (!found) { found = { case: caseName, rep, arms: {}, outcomes: {} }; entries.set(key, found); }
    return found;
  };
  for (const sample of arms) {
    if (sample.failed) failed.add(`${sample.case}\u0000${sample.rep}\u0000${sample.arm}`);
    entry(sample.case, sample.rep).arms[sample.arm] = { passed: sample.failed || sample.fraction === null ? null : sample.fraction === 1, checks: [] };
  }
  const record = (target: CaseRun, arm: Arm, checks: ComparisonRow['checks_candidate']): void => {
    if (failed.has(`${target.case}\u0000${target.rep}\u0000${arm}`)) { target.arms[arm] = { passed: null, checks: [] }; return; }
    target.arms[arm] = { passed: checks.length ? checks.every((check) => check.passed) : null, checks: checks.map((check) => [check.name, check.passed]) };
  };
  for (const row of rows) {
    const target = entry(row.case, row.rep);
    target.outcomes[row.comparison] = row.outcome;
    record(target, 'candidate', row.checks_candidate);
    const opponent = row.comparison.replace(/^candidate-vs-/, '');
    if (opponent === 'baseline' || opponent === 'incumbent') record(target, opponent, row.checks_opponent);
  }
  return [...entries.values()];
}

/** §5.3 rev 20: passed / decidable case-runs per arm. A null verdict is neither passed nor counted. */
export function caseRunTally(perCase: readonly CaseRun[], armNames: readonly string[]): Record<string, CaseRunTally> {
  const tally: Record<string, CaseRunTally> = {};
  for (const arm of armNames) {
    const verdicts = perCase.map((run) => run.arms[arm as Arm]?.passed).filter((passed): passed is boolean => typeof passed === 'boolean');
    tally[arm] = { passed: verdicts.filter(Boolean).length, total: verdicts.length };
  }
  return tally;
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
  for (const [caseName, missing] of Object.entries(aggregateResult.environment_skips)) {
    lines.push(`skipped (environment): ${caseName} — missing ${missing.join(', ')}`);
  }
  for (const [caseName, dropped] of Object.entries(aggregateResult.dropped_cases)) {
    lines.push(`dropped (${dropped.kind}): ${caseName} — ${dropped.detail}`);
  }
  for (const [comparison, summary] of Object.entries(aggregateResult.comparisons)) {
    lines.push(`${comparison}: ${summarize(summary.win, summary.loss, summary.tie)}`);
  }
  const scores = Object.entries(aggregateResult.arm_scores).map(([arm, score]) => `${arm} ${score === null ? 'n/a' : score.toFixed(2)}`);
  if (scores.length) lines.push(`arm scores: ${scores.join(' · ')}`);
  const caseRuns = Object.entries(aggregateResult.case_runs).filter(([, tally]) => tally.total > 0).map(([arm, tally]) => `${arm} ${tally.passed}/${tally.total}`);
  if (caseRuns.length) lines.push(`case-runs passed: ${caseRuns.join(' · ')}`);
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
