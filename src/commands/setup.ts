import { runEvalBatch, EVAL_PARALLEL_DEFAULT, EVAL_LOCK_WAIT_MS } from '../lib/evals/batch.js';
import { MARK, body, decorate, header, sessionBox, style, welcome } from '../lib/banner.js';
import { packageVersion } from '../lib/package.js';
import { estimateFromReceipts, estimateLine } from '../lib/evals/estimate.js';
import { enqueueEvals } from '../lib/evals/queue.js';
import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { creatorAuthenticationError, detectOrOfferGh, refuseSecondTeam, teamByRemote } from '../lib/auth.js';
import { registerCheckout } from '../lib/checkouts.js';
import { COMMUNITY_URL } from '../lib/community.js';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { discoverSkillRoots } from '../lib/discover.js';
import { preflight as systemPreflight } from '../lib/evals/agent.js';
import { defaultHookOptions, HookOptions, offerHook as defaultOfferHook } from '../lib/hook.js';
import { defaultWrapperOptions, offerWrapper as defaultOfferWrapper, WrapperOptions } from '../lib/wrapper.js';
import { MAX_SELECT_ATTEMPTS, Prompter } from '../lib/prompt.js';
import { readRoster } from '../lib/skills.js';
import { printable } from '../lib/skill-source.js';
import { repositoryUrl, githubOwnerRepo, isGitHubRemote, normalizeRemote, stripRemoteCredentials } from '../lib/remote.js';
import { fromError, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { describeClone } from '../lib/teamRepo.js';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Launch } from '../lib/launch.js';
import { assetSuffix, detectPlatform, type PlatformEvidence } from '../lib/platform.js';
import { run as runApp } from './app.js';
import { run as evalRun, skillsWithoutReceipt, type EvalArgs } from './eval.js';
import { joinCommand, run as invite } from './invite.js';
import { ConnectArgs, ConnectOutcome, run as connect } from './connect.js';
import { ensureClone, parseJoinTarget, requireGitConfig, run as team } from './team.js';

export interface SetupVerbs {
  team: typeof team;
  connect: (args: ConnectArgs, io: Prompter) => Promise<Result<ConnectOutcome | undefined>>;
  app: typeof runApp;
  invite: typeof invite;
  offerHook: typeof defaultOfferHook;
  offerWrapper: typeof defaultOfferWrapper;
  eval: typeof evalRun;
  /**
   * The paid agent probe the eval batch runs once. It sits on the verb table, not only on the free-standing
   * `args.preflight` knob, so a test that stubs `verbs` at all can never spawn the real `claude` by accident.
   */
  preflight: typeof systemPreflight;
}
export interface SetupArgs extends WithForm {
  target?: string;
  /** Desktop app: `false` (--no-app) keeps setup in the terminal; otherwise, where an app exists, setup opens it without asking. `true` is accepted for compatibility. */
  app?: boolean;
  /** `false` (--no-discover) skips the offer to look for skill folders on this machine. */
  discover?: boolean;
  /** `false` (--no-evals) skips the offer to evaluate every shared skill that has no receipt. */
  evals?: boolean;
  /** Test knob for the agent probe; defaults to the real one. Mirrors EvalArgs.preflight. */
  preflight?: EvalArgs['preflight'];
  /** Test knob for the platform table; defaults to this machine. */
  evidence?: PlatformEvidence;
  launch?: Launch;
  /** §6 install bootstrap: the print-only steps (welcome, hints, community, closing summary) are suppressed; every prompt still happens. */
  quiet?: boolean;
  /** Offer local skills independently of print-only suppression. */
  offerConnect?: boolean;
  config?: ConfigStore;
  runner?: Runner;
  home?: string;
  cwd?: string;
  hook?: HookOptions;
  /** Where the bundled /terum-skills Claude Code skill is offered from and placed (test knob). */
  wrapper?: WrapperOptions;
  communityUrl?: string;
  verbs?: Partial<SetupVerbs>;
}
export type StepOutcome = 'done' | 'skipped' | 'printed' | 'queued' | 'batched';
type Step = 'welcome' | 'app' | 'role' | 'github' | 'team' | 'actions' | 'invite' | 'discover' | 'evals' | 'community' | 'hook' | 'wrapper' | 'done';
export interface SetupResult {
  role: 'creator' | 'joiner';
  team: string;
  remote: string;
  /** Only reached steps are recorded, so an interrupted run names its stopping point. */
  steps: Partial<Record<Step, StepOutcome>>;
}

