import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandResult, Runner, RunOptions, systemRunner } from '../runner.js';
import { Prompter, PromptClosedError } from '../prompt.js';

/** Every temp dir created through `temporaryDirectory` — removed by setup.ts after each test. */
export const TEMP_DIRS: string[] = [];

/**
 * A Prompter with scripted answers that records every question it was asked. Like the real
 * terminal channel it throws PromptClosedError once its script is exhausted ('' means "press
 * Enter", i.e. take the default), so an over-asking verb fails loudly instead of drifting.
 */
export class ScriptedPrompter implements Prompter {
  readonly lines: string[] = [];
  readonly asked: string[] = [];
  constructor(private readonly answers: string[] = [], private readonly confirms: boolean[] = [], readonly interactive = false) {}
  private next(question: string): string {
    this.asked.push(question);
    const answer = this.answers.shift();
    if (answer === undefined) throw new PromptClosedError(question, 'closed');
    return answer;
  }
  async confirm(question: string): Promise<boolean> {
    this.asked.push(question);
    const answer = this.confirms.shift();
    if (answer === undefined) throw new PromptClosedError(question, 'closed');
    return answer;
  }
  async text(question: string, defaultValue?: string): Promise<string> { return this.next(question) || (defaultValue ?? ''); }
  async secret(question: string): Promise<string> { return this.next(question); }
  async select(question: string, choices: readonly string[]): Promise<string> { return this.next(question) || choices[0] || ''; }
  print(line: string): void { this.lines.push(line); }
  askedAbout(fragment: string): boolean { return this.asked.some((question) => question.includes(fragment)); }
  countAsked(fragment: string): number { return this.asked.filter((question) => question.includes(fragment)).length; }
}

export async function temporaryDirectory(prefix = 'terum-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}

export async function git(args: string[], cwd?: string): Promise<string> {
  const result = await systemRunner.run('git', args, { cwd });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

export const TEAM_JSON = { layout_version: 2, name: 'team', categories: [], global: [], projects: {}, archived: [] as string[], policy: { publish: 'pr', skill_license: 'UNLICENSED' } };
export const person = (handle: string, extra: Record<string, unknown> = {}) => ({ handle, display_name: handle, email: `${handle}@example.com`, github: handle, bio: '', installed: [], declined: [], ...extra });

/** A bare "origin" seeded with a minimal §4.1 tree on `main`, plus the seed clone that pushed it. */
export async function bareTeam(): Promise<{ root: string; bare: string; seed: string }> {
  const root = await temporaryDirectory();
  const bare = join(root, 'team.git');
  const seed = join(root, 'seed');
  await git(['init', '-q', '--bare', bare]);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare);
  await git(['clone', '-q', bare, seed]);
  await git(['checkout', '-q', '-b', 'main'], seed);
  await git(['config', 'user.name', 'Seed'], seed);
  await git(['config', 'user.email', 'seed@example.com'], seed);
  await mkdir(join(seed, 'people'), { recursive: true });
  await mkdir(join(seed, 'skills'), { recursive: true });
  await mkdir(join(seed, 'evals'), { recursive: true });
  await writeFile(join(seed, 'skills', '.gitkeep'), '');
  await writeFile(join(seed, 'evals', '.gitkeep'), '');
  await writeFile(join(seed, 'team.json'), `${JSON.stringify(TEAM_JSON, null, 2)}\n`);
  await writeFile(join(seed, 'people', 'seed.json'), `${JSON.stringify(person('seed'), null, 2)}\n`);
  await git(['add', '--all'], seed);
  await git(['commit', '-q', '-m', 'seed'], seed);
  await git(['push', '-q', 'origin', 'HEAD:main'], seed);
  return { root, bare, seed };
}

/** Commit and push a file from the seed clone — "another machine moved origin/main". */
export async function pushFromSeed(seed: string, path: string, content: string, message = 'seed update'): Promise<void> {
  await git(['fetch', '-q', 'origin'], seed);
  await git(['reset', '-q', '--hard', 'origin/main'], seed);
  await mkdir(join(seed, path, '..'), { recursive: true });
  await writeFile(join(seed, path), content);
  await git(['add', '--all'], seed);
  await git(['commit', '-q', '-m', message], seed);
  await git(['push', '-q', 'origin', 'HEAD:main'], seed);
}

export async function cloneWithIdentity(bare: string, destination: string, name = 'Me', email = 'me@example.com'): Promise<string> {
  await git(['clone', '-q', '--branch', 'main', bare, destination]);
  await git(['config', 'user.name', name], destination);
  await git(['config', 'user.email', email], destination);
  return destination;
}

export async function originSha(bare: string, ref = 'main'): Promise<string> {
  return (await git(['rev-parse', ref], bare)).trim();
}

export type GhHandler = (args: readonly string[], options?: RunOptions) => CommandResult | Promise<CommandResult>;
export interface RecordedCall { command: 'git' | 'gh'; args: string[]; env?: NodeJS.ProcessEnv; cwd?: string; }

/**
 * Maps a public-looking remote to a local bare fixture in both directions (arguments in, stdout
 * out), records every call, and routes `gh` to a handler (default: "gh is not installed").
 */
export function mappedRunner(publicRemote: string, bare: string, gh?: GhHandler): Runner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(command, args, options) {
      calls.push({ command, args: [...args], env: options?.env, cwd: options?.cwd });
      if (command === 'gh') {
        if (!gh) throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
        return gh(args, options);
      }
      const mapped = args.map((value) => (value === publicRemote ? bare : value));
      const result = await systemRunner.run(command, mapped, options);
      return { ...result, stdout: result.stdout.split(bare).join(publicRemote) };
    },
  };
}

