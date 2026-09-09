import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { creatorAuthenticationError, detectOrOfferGh, refuseSecondTeam, teamByRemote } from '../lib/auth.js';
import { COMMUNITY_URL } from '../lib/community.js';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { defaultHookOptions, HookOptions, offerHook as defaultOfferHook } from '../lib/hook.js';
import { defaultWrapperOptions, offerWrapper as defaultOfferWrapper, WrapperOptions } from '../lib/wrapper.js';
import { Prompter } from '../lib/prompt.js';
import { readRoster } from '../lib/skills.js';
import { repositoryUrl, githubOwnerRepo, isGitHubRemote, normalizeRemote, stripRemoteCredentials } from '../lib/remote.js';
import { fromError, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { describeClone } from '../lib/teamRepo.js';
import { readFile } from 'node:fs/promises';
import type { Launch } from '../lib/launch.js';
import { assetSuffix, detectPlatform, type PlatformEvidence } from '../lib/platform.js';
import { run as runApp } from './app.js';
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
}
export interface SetupArgs extends WithForm {
  target?: string;
  /** Desktop app opt-in (D4, 2026-09-08): `true` opens it without asking, `false` never asks; absent asks (default no) unless a yes was remembered. */
  app?: boolean;
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
export type StepOutcome = 'done' | 'skipped' | 'printed';
type Step = 'welcome' | 'app' | 'role' | 'github' | 'team' | 'actions' | 'invite' | 'community' | 'hook' | 'wrapper' | 'done';
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
  const verbs: SetupVerbs = { team, connect, app: runApp, invite, offerHook: defaultOfferHook, offerWrapper: defaultOfferWrapper, ...args.verbs };
  const steps: SetupResult['steps'] = {};
  let teamName = '';
  let remote = '';

  const say = (line: string): void => { if (!args.quiet) io.print(line); };
  try {
    for (const line of WELCOME) say(line);
    steps.welcome = args.quiet ? 'skipped' : 'printed';
    const before = await store.read();
    const target = args.target === undefined ? undefined : parseJoinTarget(args.target);
    refuseSecondTeam(before, target ? { remote: target.remote } : {}, invocation(args.form, 'setup', ...(args.target === undefined ? [] : [args.target])), args.form);

    // The desktop app, first and opt-in (D4/D5, 2026-09-08). Asked only where an app exists for this machine, only to a
    // person at an interactive terminal (never over a pipe, never over frames, never in install's quiet bootstrap). The question itself belongs to the
    // `app` verb (setup orchestrates, verbs ask): a remembered yes or --app skips it, a no is recorded and asked again
    // next run, --no-app never asks. A failed hand-off is printed and the terminal wizard continues.
    if (args.quiet || !io.interactive || io.channel === 'frames' || args.app === false || assetSuffix(detectPlatform(args.evidence ?? { platform: process.platform, arch: process.arch, procVersion: await readProcVersion() })) === null) {
      steps.app = 'skipped';
    } else {
      const wanted = args.app === true || (await store.read()).app?.choice === 'opted-in';
      const opened = await verbs.app({ form: args.form, config: store, runner, launch: args.launch, evidence: args.evidence, target: args.target, intent: 'setup', offer: !wanted }, io);
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
    if (configured) say(`Resuming setup for team ${configured[0]}. Terum Skills keeps one team per machine; to move this machine to another team run \`${invocation(args.form, 'team leave', configured[0])}\` first.`);
    else if (args.target === undefined) {
      io.print('Creating a new team creates a private GitHub repository under your account.');
      const choice = await io.select(ROLE_QUESTION, [CREATE_CHOICE, JOIN_CHOICE]);
      steps.role = 'done';
      if (choice === JOIN_CHOICE) {
        for (const line of joinHandoff()) io.print(line);
        steps.team = 'printed';
        return success({ role: 'joiner', team: teamName, remote, steps });
      }
    }

    const gh = await detectOrOfferGh(io, runner);
    if (role === 'creator') {
      const error = creatorAuthenticationError(gh, args.form);
      if (error) return failed(error, role, teamName, remote, steps);
      say('GitHub: gh is logged in.');
    } else if (gh.authenticated) say('GitHub: gh is logged in. For an owner/repository target, setup will try to accept a matching invitation; Git access uses your configured Git credentials.');
    else if (gh.installed) say('GitHub: gh is installed but logged out; you will be asked to accept the invitation in your browser.');
    else say('GitHub: gh is not installed; you will be asked to accept the invitation in your browser.');
    steps.github = 'done';

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

    const communityUrl = args.communityUrl ?? COMMUNITY_URL;
    if (communityUrl === '' || args.quiet) steps.community = 'skipped';
    else { io.print(`Feedback and requests: ${communityUrl}`); steps.community = 'printed'; }

    const hookOutcome = await verbs.offerHook(io, resolvedHook(store, args.home, args.hook));
    steps.hook = hookOutcome === 'installed' || hookOutcome === 'replaced' ? 'done' : 'skipped';

    // The /terum-skills Claude Code skill ships inside this package, and setup is the one onboarding
    // step (npm-first, Ryan 2026-09-08), so the skill that lets Claude Code run these verbs is offered
    // here, right after the hook and in the hook's shape: one offer with its own y/N on the same io,
    // a copy the tool recognises by its frontmatter marker (refreshed on a re-run without asking,
    // removed by machine uninstall), and anything else at that path left alone (src/lib/wrapper.ts).
    const wrapperOutcome = await verbs.offerWrapper(io, { ...defaultWrapperOptions(args.home), ...args.wrapper });
    steps.wrapper = wrapperOutcome === 'installed' || wrapperOutcome === 'replaced' ? 'done' : 'skipped';

    if (args.quiet) steps.done = 'skipped';
    else {
      // Every step above is durable by here; this closing summary reads the disposable clone (§4.2),
      // so a read-back problem must not turn a finished wizard into a failure (the rule team join and
      // team leave already follow). Only the clone reads sit inside the try, and the roster is read
      // before its header prints. The repository links come from the remote already in hand — they
      // are the payload the user sends teammates — so an unreadable clone must not take them with it.
      try {
        const { roster, problems } = await readRoster(clone);
        io.print('Members:');
        for (const person of roster) io.print(`  @${person.handle} — ${person.displayName}`);
        for (const problem of problems) io.print(`  ${problem.file}: ${problem.message}`);
      } catch (error) {
        io.print(`Set up, but the team details could not be read from ${clone}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const ownerRepo = githubOwnerRepo(remote);
      const url = repositoryUrl(remote);
      io.print(`Repository: ${url}`);
      io.print(`README: ${ownerRepo ? `${url}/blob/main/README.md` : url}`);
      steps.done = 'printed';
    }
    return success({ role, team: teamName, remote, steps });
  } catch (error) { return failed(error, role, teamName, remote, steps); }
}

async function readProcVersion(): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  try { return await readFile('/proc/version', 'utf8'); } catch { return null; }
}
