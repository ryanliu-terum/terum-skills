import { ConfigStore, createConfigStore } from './config.js';
import { Prompter } from './prompt.js';
import { isGitHubRemote, normalizeRemote, remoteToGitUrl } from './remote.js';
import { Runner, systemRunner } from './runner.js';
import { Config, emailSchema, HANDLE_RULE, handleSchema, TeamConfig } from './schema.js';

/**
 * §6 `login` / D7 / D8. gh is the credential; a per-team fine-grained PAT is the fallback for a
 * GitHub team when gh is logged out or absent. Tokens travel to gh as GH_TOKEN and to git as an
 * env-only credential helper scoped to github.com (`gitAuthEnv`) — never on a command line,
 * never in a URL, never `gh auth login --with-token`. Joiners are never asked for a PAT.
 */
export interface AuthDependencies { config?: ConfigStore; runner?: Runner; }
export interface Identity { handle: string; displayName: string; email: string; github: string; }
export interface GhState { installed: boolean; authenticated: boolean; }

export const MAX_ATTEMPTS = 3;
export const GITHUB_HOST = 'https://github.com';

export async function ghState(runner: Runner = systemRunner): Promise<GhState> {
  try {
    const version = await runner.run('gh', ['--version']);
    if (version.code !== 0) return { installed: false, authenticated: false };
  } catch {
    return { installed: false, authenticated: false };
  }
  return { installed: true, authenticated: await ghAuthenticated(runner) };
}

async function ghAuthenticated(runner: Runner): Promise<boolean> {
  try { return (await runner.run('gh', ['auth', 'status'])).code === 0; } catch { return false; }
}

/**
 * gh logged in → done. gh installed but logged out, on an interactive Prompter → offer (y/N) to run
 * gh's own interactive login with inherited stdio, then re-check. Never offered when the channel
 * is not interactive (§6: "skipped whenever stdin is not a TTY").
 */
export async function detectOrOfferGh(io: Prompter, runner: Runner = systemRunner, known?: GhState): Promise<GhState> {
  const state = known ?? (await ghState(runner));
  if (state.authenticated || !state.installed || !io.interactive) return state;
  if (!(await io.confirm('GitHub CLI is installed but logged out. Run `gh auth login` now?'))) return state;
  try { await runner.run('gh', ['auth', 'login'], { stdio: 'inherit' }); } catch { return state; }
  return { installed: true, authenticated: await ghAuthenticated(runner) };
}

export interface IdentityOptions {
  /** §5.4: the per-team handle is immutable once its people file exists — when bound, it is not asked. */
  fixedHandle?: string;
  gh?: GhState;
  /** A GitHub login already known (from a PAT probe); skips the `gh api user` lookup. */
  githubLogin?: string;
}

/** First-run identity (§5.4 rules): GitHub login, handle (validated, re-prompted), name, email. */
export async function collectIdentity(io: Prompter, existing: Config, runner: Runner = systemRunner, options: IdentityOptions = {}): Promise<Identity> {
  let github = existing.github ?? options.githubLogin ?? '';
  if (!github && options.gh?.authenticated) {
    const login = await runner.run('gh', ['api', 'user', '-q', '.login']);
    if (login.code === 0) github = login.stdout.trim();
  }
  github = (await io.text('GitHub login', github)).trim();
  const handle = options.fixedHandle ?? (await askHandle(io, existing.default_handle ?? github));
  const displayName = await askUntilValid(io, 'Your name', existing.display_name, (value) => (value.trim() ? { ok: true, value: value.trim() } : { ok: false, rule: 'a name is required' }));
  const email = await askUntilValid(io, 'Your email', existing.email, (value) => (emailSchema.safeParse(value.trim()).success ? { ok: true, value: value.trim() } : { ok: false, rule: 'enter a valid email address' }));
  return { handle, displayName, email, github };
}

/** The one handle prompt: validated against §5.4 syntax, re-asked with the rule. */
export async function askHandle(io: Prompter, defaultValue?: string): Promise<string> {
  return askUntilValid(io, 'Team handle', defaultValue, (value) => {
    const parsed = handleSchema.safeParse(value);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, rule: HANDLE_RULE };
  });
}

export type Validation = { ok: true; value: string } | { ok: false; rule: string };

/** Ask up to MAX_ATTEMPTS times, printing the rule after each rejected answer; the last rejection throws. */
export async function askUntilValid(io: Prompter, question: string, defaultValue: string | undefined, validate: (value: string) => Validation): Promise<string> {
  let rule = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const outcome = validate(await io.text(question, defaultValue));
    if (outcome.ok) return outcome.value;
    rule = outcome.rule;
    if (attempt < MAX_ATTEMPTS) io.print(`Invalid ${question.toLowerCase()}: ${rule}`);
  }
  throw new Error(`Invalid ${question.toLowerCase()} after ${MAX_ATTEMPTS} attempts: ${rule}`);
}

/**
 * Env for git/gh child processes when a per-team PAT is in play. Empty when there is no token.
 * The credential helper is scoped to github.com — tokens are GitHub-only (D7) — and is appended
 * after any GIT_CONFIG_* entries the caller's environment already carries.
 */
