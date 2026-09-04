import { Command } from 'commander';
import { run as login } from './commands/login.js';
import { run as runTeam } from './commands/team.js';
import { Prompter } from './lib/prompt.js';
import { Result } from './lib/result.js';

/**
 * §3: commander wiring only. Every verb is `run(args, io)` in src/commands; this file maps flags
 * to it. `execute` is injected so the mapping and the exit code are testable without a terminal.
 */
export type Execute = (invoke: (io: Prompter) => Promise<Result<unknown>>) => Promise<void>;
export interface CliVerbs { login: typeof login; team: typeof runTeam; }

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

  return program;
}
