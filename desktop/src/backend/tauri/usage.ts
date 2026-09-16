import { z } from 'zod';
import type { UsageModel } from '../types';

/** Mirrors `UsageResult` in src/commands/usage.ts. `passthrough()` throughout: a NEWER CLI may add
 *  fields, and a read must degrade rather than throw. An OLDER CLI is handled before we get here —
 *  it does not advertise `features.usage`, so the control is greyed and the verb is never spawned. */
const row = z.object({
  skill: z.string(), label: z.string(), d1: z.number(), d2: z.number(),
  autonomy: z.number().nullable(), availability: z.enum(['full', 'partial', 'unknown']),
}).passthrough();

export const cliUsage = z.object({
  since: z.string(), until: z.string(),
  rows: z.array(row),
  unused: z.number(),
  unrecognised: z.array(z.object({ skill: z.string(), d1: z.number(), d2: z.number() }).passthrough()),
  caveats: z.array(z.string()),
}).passthrough();

export type CliUsage = z.infer<typeof cliUsage>;

/**
 * One skill's firings out of the whole-machine report.
 *
 * The verb is called ONCE with no ref and filtered here, never once per skill. `usage <skill>`
 * filters AFTER the corpus scan, so a per-skill spawn costs the same full scan as an unfiltered one
 * (measured 2026-09-15: 1.3s either way over 706 transcripts / 160 MB), and `cached()` keys on argv,
 * so per-skill calls would be per-skill cache entries and per-skill rescans.
 *
 * `firings: null` means **no placement on this machine** — a different statement from "placed and
 * never fired", which is `{d1: 0, d2: 0}`. The panel must say different things about them: the
 * second is the interesting case this feature exists to surface, the first is just absence.
 */
export function mapUsage(report: CliUsage, skill: string): UsageModel {
  const found = report.rows.find(r => r.skill === skill) ?? null;
  return {
    firings: found === null ? null : { d1: found.d1, d2: found.d2, autonomy: found.autonomy, availability: found.availability },
    since: report.since, until: report.until, caveats: report.caveats,
  };
}
