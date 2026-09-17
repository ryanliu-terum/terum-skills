/**
 * Layer 3, stage 5 (spec §5.6): judgments + observation sets → the candidate queue.
 *
 * A candidate is a `(prompt, skill)` PAIR, never a prompt. `SELECTION_PROMPT` returns a list, so one
 * prompt can be a candidate for three skills and appear under three headings — and the headline has
 * to name both units or a reader will read the pair count as a prompt count.
 */
import type { HarvestedPrompt } from './harvest.js';

export interface Candidate {
  skill: string;
  prompt: string;
  ts: string;
  noPriorContext: boolean;
}

export interface CandidateGroup {
  skill: string;
  candidates: Candidate[];
}

export interface Judged {
  prompt: HarvestedPrompt;
  /** Skills the judge named. An errored batch yields `null` — never a false "applies". */
  selected: string[] | null;
}

export interface Queue {
  groups: CandidateGroup[];
  /** Total `(prompt, skill)` pairs after the cap. */
  candidates: number;
  /** Distinct prompts with a surviving candidate — differs from `candidates` (§5.6.5). */
  prompts: number;
  /** True when `--limit` dropped pairs, including mid-group. */
  truncated: boolean;
  /** Prompts whose judge batch errored, so they were never judged in either direction. */
  unjudged: number;
}

export interface ReconcileOptions {
  limit: number;
  /** Narrow the printed queue to one skill. A view filter only — never narrows the catalog (§5.3). */
  ref?: string;
}

/**
 * §5.6.2 — a candidate survives only when the prompt's observation set holds NO observation for
 * *that* skill, of either kind. A D2 observation drops it because the human already chose: that is
 * layer 2's row, not a miss.
 */
export function reconcile(judged: readonly Judged[], options: ReconcileOptions): Queue {
  const bySkill = new Map<string, Candidate[]>();
  let unjudged = 0;

  for (const row of judged) {
    if (row.selected === null) { unjudged += 1; continue; }
    const fired = new Set(row.prompt.observations.map((observation) => observation.skill));
    for (const skill of row.selected) {
      if (fired.has(skill)) continue;
      if (options.ref !== undefined && skill !== options.ref) continue;
      const list = bySkill.get(skill) ?? [];
      list.push({ skill, prompt: row.prompt.text, ts: row.prompt.ts, noPriorContext: row.prompt.noPriorContext });
      bySkill.set(skill, list);
    }
  }

  // §5.6.3 — ordering is total, so two runs over one corpus print identically. Corpus order is the
  // final tiebreak: `judged` arrives in walk order (project, file, record), which is already sorted,
  // and a stable sort preserves it under equal timestamps.
  const groups: CandidateGroup[] = [...bySkill.entries()]
    .map(([skill, candidates]) => ({ skill, candidates }))
    .sort((a, b) => b.candidates.length - a.candidates.length || a.skill.localeCompare(b.skill));
  for (const group of groups) group.candidates.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  // §5.6.4 — a GLOBAL cap on pairs, applied AFTER the full ordering, truncating mid-group if that is
  // where the budget runs out.
  let budget = options.limit;
  const capped: CandidateGroup[] = [];
  let truncated = false;
  for (const group of groups) {
    if (budget <= 0) { truncated = true; break; }
    const take = group.candidates.slice(0, budget);
    if (take.length < group.candidates.length) truncated = true;
    budget -= take.length;
    capped.push({ skill: group.skill, candidates: take });
  }

  const kept = new Set<string>();
  let candidates = 0;
  for (const group of capped) {
    candidates += group.candidates.length;
    for (const candidate of group.candidates) kept.add(`${candidate.ts} ${candidate.prompt}`);
  }
  return { groups: capped, candidates, prompts: kept.size, truncated, unjudged };
}
