import { runEvalBatch, EVAL_PARALLEL_DEFAULT, EVAL_LOCK_WAIT_MS } from '../lib/evals/batch.js';
import { MARK, body, decorate, header, sessionBox, style, welcome } from '../lib/banner.js';
import { packageVersion } from '../lib/package.js';
import { estimateFromReceipts, estimateLine } from '../lib/evals/estimate.js';
import { enqueueEvals } from '../lib/evals/queue.js';
import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { creatorAuthenticationError, detectOrOfferGh, identityDefaults, refuseSecondTeam, teamByRemote, type Identity } from '../lib/auth.js';
import { claudeCodeIntegration as defaultClaudeCode } from '../lib/claudeCode.js';
import { CREATE_FORM_TITLE, createFields, createValuesFrom, IDENTITY_FORM_TITLE, identityFields, identityValues, identityValuesFrom, INVITE_FORM_TITLE, inviteFields, inviteLogins, validateCreate, validateIdentity, type CreateValues } from '../lib/setupForms.js';
import { SUCCESSOR_LOOKUP_DEADLINE_MS } from '../lib/successor.js';
import { addLibraryProject } from '../lib/projects.js';
import { nearestRepoRoot } from '../lib/local-skills.js';
import { COMMUNITY_URL } from '../lib/community.js';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { preflight as systemPreflight } from '../lib/evals/agent.js';
import { defaultHookOptions, HookOptions } from '../lib/hook.js';
import { defaultWrapperOptions, WrapperOptions } from '../lib/wrapper.js';
import { defaultEditHookOptions, type EditHookOptions } from '../lib/editHook.js';
import { askForm, MAX_FORM_ATTEMPTS, MAX_SELECT_ATTEMPTS, Prompter } from '../lib/prompt.js';
import { readRoster } from '../lib/skills.js';
import { repositoryUrl, githubOwnerRepo, isGitHubRemote, normalizeRemote, stripRemoteCredentials } from '../lib/remote.js';
import { fromError, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { describeClone } from '../lib/teamRepo.js';
import { repositoryIsGone } from '../lib/successor.js';
import { readFile } from 'node:fs/promises';
import { exists } from '../lib/fs.js';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Launch } from '../lib/launch.js';
import { assetSuffix, detectPlatform, type PlatformEvidence } from '../lib/platform.js';
import { run as runApp } from './app.js';
import { reconcileHasRows, run as runReconcile } from './reconcile.js';
import { run as evalRun, queueItemsFor, skillsWithoutReceipt, type EvalArgs } from './eval.js';
import { FIXABLE_INVITE_REASONS, joinCommand, run as invite } from './invite.js';
import { ensureClone, parseJoinTarget, requireGitConfig, run as team, suggestedRepoName } from './team.js';

export interface SetupVerbs {
  team: typeof team;
  app: typeof runApp;
  invite: typeof invite;
  /** The one Claude Code question: three checkboxes, one Install (src/lib/claudeCode.ts). */
  claudeCode: typeof defaultClaudeCode;
  eval: typeof evalRun;
  reconcile: typeof runReconcile;
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
  /** `false` (--no-projects) skips the offer to add a project to your library. */
  projects?: boolean;
  /** `false` (--no-existing) skips reconciling existing Library folders with the team. */
  existing?: boolean;
  /** `false` (--no-evals) skips the offer to evaluate every shared skill that has no receipt. */
  evals?: boolean;
  /** Test knob for the agent probe; defaults to the real one. Mirrors EvalArgs.preflight. */
  preflight?: EvalArgs['preflight'];
  /** Test knob for the platform table; defaults to this machine. */
  evidence?: PlatformEvidence;
  launch?: Launch;
  /** §6 install bootstrap: the print-only steps (welcome, hints, community, closing summary) are suppressed; every prompt still happens. */
  quiet?: boolean;
  config?: ConfigStore;
  runner?: Runner;
  home?: string;
  cwd?: string;
  hook?: HookOptions;
  /** Where the bundled /terum-skills Claude Code skill is offered from and placed (test knob). */
  wrapper?: WrapperOptions;
  editHook?: Partial<EditHookOptions>;
  communityUrl?: string;
  /** Test knob: whether the configured team's repository answers "not found"; defaults to lib/successor's git probe. */
  gone?: (runner: Runner, remote: string) => Promise<boolean>;
  verbs?: Partial<SetupVerbs>;
}
export type StepOutcome = 'done' | 'skipped' | 'printed' | 'queued' | 'batched';
type Step = 'welcome' | 'app' | 'role' | 'github' | 'team' | 'invite' | 'projects' | 'existing' | 'evals' | 'community' | 'hook' | 'wrapper' | 'editHook' | 'done';
export interface SetupResult {
  role: 'creator' | 'joiner';
  team: string;
  remote: string;
  /** Only reached steps are recorded, so an interrupted run names its stopping point. */
  steps: Partial<Record<Step, StepOutcome>>;
}

