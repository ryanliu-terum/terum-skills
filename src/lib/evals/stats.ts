/**
 * Eval spec §7 / §16.5–6: honest statistics for small, noisy pairwise samples — a two-sided
 * sign test and net lift. Anything fancier is false precision on top of judge noise.
 * Pure (ME1): no I/O anywhere in this module.
 */

export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1.0;
  const k = Math.min(wins, losses);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += comb(n, i);
  return Math.min(1.0, (2 * tail) / 2 ** n);
}

function comb(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

/** Fraction of comparisons the skill improved minus the fraction it degraded; ties dilute. */
export function netLift(wins: number, losses: number, ties: number): number {
  const n = wins + losses + ties;
  return n ? (wins - losses) / n : 0;
}

export type Verdict = 'PASS' | 'NEUTRAL' | 'FAIL';

/**
 * §16.5 banding on candidate-vs-baseline net lift: PASS ≥ +1/3, FAIL ≤ −1/3, else NEUTRAL.
 * Compared in integers so the ±1/3 boundaries are exact, never float-rounded.
 */
export function verdictBand(wins: number, losses: number, ties: number): Verdict {
  const n = wins + losses + ties;
  if (n === 0) return 'NEUTRAL';
  const net = wins - losses;
  if (3 * net >= n) return 'PASS';
  if (3 * net <= -n) return 'FAIL';
  return 'NEUTRAL';
}

export function summarize(wins: number, losses: number, ties: number): string {
  const p = signTest(wins, losses);
  const n = wins + losses + ties;
  const lift = 100 * netLift(wins, losses, ties);
  const signed = `${lift >= 0 ? '+' : ''}${lift.toFixed(0)}%`;
  return `${signed} net lift (${wins}W / ${losses}L / ${ties}T over ${n} comparisons, sign test p=${p.toFixed(3)})`;
}
