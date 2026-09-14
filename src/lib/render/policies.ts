/**
 * §5 selection policies — pure functions with the desktop's semantics where the desktop already has
 * them (desktop/src/backend/mock/derive.ts, receipt-summary.ts, score-fractions.ts), so a later
 * desktop import changes no pixel. This module imports NOTHING (a leaf the desktop bundle may take).
 */
export type Verdict = 'PASS' | 'NEUTRAL' | 'FAIL';

/** PASS when 3(w−l) ≥ n, FAIL when 3(l−w) ≥ n, else NEUTRAL; null when there is nothing to band. */
export function verdictBand(w: number, l: number, t: number): Verdict | null {
  const n = w + l + t;
  if (!(n > 0)) return null;
  if (3 * (w - l) >= n) return 'PASS';
  if (3 * (l - w) >= n) return 'FAIL';
  return 'NEUTRAL';
}

export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Cannot round a non-finite number.');
  const floor = Math.floor(value);
  const fraction = value - floor;
  return fraction === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value);
}

export function liftPercent(w: number, l: number, t: number): number | null {
  const n = w + l + t;
  return n > 0 ? roundHalfEven(((w - l) / n) * 100) : null;
}

export function liftText(lift: number | null): string {
  if (lift === null) return '—';
  return `${lift > 0 ? '+' : lift < 0 ? '−' : '±'}${Math.abs(lift)}%`;
}

export const HEADLINE_COMPARISON = 'candidate-vs-baseline';

export interface ComparisonLike { win: number; loss: number; tie: number; net_lift?: number; sign_p?: number }
export interface ReceiptLike { verdict: Verdict; execution_status: 'complete' | 'partial' | 'failed'; expected_rows: number; scored_rows: number; comparisons: Record<string, ComparisonLike> }
export interface ReceiptSummary { verdict: Verdict; w: number; l: number; t: number; n: number; lift: number | null; partial: [number, number] | null; signP: string | null }

/** One receipt's headline numbers — never combined across receipts (eval-engine spec §12). */
export function summariseReceipt(receipt: ReceiptLike | null | undefined): ReceiptSummary | null {
  if (!receipt) return null;
  const comparison = receipt.comparisons?.[HEADLINE_COMPARISON];
  const w = comparison?.win ?? 0, l = comparison?.loss ?? 0, t = comparison?.tie ?? 0;
  return {
    verdict: receipt.verdict, w, l, t, n: w + l + t,
    lift: comparison ? liftPercent(w, l, t) : null,
    partial: receipt.execution_status === 'partial' ? [receipt.scored_rows, receipt.expected_rows] : null,
    signP: comparison && typeof comparison.sign_p === 'number' ? comparison.sign_p.toFixed(3) : null,
  };
}

/** The record strip: counts only — receipts carry no per-case order (spec §4.1). */
export function stripText(w: number, l: number, t: number): string { return 'W'.repeat(w) + 'L'.repeat(l) + 'T'.repeat(t); }

export function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function marketplaceOrder(a: { installs: number; name: string }, b: { installs: number; name: string }): number {
  return b.installs - a.installs || compareText(a.name, b.name);
}

export type LibraryState = 'broken' | 'edited' | 'placed' | 'shared' | 'untracked';
const LIBRARY_LADDER: readonly LibraryState[] = ['broken', 'edited', 'placed', 'shared', 'untracked'];
/** `known`: the folder's uuid belongs to a team skill (`knownToTeam`, PR #199) — the 'shared' state. */
export interface LibraryRowLike { name: string; edited: boolean; tracked: boolean; known: boolean; problem?: string }

export function libraryState(row: LibraryRowLike): LibraryState {
  return row.problem !== undefined ? 'broken' : row.edited ? 'edited' : row.tracked ? 'placed' : row.known ? 'shared' : 'untracked';
}

export function libraryOrder(a: LibraryRowLike, b: LibraryRowLike): number {
  return LIBRARY_LADDER.indexOf(libraryState(a)) - LIBRARY_LADDER.indexOf(libraryState(b)) || compareText(a.name, b.name);
}

export function adoption(person: { authored: readonly string[] }, installs: ReadonlyMap<string, number>): number {
  return person.authored.reduce((sum, id) => sum + (installs.get(id) ?? 0), 0);
}

export function peopleOrder(installs: ReadonlyMap<string, number>): (a: { handle: string; authored: readonly string[] }, b: { handle: string; authored: readonly string[] }) => number {
  return (a, b) => adoption(b, installs) - adoption(a, installs) || compareText(a.handle, b.handle);
}

export function projectsOrder(members: ReadonlyMap<string, number>): (a: { name: string }, b: { name: string }) => number {
  return (a, b) => (members.get(b.name) ?? 0) - (members.get(a.name) ?? 0) || compareText(a.name, b.name);
}