const WELCOME = [
  'Welcome to terum-skills.',
  "Your team's skills live in one private git repository the team controls; each member installs what they want, edits flow back on sync, and the team endorses the ones everyone should have.",
  'This wizard helps you create a team, join an existing team, or resume setup. It checks GitHub, sets up your team, invites teammates, offers your local skills to connect, and offers the session hook and the /terum-skills Claude Code skill; re-run it any time to continue, and leave the invitation question blank to skip it.',
];

export const DISCOVER_QUESTION = 'Look for skill folders on this machine and add them to your library?';
export const DISCOVER_WHERE_QUESTION = 'Look under which folder?';
export const DISCOVER_START_LINE = 'Looking for skill folders on this machine…';
/** Retained verbatim for frame consumers; the control is now a four-choice select. */
export function evalsQuestion(count: number): string {
  return `Evaluate the ${count} shared ${count === 1 ? 'skill' : 'skills'} that ${count === 1 ? 'has' : 'have'} no receipt yet? This runs Claude on each one and commits each receipt to the team repo.`;
}

/**
 * A typed `~` reaches this verb literally: the desktop's prompt dialog has no shell in between, and a
 * terminal only expands a `~` the person did not quote. Pressing Enter is already safe (the default is the
 * absolute home), so this only rescues a typed answer. `~otheruser` is deliberately left alone — this tool
 * has no password database to resolve it against, and `resolve` turning it into a folder name is honest.
 */
export function expandTilde(answer: string, home: string): string {
  if (answer === '~') return home;
  if (answer.startsWith('~/') || answer.startsWith('~\\')) return join(home, answer.slice(2));
  return answer;
}

export const ROLE_QUESTION = 'Create a team or join one?';
export const CREATE_CHOICE = 'Create a new team';
export const JOIN_CHOICE = 'Join an existing team';

function joinHandoff(): string[] {
  return [
    'Ask the team owner to invite you, then run the command they send you.',
    'It may look like:',
    `  ${joinCommand('<org>/<repo>')}`,
    "If you already have access, use that setup command with your team's repository.",
    'No changes were made.',
  ];
}

function failed(error: unknown, role: SetupResult['role'], teamName: string, remote: string, steps: SetupResult['steps']): Result<SetupResult> {
  const outcome = error && typeof error === 'object' && 'ok' in error && error.ok === false && 'error' in error
    ? error as Extract<Result<unknown>, { ok: false }> : fromError(error);
  return { ...outcome, ok: false, error: outcome.ok ? '' : outcome.error, value: { role, team: teamName, remote, steps } };
}

function resolvedHook(store: ConfigStore, home: string | undefined, partial: HookOptions | undefined): Required<HookOptions> {
  return { ...defaultHookOptions(store.root, home), ...partial };
}

