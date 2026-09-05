import { ConfigStore, createConfigStore } from './config.js';
import { Prompter } from './prompt.js';
import { normalizeRemote } from './remote.js';
import { Runner, systemRunner } from './runner.js';
import { Config, emailSchema, githubLoginSchema, HANDLE_RULE, handleSchema, TeamConfig } from './schema.js';

/**
 * §6 `login` / D7 / D8 (rev 9, Decision 2). gh is the only credential the tool touches on GitHub —
 * through gh's own `gh auth login`, offered as a child process with inherited stdio. A generic-git
 * remote uses whatever ambient git credentials the machine already has. The tool never prompts
 * for, stores, probes, or passes a token, and nobody — creator or joiner — is ever asked for one.
 */
export interface AuthDependencies { config?: ConfigStore; runner?: Runner; }
export interface Identity { handle: string; displayName: string; email: string; github: string; }
export interface GhState { installed: boolean; authenticated: boolean; }

export const MAX_ATTEMPTS = 3;
const GITHUB_LOGIN_RULE = 'a GitHub login is 1-39 letters, digits, or single internal hyphens; enter - if you have none';

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
}

/**
 * First-run identity (§5.4 rules): GitHub login, handle (validated, re-prompted), name, email.
 * The login is optional (a generic-git member may have none) but, when given, must be a real
 * GitHub login: it is identity evidence at `team join` (the §5.4 reclaim rule) and a REST path
 * segment at `team remove`, so it is validated and re-asked like the handle.
 */
export async function collectIdentity(io: Prompter, existing: Config, runner: Runner = systemRunner, options: IdentityOptions = {}): Promise<Identity> {
  // A persisted value that is not a login (written before this validation existed) is no default: it would be re-offered forever.
  let suggested = existing.github && githubLoginSchema.safeParse(existing.github).success ? existing.github : '';
  if (!suggested && options.gh?.authenticated) {
    const login = await runner.run('gh', ['api', 'user', '-q', '.login']);
    if (login.code === 0 && githubLoginSchema.safeParse(login.stdout.trim()).success) suggested = login.stdout.trim();
  }
  // Enter takes the suggestion, so `-` is the way to say "none" once one is offered.
  const github = await askUntilValid(io, suggested ? 'GitHub login (- for none)' : 'GitHub login', suggested, (value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '-') return { ok: true, value: '' };
    const parsed = githubLoginSchema.safeParse(trimmed);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, rule: GITHUB_LOGIN_RULE };
  });
  const handle = options.fixedHandle ?? (await askHandle(io, existing.default_handle ?? (github || undefined)));
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

export interface CreatorAuth { identity: Identity; gh: GhState; }

/** Shared wording for `team create` and setup's read-only GitHub preflight. */
export function creatorAuthenticationError(gh: GhState): string | null {
  if (!gh.installed) return 'Creating a GitHub team needs the GitHub CLI (gh) in phase 1. Install it from https://cli.github.com and run `gh auth login`, or create the team against an existing empty remote with `team create <name> --remote <url>`.';
  if (!gh.authenticated) return 'GitHub authentication is required to create a team: run `gh auth login` and retry, or create the team against an existing empty remote with `team create <name> --remote <url>`.';
  return null;
}

/**
 * Creator path: `team create` on GitHub needs `gh repo create`, so a logged-in gh is required —
 * detection, the login offer, then identity. There is no token fallback (Decision 2): declined,
 * or no gh at all, stops here and says what to do instead.
 */
export async function authenticateCreator(io: Prompter, dependencies: AuthDependencies = {}): Promise<CreatorAuth> {
  const store = dependencies.config ?? createConfigStore();
  const runner = dependencies.runner ?? systemRunner;
  const config = await store.read();
  const gh = await detectOrOfferGh(io, runner);
  const authenticationError = creatorAuthenticationError(gh);
  if (authenticationError) throw new Error(authenticationError);
  const identity = await collectIdentity(io, config, runner, { gh });
  return { identity, gh };
}

/** When a gh call failed, the reason worth telling the user when the cause is gh itself (absent or logged out); null otherwise. */
export async function explainGhFailure(runner: Runner = systemRunner): Promise<string | null> {
  const gh = await ghState(runner);
  if (!gh.installed) return 'GitHub CLI (gh) is not installed; this operation needs it on GitHub in phase 1. Install it from https://cli.github.com and run `gh auth login`.';
  if (!gh.authenticated) return 'GitHub authentication is required: run `gh auth login` and retry.';
  return null;
}

/** Joiner path (D8): detection and the gh offer only — a token is never requested. */
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

/**
 * The one place a `teams.<name>` entry is written: `team create`/`team join` only, always with the
 * handle they proved against the roster (rev 9, Decision 4). Unknown keys are kept, except a stale
 * `token` from before Decision 2, which is dropped rather than carried forward.
 */
export function bindTeam(config: Config, name: string, entry: { remote: string; handle: string }): TeamConfig {
  const current: Record<string, unknown> = { ...(config.teams[name] ?? {}) };
  delete current.token;
  const bound: TeamConfig = { ...current, remote: normalizeRemote(entry.remote), handle: entry.handle };
  config.teams[name] = bound;
  return bound;
}

/** The config entry already bound to a remote, if any (§6: a second join never duplicates a team). */
export function teamByRemote(config: Config, remote: string): [string, TeamConfig] | undefined {
  const normalized = normalizeRemote(remote);
  return Object.entries(config.teams).find(([, team]) => team.remote === normalized);
}

/**
 * One remote → one team name, one name → one remote. `create` and `join` check this before they
 * prompt AND again under the config lock right before binding, so a verb that ran in between
 * cannot leave two entries for one repository.
 */
export function assertBindable(config: Config, team: string, remote: string): void {
  const normalized = normalizeRemote(remote);
  const byRemote = teamByRemote(config, normalized);
  if (byRemote && byRemote[0] !== team) throw new Error(`${normalized} is already configured as team ${byRemote[0]}.`);
  const existing = config.teams[team];
  if (existing && existing.remote !== normalized) throw new Error(`Team ${team} is configured for ${existing.remote}, not ${normalized}; pass --as <other-name>.`);
}
