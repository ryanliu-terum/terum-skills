import { Command } from 'commander';
import { run as login } from './commands/login.js';
import { run as runTeam } from './commands/team.js';
import { run as share } from './commands/share.js';
import { run as install } from './commands/install.js';
import { run as uninstall } from './commands/uninstall.js';
import { run as sync } from './commands/sync.js';
import { run as search } from './commands/search.js';
import { Prompter } from './lib/prompt.js';
import { Result } from './lib/result.js';

/**
 * §3: commander wiring only. Every verb is `run(args, io)` in src/commands; this file maps flags
 * to it. `execute` is injected so the mapping and the exit code are testable without a terminal.
 */
export type Execute = (invoke: (io: Prompter) => Promise<Result<unknown>>) => Promise<void>;
export interface CliVerbs { login: typeof login; team: typeof runTeam; share?: typeof share; install?: typeof install; uninstall?: typeof uninstall; sync?: typeof sync; search?: typeof search; }

export function buildProgram(execute: Execute, verbs: CliVerbs = { login, team: runTeam }): Command {
  const program = new Command();
  program.name('terum-skills').description('Share private Claude Code skills through a team git repository.').exitOverride();

  program
    .command('login')
    .description('Authenticate an admin for one team (gh, or a per-team PAT as the fallback)')
    .requiredOption('--team <team>', 'team name')
    .requiredOption('--remote <remote>', 'the team repository, e.g. github.com/org/team-skills')
    .action(async (options: { team: string; remote: string }) => execute((io) => verbs.login({ team: options.team, remote: options.remote }, io)));

  const team = program.command('team').description('Create or join a team');
  team
    .command('create <name>')
    .description('Create a private team repository and become its first member')
    .option('--org <org>', 'GitHub organization (default: your own account)')
    .option('--remote <url>', 'push the scaffold to an existing EMPTY remote instead of creating one on GitHub')
    .action(async (name: string, options: { org?: string; remote?: string }) => execute((io) => verbs.team({ kind: 'create', name, ...options }, io)));
  team
    .command('join <target>')
    .description('Join a team: <org>/<repo> on GitHub, or any git remote URL')
    .option('--as <name>', 'local team name (default: the repository name)')
    .action(async (target: string, options: { as?: string }) => execute((io) => verbs.team({ kind: 'join', target, ...options }, io)));

  // M2 verbs are registered at the end to keep the M1/M3 commander edits mechanically mergeable.
  program.command('share [path]').option('--team <team>').option('--allow-privileged').option('--keep-source <id>').option('--keep-repo <id>').option('--relocate <id:path>').option('--forget <id>').action(async (path: string | undefined, options: { team?: string; allowPrivileged?: boolean; keepSource?: string; keepRepo?: string; relocate?: string; forget?: string }) => execute((io) => (verbs.share ?? share)({ path, ...options }, io)));
  program.command('install <ref> [value]').option('--team <team>').option('--force').action(async (ref: string, value: string | undefined, options: { team?: string; force?: boolean }) => execute((io) => (verbs.install ?? install)(ref === 'member' ? { kind: 'member', member: value, ...options } : ref === 'project' ? { kind: 'project', project: value, ...options } : { ref, ...options }, io)));
  program.command('uninstall <ref> [value]').option('--team <team>').action(async (ref: string, value: string | undefined, options: { team?: string }) => execute((io) => (verbs.uninstall ?? uninstall)(ref === 'member' ? { kind: 'member', member: value, ...options } : ref === 'project' ? { kind: 'project', project: value, ...options } : { ref, ...options }, io)));
  program.command('sync').option('--hook').option('--prune').action(async (options: { hook?: boolean; prune?: boolean }) => execute((io) => (verbs.sync ?? sync)(options.hook ? { hook: true, prune: options.prune } : { prune: options.prune }, io)));
  program.command('search <term>').option('--category <category>').option('--author <author>').option('--project <project>').action(async (term: string, options: { category?: string; author?: string; project?: string }) => execute((io) => (verbs.search ?? search)({ term, ...options }, io)));

  return program;
}
