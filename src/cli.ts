import { Command } from 'commander';
import { run as login } from './commands/login.js';
import { run as runTeam } from './commands/team.js';
import { run as share } from './commands/share.js';
import { run as install } from './commands/install.js';
import { run as uninstall } from './commands/uninstall.js';
import { run as sync } from './commands/sync.js';
import { run as search } from './commands/search.js';
import { run as invite } from './commands/invite.js';
import { run as runLs } from './commands/ls.js';
import { run as readme } from './commands/readme.js';
import { run as runLeave } from './commands/leave.js';
import { run as runPublish } from './commands/publish.js';
import { Prompter } from './lib/prompt.js';
import { Result } from './lib/result.js';

/**
 * §3: commander wiring only. Every verb is `run(args, io)` in src/commands; this file maps flags
 * to it. `execute` is injected so the mapping and the exit code are testable without a terminal.
 */
export type Execute = (invoke: (io: Prompter) => Promise<Result<unknown>>) => Promise<void>;
export interface CliVerbs { login: typeof login; team: typeof runTeam; share?: typeof share; install?: typeof install; uninstall?: typeof uninstall; sync?: typeof sync; search?: typeof search; invite?: typeof invite; ls?: typeof runLs; readme?: typeof readme; publish?: typeof runPublish; leave?: typeof runLeave; }

export function buildProgram(execute: Execute, verbs: CliVerbs = { login, team: runTeam }): Command {
  const active: Required<CliVerbs> = { login: verbs.login, team: verbs.team, share: verbs.share ?? share, install: verbs.install ?? install, uninstall: verbs.uninstall ?? uninstall, sync: verbs.sync ?? sync, search: verbs.search ?? search, invite: verbs.invite ?? invite, ls: verbs.ls ?? runLs, readme: verbs.readme ?? readme, publish: verbs.publish ?? runPublish, leave: verbs.leave ?? runLeave };
  const program = new Command();
  program.name('terum-skills').description('Share private Claude Code skills through a team git repository.').exitOverride();

  program
    .command('login')
    .description('Check the GitHub CLI and record your identity (name, email, GitHub login, default handle); writes no team entry')
    .action(async () => execute((io) => active.login({}, io)));

  const team = program.command('team').description('Create or join a team');
  team
    .command('create [name]')
    .description('Create a private team repository and become its first member (asks for the team name and the repository name when omitted)')
    .option('--org <org>', 'GitHub organization (default: your own account)')
    .option('--repo <repo>', 'GitHub repository name (default: the team name)')
    .option('--remote <url>', 'push the scaffold to an existing EMPTY remote instead of creating one on GitHub')
    .action(async (name: string | undefined, options: { org?: string; repo?: string; remote?: string }) => execute((io) => active.team({ kind: 'create', name, ...options }, io)));
  team
    .command('join <target>')
    .description('Join a team: <org>/<repo> on GitHub, or any git remote URL')
    .option('--as <name>', 'local team name (default: the repository name)')
    .action(async (target: string, options: { as?: string }) => execute((io) => active.team({ kind: 'join', target, ...options }, io)));
  team
    .command('remove <handle>')
    .description('Revoke a member’s GitHub access and archive their roster entry')
    .option('--team <team>', 'configured team (required when more than one exists)')
    .option('--archive-only', 'archive roster membership without attempting host access changes')
    .action(async (handle: string, options: { team?: string; archiveOnly?: boolean }) => execute((io) => active.team({ kind: 'remove', handle, ...options }, io)));
  team
    .command('leave <name>')
    .description('Remove this team’s placed skills, its local clone, and its config entry from this machine (your membership is unchanged)')
    .action(async (name: string) => execute((io) => active.leave({ name }, io)));

  program
    .command('invite <github-login...>')
    .description('Invite GitHub users to the configured team')
    .option('--team <team>', 'configured team (required when more than one exists)')
    .action(async (logins: string[], options: { team?: string }) => execute((io) => active.invite({ logins, ...options }, io)));
  const ls = program.command('ls').description('List team members and shared skills').option('--team <team>', 'configured team (required when more than one exists)');
  ls.action(async (options: { team?: string }) => execute((io) => active.ls({ kind: 'all', ...options }, io)));
  ls.command('member <handle>').option('--team <team>', 'configured team (required when more than one exists)').action(async (handle: string, options: { team?: string }) => execute((io) => active.ls({ kind: 'member', value: handle, team: options.team ?? ls.opts<{ team?: string }>().team }, io)));
  ls.command('project <name>').option('--team <team>', 'configured team (required when more than one exists)').action(async (name: string, options: { team?: string }) => execute((io) => active.ls({ kind: 'project', value: name, team: options.team ?? ls.opts<{ team?: string }>().team }, io)));
  program
    .command('readme', { hidden: true })
    .option('--pr-comment <base-ref>', 'render the publish preview comment')
    .action(async (options: { prComment?: string }) => execute((io) => active.readme(options, io)));

  program
    .command('publish <ref>')
    .description('Endorse a shared skill for the team: opens a pull request under policy "pr", commits directly under policy "push"')
    .option('--project <project>', 'endorse into the project list instead of the global list')
    .option('--team <team>', 'configured team (required when more than one exists and the ref is bare)')
    .action(async (ref: string, options: { project?: string; team?: string }) => execute((io) => active.publish({ ref, ...options }, io)));

  // M2 verbs are registered at the end to keep the M1/M3 commander edits mechanically mergeable.
  program.command('share [path]').description('Share a skill folder with the team; later edits flow automatically on sync').option('--team <team>').option('--allow-privileged').option('--keep-source <id>').option('--keep-repo <id>').option('--relocate <id:path>').option('--forget <id>').action(async (path: string | undefined, options: { team?: string; allowPrivileged?: boolean; keepSource?: string; keepRepo?: string; relocate?: string; forget?: string }) => execute((io) => active.share({ path, ...options }, io)));
  program.command('install <ref> [value]').description('Install a skill: <ref>[@<version>], `member <handle>`, or `project <name>`').option('--team <team>').option('--force').action(async (ref: string, value: string | undefined, options: { team?: string; force?: boolean }) => execute((io) => active.install(ref === 'member' ? { kind: 'member', member: value, ...options } : ref === 'project' ? { kind: 'project', project: value, ...options } : { ref, ...options }, io)));
  program.command('uninstall <ref> [value]').description('Remove a placed skill: <ref>, `member <handle>`, or `project <name>`').option('--team <team>').action(async (ref: string, value: string | undefined, options: { team?: string }) => execute((io) => active.uninstall(ref === 'member' ? { kind: 'member', member: value, ...options } : ref === 'project' ? { kind: 'project', project: value, ...options } : { ref, ...options }, io)));
  program.command('sync').description('Pull the team repo, finish pending work, and refresh placed skills (--hook for the session hook)').option('--hook').option('--prune').action(async (options: { hook?: boolean; prune?: boolean }) => execute((io) => active.sync(options.hook ? { hook: true, prune: options.prune } : { prune: options.prune }, io)));
  program.command('search <term>').description('Search shared skills by name, description, or category (read-only)').option('--category <category>').option('--author <author>').option('--project <project>').action(async (term: string, options: { category?: string; author?: string; project?: string }) => execute((io) => active.search({ term, ...options }, io)));

  return program;
}