export function gitAuthEnv(token: string | null | undefined, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!token) return {};
  const base = Number.parseInt(inherited.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  const key = `credential.${GITHUB_HOST}.helper`;
  return {
    GH_TOKEN: token,
    GIT_CONFIG_COUNT: String(base + 2),
    // An empty helper value resets the list for this URL scope; ours then answers from GH_TOKEN
    // in the environment. Nothing is written to disk and the token never appears on a command line.
    [`GIT_CONFIG_KEY_${base}`]: key,
    [`GIT_CONFIG_VALUE_${base}`]: '',
    [`GIT_CONFIG_KEY_${base + 1}`]: key,
    [`GIT_CONFIG_VALUE_${base + 1}`]: '!f() { printf "username=x-access-token\\npassword=%s\\n" "$GH_TOKEN"; }; f',
  };
}

export interface CreatorAuth { identity: Identity; gh: GhState; token: string | null; }
export interface CreatorAuthOptions {
  /** The team remote; a PAT is only ever accepted for a GitHub remote and is probed against it when known. */
  remote?: string;
  /** `team create` needs `gh repo create`; `login` does not. */
  requireGh?: boolean;
  fixedHandle?: string;
}

/**
 * Admin path (creator / `login`). gh logged in is the normal case. Otherwise, for a GitHub
 * remote, a per-team PAT: probed with `git ls-remote` against the team repo when the repo is
 * known, else with `gh api user` (which needs gh installed). Phase 1 has no HTTP client.
 */
export async function authenticateCreator(io: Prompter, dependencies: AuthDependencies = {}, options: CreatorAuthOptions = {}): Promise<CreatorAuth> {
  const store = dependencies.config ?? createConfigStore();
  const runner = dependencies.runner ?? systemRunner;
  const config = await store.read();
  const gh = await detectOrOfferGh(io, runner);
  if (options.requireGh && !gh.installed) {
    throw new Error('Creating a GitHub team needs the GitHub CLI (gh) in phase 1. Install it from https://cli.github.com and run `gh auth login`, or create the team against an existing empty remote with `team create <name> --remote <url>`.');
  }
  let token: string | null = null;
  let githubLogin: string | undefined;
  if (!gh.authenticated) {
    if (options.remote !== undefined && !isGitHubRemote(options.remote)) {
      throw new Error(`${normalizeRemote(options.remote)} is not on GitHub; a per-team PAT is GitHub-only (D7). Use your ambient git credentials for this remote.`);
    }
    token = await io.secret('Fine-grained GitHub PAT for this team (repo Administration + Contents)');
    if (!token) throw new Error('GitHub authentication is required: log in with `gh auth login` or provide a per-team PAT.');
    githubLogin = await probeToken(token, options.remote, gh, runner);
  }
  const identity = await collectIdentity(io, config, runner, { fixedHandle: options.fixedHandle, gh, githubLogin });
  return { identity, gh, token };
}

/** Verify a PAT. Against the team repo when known (no gh needed); otherwise via gh, which must exist. Returns the login when gh told us. */
async function probeToken(token: string, remote: string | undefined, gh: GhState, runner: Runner): Promise<string | undefined> {
  const env = gitAuthEnv(token);
  if (remote !== undefined) {
    const heads = await runner.run('git', ['ls-remote', '--heads', '--', remoteToGitUrl(remote)], { env });
    if (heads.code !== 0) throw new Error(`GitHub token probe failed against ${normalizeRemote(remote)}: ${(heads.stderr || heads.stdout).trim()}`);
    if (!gh.installed) return undefined;
  } else if (!gh.installed) {
    throw new Error('Cannot verify a PAT without gh or a known team repository.');
  }
  const who = await runner.run('gh', ['api', 'user', '-q', '.login'], { env });
  if (who.code !== 0) throw new Error(`GitHub token probe failed: ${(who.stderr || who.stdout).trim()}`);
  return who.stdout.trim() || undefined;
}

/** Joiner path (D8): detection and the gh offer only — a PAT is never requested. */
export async function identityForJoiner(io: Prompter, dependencies: AuthDependencies = {}, options: { fixedHandle?: string; gh?: GhState } = {}): Promise<{ identity: Identity; gh: GhState }> {
  const store = dependencies.config ?? createConfigStore();
  const runner = dependencies.runner ?? systemRunner;
  const config = await store.read();
  const gh = options.gh ?? (await detectOrOfferGh(io, runner));
  return { identity: await collectIdentity(io, config, runner, { fixedHandle: options.fixedHandle, gh }), gh };
}

/** The machine-wide defaults every verb refreshes after collecting identity (§5.4). */
export function setIdentity(config: Config, identity: Identity): void {
  config.default_handle = identity.handle;
  config.display_name = identity.displayName;
  config.email = identity.email;
  config.github = identity.github;
}

/** The one place a `teams.<name>` entry is written. `token`/`handle` undefined = keep what is stored. */
export function bindTeam(config: Config, name: string, entry: { remote: string; token?: string | null; handle?: string | null }): TeamConfig {
  const current = config.teams[name];
  const bound: TeamConfig = {
    ...(current ?? {}),
    remote: normalizeRemote(entry.remote),
    token: entry.token === undefined ? (current?.token ?? null) : entry.token,
    handle: entry.handle === undefined ? (current?.handle ?? null) : entry.handle,
  };
  config.teams[name] = bound;
  return bound;
}

/** The config entry already bound to a remote, if any (§6: a second join never duplicates a team). */
export function teamByRemote(config: Config, remote: string): [string, TeamConfig] | undefined {
  const normalized = normalizeRemote(remote);
  return Object.entries(config.teams).find(([, team]) => team.remote === normalized);
}
