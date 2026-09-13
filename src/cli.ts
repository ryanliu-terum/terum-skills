import { invocation, getStartedLines, type InvocationForm } from './lib/invocation.js';
import { run as profile, type ProfileArgs } from './commands/profile.js';
import { run as runUpdate } from './commands/update.js';
import { run as runApp } from './commands/app.js';
import { run as runAppUpdate } from './commands/appUpdate.js';
import { packageVersion } from './lib/package.js';
import { Command, Option } from 'commander';
import { run as login } from './commands/login.js';
import { run as runProject } from './commands/project.js';
import { run as runTeam, type TeamCommand } from './commands/team.js';
import { run as install } from './commands/install.js';
import { run as uninstall } from './commands/uninstall.js';
import { run as runUninstallMachine } from './commands/uninstallMachine.js';
import type { Launch } from './lib/launch.js';
import { run as sync } from './commands/refresh.js';
import { run as prune } from './commands/prune.js';
import { run as search } from './commands/search.js';
import { run as invite } from './commands/invite.js';
import { run as status } from './commands/status.js';
import { run as runLs } from './commands/ls.js';
import { run as readme } from './commands/readme.js';
import { run as runLeave } from './commands/leave.js';
import { run as runPublish } from './commands/publish.js';
import { run as runSetup } from './commands/setup.js';
import { run as runGuardPush } from './commands/guardPush.js';
import { run as runValidate } from './commands/validate.js';
import { run as runEvalReport } from './commands/evalReport.js';
import { run as runEval } from './commands/eval.js';
import { Prompter } from './lib/prompt.js';
import { failure, Result } from './lib/result.js';

/**
 * §3: commander wiring only. Every verb is `run(args, io)` in src/commands; this file maps flags
 * to it. `execute` is injected so the mapping and the exit code are testable without a terminal.
 */
export type Execute = (invoke: (io: Prompter) => Promise<Result<unknown>>, meta: { verb: string; notices: boolean }) => Promise<void>;
export interface CliVerbs { project?: typeof runProject; profile?: typeof profile; app?: typeof runApp; appUpdate?: typeof runAppUpdate; update?: typeof runUpdate; login: typeof login; team: TeamCommand; setup?: typeof runSetup; install?: typeof install; uninstall?: typeof uninstall; uninstallMachine?: typeof runUninstallMachine; sync?: typeof sync; prune?: typeof prune; search?: typeof search; invite?: typeof invite; ls?: typeof runLs; status?: typeof status; readme?: typeof readme; publish?: typeof runPublish; leave?: typeof runLeave; guardPush?: typeof runGuardPush; validate?: typeof runValidate; eval?: typeof runEval; evalReport?: typeof runEvalReport; }