/** `v<N>` → N; anything else (null, a legacy tree hash, `v0`) → null. Re-declared here because this module imports nothing. */
export function parseVersionOrdinal(version: string | null | undefined): number | null {
  if (typeof version !== 'string' || !/^v[1-9][0-9]*$/.test(version)) return null;
  const n = Number(version.slice(1));
  return Number.isSafeInteger(n) ? n : null;
}

/** Version DESC (numeric), then run id DESC — `evalReport.ts byVersionThenRun`. */
export function historyOrder(a: { version: string; run_id: string }, b: { version: string; run_id: string }): number {
  const left = parseVersionOrdinal(a.version) ?? -1;
  const right = parseVersionOrdinal(b.version) ?? -1;
  return right - left || compareText(b.run_id, a.run_id);
}

export function localRunsOrder(a: { run_id: string }, b: { run_id: string }): number { return compareText(b.run_id, a.run_id); }

export interface AttentionCounts { failing: number; notEvaluated: number; edited: number; attention: number }

export function attentionCounts(rows: readonly { localVerdict: Verdict | null; edited: boolean; broken: boolean }[]): AttentionCounts {
  const failing = rows.filter((row) => row.localVerdict === 'FAIL').length;
  const notEvaluated = rows.filter((row) => !row.broken && row.localVerdict === null).length;
  const edited = rows.filter((row) => row.edited).length;
  return { failing, notEvaluated, edited, attention: failing + notEvaluated + edited };
}

/** ▲ only when the viewer's recorded install is a `v<N>` folder numerically older than the latest. */
export function updateAvailable(latest: string, installed: string | null | undefined): boolean {
  const newest = parseVersionOrdinal(latest);
  const held = parseVersionOrdinal(installed);
  return newest !== null && held !== null && held < newest;
}

export function verdictCounts(verdicts: readonly (Verdict | null)[]): { PASS: number; NEUTRAL: number; FAIL: number; notEvaluated: number } {
  const counts = { PASS: 0, NEUTRAL: 0, FAIL: 0, notEvaluated: 0 };
  for (const verdict of verdicts) { if (verdict === null) counts.notEvaluated += 1; else counts[verdict] += 1; }
  return counts;
}

export function applyRowCap<T>(rows: readonly T[], cap: number | 'all'): { rows: T[]; more: number } {
  if (cap === 'all' || rows.length <= cap) return { rows: [...rows], more: 0 };
  return { rows: rows.slice(0, cap), more: rows.length - cap };
}

/** Above five rows the not-offered list is grouped by reason (first-seen order, count DESC); `--rows all` lists them all. */
export function groupNotOffered<T extends { reason: string }>(rows: readonly T[], cap: number | 'all'): { grouped: boolean; groups: { reason: string; count: number }[] } {
  if (cap === 'all' || rows.length <= 5) return { grouped: false, groups: [] };
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  return { grouped: true, groups: [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) };
}

/** First sentence when it fits in `max` code points, else the first `max` code points and `…`; always one line. */
export function shortDescription(description: string | null | undefined, max = 80): string {
  if (typeof description !== 'string' || description.trim() === '') return '—';
  const flat = description.replace(/\s*\r?\n\s*/g, ' ').trim();
  const sentence = /^(.*?[.!?])(?:\s|$)/.exec(flat)?.[1] ?? flat;
  if ([...sentence].length <= max) return sentence;
  return `${[...flat].slice(0, max).join('')}…`;
}

/** The person's name out of a `Name <email>` byline; `—` for an empty one. */
export function displayName(author: string | null | undefined): string {
  const name = (author ?? '').replace(/\s*<[^>]*>\s*$/, '').trim();
  return name === '' ? '—' : name;
}

export interface EvalEstimate { cases: number; k: number; arms: number; runs: number; minutes: number; dollars: number }

/** `derive.ts eval_estimate`: per-arm means × cases × k; null when any arm lacks a duration or a cost, or there is nothing to run. */
export function evalEstimate(input: { cases: number; k: number; efficiency: Record<string, { duration_ms: number | null; cost_usd: number | null }> }): EvalEstimate | null {
  const arms = Object.values(input.efficiency);
  const perArm = input.cases * input.k;
  if (arms.length === 0 || !(perArm > 0)) return null;
  if (arms.some((arm) => arm.duration_ms === null || arm.cost_usd === null)) return null;
  const seconds = arms.reduce((sum, arm) => sum + (arm.duration_ms as number) / 1000, 0) * perArm;
  const dollars = arms.reduce((sum, arm) => sum + (arm.cost_usd as number), 0) * perArm;
  return { cases: input.cases, k: input.k, arms: arms.length, runs: perArm * arms.length, minutes: 5 * roundHalfEven(seconds / 300), dollars: roundHalfEven(dollars) };
}

/** `score-fractions.ts`: each arm's cost over the costlier arm; null without two finite costs or when both are zero. */
export function roiFractions(candidate: number | null | undefined, baseline: number | null | undefined): [number, number] | null {
  if (candidate == null || baseline == null) return null;
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) return null;
  const max = Math.max(candidate, baseline);
  if (max <= 0) return null;
  return [candidate / max, baseline / max];
}
