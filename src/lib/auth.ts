import { invocation, type InvocationForm, type WithForm } from './invocation.js';
import { ConfigStore, createConfigStore } from './config.js';
import { Prompter } from './prompt.js';
import { normalizeRemote, stripRemoteCredentials } from './remote.js';
import { RefusedError } from './result.js';
import { Runner, systemRunner } from './runner.js';
import { Config, emailSchema, githubLoginSchema, HANDLE_RULE, handleSchema, TeamConfig } from './schema.js';

/**
 * §6 `login` / D7 / D8 (rev 9, Decision 2). gh is the only credential the tool touches on GitHub —
 * through gh's own `gh auth login`, offered as a child process with inherited stdio. A generic-git
 * remote uses whatever ambient git credentials the machine already has. The tool never prompts
 * for, stores, probes, or passes a token, and nobody — creator or joiner — is ever asked for one.
 */
export interface AuthDependencies extends WithForm { config?: ConfigStore; runner?: Runner; }
export interface Identity { handle: string; displayName: string; email: string; github: string; }
export interface GhState { installed: boolean; authenticated: boolean; }

export const MAX_ATTEMPTS = 3;
const GITHUB_LOGIN_RULE = 'a GitHub login is 1-39 letters, digits, or single internal hyphens; enter - if you have none';

/** Offline executable presence; never probes credentials. */
export async function gitState(runner: Runner = systemRunner): Promise<{ installed: boolean }> {
  try { return { installed: (await runner.run('git', ['--version'])).code === 0 }; }
  catch { return { installed: false }; }
}

export async function ghState(runner: Runner = systemRunner, options: { presenceOnly?: boolean } = {}): Promise<GhState> {
  try {
    const version = await runner.run('gh', ['--version']);
    if (version.code !== 0) return { installed: false, authenticated: false };
  } catch {
    return { installed: false, authenticated: false };
  }
  return { installed: true, authenticated: options.presenceOnly ? false : await ghAuthenticated(runner) };
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
  // Over frames the caller is a program with no terminal to hand gh; say what to do instead of asking (D5, 2026-09-08).
  if (io.channel === 'frames') { io.print('GitHub CLI is installed but logged out. Run `gh auth login` in a terminal, then try again.'); return state; }
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
 *
 * Every value is a default the person confirms rather than types: the login from config or gh,
 * the handle from config or the login, the name and email from config or git's global identity.
 * When all four are known they are shown on one line and confirmed with one y/N; `n` re-asks
 * each with the same defaults (acceptance A2, 2026-09-06). A machine that knows less asks the
 * questions it needs, as before — the confirmation collapses questions, it never skips one.
 */
export async function collectIdentity(io: Prompter, existing: Config, runner: Runner = systemRunner, options: IdentityOptions = {}): Promise<Identity> {
  // A persisted value that is not a login (written before this validation existed) is no default: it would be re-offered forever.
  let suggested = existing.github && githubLoginSchema.safeParse(existing.github).success ? existing.github : '';
  if (!suggested && options.gh?.authenticated) {
    const login = await runner.run('gh', ['api', 'user', '-q', '.login']);
    if (login.code === 0 && githubLoginSchema.safeParse(login.stdout.trim()).success) suggested = login.stdout.trim();
  }
  const handleDefault = options.fixedHandle ?? existing.default_handle ?? (suggested || undefined);
  const nameDefault = existing.display_name ?? (await gitGlobalIdentity(runner, 'user.name'));
  // Only a well-formed email is offered: an invalid default would be re-offered on every Enter.
  const gitEmail = existing.email === undefined ? await gitGlobalIdentity(runner, 'user.email') : '';
  const emailDefault = existing.email ?? (emailSchema.safeParse(gitEmail).success ? gitEmail : undefined);
  const handleKnown = handleDefault === undefined ? undefined : handleSchema.safeParse(handleDefault);
  // A `-` answered before is stored as '' and is an answer; an absent key is not.
  const githubKnown = suggested !== '' || existing.github === '';
  if (githubKnown && handleKnown?.success && nameDefault && emailDefault) {
    const known: Identity = { handle: handleKnown.data, displayName: nameDefault, email: emailDefault, github: suggested };
    io.print(`Identity: @${known.handle} — ${known.displayName} <${known.email}>${known.github ? ` (GitHub: ${known.github})` : ' (no GitHub login)'}`);
    if (await io.confirm('Use this identity?')) return known;
  }
  // Enter takes the suggestion, so `-` is the way to say "none" once one is offered.
  const github = await askUntilValid(io, suggested ? 'GitHub login (- for none)' : 'GitHub login', suggested, (value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '-') return { ok: true, value: '' };
    const parsed = githubLoginSchema.safeParse(trimmed);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, rule: GITHUB_LOGIN_RULE };
  });
  const handle = options.fixedHandle ?? (await askHandle(io, existing.default_handle ?? (github || undefined)));
  const displayName = await askUntilValid(io, 'Your name', nameDefault || undefined, (value) => (value.trim() ? { ok: true, value: value.trim() } : { ok: false, rule: 'a name is required' }));
  const email = await askUntilValid(io, 'Your email', emailDefault, (value) => (emailSchema.safeParse(value.trim()).success ? { ok: true, value: value.trim() } : { ok: false, rule: 'enter a valid email address' }));
  return { handle, displayName, email, github };
}

