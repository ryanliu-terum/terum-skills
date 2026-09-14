/**
 * §6: the one verb that only moves a team clone forward — fetch, then hard reset to origin/main, under the
 * per-clone writer lock, and nothing else. No placement, no pending replay, no auto-share, no push, no prompt,
 * and records `run/<team>.stamp` after every successful fetch. The stamp now means the clone was fetched at
 * its recorded time and head; it no longer claims that placements or local authoring sources were reconciled.
 *
 * It exists because every read verb is contractually fetch-free, so a teammate's committed receipt reaches this
 * machine only when someone runs a write verb. The desktop app calls this in the background on launch and on
 * window focus (Bugs.pdf W-08). A per-team failure is never a process failure: `ok` is false only when the
 * config itself cannot be read or `--team` names a team that is not configured.
 */
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { githubOwnerRepo, isRepositoryNotFound, normalizeRemote } from '../lib/remote.js';
import { fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { findSuccessors, type Successor, successorSummary, type SuccessorSearch } from '../lib/successor.js';
import { CloneBusy, type CloneState, describeClone, refreshClone, RemoteAccessError } from '../lib/teamRepo.js';
import { invocation } from '../lib/invocation.js';
import { run as move, type MoveResult } from './teamMove.js';
import { defaultWrapperOptions, installWrapper, wrapperState } from '../lib/wrapper.js';
import { stampIsFresh, writeStamp } from '../lib/hook.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SyncArgs extends WithForm {
  /** Absent means every configured team. */
  team?: string;
  config?: ConfigStore;
  runner?: Runner;
  /** Test knob: the clone lock's stale window in ms (mirrors SyncArgs.lockStale). */
  lockStale?: number;
  /** How long the fetch may run before it is killed; default REFRESH_DEADLINE_MS. */
  deadlineMs?: number;
  /** Session-start hook mode; it may refresh only Terum's managed bundled manual. */
  hook?: boolean;
  /** Test knob: the successor lookup for a team whose repository no longer exists. Defaults to lib/successor's GitHub lookup. */
  successors?: (runner: Runner, remote: string) => Promise<SuccessorSearch>;
  /** Test knob: the clock the successor cache is judged by. */
  now?: () => number;
}
/** `fresh` is hook mode only: the clone was fetched within the hour (§8), so the session-start hook left it alone. */
export type RefreshState = 'refreshed' | 'fresh' | 'busy' | 'unreachable' | 'no-clone' | 'error';
export interface RefreshTeam {
  team: string;
  state: RefreshState;
  /** True when this refresh changed what the read verbs see: HEAD moved, or a dirty tracked tree was reset. */
  changed: boolean;
  /** HEAD after the attempt, or null when it could not be read. */
  head: string | null;
  /** This CLI's own explanation for a state other than 'refreshed'. */
  detail?: string;
  /**
   * `unreachable` because the remote answered "repository not found": it was deleted, moved, or this account was never
   * given access. Set only for a GitHub remote, and only outside hook mode (the hook must stay fast and silent).
   */
  missing?: true;
  /** Where the team may have gone, best first, when `missing`; empty when GitHub was asked and knows of nothing. */
  successors?: Successor[];
  /** Why no successor could be looked up (gh absent, logged out, offline), when `missing`. */
  lookup?: string;
  /** One line for a person: the repository is gone, and what was found. Present exactly when `missing`. */
  summary?: string;
}
export interface SyncResult {
  changed: boolean;
  teams: RefreshTeam[];
  notices: string[];
  /** Set when an interactive terminal run offered a move to a found successor and the person took it. */
  moved?: MoveResult;
}
export type RefreshArgs = SyncArgs;
export type RefreshResult = SyncResult;

/** A fetch that has not finished in this long is killed; a background caller must never wedge (W-08). */
export const REFRESH_DEADLINE_MS = 20_000;
/**
 * A successor lookup is a handful of GitHub calls, and the desktop app refreshes on every window focus (at most once a
 * minute) for as long as the team stays unresolved. The answer is cached under `run/<team>.successors.json` for this
 * long; a person at a terminal always asks afresh, because they are about to act on it.
 */
export const SUCCESSOR_CACHE_MS = 10 * 60_000;
/**
 * git already runs without a terminal prompt for piped runs (lib/runner.ts), but three other routes can still raise a
 * dialog, which a silent background verb must never do: Git Credential Manager on Windows for an expired credential,
 * an inherited GIT_ASKPASS (VS Code and the desktop shells set one), and ssh's own askpass for a passphrase. Passed as
 * config through the environment so refreshClone's argument list is untouched; git ignores keys it does not know.
 * An empty GIT_ASKPASS is "no askpass program" to git (prompt.c runs one only for a non-empty value, and an empty
 * variable also stops the fall-through to core.askPass and SSH_ASKPASS), SSH_ASKPASS_REQUIRE=never keeps OpenSSH
 * 8.4+ from starting one by itself, and with no terminal on the fetch's stdin a passphrase then fails fast instead
 * of waiting on a prompt nobody sees. The `credential.interactive=false` pair is appended after any GIT_CONFIG_*
 * pairs the caller already passed, so a proxy or extra header handed down the same way survives the fetch.
 */
