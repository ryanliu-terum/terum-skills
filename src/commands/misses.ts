/**
 * The `misses` verb — layer 3 (spec `.planning/specs/2026-09-17-miss-detection.md`).
 *
 * Layer 2's `usage` can tell you a skill was passed over only if it fired at least once. For a skill
 * that never fired at all, "nobody needed it" and "it was needed and missed" are the same row. This
 * verb separates them, by asking a model which skills *should* have been selected for prompts that
 * really happened, and reconciling that against what really fired.
 *
 * Three things it must never become:
 *   - a rate. The 2026-09-08 assessment established that a silent miss cannot be counted
 *     deterministically; this prints candidates for review and says so every time (§7).
 *   - a flag on `usage`. That verb promises it never spawns an agent, and the desktop drives it on
 *     every skill page (§5.1).
 *   - a writer to `usage-events.jsonl`. That archive's four-field shape is what makes it shareable
 *     to D4 later; prompt text in it would poison D4 before D4 is written (§4).
 */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import type { AgentApi } from '../lib/evals/agent.js';
import { systemAgent } from '../lib/evals/agent.js';
import type { WithForm } from '../lib/invocation.js';
import { undatedSkills, type CatalogEntry } from '../lib/misses/catalog.js';
import { harvestCorpus, type HarvestedPrompt } from '../lib/misses/harvest.js';
import { batchCount, judgePrompts } from '../lib/misses/judge.js';
import { reconcile, type Queue } from '../lib/misses/reconcile.js';
import type { Prompter } from '../lib/prompt.js';
import { failure, fromError, type Result, success } from '../lib/result.js';
import { normaliseSince } from './usage.js';
import { parseSkillFrontmatter } from '../lib/schema.js';

/** §6 — weekly cadence; monthly is the maximum retention allows, not a choice. */
export const DEFAULT_WINDOW_DAYS = 7;
/** §6 — a queue nobody finishes is a queue nobody reads. */
export const DEFAULT_LIMIT = 20;

export interface MissesArgs extends WithForm {
  ref?: string;
  since?: string;
  limit?: number;
  json?: boolean;
  config?: ConfigStore;
  agent?: AgentApi;
  projectsRoot?: string;
  now?: () => number;
}

export interface MissesResult extends Queue {
  since: string;
  until: string;
  /** Prompts that reached the judge. */
  screened: number;
  /** Model calls spent. Printed so the cost is never hidden (§6). */
  calls: number;
  /** Ledger names with no date, excluded from every catalog and disclosed (§5.3). */
  undated: string[];
  problems: { path: string; reason: string }[];
  caveats: string[];
}

/**
 * §7 — these print every time and are not suppressible. A number that reads as a measured miss rate
 * is the one thing this report must never show.
 */
const CAVEATS: readonly string[] = [
  'Counts are candidates for review, not measured misses; the judge sees a trimmed window, not the session.',
  'Skills with no recorded placement date were left out of the catalogue and cannot appear here.',
];

/**
 * The placement inventory, with each skill's description read from its placed `SKILL.md`.
 *
 * Mirrors `placedSkills()` in `usage.ts` — earliest placement wins, because that is when the skill
 * became available to be passed over — but carries the description too, which the judge needs and
 * the ledger does not store.
 */
