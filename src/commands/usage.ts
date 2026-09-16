/**
 * The `usage` verb — which skills fired on this machine, and whether the model chose them or a
 * human named them (build spec §6). Read-only over the team repo: it never takes the clone lock,
 * never fetches, never spawns an agent, and makes no model call. Its only write is an append to the
 * machine-local event archive (D2, §8).
 *
 * The one number this exists for: a skill with `0 autonomous, N explicit` is one people reach for
 * and the model never picks from its description. Measured 2026-09-15, `codex-spec` and `handoff`
 * were exactly that.
 */
import { basename } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, type Result, success } from '../lib/result.js';
import { aggregate, type PlacedSkill, type UsageReport } from '../lib/usage/aggregate.js';
import { appendEvents, archivePath, readArchive } from '../lib/usage/archive.js';
import { eventKey } from '../lib/usage/archive.js';
import { scanTranscripts, type UsageEvent } from '../lib/usage/transcripts.js';

/** The window §7's caveat is written for: Claude Code prunes transcripts at roughly this age. */
export const DEFAULT_WINDOW_DAYS = 30;

export interface UsageArgs extends WithForm {
  /** Narrow to one skill. */
  ref?: string;
  /** ISO-8601 lower bound. Older than retention is answerable only from the archive. */
  since?: string;
  /** Fold the `unrecognised` tail into the main table. */
  all?: boolean;
  json?: boolean;
  config?: ConfigStore;
  /** Test knob: where Claude Code keeps transcripts. */
  projectsRoot?: string;
  /** Test knob. */
  now?: () => number;
}

export interface UsageResult extends UsageReport {
  /** How many events this run added to the archive. */
  archived: number;
  /** Transcripts that could not be read. Fail open, never quietly (§10). */
  problems: { path: string; reason: string }[];
  /** True when the window reaches past retention, so the archive supplied part of the answer. */
  usedArchive: boolean;
  caveats: string[];
}

/**
 * The caveats are load-bearing and each traces to something measured (§7). They are printed every
 * time, never suppressed by a flag — a number that implies a skill *helped* is the one thing this
 * report must never print.
 */
const CAVEATS: readonly string[] = [
  'Counts are invocations, not outcome-changing uses; reopenings are not deduped.',
  `${DEFAULT_WINDOW_DAYS}-day window: Claude Code prunes transcripts, so earlier use is visible only where this machine has already archived it.`,
];

/**
 * Rows come from the placements ledger (D1). The key is the placement path; the skill's name is its
 * basename, which is what the Placer wrote and what a firing record names.
 *
 * Every placement carries a team, so every row is labelled `team` today. `library` and
 * `bundled-or-foreign` arrive with the Library scan in a later slice; inventing them here from a
 * path shape would be a guess, and §5 is explicit that provenance is ledger evidence.
 */
