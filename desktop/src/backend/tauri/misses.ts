import { z } from 'zod';
import type { MissesModel } from '../types';

/** Mirrors `MissesResult` in src/commands/misses.ts. `passthrough()` throughout: a NEWER CLI may add
 *  fields and a read must degrade rather than throw. An OLDER CLI never gets here — it does not
 *  advertise `features.misses`, so the control is disabled and the verb is never spawned. */
const candidate = z.object({
  skill: z.string(), prompt: z.string(), ts: z.string(), noPriorContext: z.boolean(),
}).passthrough();

export const cliMisses = z.object({
  groups: z.array(z.object({ skill: z.string(), candidates: z.array(candidate) }).passthrough()),
  candidates: z.number(),
  prompts: z.number(),
  truncated: z.boolean(),
  unjudged: z.number(),
  since: z.string(),
  until: z.string(),
  screened: z.number(),
  calls: z.number(),
  caveats: z.array(z.string()),
}).passthrough();

export type CliMisses = z.infer<typeof cliMisses>;

/**
 * The whole machine's screening result.
 *
 * Called ONCE with no ref, and the panel filters — the same rule `mapUsage` follows, for a sharper
 * reason. Passing `misses <skill>` does NOT narrow the work: `judgePrompts` judges every harvested
 * prompt against the full as-of-T catalog and `reconcile` filters only afterwards, so a per-skill
 * run costs exactly what a whole-machine run costs. Calling it once per skill page would therefore
 * bill the user once per page for a result the first run already computed.
 *
 * The caveats are carried through verbatim and the panel prints them every time. They are the only
 * thing standing between a candidate list and a reader who takes it for a measured miss rate.
 */
export function mapMisses(report: CliMisses): MissesModel {
  return {
    groups: report.groups.map(g => ({
      skill: g.skill,
      candidates: g.candidates.map(c => ({ prompt: c.prompt, ts: c.ts, noPriorContext: c.noPriorContext })),
    })),
    screened: report.screened,
    calls: report.calls,
    truncated: report.truncated,
    unjudged: report.unjudged,
    since: report.since,
    until: report.until,
    caveats: report.caveats,
  };
}