/** Wrap a runner so a hook can act before (or instead of) a matching command. */
export function wrapRunner(base: Runner, hook: (command: 'git' | 'gh', args: readonly string[], options: RunOptions | undefined, next: () => Promise<CommandResult>) => Promise<CommandResult>): Runner {
  return { run: (command, args, options) => hook(command, args, options, () => base.run(command, args, options)) };
}

/**
 * A gh handler that reports "installed, authenticated as <login>" and answers the given API calls.
 * Like the real gh, an `api` call succeeds only when the ambient login is authenticated OR a
 * GH_TOKEN was passed in the child env; `auth login` flips the ambient state.
 */
export function fakeGh(login: string, api: Record<string, CommandResult> = {}, authenticated = true): GhHandler {
  let loggedIn = authenticated;
  return (args, options) => {
    const key = args.join(' ');
    if (args[0] === '--version') return { code: 0, stdout: 'gh version 2.0.0', stderr: '' };
    if (key === 'auth status') return loggedIn ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: 'not logged in' };
    if (key === 'auth login') { loggedIn = true; return { code: 0, stdout: '', stderr: '' }; }
    const credentialed = loggedIn || Boolean(options?.env?.GH_TOKEN);
    if (args[0] === 'api' && !credentialed) return { code: 1, stdout: '', stderr: 'gh: Requires authentication (HTTP 401)' };
    if (key === 'api user -q .login') return { code: 0, stdout: `${login}\n`, stderr: '' };
    return api[key] ?? { code: 1, stdout: '', stderr: `unexpected gh ${key}` };
  };
}

/** A runner that answers gh through `handler` and every git call with success; records calls. */
export function ghOnlyRunner(handler: GhHandler): Runner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return { calls, async run(command, args, options) { calls.push({ command, args: [...args], env: options?.env, cwd: options?.cwd }); return command === 'gh' ? handler(args, options) : { code: 0, stdout: '', stderr: '' }; } };
}

/** A runner on a machine with no gh at all (spawn ENOENT); git succeeds trivially. */
export const noGhRunner: Runner = { async run(command) { if (command === 'gh') throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); return { code: 0, stdout: '', stderr: '' }; } };

export async function content(path: string): Promise<string> { return readFile(path, 'utf8'); }
export async function clean(path: string): Promise<void> { await rm(path, { recursive: true, force: true }); }
export const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);