export function nonInteractiveGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const declared = Number(env.GIT_CONFIG_COUNT);
  // git itself rejects a count that is not a whole number; treating one as zero keeps the pair below reachable.
  const count = Number.isSafeInteger(declared) && declared >= 0 ? declared : 0;
  return { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never', GIT_CONFIG_COUNT: String(count + 1), [`GIT_CONFIG_KEY_${count}`]: 'credential.interactive', [`GIT_CONFIG_VALUE_${count}`]: 'false' };
}

export async function run(args: SyncArgs, io: Prompter): Promise<Result<SyncResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const runner = args.runner ?? systemRunner;
    const deadlineMs = args.deadlineMs ?? REFRESH_DEADLINE_MS;
    // selectTeam is the one place ambiguity is decided; an unknown --team is the only per-team failure that
    // fails the whole run, exactly as every other verb behaves.
    const names = args.team === undefined ? Object.keys(config.teams) : [selectTeam(config.teams, args.team, args.form)[0]];
    const teams: RefreshTeam[] = [];
    const notices: string[] = [];
    const gitEnv = nonInteractiveGitEnv();
    for (const team of names) {
      const binding = config.teams[team]!;
      const clone = store.teamClone(team);
      const described = await describeClone(clone, normalizeRemote(binding.remote), runner);
      // Never repair and never re-clone: `sync` and `team join` own repair, and this verb runs unattended.
      if (described.state !== 'ok') { teams.push({ team, state: 'no-clone', changed: false, head: null, detail: cloneDetail(described) }); continue; }
      // §8: the session-start hook runs at every Claude Code session start, so a clone fetched within the hour is
      // reported as `fresh` and left alone; a person at a terminal or the app asking for a fetch always gets one.
      // Concurrent hooks on one clone are serialised by the clone's own writer lock inside refreshClone.
      if (args.hook && await stampIsFresh(store.root, team, args.now)) { teams.push({ team, state: 'fresh', changed: false, head: await headOf(runner, clone) }); continue; }
      const before = await headOf(runner, clone);
      const wasDirty = await hasTrackedChanges(runner, clone);
      let outcome: RefreshTeam;
      try {
        await refreshClone(runner, clone, { label: team, env: gitEnv, lockStale: args.lockStale, deadlineMs });
        const after = await headOf(runner, clone);
        outcome = { team, state: 'refreshed', changed: wasDirty || before !== after, head: after };
      } catch (error) {
        // A background caller must never surface an error board for one team, and the clone it failed on is
        // still readable: report what happened and keep going. Re-read HEAD so the report is not a guess.
        const head = await headOf(runner, clone);
        if (error instanceof CloneBusy) outcome = { team, state: 'busy', changed: false, head, detail: error.message };
        else if (error instanceof RemoteAccessError) {
          outcome = { team, state: 'unreachable', changed: false, head, detail: [error.stderr, error.explanation].filter(Boolean).join('\n') };
          // A repository that is gone is the one unreachable state a person can act on, so say where it went. The hook
          // is exempt: it runs at every session start with nobody reading, and the lookup is a network round trip.
          const ownerRepo = githubOwnerRepo(binding.remote);
          if (!args.hook && ownerRepo && isRepositoryNotFound(error.stderr)) {
            const search = await cachedSuccessors(store.root, team, binding.remote, io.interactive && io.channel !== 'frames', () => (args.successors ?? findSuccessors)(runner, binding.remote), args.now ?? Date.now);
            outcome.missing = true;
            outcome.successors = search.successors;
            if (search.reason) outcome.lookup = search.reason;
            outcome.summary = successorSummary(team, ownerRepo, search);
          }
        }
        else outcome = { team, state: 'error', changed: false, head, detail: error instanceof Error ? error.message : String(error) };
      }
      teams.push(outcome);
      // The stamp is bookkeeping about the clone, not the clone: `state` and `changed` were decided above, and a stamp
      // that cannot be written (a full disk, an unwritable run/, a scanner holding the temp file on Windows) costs one
      // notice and a `status` that errs toward "sync", never a report that the fetch failed. A runner that cannot
      // report HEAD has no truthful stamp value, so that clone is deliberately left unstamped for retry.
      if (outcome.state === 'refreshed' && outcome.head !== null) {
        try { await writeStamp(store.root, team, { head: outcome.head, at: new Date().toISOString() }); }
        catch (error) { notices.push(`${team}: fetched, but the fetch stamp could not be written (${error instanceof Error ? error.message : String(error)}); status may call the clone stale until the next sync.`); }
      }
    }
    if (args.hook && await wrapperState(defaultWrapperOptions()) === 'outdated') {
      await installWrapper(defaultWrapperOptions());
      notices.push('Updated your /terum-skills manual for this CLI.');
    }
    if (args.hook) io.print('{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}');
    // A program reads `detail`; only a person needs the line, and a program's channel must stay result-only. In hook
    // mode stdout carries the reload directive and nothing else (lib/execute.ts routes hook notices to stderr), so
    // the lines travel as notices there: a multi-line git diagnostic after the directive would break the hook's JSON.
    const lines = teams.filter((outcome) => outcome.state !== 'refreshed' && outcome.state !== 'fresh').map((outcome) => `${outcome.team}: not refreshed (${outcome.state})${outcome.detail ? ` — ${outcome.detail}` : ''}`);
    if (args.hook) notices.push(...lines);
    else if (io.channel !== 'frames') for (const line of lines) io.print(line);
    const result: SyncResult = { changed: teams.some((outcome) => outcome.changed), teams, notices };
    // The self-driving half: a person at a terminal is offered the move right here, one question, and a shell over frames
    // gets the same facts in `successors` to draw its own button. A hook or a pipe gets the summary line and the command.
    for (const outcome of teams) {
      if (!outcome.missing || !outcome.summary) continue;
      if (io.channel === 'frames') continue;
      io.print(outcome.summary);
      const choices = (outcome.successors ?? []).map((entry) => entry.ownerRepo);
      if (choices.length === 0) continue;
      if (!io.interactive || args.hook) { io.print(`To follow it, run \`${invocation(args.form, 'team move', choices[0]!)}\`.`); continue; }
      const NOT_NOW = 'Not now';
      const picked = await io.select(`Move this machine from ${outcome.team} to the replacement?`, [...choices, NOT_NOW], choices.length === 1 ? choices[0] : NOT_NOW, { descriptions: [...(outcome.successors ?? []).map((entry) => `${entry.source === 'invitation' ? 'Invitation pending' : 'You already have access'}${entry.teamName ? `; team.json names it ${entry.teamName}` : ''}${entry.at ? `; ${entry.at.slice(0, 10)}` : ''}.`), `Leave ${outcome.team} as it is; run \`${invocation(args.form, 'team move', choices[0]!)}\` later.`] });
      if (picked === NOT_NOW) continue;
      const moved = await move({ form: args.form, target: picked, from: outcome.team, yes: true, config: store, runner }, io);
      // The refresh itself succeeded; a failed move is reported as this run's failure with the refresh facts kept.
      if (!moved.ok) return { ok: false, error: moved.error, value: result, ...(moved.cancelled ? { cancelled: true as const } : {}), ...(moved.refused ? { refused: true as const } : {}) };
      result.moved = moved.value;
      break; // one team per machine: after a move there is nothing else to offer
    }
    // This internal marker keeps the public DTO to its three declared fields while allowing the bin
    // to route hook notices to stderr. It is intentionally non-enumerable, so frames and JSON retain
    // the same SyncResult shape as ordinary sync.
    if (args.hook) Object.defineProperty(result, 'hook', { value: true });
    return success(result);
  } catch (error) { return fromError(error); }
}