export function placedSkills(placements: Record<string, { team: string; placed_at: string }>): PlacedSkill[] {
  const byName = new Map<string, PlacedSkill>();
  for (const [path, entry] of Object.entries(placements)) {
    const name = basename(path);
    const placedAt = typeof entry.placed_at === 'string' && entry.placed_at.length > 0 ? entry.placed_at : null;
    const existing = byName.get(name);
    // The same skill can be placed in more than one scope; the earliest placement is when it became
    // available to be passed over, so it is the one the availability rule needs.
    if (existing === undefined || (placedAt !== null && (existing.placedAt === null || placedAt < existing.placedAt))) {
      byName.set(name, { name, label: 'team', placedAt });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * §7's report, verbatim in shape. The `never chosen from its description` annotation is the whole
 * point of the verb: it marks a skill people reach for that the model never picks on its own.
 *
 * Every caveat prints every time. A rate that implies the skill *helped* is the one thing this
 * report must never show, and the disclaimers are what keep the counts honest (ryanliu, `8ec17dd7`).
 */
export function renderReport(report: UsageResult, options: { all?: boolean; single?: boolean } = {}): string[] {
  const lines: string[] = [];
  const width = Math.max(0, ...report.rows.map((row) => row.skill.length), ...(options.all || options.single === true ? report.unrecognised.map((row) => row.skill.length) : []));
  const fired = report.rows.filter((row) => row.d1 + row.d2 > 0);
  for (const row of fired) {
    const note = row.autonomy === 0 ? '  ·  never chosen from its description' : '';
    const partial = row.availability === 'full' ? '' : `  (${row.availability === 'partial' ? 'placed mid-window' : 'availability unknown'})`;
    lines.push(`${row.skill.padEnd(width)}  ${String(row.d1).padStart(2)} autonomous   ${String(row.d2).padStart(2)} explicit${note}${partial}`);
  }
  if (fired.length === 0 && report.unrecognised.length === 0) lines.push('No placed skill fired in this window.');
  // A whole-machine tally means nothing when one skill was asked about, and reads as noise when
  // that skill has no placement row at all.
  if (!(options.single === true && report.rows.length === 0)) lines.push(`${report.unused} skill${report.unused === 1 ? '' : 's'} placed here and never fired in this window.`);
  if ((options.all || options.single === true) && report.unrecognised.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Fired here, but not placed by this machine — so how long it was available is unknown:');
    for (const row of report.unrecognised) lines.push(`${row.skill.padEnd(width)}  ${String(row.d1).padStart(2)} autonomous   ${String(row.d2).padStart(2)} explicit`);
  } else if (report.unrecognised.length > 0) {
    lines.push(`${report.unrecognised.length} fired name${report.unrecognised.length === 1 ? '' : 's'} had no placement here; pass --all to list them.`);
  }
  lines.push('', ...report.caveats);
  return lines;
}

export async function run(args: UsageArgs, io: Prompter): Promise<Result<UsageResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const now = args.now?.() ?? Date.now();
    const until = new Date(now).toISOString();
    const defaultSince = new Date(now - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();
    const since = args.since ?? defaultSince;

    const problems: { path: string; reason: string }[] = [];
    const scanned = await scanTranscripts({
      ...(args.projectsRoot === undefined ? {} : { root: args.projectsRoot }),
      onProblem: (path, reason) => problems.push({ path, reason }),
    });

    // Append BEFORE reporting, so a run always widens what the next one can see — including when
    // this run's window is narrower than what the transcripts still hold.
    const path = archivePath(store.root);
    const archived = await appendEvents(path, scanned);

    // The default window is answered from transcripts alone: deleting the archive must not change a
    // number this report prints. Only a window reaching past retention consults it.
    const usedArchive = since < defaultSince;
    let events: UsageEvent[] = scanned;
    if (usedArchive) {
      const seen = new Set(scanned.map(eventKey));
      events = [...scanned, ...(await readArchive(path)).filter((event) => !seen.has(eventKey(event)))];
    }

    // §10 — fail open, never quietly. An unreadable transcript is a smaller corpus, not an error,
    // but a silently smaller corpus is a wrong number nobody can see.
    for (const problem of problems) io.print(`warning: could not read ${problem.path} (${problem.reason}); its firings are not counted.`);

    let placed = placedSkills(config.placements);
    if (args.ref !== undefined) placed = placed.filter((skill) => skill.name === args.ref);
    let report = aggregate(events, placed, { since, until });
    // Asked about ONE skill, answer about that skill. The tail otherwise reports every other
    // unplaced name on the machine, which is noise here — and worse, a skill that fired from a copy
    // Terum did not place would have its counts withheld behind a `--all` hint.
    if (args.ref !== undefined) report = { ...report, unrecognised: report.unrecognised.filter((row) => row.skill === args.ref) };
    const result: UsageResult = { ...report, archived, problems, usedArchive, caveats: [...CAVEATS] };
    // The verb renders itself; `execute` writes nothing on success to a terminal, and frame mode
    // carries `result` as the value regardless (lib/execute.ts).
    if (args.json === true) io.print(JSON.stringify(result, null, 2));
    else for (const line of renderReport(result, { ...(args.all === undefined ? {} : { all: args.all }), single: args.ref !== undefined })) io.print(line);
    return success(result);
  } catch (error) {
    return fromError(error);
  }
}