const WELCOME = [
  'Welcome to terum-skills.',
  "Your team's skills live in one private git repository the team controls; each member installs what they want and publishes local skills explicitly.",
  'This wizard helps you create a team, join one, invite teammates, and offer the session hook, the /terum-skills Claude Code skill and a reminder to publish a skill after Claude edits one; re-run it any time to continue, and skip the invitation step if you have nobody to invite yet.',
];

export const PROJECTS_QUESTION = 'Add a project?';
export const PROJECTS_WHERE_QUESTION = 'Which folder?';
export const PROJECTS_START_LINE = "Terum will track the skills in that project's .claude folder.";
/** Retained verbatim for frame consumers; the control is now a four-choice select. */
export function evalsQuestion(count: number): string {
  return `Evaluate the ${count} shared ${count === 1 ? 'skill' : 'skills'} that ${count === 1 ? 'has' : 'have'} no receipt yet? This runs Claude on each one and records results locally.`;
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

/**
 * §6.1 still exits at a failed invite, but it must not exit silently: the team is real and any invitation
 * already accepted by GitHub stands. Naming both, and naming the re-run, is the whole of A in D1.
 */
function unfinishedAtInvite(teamName: string, invited: readonly string[], form: WithForm['form']): string[] {
  return [
    invited.length === 0
      ? `Team ${teamName} is set up; no invitation was sent.`
      : `Team ${teamName} is set up and ${invited.length} invitation${invited.length === 1 ? '' : 's'} ${invited.length === 1 ? 'was' : 'were'} sent; that stands.`,
    `Setup stopped here, so the project, eval and Claude Code steps were not offered — run \`${invocation(form, 'setup')}\` again to finish.`,
  ];
}

function resolvedHook(store: ConfigStore, home: string | undefined, partial: HookOptions | undefined, form: WithForm['form']): Required<HookOptions> {
  return { ...defaultHookOptions(store.root, home, form), ...partial };
}

/**
 * Whether `<login>/<repo>` already exists on GitHub, read before `gh repo create` so a taken name is marked on
 * the form the person is looking at instead of surfacing as a stray question mid-create. Bounded and
 * non-throwing; anything but a clear "yes, that repository" reads as free, and create's own retry still
 * catches the race.
 */
async function repositoryTaken(runner: Runner, login: string, repo: string): Promise<boolean> {
  if (login === '') return false;
  try {
    const probe = await runner.run('gh', ['api', `repos/${login}/${repo}`, '-q', '.full_name'], { deadlineMs: SUCCESSOR_LOOKUP_DEADLINE_MS });
    return probe.code === 0 && probe.stdout.trim().toLowerCase() === `${login}/${repo}`.toLowerCase();
  } catch { return false; }
}

export async function run(args: SetupArgs, io: Prompter): Promise<Result<SetupResult>> {
  const role: SetupResult['role'] = args.target === undefined ? 'creator' : 'joiner';
  const store = args.config ?? createConfigStore();
  const runner = args.runner ?? systemRunner;
  const verbs: SetupVerbs = { team, app: runApp, invite, claudeCode: defaultClaudeCode, eval: evalRun, reconcile: runReconcile, preflight: systemPreflight, ...args.verbs };
  const steps: SetupResult['steps'] = {};
  let teamName = '';
  let remote = '';

  const decorated = decorate(io, args);
  const titles: Record<Step, string> = { welcome: 'Welcome', app: 'App', role: 'Role', github: 'GitHub', team: 'Team', invite: 'Invite', projects: 'Projects', existing: 'Your skills', evals: 'Evals', community: 'Community', hook: 'Session hook', wrapper: 'Wrapper', editHook: 'Edit hook', done: 'Done' };
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
    // A channel that draws forms keeps drawing them through the decoration; dropping this would silently turn every form back into one question per field.
    ...(output.form ? { form: (title, fields, options) => { openSection(); return output.form!(title, fields, { ...options, decorated }); } } : {}),
  };
  const bullet = (line: string): void => io.print(decorated ? `  • ${line.trimStart()}` : line);
  const say = (line: string): void => { if (!args.quiet) io.print(line); };
  try {
    if (decorated) { for (const line of MARK.split('\n')) output.print(style('dim', line)); output.print(''); output.print(welcome()); }
    for (const line of WELCOME) say(line);
    steps.welcome = args.quiet ? 'skipped' : 'printed';
    let before = await store.read();
    const target = args.target === undefined ? undefined : parseJoinTarget(args.target);
    // A machine already on one team, handed a different target, is normally refused (one team per machine). When the
    // team it is on has lost its repository — the owner recreated it elsewhere and posted the new setup command, which
    // is exactly what this person just pasted (2026-09-13) — the refusal would send them to `team leave` by hand. Ask
    // once and move instead. Only a clear "repository not found" qualifies; offline or denied keeps the refusal.
    let movedFrom: string | undefined;
    const bound = Object.entries(before.teams);
    if (target && bound.length === 1 && !teamByRemote(before, target.remote) && await (args.gone ?? repositoryIsGone)(runner, bound[0]![1].remote)) {
      const [current, binding] = bound[0]!;
      section('team');
      io.print(`Team ${current}'s repository ${repositoryUrl(binding.remote)} no longer exists on GitHub.`);
      if (await io.confirm(`Move this machine from ${current} to ${repositoryUrl(target.remote)}?`, { detail: [`Skills placed from ${current} are removed and placed again from the new team where it shares them; nothing is written to the old repository.`] })) {
        const moved = await verbs.team({ form: args.form, kind: 'move', target: args.target!, from: current, yes: true, config: store, runner, hook: args.hook }, io);
        if (!moved.ok) return failed(moved, role, teamName, remote, steps);
        movedFrom = current; teamName = moved.value.to; remote = moved.value.toRemote; steps.team = 'done';
        before = await store.read();
      }
    }
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
        io.print(args.target === undefined || movedFrom !== undefined ? 'Continuing in the app.' : `Continuing in the app. Join ${args.target} there.`);
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
        // One form (Ryan, 2026-09-19): team, repository and identity together, validated as a whole, re-shown
        // with the fields marked until it passes. Only then does `team create` run, with every answer supplied,
        // so it asks nothing itself. A taken repository name is probed first for the same reason.
        const defaults = await identityDefaults(before, runner, { gh });
        let values: CreateValues = { team: '', repo: '', ...identityValues(defaults) };
        let errors: Record<string, string> = {};
        let create: { name: string; repo: string; identity: Identity } | undefined;
        for (let attempt = 1; attempt <= MAX_FORM_ATTEMPTS && !create; attempt++) {
          const answers = await askForm(io, CREATE_FORM_TITLE, createFields(values, { githubKnown: defaults.githubKnown }), { submit: 'Create team', errors });
          if (answers === null) throw new Error(`${CREATE_FORM_TITLE} was cancelled.`);
          // A cleared repository field takes the suggestion `team create` would have offered (the name rule decides whether the suffix fits).
          if (typeof answers.repo === 'string' && answers.repo.trim() === '' && typeof answers.team === 'string' && answers.team.trim() !== '') answers.repo = suggestedRepoName(answers.team.trim());
          const validated = await validateCreate(answers, { teams: Object.keys(before.teams), cloneExists: async (name) => exists(store.teamClone(name)) });
          values = createValuesFrom(answers, values);
          if (!validated.ok) { errors = validated.errors; continue; }
          if (await repositoryTaken(runner, validated.value.identity.github, validated.value.repo)) { errors = { repo: `${validated.value.identity.github}/${validated.value.repo} already exists on GitHub; pick another name` }; continue; }
          create = validated.value;
        }
        if (!create) throw new Error(`${CREATE_FORM_TITLE} was not completed after ${MAX_FORM_ATTEMPTS} attempts.`);
        const result = await verbs.team({ form: args.form, kind: 'create', name: create.name, repo: create.repo, identity: create.identity, offerHook: false, config: store, runner }, io);
        if (!result.ok) return failed(result, role, teamName, remote, steps);
        teamName = result.value.team;
        remote = 'remote' in result.value ? result.value.remote : (await store.read()).teams[teamName]!.remote;
        steps.team = 'done';
      }
    } else if (movedFrom !== undefined) {
      say(`Moved from ${movedFrom} to ${teamName}.`);
    } else {
      const target = parseJoinTarget(args.target!);
      const configured = teamByRemote(before, target.remote);
      if (configured?.[1].handle) {
        teamName = configured[0]; remote = configured[1].remote;
        say(`Team ${teamName} is already configured on this machine.`);
        steps.team = 'skipped';
      } else {
        // The joiner's one form: the identity fields alone. A roster collision on the handle is still re-asked by
        // `team join` itself, against the freshly reset roster, which is the one place that can judge it.
        const defaults = await identityDefaults(before, runner, { gh });
        let values = identityValues(defaults);
        let errors: Record<string, string> = {};
        let identity: Identity | undefined;
        for (let attempt = 1; attempt <= MAX_FORM_ATTEMPTS && !identity; attempt++) {
          const answers = await askForm(io, IDENTITY_FORM_TITLE, identityFields(values, { githubKnown: defaults.githubKnown }), { submit: 'Join team', errors });
          if (answers === null) throw new Error(`${IDENTITY_FORM_TITLE} was cancelled.`);
          const validated = validateIdentity(answers);
          values = identityValuesFrom(answers);
          if (!validated.ok) { errors = validated.errors; continue; }
          identity = validated.value;
        }
        if (!identity) throw new Error(`${IDENTITY_FORM_TITLE} was not completed after ${MAX_FORM_ATTEMPTS} attempts.`);
        const result = await verbs.team({ form: args.form, kind: 'join', target: args.target!, identity, offerHook: false, config: store, runner }, io);
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
      // D1 (2026-09-13): a mistyped or non-existent login is a slip, not a step failure — re-ask instead of
      // exiting. This deliberately overrides §6.1's blanket "exits non-zero at that step" for that one class
      // and nothing else: a cap, a permission refusal or an auth failure still exits, and the batch is still
      // validated before anything is sent, so a re-ask can never double-invite. Whichever way it ends, an
      // exit here names what is already durable and how to finish, because §6.1's recovery — re-run setup —
      // was real but had never been said out loud anywhere in the output.
      // Its own form, right after the team exists: invitations email other people, which is not what the team
      // form's Confirm agreed to, and GitHub can only add collaborators to a repository that exists.
      const ownerRepo = githubOwnerRepo(remote) ?? stripRemoteCredentials(remote);
      let typed = '';
      for (let attempt = 0; ; attempt++) {
        const answers = await askForm(io, INVITE_FORM_TITLE, inviteFields(typed), {
          submit: 'Invite', skippable: true, skipLabel: 'Skip for now',
          detail: [`Send them: ${joinCommand(ownerRepo)}`],
          ...(attempt === 0 ? {} : { errors: { logins: 'those GitHub usernames could not be invited; enter them again' } }),
        });
        const logins = inviteLogins(answers);
        if (logins.length === 0) { steps.invite = 'skipped'; break; }
        typed = logins.join(' ');
        const result = await verbs.invite({ form: args.form, logins, team: teamName, config: store, runner }, io);
        if (result.ok) { steps.invite = 'done'; break; }
        const failures = result.value?.failed ?? [];
        const retypeable = failures.length > 0 && failures.every(entry => FIXABLE_INVITE_REASONS.has(entry.reason));
        if (retypeable && attempt + 1 < MAX_SELECT_ATTEMPTS) continue;
        for (const line of unfinishedAtInvite(teamName, result.value?.invited ?? [], args.form)) io.print(line);
        return failed(result, role, teamName, remote, steps);
      }
    } else {
      const clean = stripRemoteCredentials(remote);
      io.print(`Access to ${clean} is managed on the host; grant it there, then send teammates: ${joinCommand(clean)}`);
      steps.invite = 'skipped';
    }

    say('Next, from any terminal:');
    say(`  ${invocation(args.form, 'install', { raw: `${teamName}/<skill>` })}   — install a shared skill (add @<version> to pin it)`);
    say(`  ${invocation(args.form, 'ls [--local]')}             — list members and shared skills; --local lists your own`);
    say(`  ${invocation(args.form, 'search <term>')}            — find a skill by name, description, or category`);
    say(`  ${invocation(args.form, 'sync')}                     — fetch the team clone`);
    say(`  ${invocation(args.form, 'publish <skill>')}          — publish a local skill explicitly`);
    say(`  ${invocation(args.form, 'eval <skill>')}             — evaluate a shared skill locally before publishing`);

    // D13: one folder picker, never a scan-and-checklist. Optional, never fatal, and only offered
    // where a person can answer. The second and third project are added from the Library.
    if (args.quiet || args.projects === false || !io.interactive) steps.projects = 'skipped';
    else {
      section('projects');
      io.print(PROJECTS_START_LINE);
      try {
        if (!(await io.confirm(PROJECTS_QUESTION))) steps.projects = 'skipped';
        else {
          const home = args.home ?? homedir();
          const cwd = args.cwd ?? process.cwd();
          // Blank takes the offered default, the way every other text question works; Skip is the
          // confirm above, which is the one place a person declines.
          const answer = (await io.text(PROJECTS_WHERE_QUESTION, await nearestRepoRoot(cwd) ?? cwd, { path: true })).trim();
          await addLibraryProject(store, resolve(cwd, expandTilde(answer, home)), io, { home });
          steps.projects = 'done';
        }
      } catch (error) {
        // A wizard that finished every durable step must not fail on an optional one.
        io.print(`Could not add that project: ${error instanceof Error ? error.message : String(error)}`);
        steps.projects = 'skipped';
      }
    }

    // Reconcile cannot change the team binding, so one post-project snapshot is also the eval step's
    // handle evidence. Keep its read failure inside the two optional, non-fatal steps: setup has
    // already completed its durable team work by here.
    let libraryBinding: { handle?: string } | undefined;
    let libraryBindingError: unknown;
    if (teamName !== '') {
      try { libraryBinding = (await store.read()).teams[teamName]; }
      catch (error) { libraryBindingError = error; }
    }
    if (args.quiet || args.existing === false || !io.interactive || teamName === '') steps.existing = 'skipped';
    else {
      section('existing');
      try {
        const reconciled = await verbs.reconcile({ form: args.form, team: teamName, list: io.channel === 'frames', config: store, runner, home: args.home }, io);
        if (!reconciled.ok) {
          io.print(`Could not check your library against the team: ${reconciled.error}`);
          steps.existing = 'skipped';
        } else if (!reconcileHasRows(reconciled.value)) {
          steps.existing = 'skipped';
        } else {
          steps.existing = io.channel === 'frames' ? 'printed' : 'done';
        }
      } catch (error) {
        io.print(`Could not check your library against the team: ${error instanceof Error ? error.message : String(error)}`);
        steps.existing = 'skipped';
      }
    }

    // The default remains Skip. Queuing never probes the paid agent.
    if (args.quiet || args.evals === false || !io.interactive || teamName === '') steps.evals = 'skipped';
    else {
      section('evals');
      try {
        if (libraryBindingError !== undefined) throw libraryBindingError;
        const handle = libraryBinding?.handle;
        if (!handle) {
          io.print('Skipping the eval offer: this machine has no joined handle for the team yet.');
          steps.evals = 'skipped';
        } else {
          const scan = await skillsWithoutReceipt(clone, teamName, bullet);
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
            // §6.6: a queued eval names the bytes it was queued against, and §6.3 made eval target a
            // LOCAL folder — so queueing resolves and digests each skill here, and a skill with no
            // copy on this machine is reported and left out rather than queued to fail unattended.
            /** Returns how many were actually queued: not every candidate can be. */
            const queue = async (remaining: typeof candidates, window: 'overnight' | 'later'): Promise<number> => {
              const requestedAt = new Date().toISOString();
              const items = await queueItemsFor({ home: args.home ?? homedir(), config: await store.read(), stateRoot: store.root, team: teamName, names: remaining.map(candidate => candidate.name), requestedAt, window }, bullet);
              if (items.length === 0) { io.print('None of those skills has a copy on this machine, so none could be queued.'); return 0; }
              await enqueueEvals(store.root, items, line => io.print(line));
              if (window === 'overnight') io.print(`Queued ${items.length} evals for overnight: the app runs them in parallel between 01:00 and 05:00 while it is open and idle. Run them now with \`${invocation(args.form, 'eval --drain')}\`.`);
              else io.print(`Queued ${items.length} evals for later. Run them with \`${invocation(args.form, 'eval --drain')}\`.`);
              return items.length;
            };
            if (choice === 'Skip') steps.evals = 'skipped';
            // `queued` is what the app renders back as the outcome of this step, so it has to be
            // what happened: the early return above prints that nothing could be queued, and
            // reporting `queued` over it told the user evals were waiting when none were.
            else if (choice === 'Overnight') steps.evals = await queue(candidates, 'overnight') > 0 ? 'queued' : 'skipped';
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
                    run: (candidate, captured) => verbs.eval({ form: args.form, ref: candidate.name, team: teamName, config: store, runner, preflight: reuse, lockWaitMs: EVAL_LOCK_WAIT_MS }, captured),
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

    // The Claude Code pieces — the session hook, the bundled /terum-skills skill (npm-first, Ryan 2026-09-08)
    // and the publish reminder after an edit — are one question with three checkboxes and one Install
    // (Ryan, 2026-09-19), each piece named for what it does and where it writes. The three steps are kept
    // in the result so a shell's progress card reads as before; `hook` is the one the card draws.
    section('hook');
    const outcomes = await verbs.claudeCode(io, {
      hook: resolvedHook(store, args.home, args.hook, args.form),
      wrapper: { ...defaultWrapperOptions(args.home, args.form), ...args.wrapper },
      editHook: { ...defaultEditHookOptions(store.root, args.home), ...args.editHook },
    });
    const installed = (outcome: string): StepOutcome => outcome === 'installed' || outcome === 'replaced' ? 'done' : 'skipped';
    steps.hook = installed(outcomes.hook);
    steps.wrapper = installed(outcomes.wrapper);
    steps.editHook = installed(outcomes.editHook);

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
