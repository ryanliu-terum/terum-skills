/**
 * Layer 3, stage 4's input (spec §5.3): the catalog **as it was at the prompt's timestamp**.
 *
 * The failure this prevents is the one most likely to make the feature cry wolf. `endorsedCatalog()`
 * builds from the Library root as it is *now*; showing the judge today's catalog against a
 * three-week-old prompt makes it flag every skill installed since as a miss. Parent §2.2 is explicit
 * that the transcript cannot answer "was this available?" — so it is reconstructed from the
 * placements ledger, or the skill is left out.
 */

export interface CatalogEntry {
  name: string;
  description: string;
  /** ISO-8601 from the ledger, or null when the ledger records no date. */
  placedAt: string | null;
}

/**
 * The entries available at `ts`.
 *
 * A `null` placedAt is **excluded**, not assumed available. This is the one place "unknown" must
 * not be read as "yes": a false miss is worse than a missed miss in a queue a human reads (§5.3).
 */
export function catalogAsOf(entries: readonly CatalogEntry[], ts: string): CatalogEntry[] {
  return entries
    .filter((entry) => entry.placedAt !== null && entry.placedAt <= ts)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The `- name: description` shape layer 1's `SELECTION_PROMPT` expects (`evals/triggers.ts`). */
export function renderCatalog(entries: readonly CatalogEntry[]): string {
  return entries.map((entry) => `- ${entry.name}: ${entry.description}`).join('\n');
}

/** Names the ledger knows but cannot date, so §7 can disclose what it could not consider. */
export function undatedSkills(entries: readonly CatalogEntry[]): string[] {
  return entries.filter((entry) => entry.placedAt === null).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}
