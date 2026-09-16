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
 * Three sources, in order, because an observed firing is evidence no matter who placed the copy:
 *
 *  1. a **row** — this skill is in Terum's `placements` ledger, so its availability is known;
 *  2. the **`unrecognised` tail** — it fired here but Terum did not place it (a hand-installed
 *     folder under `~/.claude/skills/`, which the app itself labels "yours, not placed by Terum").
 *     `placed: false`, availability unknown, because no ledger row means no `placed_at`;
 *  3. neither — nothing was observed. That is NOT the same as "not installed", and the panel must
 *     not claim it is: this model sees firings, not the filesystem.
 *
 * Dropping case 2 was a real bug — `decision-walk` had four recorded firings and the tab said there
 * was nothing to observe, while the rail beside it read "Installed · on this machine".
 */
export function mapUsage(report: CliUsage, skill: string): UsageModel {
  const row = report.rows.find(r => r.skill === skill);
  const loose = row === undefined ? report.unrecognised.find(r => r.skill === skill) : undefined;
  const firings = row !== undefined
    ? { d1: row.d1, d2: row.d2, autonomy: row.autonomy, availability: row.availability, placed: true }
    : loose !== undefined
      ? { d1: loose.d1, d2: loose.d2, autonomy: loose.d1 + loose.d2 === 0 ? null : loose.d1 / (loose.d1 + loose.d2), availability: 'unknown' as const, placed: false }
      : null;
  return { firings, since: report.since, until: report.until, caveats: report.caveats };
}
