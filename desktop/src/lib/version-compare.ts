/** Stable-channel comparison, the same three-segment rule the CLI uses (src/lib/update.ts:78).
 *  Anything that is not exactly x.y.z (the mock's "0.1.0 (build 12)", a prerelease tag, null)
 *  is not comparable, and an incomparable pair is never "newer". */
export function isNewer(candidate: string | null | undefined, running: string | null | undefined): boolean {
  if (!candidate || !running || !/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(running)) return false;
  const left = candidate.split('.').map(Number), right = running.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (left[i]! > right[i]!) return true; if (left[i]! < right[i]!) return false; }
  return false;
}
