/**
 * §6: the one verb that only moves a team clone forward — fetch, then hard reset to origin/main, under the
 * per-clone writer lock, and nothing else. No placement, no pending replay, no auto-share, no push, no prompt,
 * and deliberately NO `run/<team>.stamp` write: the stamp means "fully synced" (src/commands/sync.ts, and
 * stampIsFresh in src/lib/hook.ts suppresses the session hook for an hour), which a fetch does not earn.
 *
 * It exists because every read verb is contractually fetch-free, so a teammate's committed receipt reaches this
 * machine only when someone runs a write verb. The desktop app calls this in the background on launch and on
 * window focus (Bugs.pdf W-08). A per-team failure is never a process failure: `ok` is false only when the
 * config itself cannot be read or `--team` names a team that is not configured.
 */
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { normalizeRemote } from '../lib/remote.js';
import { fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { CloneBusy, type CloneState, describeClone, refreshClone, RemoteAccessError } from '../lib/teamRepo.js';

export interface RefreshArgs extends WithForm {
  /** Absent means every configured team. */
  team?: string;
  config?: ConfigStore;
  runner?: Runner;
  /** Test knob: the clone lock's stale window in ms (mirrors SyncArgs.lockStale). */
  lockStale?: number;
  /** How long the fetch may run before it is killed; default REFRESH_DEADLINE_MS. */
  deadlineMs?: number;
}
export type RefreshState = 'refreshed' | 'busy' | 'unreachable' | 'no-clone' | 'error';
export interface RefreshTeam {
  team: string;
  state: RefreshState;
  /** True when this refresh changed what the read verbs see: HEAD moved, or a dirty tracked tree was reset. */
  changed: boolean;
  /** HEAD after the attempt, or null when it could not be read. */
  head: string | null;
  /** This CLI's own explanation for a state other than 'refreshed'. */
  detail?: string;
}
export interface RefreshResult { changed: boolean; teams: RefreshTeam[] }

/** A fetch that has not finished in this long is killed; a background caller must never wedge (W-08). */
export const REFRESH_DEADLINE_MS = 20_000;
/**
 * git already runs without a terminal prompt for piped runs (lib/runner.ts), but Git Credential Manager can raise
 * a GUI dialog on Windows for an expired credential, which a silent background verb must never do. Passed as
 * config through the environment so refreshClone's argument list is untouched; git ignores keys it does not know.
 */
const NON_INTERACTIVE_GIT: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.interactive', GIT_CONFIG_VALUE_0: 'false' };

export async function run(args: RefreshArgs, io: Prompter): Promise<Result<RefreshResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const runner = args.runner ?? systemRunner;
    const deadlineMs = args.deadlineMs ?? REFRESH_DEADLINE_MS;
    // selectTeam is the one place ambiguity is decided; an unknown --team is the only per-team failure that
    // fails the whole run, exactly as every other verb behaves.
    const names = args.team === undefined ? Object.keys(config.teams) : [selectTeam(config.teams, args.team, args.form)[0]];
    const teams: RefreshTeam[] = [];
    for (const team of names) {
      const binding = config.teams[team]!;
      const clone = store.teamClone(team);
      const described = await describeClone(clone, normalizeRemote(binding.remote), runner);
      // Never repair and never re-clone: `sync` and `team join` own repair, and this verb runs unattended.
      if (described.state !== 'ok') { teams.push({ team, state: 'no-clone', changed: false, head: null, detail: cloneDetail(described) }); continue; }
      const before = await headOf(runner, clone);
      const wasDirty = await hasTrackedChanges(runner, clone);
      try {
        await refreshClone(runner, clone, { label: team, env: NON_INTERACTIVE_GIT, lockStale: args.lockStale, deadlineMs });
        const after = await headOf(runner, clone);
        teams.push({ team, state: 'refreshed', changed: wasDirty || before !== after, head: after });
      } catch (error) {
        // A background caller must never surface an error board for one team, and the clone it failed on is
        // still readable: report what happened and keep going. Re-read HEAD so the report is not a guess.
        const head = await headOf(runner, clone);
        if (error instanceof CloneBusy) teams.push({ team, state: 'busy', changed: false, head, detail: error.message });
        else if (error instanceof RemoteAccessError) teams.push({ team, state: 'unreachable', changed: false, head, detail: [error.stderr, error.explanation].filter(Boolean).join('\n') });
        else teams.push({ team, state: 'error', changed: false, head, detail: error instanceof Error ? error.message : String(error) });
      }
    }
    // A program reads `detail`; only a person needs the line, and a program's channel must stay result-only.
    if (io.channel !== 'frames') for (const outcome of teams) if (outcome.state !== 'refreshed') io.print(`${outcome.team}: not refreshed (${outcome.state})${outcome.detail ? ` — ${outcome.detail}` : ''}`);
    return success({ changed: teams.some((outcome) => outcome.changed), teams });
  } catch (error) { return fromError(error); }
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
