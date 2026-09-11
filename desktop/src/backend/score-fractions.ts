/**
 * Bar fractions for the ROI group: each arm's cost as a share of the more expensive arm, so the
 * costlier arm draws a full bar and the caption's "lower wins" reads correctly. Null whenever either
 * arm reports no cost, or neither arm cost anything — the caller then draws the honest empty track
 * rather than a bar built from a number nobody measured.
 */
export function roiFractions(candidate: number | null | undefined, baseline: number | null | undefined): [number, number] | null {
  if (candidate == null || baseline == null) return null;
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) return null;
  const max = Math.max(candidate, baseline);
  if (max <= 0) return null;
  return [candidate / max, baseline / max];
}