export async function catalogEntries(placements: Record<string, { placed_at: string }>): Promise<CatalogEntry[]> {
  const byName = new Map<string, CatalogEntry>();
  for (const [path, entry] of Object.entries(placements)) {
    const name = basename(path);
    const placedAt = typeof entry.placed_at === 'string' && entry.placed_at.length > 0 ? entry.placed_at : null;
    const existing = byName.get(name);
    if (existing !== undefined && !(placedAt !== null && (existing.placedAt === null || placedAt < existing.placedAt))) continue;
    // A placement whose folder is gone still has a ledger row; it stays, undated-or-dated as the
    // ledger says, with an empty description. Dropping it would silently shrink the catalog.
    const source = await readFile(join(path, 'SKILL.md'), 'utf8').catch(() => undefined);
    const parsed = source === undefined ? undefined : parseSkillFrontmatter(source);
    byName.set(name, { name, description: parsed?.ok === true ? parsed.data.description : '', placedAt });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** §7's report, verbatim in shape. */
export function renderReport(result: MissesResult, options: { single?: boolean } = {}): string[] {
  const lines: string[] = [];
  const head = `${result.candidates} candidate${result.candidates === 1 ? '' : 's'} across ${result.prompts} prompt${result.prompts === 1 ? '' : 's'} worth reviewing`;
  const scope = options.single === true ? '' : `, ${result.screened} prompts screened`;
  lines.push(`${head} (${daysOf(result)} days${scope}, ${result.calls} judge call${result.calls === 1 ? '' : 's'}).`);
  if (result.candidates === 0) {
    lines.push('Nothing worth reviewing in this window.');
  } else {
    lines.push('These are candidates, not misses — the judge did not see your full session.');
    lines.push('');
    for (const group of result.groups) {
      const n = group.candidates.length;
      lines.push(`${group.skill}  ·  ${n} prompt${n === 1 ? '' : 's'} where it looked applicable and nothing fired`);
      for (const candidate of group.candidates) {
        const mark = candidate.noPriorContext ? '   (no prior context)' : '';
        lines.push(`  ${candidate.ts.slice(0, 10)}  ${JSON.stringify(oneLine(candidate.prompt))}${mark}`);
      }
      lines.push('');
    }
  }
  if (result.truncated) lines.push(`Queue truncated at --limit; more candidates were found than shown.`);
  if (result.unjudged > 0) lines.push(`${result.unjudged} prompt${result.unjudged === 1 ? '' : 's'} could not be judged (the model call failed); they are counted in neither direction.`);
  lines.push('', ...result.caveats);
  return lines;
}

const daysOf = (result: MissesResult): number => Math.max(1, Math.round((Date.parse(result.until) - Date.parse(result.since)) / 86_400_000));
const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 90 ? flat : `${flat.slice(0, 89)}…`;
};

export async function run(args: MissesArgs, io: Prompter): Promise<Result<MissesResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const now = args.now?.() ?? Date.now();
    const until = new Date(now).toISOString();
    const defaultSince = new Date(now - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();
    const since = args.since === undefined ? defaultSince : normaliseSince(args.since);
    if (since === null) return failure(`--since needs an ISO-8601 date or timestamp, like 2026-09-01 or 2026-09-01T00:00:00Z; received ${args.since}.`);
    const limit = args.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) return failure('--limit must be a positive integer.');

    const problems: { path: string; reason: string }[] = [];
    const harvested = await harvestCorpus({
      ...(args.projectsRoot === undefined ? {} : { root: args.projectsRoot }),
      onProblem: (path, reason) => problems.push({ path, reason }),
    });
    // §10 fail open, never quietly: an unreadable transcript is a smaller corpus, not an error, but
    // a silently smaller corpus is a wrong number nobody can see.
    for (const problem of problems) io.print(`warning: could not read ${problem.path} (${problem.reason}); its prompts are not screened.`);

    const inWindow = harvested.filter((prompt: HarvestedPrompt) => prompt.ts >= since && prompt.ts <= until);
    const entries = await catalogEntries(config.placements as Record<string, { placed_at: string }>);

    const judged = await judgePrompts(inWindow, { agent: args.agent ?? systemAgent, entries });
    const queue = reconcile(judged, { limit, ...(args.ref === undefined ? {} : { ref: args.ref }) });

    const result: MissesResult = {
      ...queue,
      since, until,
      screened: inWindow.length,
      calls: batchCount(inWindow.length),
      undated: undatedSkills(entries),
      problems,
      caveats: [...CAVEATS],
    };
    if (args.json === true) io.print(JSON.stringify(result, null, 2));
    else for (const line of renderReport(result, { single: args.ref !== undefined })) io.print(line);
    return success(result);
  } catch (error) {
    return fromError(error);
  }
}