export async function run(args: SetupArgs, io: Prompter): Promise<Result<SetupResult>> {
  const role: SetupResult['role'] = args.target === undefined ? 'creator' : 'joiner';
  const store = args.config ?? createConfigStore();
  const runner = args.runner ?? systemRunner;
  const verbs: SetupVerbs = { team, connect, app: runApp, invite, offerHook: defaultOfferHook, offerWrapper: defaultOfferWrapper, eval: evalRun, preflight: systemPreflight, ...args.verbs };
  const steps: SetupResult['steps'] = {};
  let teamName = '';
  let remote = '';

  const decorated = decorate(io, args);
  const titles: Record<Step, string> = { welcome: 'Welcome', app: 'App', role: 'Role', github: 'GitHub', team: 'Team', actions: 'Actions', invite: 'Invite', discover: 'Find skills', evals: 'Evals', community: 'Community', hook: 'Session hook', wrapper: 'Wrapper', done: 'Done' };
  const output = io;
  let pendingSection: Step | undefined;
  const section = (step: Step): void => { pendingSection = step; };
  const openSection = (): void => { if (decorated && pendingSection) for (const line of header(titles[pendingSection]).split('\n')) output.print(line); pendingSection = undefined; };
  if (decorated) io = {
    interactive: output.interactive, ...(output.channel === undefined ? {} : { channel: output.channel }),
    print: line => { openSection(); for (const part of line.split('\n')) output.print(body(part)); },
    progress: update => output.progress?.(update),
    confirm: (question, options) => { openSection(); return output.confirm(question, { ...options, decorated }); },
    text: (question, fallback, options) => { openSection(); return output.text(question, fallback, { ...options, decorated }); },
    select: (question, choices, fallback, options) => { openSection(); return output.select(question, choices, fallback, { ...options, decorated }); },
  };
  const bullet = (line: string): void => io.print(decorated ? `  • ${line.trimStart()}` : line);
  const say = (line: string): void => { if (!args.quiet) io.print(line); };
  try {
    if (decorated) { for (const line of MARK.split('\n')) output.print(style('dim', line)); output.print(''); output.print(welcome()); }
    for (const line of WELCOME) say(line);
    steps.welcome = args.quiet ? 'skipped' : 'printed';
    const before = await store.read();
    const target = args.target === undefined ? undefined : parseJoinTarget(args.target);
    refuseSecondTeam(before, target ? { remote: target.remote } : {}, invocation(args.form, 'setup', ...(args.target === undefined ? [] : [args.target])), args.form);

    // The desktop app, first (D5, 2026-09-08). Where an app exists for this machine and a person is at an interactive
    // terminal (never over a pipe, never over frames, never in install's quiet bootstrap), setup installs and opens it
    // without asking and continues there (Teddy, 2026-09-09: the wizard boots the app; the D4 opt-in question is gone).
    // --no-app keeps the whole wizard in the terminal. A failed hand-off is printed and the terminal wizard continues.
    if (args.quiet || !io.interactive || io.channel === 'frames' || args.app === false || assetSuffix(detectPlatform(args.evidence ?? { platform: process.platform, arch: process.arch, env: process.env, procVersion: await readProcVersion() })) === null) {
      steps.app = 'skipped';
    } else {
      section('app');
      const opened = await verbs.app({ form: args.form, config: store, runner, launch: args.launch, evidence: args.evidence, target: args.target, intent: 'setup', offer: false }, io);
      if (opened.ok && (opened.value.action === 'launched' || opened.value.action === 'installed-and-launched')) {
        io.print(args.target === undefined ? 'Continuing in the app.' : `Continuing in the app. Join ${args.target} there.`);
        steps.app = 'done';
        return success({ role, team: teamName, remote, steps });
      }
      if (!opened.ok) io.print(opened.error);
      steps.app = 'skipped';
    }

    // The fork the argument used to decide silently. A target names a team to join; a configured
    // machine resumes its configured team; only a fresh machine with no
    // target is asked — before gh is probed, so a joiner is never offered `gh auth login`. The
    // selection has no default on purpose (the one exception to "a question with a default"): a wrong
    // "create" is a private GitHub repository, a wrong "join" is a re-run. "Join" is a success exit
    // that writes nothing; the owner's command creates every piece of local state itself.
    const configured = args.target === undefined ? Object.entries(before.teams)[0] : undefined;
    if (configured || args.target === undefined) section('role');
    if (configured) say(`Resuming setup for team ${configured[0]}. Terum Skills keeps one team per machine; to move this machine to another team run \`${invocation(args.form, 'team leave', configured[0])}\` first.`);
    else if (args.target === undefined) {
      io.print('Creating a new team creates a private GitHub repository under your account.');
      const choice = await io.select(ROLE_QUESTION, [CREATE_CHOICE, JOIN_CHOICE], undefined, { descriptions: ['Creates a private GitHub repository under your account.', 'Uses an invitation from the team owner.'] });
      steps.role = 'done';
      if (choice === JOIN_CHOICE) {
        for (const line of joinHandoff()) io.print(line);
        steps.team = 'printed';
        return success({ role: 'joiner', team: teamName, remote, steps });
      }
    }

    section('github');
    const gh = await detectOrOfferGh(io, runner);
    if (role === 'creator') {
      const error = creatorAuthenticationError(gh, args.form);
      if (error) return failed(error, role, teamName, remote, steps);
      say('GitHub: gh is logged in.');
    } else if (gh.authenticated) say('GitHub: gh is logged in. For an owner/repository target, setup will try to accept a matching invitation; Git access uses your configured Git credentials.');
    else if (gh.installed) say('GitHub: gh is installed but logged out; you will be asked to accept the invitation in your browser.');
    else say('GitHub: gh is not installed; you will be asked to accept the invitation in your browser.');
    steps.github = 'done';

    section('team');
    if (role === 'creator') {
      const configured = Object.entries(before.teams)[0];
      if (configured) {
        teamName = configured[0]; remote = configured[1].remote;
        steps.team = 'skipped';
      } else {
        const result = await verbs.team({ form: args.form, kind: 'create', offerHook: false, config: store, runner }, io);
        if (!result.ok) return failed(result, role, teamName, remote, steps);
        teamName = result.value.team;
        remote = 'remote' in result.value ? result.value.remote : (await store.read()).teams[teamName]!.remote;
        steps.team = 'done';
      }
    } else {
      const target = parseJoinTarget(args.target!);
      const configured = teamByRemote(before, target.remote);
      if (configured?.[1].handle) {
        teamName = configured[0]; remote = configured[1].remote;
        say(`Team ${teamName} is already configured on this machine.`);
        steps.team = 'skipped';
      } else {
        const result = await verbs.team({ form: args.form, kind: 'join', target: args.target!, offerHook: false, config: store, runner }, io);
        if (!result.ok) return failed(result, role, teamName, remote, steps);
        teamName = result.value.team;
        remote = (await store.read()).teams[teamName]!.remote;
        steps.team = 'done';
      }
    }

    const clone = store.teamClone(teamName);
    // A configured team whose clone is gone or incomplete is not set up: every later verb fails on
    // it, and the resumed team step above never re-clones. Decided HERE — before the wizard prompts
    // for a skill, invites anyone or writes the hook — from the one definition of "a complete clone"
    // that `team join` uses (rulings walk R9, 2026-09-06). An absent clone is re-cloned by the wizard
    // itself, with the git identity later writes need: its banner promises a re-run fixes the
    // machine (R8). A folder that is present but incomplete, or another team's, may hold someone's
    // work and is refused with the move-aside repair.
    if (steps.team === 'skipped') {
      const repair = `\`${invocation(args.form, 'team join', stripRemoteCredentials(remote))}\``;
      const described = await describeClone(clone, normalizeRemote(remote), runner);
      if (described.state === 'absent') {
        say(`Team ${teamName}'s clone at ${clone} is missing; re-cloning it from ${stripRemoteCredentials(remote)}.`);
        await ensureClone(clone, remote, normalizeRemote(remote), runner);
        if (before.display_name && before.email) await requireGitConfig(runner, clone, { displayName: before.display_name, email: before.email });
        steps.team = 'done';
      } else if (described.state === 'incomplete') {
        return failed(new Error(`Team ${teamName} is configured, but ${clone} exists and is not a complete clone of ${stripRemoteCredentials(remote)}; move it aside, run ${repair} to restore it, then re-run setup.`), role, teamName, remote, steps);
      } else if (described.state === 'foreign') {
        return failed(new Error(`Team ${teamName} is configured, but ${clone} is a clone of ${described.origin}, not ${stripRemoteCredentials(remote)}; move it aside, run ${repair} to restore it, then re-run setup.`), role, teamName, remote, steps);
      }
    }

    // Invite comes straight after the team exists (Ryan, 2026-09-06; overrides build-spec default 42
    // "invites after the actions"): the owner's next question is who is on the team, and the block
    // `invite` prints is what they send each teammate. Creator only, GitHub remotes only; blank skips;
    // a re-run asks again. A failed Result stops the wizard here (spec §6.1 "Errors"); GitHub, not the
    // wizard, decides whether this account may add collaborators to the carried-forward repository.
    if (role !== 'joiner') section('invite');
    if (role === 'joiner') steps.invite = 'skipped';
    else if (isGitHubRemote(remote)) {
      const answer = await io.text('Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)', '');
      const logins = answer.split(/[\s,]+/).filter(Boolean);
      if (logins.length === 0) steps.invite = 'skipped';
      else {
        const result = await verbs.invite({ form: args.form, logins, team: teamName, config: store, runner }, io);
        if (!result.ok) return failed(result, role, teamName, remote, steps);
        steps.invite = 'done';
      }
    } else {
      const clean = stripRemoteCredentials(remote);
      io.print(`Access to ${clean} is managed on the host; grant it there, then send teammates: ${joinCommand(clean)}`);
      steps.invite = 'skipped';
    }

    if (args.offerConnect !== false || !args.quiet) section('actions');
    if (args.offerConnect !== false) {
      const result = await verbs.connect({ form: args.form, team: teamName, home: args.home, cwd: args.cwd, config: store, runner }, io);
      if (!result.ok) return failed(result, role, teamName, remote, steps);
      steps.actions = result.value !== undefined && (!('kind' in result.value) || result.value.shared.length > 0) ? 'done' : 'skipped';
    } else steps.actions = 'skipped';
    say('Next, from any terminal:');
    say(`  ${invocation(args.form, 'install', { raw: `${teamName}/<skill>` })}   — install a shared skill (add @<version> to pin it)`);
    say(`  ${invocation(args.form, 'ls [--local]')}             — list members and shared skills; --local lists your own`);
    say(`  ${invocation(args.form, 'search <term>')}            — find a skill by name, description, or category`);
    say(`  ${invocation(args.form, 'sync')}                     — pull updates and finish pending work`);
    say(`  ${invocation(args.form, 'publish <skill>')} — endorse a skill already connected to the team`);
    say(`  ${invocation(args.form, 'eval <skill>')}             — evaluate a shared skill locally before publishing`);
    say(`  ${invocation(args.form, 'connect')}      — connect your local skills to the team (asks which)`);

    // Discovery is optional, never fatal, and only offered where a person can answer.
    if (args.quiet || args.discover === false || !io.interactive) steps.discover = 'skipped';
    else {
      section('discover');
      io.print(DISCOVER_START_LINE);
      try {
        if (!(await io.confirm(DISCOVER_QUESTION))) steps.discover = 'skipped';
        else {
          const home = args.home ?? homedir();
          const root = resolve(args.cwd ?? process.cwd(), expandTilde(await io.text(DISCOVER_WHERE_QUESTION, home), home));
          const config = await store.read();
          const found = await discoverSkillRoots({
            under: [root], home, checkouts: config.checkouts ?? [], stateRoot: store.root, config,
            onProgress: (progress) => io.progress?.({ step: 'discover', current: progress.scanned }),
          });
          for (const candidate of found.candidates) bullet(`${printable(candidate.path)} — ${candidate.skillFolders} skill folders${candidate.registered ? ' · already registered' : ''}`);
          for (const problem of found.problems) bullet(`Could not look in ${printable(problem.path)}: ${printable(problem.reason)}`);
          if (found.truncated) io.print(`(stopped early; run \`${invocation(args.form, 'checkout discover --budget-ms 60000')}\` to look longer)`);
          const unregistered = found.candidates.filter((candidate) => !candidate.registered);
          if (found.candidates.length === 0) io.print(`No skill folders found under ${printable(root)}.`);
          else if (unregistered.length > 0) {
            const all = await io.confirm(`Add all ${unregistered.length}?`);
            for (const candidate of unregistered) {
              if (!all && !(await io.confirm(`Add ${printable(candidate.path)}?`))) continue;
              try { await registerCheckout(store, candidate.path, io, { home }); }
              catch (error) { io.print(`Could not register ${printable(candidate.path)}: ${error instanceof Error ? error.message : String(error)}`); }
            }
          }
          steps.discover = 'done';
        }
      } catch (error) {
        // A wizard that finished every durable step must not fail on an optional search.
        io.print(`Could not look for skill folders: ${error instanceof Error ? error.message : String(error)}`);
        steps.discover = 'skipped';
      }
    }

    // The default remains Skip. Queuing never probes the paid agent.
    if (args.quiet || args.evals === false || !io.interactive || teamName === '') steps.evals = 'skipped';
    else {
      section('evals');
      try {
        const handle = (await store.read()).teams[teamName]?.handle;
        if (!handle) {
          io.print('Skipping the eval offer: this machine has no joined handle for the team yet, so a receipt could not be committed.');
          steps.evals = 'skipped';
        } else {
          const scan = await skillsWithoutReceipt(clone, teamName, runner, bullet);
          const candidates = scan.pending;
          if (candidates.length === 0) {
            // An empty batch has four different causes and only one of them means "everything is evaluated".
            io.print(scan.shared === 0
              ? 'The team has no shared skills yet; nothing to evaluate.'
              : scan.versionProblem !== undefined
                ? 'Could not read the current skill versions, so no shared skill could be checked for a receipt.'
                : scan.considered === 0
                  ? 'No shared skill could be checked for a receipt; see the lines above.'
                  : 'Every shared skill already has an eval receipt for its current version.');
            steps.evals = 'skipped';
          } else {
            const measured = await estimateFromReceipts(clone).catch((error: unknown) => {
              io.print(`Could not estimate eval cost: ${error instanceof Error ? error.message : String(error)}. Continuing without a numeric estimate.`);
              return null; // Optional historical data must never remove the eval offer.
            });
            const estimate = estimateLine(candidates.length, measured);
            io.print(estimate);
            const choice = await io.select(evalsQuestion(candidates.length), ['Now', 'In batches', 'Overnight', 'Skip'], 'Skip', { ...(io.channel === 'frames' ? { detail: [estimate] } : {}), descriptions: [
              `Runs all ${candidates.length}, ${EVAL_PARALLEL_DEFAULT} at a time, in this terminal.`,
              'Asks how many at a time and checks in between batches.',
              'Queues them; the app runs them between 01:00 and 05:00 while it is open and idle.',
              `Evaluate any skill later with \`${invocation(args.form, 'eval <skill>')}\`.`,
            ] });
            const queue = async (remaining: typeof candidates, window: 'overnight' | 'later') => {
              const requestedAt = new Date().toISOString();
              await enqueueEvals(store.root, remaining.map(candidate => ({ team: teamName, skill: candidate.name, version: candidate.version, requestedAt, window })));
              if (window === 'overnight') io.print(`Queued ${remaining.length} evals for overnight: the app runs them in parallel between 01:00 and 05:00 while it is open and idle. Run them now with \`${invocation(args.form, 'eval --drain')}\`.`);
              else io.print(`Queued ${remaining.length} evals for later. Run them with \`${invocation(args.form, 'eval --drain')}\`.`);
            };
            if (choice === 'Skip') steps.evals = 'skipped';
            else if (choice === 'Overnight') { await queue(candidates, 'overnight'); steps.evals = 'queued'; }
            else if (choice === 'Now' || choice === 'In batches') {
              let batchSize = candidates.length;
              if (choice === 'In batches') {
                let valid = false;
                for (let attempt = 0; attempt < MAX_SELECT_ATTEMPTS; attempt++) {
                  const answer = (await io.text('How many at a time?', String(EVAL_PARALLEL_DEFAULT))).trim();
                  if (/^[0-9]+$/.test(answer) && Number.isSafeInteger(Number(answer)) && Number(answer) >= 1) { batchSize = Number(answer); valid = true; break; }
                  io.print('Enter a whole number of at least 1.');
                }
                if (!valid) throw new Error(`No valid batch size after ${MAX_SELECT_ATTEMPTS} attempts.`);
                if (batchSize !== EVAL_PARALLEL_DEFAULT) io.print(estimateLine(candidates.length, measured, batchSize));
              }
              const probe = await (args.preflight ?? verbs.preflight)();
              if (!probe.ok) { io.print(`Skipping the evals: ${probe.error}`); steps.evals = 'skipped'; }
              else {
                const reuse: EvalArgs['preflight'] = async () => probe;
                const parallel = choice === 'In batches' ? batchSize : EVAL_PARALLEL_DEFAULT;
                const width = choice === 'In batches' ? batchSize : candidates.length;
                let ok = 0, failed = 0;
                io.print(`Evaluating ${candidates.length} skills, ${parallel} at a time…`);
                for (let offset = 0; offset < candidates.length; offset += width) {
                  if (offset > 0) {
                    const remaining = candidates.length - offset;
                    if (!(await io.confirm(`Continue with the next ${Math.min(width, remaining)}? (${offset} of ${candidates.length} done, ${remaining} left)`))) { await queue(candidates.slice(offset), 'later'); break; }
                  }
                  const batch = await runEvalBatch({ items: candidates.slice(offset, offset + width), parallel, io: {
                    interactive: io.interactive, ...(io.channel === undefined ? {} : { channel: io.channel }),
                    print: line => io.print(line), confirm: io.confirm.bind(io), text: io.text.bind(io), select: io.select.bind(io),
                    progress: update => io.progress?.({ ...update, current: offset + (update.current ?? 0), total: candidates.length }),
                  },
                    run: (candidate, captured) => verbs.eval({ form: args.form, ref: candidate.name, team: teamName, commit: true, config: store, runner, preflight: reuse, lockWaitMs: EVAL_LOCK_WAIT_MS }, captured),
                  });
                  ok += batch.ok; failed += batch.failed;
                }
                io.print(`Evaluated ${ok} of ${candidates.length}; ${failed} failed.`);
                steps.evals = choice === 'In batches' ? 'batched' : 'done';
              }
            } else throw new Error(`Unknown eval choice: ${choice}`);
          }
        }
      } catch (error) {
        io.print(`Could not evaluate the shared skills: ${error instanceof Error ? error.message : String(error)}`);
        steps.evals = 'skipped';
      }
    }

    const communityUrl = args.communityUrl ?? COMMUNITY_URL;
    if (communityUrl === '' || args.quiet) steps.community = 'skipped';
    else { section('community'); io.print(`Feedback and requests: ${communityUrl}`); steps.community = 'printed'; }

    section('hook');
    const hookOutcome = await verbs.offerHook(io, resolvedHook(store, args.home, args.hook));
    steps.hook = hookOutcome === 'installed' || hookOutcome === 'replaced' ? 'done' : 'skipped';

    // The /terum-skills Claude Code skill ships inside this package, and setup is the one onboarding
    // step (npm-first, Ryan 2026-09-08), so the skill that lets Claude Code run these verbs is offered
    // here, right after the hook and in the hook's shape: one offer with its own y/N on the same io,
    // a copy the tool recognises by its frontmatter marker (refreshed on a re-run without asking,
    // removed by machine uninstall), and anything else at that path left alone (src/lib/wrapper.ts).
    section('wrapper');
    const wrapperOutcome = await verbs.offerWrapper(io, { ...defaultWrapperOptions(args.home), ...args.wrapper });
    steps.wrapper = wrapperOutcome === 'installed' || wrapperOutcome === 'replaced' ? 'done' : 'skipped';

    if (args.quiet) steps.done = 'skipped';
    else {
      section('done');
      const summary: string[] = [];
      let members: { handle: string; displayName: string }[] = [];
      const finishLine = (line: string): void => { if (decorated) summary.push(line); else io.print(line); };
      // Every step above is durable by here; this closing summary reads the disposable clone (§4.2),
      // so a read-back problem must not turn a finished wizard into a failure (the rule team join and
      // team leave already follow). Only the clone reads sit inside the try, and the roster is read
      // before its header prints. The repository links come from the remote already in hand — they
      // are the payload the user sends teammates — so an unreadable clone must not take them with it.
      try {
        const { roster, problems } = await readRoster(clone);
        members = roster;
        finishLine('Members:');
        for (const person of roster) finishLine(`${decorated ? '  •' : ' '} @${person.handle} — ${person.displayName}`);
        for (const problem of problems) finishLine(`${decorated ? '  •' : ' '} ${problem.file}: ${problem.message}`);
      } catch (error) {
        finishLine(`Set up, but the team details could not be read from ${clone}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const ownerRepo = githubOwnerRepo(remote);
      const url = repositoryUrl(remote);
      finishLine(`Repository: ${url}`);
      finishLine(`README: ${ownerRepo ? `${url}/blob/main/README.md` : url}`);
      if (decorated) {
        openSection();
        for (const line of sessionBox({ version: packageVersion() ?? 'unknown', team: teamName, handle: (await store.read()).teams[teamName]?.handle, roster: members, repository: url, readme: ownerRepo ? `${url}/blob/main/README.md` : url, next: invocation(args.form, 'ls') })) output.print(line);
        for (const line of summary.filter(line => !line.startsWith('Members:') && !line.startsWith('  • @') && !line.startsWith('Repository:') && !line.startsWith('README:'))) io.print(line);
      }
      steps.done = 'printed';
    }
    return success({ role, team: teamName, remote, steps });
  } catch (error) { return failed(error, role, teamName, remote, steps); }
}

async function readProcVersion(): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  try { return await readFile('/proc/version', 'utf8'); } catch { return null; }
}
