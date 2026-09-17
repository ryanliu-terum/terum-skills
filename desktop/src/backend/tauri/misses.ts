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
 * One skill's candidates out of the run.
 *
 * Unlike `mapUsage`, this is called WITH a ref: the CLI filters before the judge is even asked, and
 * more to the point a whole-machine run would judge every prompt against every skill and bill for
 * it. Narrowing is the cheap thing here, not the expensive thing.
 *
 * The caveats are carried through verbatim and the panel prints them every time. They are the only
 * thing standing between a candidate list and a reader who takes it for a measured miss rate.
 */
export function mapMisses(report: CliMisses, skill: string): MissesModel {
  const group = report.groups.find(g => g.skill === skill);
  return {
    candidates: (group?.candidates ?? []).map(c => ({ prompt: c.prompt, ts: c.ts, noPriorContext: c.noPriorContext })),
    screened: report.screened,
    calls: report.calls,
    truncated: report.truncated,
    unjudged: report.unjudged,
    since: report.since,
    until: report.until,
    caveats: report.caveats,
  };
}