/** git's global identity (`git config --global user.name` / `user.email`): what a commit on this machine would carry, offered as a default and confirmed like every other; absent, unreadable, or no git at all is simply no default. */
async function gitGlobalIdentity(runner: Runner, key: 'user.name' | 'user.email'): Promise<string> {
  try {
    const result = await runner.run('git', ['config', '--global', '--get', key]);
    return result.code === 0 ? result.stdout.trim() : '';
  } catch {
    return '';
  }
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
export function creatorAuthenticationError(gh: GhState, form?: InvocationForm): string | null {
  if (!gh.installed) return `Creating a GitHub team needs the GitHub CLI (gh) in phase 1. Install it from https://cli.github.com and run \`gh auth login\`, or create the team against an existing empty remote with \`${invocation(form, 'team create <name> --remote <url>')}\`.`;
  if (!gh.authenticated) return `GitHub authentication is required to create a team: run \`gh auth login\` and retry, or create the team against an existing empty remote with \`${invocation(form, 'team create <name> --remote <url>')}\`.`;
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
  const authenticationError = creatorAuthenticationError(gh, dependencies.form);
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
export function setIdentity(config: Config, identity: Partial<Identity>): void {
  if (identity.handle !== undefined) config.default_handle = identity.handle;
  if (identity.displayName !== undefined) config.display_name = identity.displayName;
  if (identity.email !== undefined) config.email = identity.email;
  if (identity.github !== undefined) config.github = identity.github;
}

/**
 * The one place a `teams.<name>` entry is written: `team create`/`team join` only, always with the
 * handle they proved against the roster (rev 9, Decision 4). Unknown keys are kept, except a stale
 * `token` from before Decision 2, which is dropped rather than carried forward.
 */
export function bindTeam(config: Config, name: string, entry: { remote: string; handle: string }, options: { form?: InvocationForm; retry?: string } = {}): TeamConfig {
  assertBindable(config, name, entry.remote, options);
  const current: Record<string, unknown> = { ...(Object.hasOwn(config.teams, name) ? config.teams[name] : {}) };
  delete current.token;
  const bound: TeamConfig = { ...current, remote: normalizeRemote(entry.remote), handle: entry.handle };
  config.teams[name] = bound;
  return bound;
}

/** The config entry already bound to a remote, if any (§6: a second join never duplicates a team). */
export function teamByRemote(config: Config, remote: string): [string, TeamConfig] | undefined {
  const normalized = normalizeRemote(remote);
  return Object.entries(config.teams).find(([, team]) => {
    let stored = team.remote;
    try { stored = normalizeRemote(stored); } catch { /* Legacy malformed stored remotes retain raw comparison. */ }
    return stored === normalized;
  });
}

/** One team per machine (Ryan, 2026-09-08). Throws RefusedError before any side effect when binding `target` would add a second team. */
export function refuseSecondTeam(config: Config, target: { remote?: string; create?: true }, retry: string, form?: InvocationForm): void {
  const entries = Object.entries(config.teams);
  if (entries.length === 0) return;
  if (target.remote !== undefined && teamByRemote(config, target.remote)) return;
  if (target.remote === undefined && target.create === undefined && entries.length === 1) return;
  if (entries.length > 1) {
    throw new RefusedError(`One team per machine: This machine is configured for teams ${entries.map(([name]) => name).join(', ')}; Terum Skills keeps one team per machine. Run \`${invocation(form, 'team leave', { raw: '<name>' })}\` for each team you no longer want, then re-run.`);
  }
  const [name, binding] = entries[0]!;
  throw new RefusedError(`One team per machine: This machine is on team ${name} (${stripRemoteCredentials(binding.remote)}). Terum Skills keeps one team per machine: run \`${invocation(form, 'team leave', name)}\` first, then re-run \`${retry}\`.`);
}

/**
 * One remote → one team name, one name → one remote. `create` and `join` check this before they
 * prompt AND again under the config lock right before binding, so a verb that ran in between
 * cannot leave two entries for one repository.
 */
export function assertBindable(config: Config, team: string, remote: string, options: { form?: InvocationForm; retry?: string } = {}): void {
  const normalized = normalizeRemote(remote);
  const isNewKey = !Object.hasOwn(config.teams, team);
  if (isNewKey && Object.keys(config.teams).length > 0) {
    refuseSecondTeam(config, { create: true }, options.retry ?? invocation(options.form, 'team join', remote), options.form);
  }
  const byRemote = teamByRemote(config, normalized);
  if (byRemote && byRemote[0] !== team) throw new Error(`${normalized} is already configured as team ${byRemote[0]}.`);
  // An own key only: the teams record inherits Object.prototype, so `constructor` or `toString` would
  // otherwise read as a configured team — after the GitHub repo exists or the roster entry is pushed.
  const existing = Object.hasOwn(config.teams, team) ? config.teams[team] : undefined;
  if (existing && byRemote?.[0] !== team) throw new Error(`Team ${team} is configured for ${existing.remote}, not ${normalized}.`);
}