export function buildProgram(execute: Execute, verbs: CliVerbs = { login, team: runTeam }, context: { form?: InvocationForm; launch?: Launch; noUpdateCheck?: boolean; serve?: () => Promise<void> } = {}): Command {
  const active: Required<CliVerbs> = { project: verbs.project ?? runProject, profile: verbs.profile ?? profile, app: verbs.app ?? runApp, appUpdate: verbs.appUpdate ?? runAppUpdate, update: verbs.update ?? runUpdate, login: verbs.login, team: verbs.team, setup: verbs.setup ?? runSetup, install: verbs.install ?? install, uninstall: verbs.uninstall ?? uninstall, uninstallMachine: verbs.uninstallMachine ?? runUninstallMachine, sync: verbs.sync ?? sync, prune: verbs.prune ?? prune, search: verbs.search ?? search, invite: verbs.invite ?? invite, ls: verbs.ls ?? runLs, status: verbs.status ?? status, readme: verbs.readme ?? readme, publish: verbs.publish ?? runPublish, leave: verbs.leave ?? runLeave, guardPush: verbs.guardPush ?? runGuardPush, validate: verbs.validate ?? runValidate, eval: verbs.eval ?? runEval, evalReport: verbs.evalReport ?? runEvalReport };
  const program = new Command();
  program.version(packageVersion() ?? 'version unknown', '-v, --version');
  program.name('terum-skills').description('Share private Claude Code skills through a team git repository.').exitOverride();
  // Root help gives first-time users a runnable next step, including after a local npm install.
  program.addHelpText('after', [
    '',
    'Get started:',
    ...getStartedLines(context.form).slice(1),
    '  Have a skill install command? Run it directly.',
    '  If no teams are configured, it guides you through setup first.',
  ].join('\n'));

  program.command('serve').description('Serve serial read requests over --frames stdio')
    .action(async () => {
      if (context.serve) await context.serve();
      else await execute(async () => failure('serve requires --frames'), { verb: 'serve', notices: false });
    });

  program
    .command('login')
    .description('Check the GitHub CLI and record your identity (name, email, GitHub login, default handle); writes no team entry')
    .option('--set <key=value>', 'Set name, email, or default-handle without prompting (repeatable)', (value: string, previous: string[] = []) => [...previous, value])
    .action(async (options: { set?: string[] }) => execute((io) => active.login({ form: context.form, ...options }, io), { verb: 'login', notices: true }));

  program
    .command('setup [target]')
    .description('Onboarding wizard: on a new machine, asks whether to create a team or join one; re-run to resume your team; pass <org>/<repo> or a remote URL to join directly (one team per machine: leave the current team first)')
    .option('--app', 'open the desktop app (the default wherever one exists)')
    .option('--no-app', 'keep setup in the terminal; do not open the desktop app')
    .option('--no-projects', 'do not offer to add a project to your library')
    .option('--no-evals', 'do not offer to evaluate the shared skills that have no receipt')
    .action(async (target: string | undefined, options: { app?: boolean; projects?: boolean; evals?: boolean }) => execute((io) => active.setup({ form: context.form, target, app: options.app, projects: options.projects, evals: options.evals, cwd: process.cwd() }, io), { verb: 'setup', notices: true }));

  const project = program.command('project').description('Add, forget, or list the projects in your library — the folders this machine reads skills from');
  project.command('add [path]').description('Add a folder to your library')
    .action(async (path: string | undefined) => execute(io => active.project({ form: context.form, kind: 'add', path, cwd: process.cwd() }, io), { verb: 'project add', notices: true }));
  project.command('remove <path>').description('Forget a project; leave its files and ledger unchanged')
    .action(async (path: string) => execute(io => active.project({ form: context.form, kind: 'remove', path, cwd: process.cwd() }, io), { verb: 'project remove', notices: true }));
  project.command('list').description('List the projects in your library')
    .action(async () => execute(io => active.project({ form: context.form, kind: 'list' }, io), { verb: 'project list', notices: true }));

  const team = program.command('team').description(`Create, join, leave, and admin settings for a team; run \`${invocation(context.form, 'team')}\` to see all options`);
  team
    .command('create [name]')
    .description('Create a private team repository and become its first member (asks for the team name and the repository name when omitted)')
    .option('--org <org>', 'GitHub organization (default: your own account)')
    .option('--repo <repo>', 'GitHub repository name (default: <team name>-shared-skills)')
    .option('--remote <url>', 'push the scaffold to an existing EMPTY remote instead of creating one on GitHub')
    .action(async (name: string | undefined, options: { org?: string; repo?: string; remote?: string }) => execute((io) => active.team({ form: context.form, kind: 'create', name, ...options }, io), { verb: 'team create', notices: true }));
  team
    .command('join <target>')
    .description('Join a team: <org>/<repo> on GitHub, or any git remote URL (one team per machine; re-running it for the configured team updates your entry)')
    .addOption(new Option('--as <name>', 'local team name (default: the repository name)').hideHelp())
    .action(async (target: string, options: { as?: string }) => execute((io) => active.team({ form: context.form, kind: 'join', target, ...options }, io), { verb: 'team join', notices: true }));
  team
    .command('remove <handle>')
    .description('Revoke a member’s GitHub access and archive their roster entry')
    .addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp())
    .option('--archive-only', 'archive roster membership without attempting host access changes')
    .action(async (handle: string, options: { team?: string; archiveOnly?: boolean }) => execute((io) => active.team({ form: context.form, kind: 'remove', handle, ...options }, io), { verb: 'team remove', notices: true }));
  team
    .command('leave <name>')
    .description('Remove this team’s placed skills, its local clone, and its config entry from this machine (your membership is unchanged)')
    .action(async (name: string) => execute((io) => active.leave({ form: context.form, name }, io), { verb: 'team leave', notices: true }));
  const teamProject = team.command('project').description('Team projects: the cards that group shared skills and name the repository they place into');
  teamProject.command('create [name]').description('Create a team project: a name, its repository, and the skills it places')
    .option('--remote <url>', "the project's repository; its skills place when a teammate installs inside that folder")
    .addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp())
    .action(async (name: string | undefined, options: { remote?: string; team?: string }) => execute(io => active.team({ form: context.form, kind: 'project-create', name, ...options }, io), { verb: 'team project create', notices: true }));
  team
    .command('workflow-update')
    .description('Print the current workflow scaffold for manual migration; never writes a repository')
    .option('--print', 'print the workflow YAML and migration instruction')
    .action(async (options: { print?: boolean }) => execute((io) => active.team({ form: context.form, kind: 'workflow-update', ...options }, io), { verb: 'team workflow-update', notices: false }));

  program
    .command('invite <github-login...>')
    .description('Invite GitHub users to the configured team')
    .addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp())
    .action(async (logins: string[], options: { team?: string }) => execute((io) => active.invite({ form: context.form, logins, ...options }, io), { verb: 'invite', notices: true }));
  const ls = program.command('ls').description('List team members and shared skills (--local: your local Claude Code skills and their team status)').option('--local', 'list your local Claude Code skills and their team status instead of the team inventory').addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp());
  ls.action(async (options: { team?: string; local?: boolean }) => execute((io) => active.ls({ form: context.form, cwd: process.cwd(), kind: 'all', ...options }, io), { verb: 'ls', notices: true }));
  ls.command('member <handle>').addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp()).action(async (handle: string, options: { team?: string }) => execute((io) => active.ls({ form: context.form, cwd: process.cwd(), kind: 'member', value: handle, team: options.team ?? ls.opts<{ team?: string }>().team, local: ls.opts<{ local?: boolean }>().local }, io), { verb: 'ls', notices: true }));
  ls.command('project <name>').addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp()).action(async (name: string, options: { team?: string }) => execute((io) => active.ls({ form: context.form, cwd: process.cwd(), kind: 'project', value: name, team: options.team ?? ls.opts<{ team?: string }>().team, local: ls.opts<{ local?: boolean }>().local }, io), { verb: 'ls', notices: true }));
  program.command('status').description('Show local team details; exit 0 means the query succeeded, not a setup-readiness or membership test').addOption(new Option('--team <team>', 'show only this configured team').hideHelp()).addOption(new Option('--permissions', 'also ask GitHub which members hold admin permission (one network call)').hideHelp()).action(async (options: { team?: string; permissions?: boolean }) => execute((io) => active.status({ ...options, form: context.form }, io), { verb: 'status', notices: true }));
  program
    .command('readme', { hidden: true })
    .option('--pr-comment <base-ref>', 'render the publish preview comment')
    .action(async (options: { prComment?: string }) => execute((io) => active.readme({ ...options, form: context.form }, io), { verb: 'readme', notices: false }));
  // The clone-local pre-push hook (D12): `guard-push <remote> <url> [<local ref> <local sha> <remote ref> <remote sha>]...`.
  program
    .command('guard-push <remote> <url> [refs...]', { hidden: true })
    .action(async (remote: string, url: string, refs: string[]) => execute((io) => active.guardPush({ form: context.form, remote, url, refs }, io), { verb: 'guard-push', notices: false }));

  program
    .command('publish <ref>')
    .description('Endorse a shared skill for the team: opens a pull request under policy "pr", commits directly under policy "push"')
    .option('--project <project>', 'endorse into the project list instead of the global list')
    .addOption(new Option('--team <team>', 'configured team (required when more than one exists and the ref is bare)').hideHelp())
    .action(async (ref: string, options: { project?: string; team?: string }) => execute((io) => active.publish({ form: context.form, ref, ...options, cwd: process.cwd() }, io), { verb: 'publish', notices: true }));

  program.command('validate <path|name>').description("Check a skill's safety and formatting deterministically: a shared skill by name or its local source folder by path (requires a configured team)").addHelpText('after', '\nDeterministic and offline (no model, no network call): HYG1 frontmatter, HYG2 hidden characters, HYG3 credentials and foreign emails, HYG4 executables and extensions, HYG5 license agreement, HYG6 description (size over 20,000 is a warning). A folder that has never been connected fails HYG1 on the managed fields connect adds (license, metadata.id, metadata.author, metadata.terum-category); connect it first.').addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp()).option('--cwd <team-checkout>', 'read the skill and team policy directly from this team checkout').action(async (target: string, options: { team?: string; cwd?: string }) => execute((io) => active.validate({ form: context.form, target, ...options }, io), { verb: 'validate', notices: true }));
  program.command('receipt-check', { hidden: true }).action(async () => execute(async (io) => { io.print('receipt-check is retired; publish records receipts when it mints a version.'); return { ok: true, value: undefined }; }, { verb: 'receipt-check', notices: false }));
  program.command('share [ref]', { hidden: true }).action(async () => execute(async () => failure(`\`share\` is retired; run \`${invocation(context.form, 'publish <skill>')}\` to publish a skill explicitly.`), { verb: 'share', notices: false }));
  program.command('eval-report <skill>').description("Show a skill's committed eval receipts and this machine's local runs (read-only, no fetch)").option('--team <team>', 'configured team (required when more than one exists)').action(async (ref: string, options: { team?: string }) => execute((io) => active.evalReport({ form: context.form, ref, ...options }, io), { verb: 'eval-report', notices: false }));
  program.command('eval [skill]').description('Evaluate a shared skill locally; generated assets stay local until reviewed').option('--k <n>', 'repetitions per execution case (default 1; --k 3 or more for a receipt you intend to gate on)', Number).option('--triggers-only').option('--execution-only').option('--case <stem>').option('--model <model>').option('--judge-model <model>').option('--no-gen', 'do not generate missing eval assets').option('--team <team>').option('--parallel <n>', 'queued evals to run at a time (default: 4)', Number).option('--queue-list', 'list queued evals').option('--drain', 'run queued evals').option('--window <window>', 'drain only overnight items').option('--max <n>', 'maximum queued items to attempt', Number).option('--dequeue <skill>', 'remove a skill from the queue (<skill> or <team>/<skill>)').action(async (ref: string | undefined, options: { parallel?: number; queueList?: boolean; drain?: boolean; window?: string; max?: number; dequeue?: string; k?: number; triggersOnly?: boolean; executionOnly?: boolean; case?: string; model?: string; judgeModel?: string; gen?: boolean; team?: string }) => {
    // commander models `--no-gen` as `gen: false`; with `--gen` deleted (D29) false is the only
    // value it can carry, and `use what is there, generate what is missing` is the default.
    const { gen, ...rest } = options;
    const args = { form: context.form, ...rest, ...(gen === false ? { noGen: true } : {}) };
    if (ref === undefined || options.queueList || options.drain || options.dequeue !== undefined || options.window !== undefined || options.max !== undefined || options.parallel !== undefined) {
      const { runQueue } = await import('./commands/eval.js');
      return execute(io => runQueue({ ...args, ref }, io), { verb: 'eval', notices: true });
    }
    return execute(io => active.eval({ ...args, ref }, io), { verb: 'eval', notices: true });
  });

  program.command('install <ref> [value]').description('Install a skill: <ref>[@<version>], `member <handle>`, or `project <name>`').addOption(new Option('--team <team>').hideHelp()).option('--force').option('--into <global|root>').action(async (ref: string, value: string | undefined, options: { team?: string; force?: boolean; into?: string }) => execute((io) => active.install(ref === 'member' ? { kind: 'member', member: value, ...options, form: context.form } : ref === 'project' ? { kind: 'project', project: value, ...options, form: context.form } : { ref, ...options, form: context.form }, io), { verb: 'install', notices: true }));
  program.command('uninstall-skill <ref> [value]').description('Remove a placed skill: <ref>, `member <handle>`, or `project <name>`').addOption(new Option('--team <team>').hideHelp()).option('--from <global|root>').action(async (ref: string, value: string | undefined, options: { team?: string; from?: string }) => execute((io) => active.uninstall(ref === 'member' ? { kind: 'member', member: value, ...options, form: context.form } : ref === 'project' ? { kind: 'project', project: value, ...options, form: context.form } : { ref, ...options, form: context.form }, io), { verb: 'uninstall-skill', notices: true }));
  program.command('uninstall').description('Remove terum-skills from this machine: your team (placed skills, local clone, cache), the session-start hook and the /terum-skills Claude Code skill if present, and ~/.terum/skills except recovery data; then prints the package-manager step').allowExcessArguments().action(async (_options: Record<string, never>, command: Command) => execute(async (io) => command.args.length ? failure(`To remove a skill, use \`${invocation(context.form, 'uninstall-skill <ref>')}\`.`) : active.uninstallMachine({ launch: context.launch, form: context.form }, io), { verb: 'uninstall', notices: true }));
  program.command('sync').description('Fetch each team clone and reset it to origin/main. Nothing on this machine is changed: no placement, no upload, no edit to your skills.').option('--hook', 'session-start mode').addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp()).action(async (options: { hook?: boolean; team?: string }) => execute((io) => active.sync({ ...options, form: context.form }, io), { verb: 'sync', notices: !options.hook }));
  program.command('prune').description('Delete quarantined items after listing and confirmation').action(async () => execute((io) => active.prune({ form: context.form }, io), { verb: 'prune', notices: true }));
  program.command('search <term>').description('Search shared skills by name, description, or category (read-only)').option('--category <category>').option('--author <author>').option('--project <project>').action(async (term: string, options: { category?: string; author?: string; project?: string }) => execute((io) => active.search({ form: context.form, term, ...options }, io), { verb: 'search', notices: true }));

  program.command('app')
    .description('Open the Terum Skills desktop app for this version, downloading it first if needed (macOS, Windows); records where this CLI is so the app can drive it')
    .action(async () => execute((io) => active.app({ form: context.form, launch: context.launch }, io), { verb: 'app', notices: false }));

  program.command('update')
    .description("Show this copy's version, the latest advertised release, and the command that updates it (prints it, never runs it)")
    .action(async () => execute((io) => active.update(context, io), { verb: 'update', notices: false }));

  program.command('profile').description('Update your own team profile')
    .option('--name <display>').option('--bio <text>').option('--role <role>')
    .option('--project <name>', 'project membership (repeat for each project)', (value: string, previous: string[]) => [...previous, value], [])
    .addOption(new Option('--team <team>').hideHelp())
    .action(async (options: Omit<ProfileArgs, 'projects'> & { project?: string[] }) => {
      const { project, ...rest } = options;
      return execute(io => active.profile({ ...rest, ...(project?.length ? { projects: project } : {}), form: context.form }, io), { verb: 'profile', notices: true });
    });
  program.command('app-update')
    .description('Check for, download, or install a newer Terum Skills desktop app (reports only, unless --stage or --apply)')
    .option('--check', 'report what is advertised and what is staged; downloads nothing (default)')
    .option('--stage', 'download and verify the desktop app for --release; installs nothing')
    .option('--apply', 'hand the install to a background process and return; the caller must then quit')
    .option('--release <version>', 'which released version to act on (default: this copy’s version)')
    .option('--force', 'with --check, ask GitHub now instead of honouring the once-a-day cap')
    .addOption(new Option('--reason <reason>', 'record why the app is installing').choices(['on-close', 'overnight', 'manual']))
    .addOption(new Option('--await-pid <pid>', 'wait for this process to exit before installing').hideHelp())
    .addOption(new Option('--apply-now', 'the detached install leg; never run this by hand').hideHelp())
    .action(async (options: { check?: boolean; stage?: boolean; apply?: boolean; release?: string; force?: boolean; awaitPid?: string; applyNow?: boolean; reason?: string }) => execute((io) => active.appUpdate({ ...options, form: context.form, launch: context.launch }, io), { verb: 'app-update', notices: false }));
  return program;
}