interface SuccessorCache { remote: string; at: number; search: SuccessorSearch; }

/**
 * The successor lookup, cached per team for SUCCESSOR_CACHE_MS unless `fresh` (a person at a terminal). A cache that
 * cannot be read or written is simply not a cache: the lookup runs, and the result is returned either way. The cache
 * is keyed on the remote it answered for, so a re-bound team never reads a stale answer.
 */
async function cachedSuccessors(root: string, team: string, remote: string, fresh: boolean, lookup: () => Promise<SuccessorSearch>, now: () => number): Promise<SuccessorSearch> {
  const path = join(root, 'run', `${team}.successors.json`);
  if (!fresh) {
    try {
      const cached = JSON.parse(await readFile(path, 'utf8')) as Partial<SuccessorCache>;
      if (cached.remote === remote && typeof cached.at === 'number' && now() - cached.at < SUCCESSOR_CACHE_MS && now() >= cached.at && cached.search && Array.isArray(cached.search.successors)) return cached.search;
    } catch { /* absent, unreadable or malformed: look it up below and overwrite */ }
  }
  const search = await lookup();
  try {
    await mkdir(join(root, 'run'), { recursive: true, mode: 0o700 });
    const record: SuccessorCache = { remote, at: now(), search };
    await writeFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch { /* a cache that cannot be written costs one more lookup next time; the answer is still returned */ }
  return search;
}

function cloneDetail(state: Exclude<CloneState, { state: 'ok' }>): string {
  return state.state === 'absent' ? 'no clone for this team on this machine'
    : state.state === 'foreign' ? `the folder is a clone of ${state.origin}`
    : `the clone is incomplete (${state.reason})${state.error ? `: ${state.error}` : ''}`;
}

/** HEAD as a full sha, or null when the clone has no readable HEAD. Never throws: a report, not a gate. */
async function headOf(runner: Runner, clone: string): Promise<string | null> {
  try {
    const result = await runner.run('git', ['rev-parse', 'HEAD'], { cwd: clone });
    const sha = result.stdout.trim();
    return result.code === 0 && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
  } catch { return null; }
}

/**
 * Tracked modifications the hard reset will discard. Untracked files are excluded on purpose: `reset --hard`
 * leaves them, so counting them would report `changed` on every refresh of a clone holding one stray file.
 */
async function hasTrackedChanges(runner: Runner, clone: string): Promise<boolean> {
  try {
    const result = await runner.run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: clone });
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch { return false; }
}
