import { access, cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Launch } from '../launch.js';
import lockfile from 'proper-lockfile';
import { systemRunner, type CommandResult, type Runner, type RunOptions } from '../runner.js';
import { type AskOptions, Prompter, PromptClosedError, type ProgressUpdate } from '../prompt.js';
import { cloneLockPath } from '../teamRepo.js';
import { canonicalDigest } from '../skills.js';
import { snapshotSkillDirectory } from '../placer/vendor/skillhub/skill-fingerprint.js';
import { writeStamp } from '../hook.js';
import { receiptSchema, type Receipt } from '../evals/receipt.js';
import { createConfigStore, type ConfigStore } from '../config.js';
import { managedSkillRoots, readBundledSkills, type WrapperOptions } from '../wrapper.js';

/** Every temp dir created through `temporaryDirectory` — removed by setup.ts after each test. */
export const TEMP_DIRS: string[] = [];

/** The one canonical /terum-skills skill (what `npm run build` bundles); from src/ the built copy does not exist, so tests point at this. */
export const BUNDLED_SKILL_SOURCE = fileURLToPath(new URL('../../../.claude/skills/terum-skills/SKILL.md', import.meta.url));
/** The repo's own skill folder: the bundle's source of truth. Reading it as a bundle skips unmarked review tools. */
export const CANONICAL_SKILLS = fileURLToPath(new URL('../../../.claude/skills', import.meta.url));
/** The names the bundle would carry, from the canonical folder: tests written before every skill exists stay true after. */
export async function bundledNames(): Promise<string[]> {
  const bundled = await readBundledSkills(CANONICAL_SKILLS);
  if (bundled === null) throw new Error(`${CANONICAL_SKILLS} holds no marked skill`);
  return [...bundled.keys()].sort();
}
/** The canonical edit-hook script, for the same reason: from src/ the bundled copy under dist/ does not exist. */
export const BUNDLED_EDIT_HOOK_SOURCE = fileURLToPath(new URL('../../../assets/claude/hooks/terum-skills-edit.mjs', import.meta.url));
/** Edit-hook options rooted in a test state root, pointed at a settings file that is never the real ~/.claude/settings.json. */
export function editHookFor(storeRoot: string, settingsFile: string): { storeRoot: string; source: string; settingsFile: string; backupDir: string } {
  return { storeRoot, source: BUNDLED_EDIT_HOOK_SOURCE, settingsFile, backupDir: join(storeRoot, 'backups') };
}
/** Both managed roots under `home`, judged against canonical skills; env decides CODEX_HOME. */
export function wrapperFor(home: string, env: NodeJS.ProcessEnv = {}): Required<WrapperOptions> {
  const roots = managedSkillRoots(home, env);
  return { roots, bundle: CANONICAL_SKILLS };
}

/**
 * A Prompter with scripted answers that records every question it was asked. Like the real
 * terminal channel it throws PromptClosedError once its script is exhausted ('' means "press
 * Enter", i.e. take the default), so an over-asking verb fails loudly instead of drifting.
 */
export class ScriptedPrompter implements Prompter {
  readonly lines: string[] = [];
  readonly details: Record<string, string[]> = {};
  readonly asked: string[] = [];
  readonly offeredDefaults: (string | undefined)[] = [];
  readonly offered: (readonly string[])[] = [];
  /** Every `io.progress?.()` a verb reported, in order. `steps` is the bare ladder, for readable assertions. */
  readonly progressed: ProgressUpdate[] = [];
  get steps(): string[] { return this.progressed.map((update) => update.step); }
  constructor(private readonly answers: string[] = [], private readonly confirms: boolean[] = [], readonly interactive = false) {}
  progress(update: ProgressUpdate): void { this.progressed.push(update); }
  private next(question: string): string {
    this.asked.push(question);
    const answer = this.answers.shift();
    if (answer === undefined) throw new PromptClosedError(question, 'closed');
    return answer;
  }
  async confirm(question: string, options?: AskOptions): Promise<boolean> {
    if (options?.detail) this.details[question] = [...options.detail];
    this.asked.push(question);
    const answer = this.confirms.shift();
    if (answer === undefined) throw new PromptClosedError(question, 'closed');
    return answer;
  }
  async text(question: string, defaultValue?: string, options?: AskOptions): Promise<string> { if (options?.detail) this.details[question] = [...options.detail]; return this.next(question) || (defaultValue ?? ''); }
  async select(question: string, choices: readonly string[], defaultChoice?: string, options?: AskOptions): Promise<string> { if (options?.detail) this.details[question] = [...options.detail]; this.offered.push([...choices]); this.offeredDefaults.push(defaultChoice); return this.next(question) || defaultChoice || choices[0] || ''; }
  print(line: string): void { this.lines.push(line); }
  askedAbout(fragment: string): boolean { return this.asked.some((question) => question.includes(fragment)); }
  countAsked(fragment: string): number { return this.asked.filter((question) => question.includes(fragment)).length; }
}

/** A non-TTY channel: a prompt is always a test failure, never a scripted answer. */
export class NonInteractivePrompter extends ScriptedPrompter {
  override async confirm(question: string): Promise<boolean> { this.asked.push(question); throw new PromptClosedError(question, 'not-interactive'); }
  override async text(question: string): Promise<string> { this.asked.push(question); throw new PromptClosedError(question, 'not-interactive'); }
  override async select(question: string): Promise<string> { this.asked.push(question); throw new PromptClosedError(question, 'not-interactive'); }
}

/**
 * Canonical, never the raw `mkdtemp` path. On macOS `tmpdir()` sits under `/var`, a symlink to
 * `/private/var`, so a fixture path and anything the code under test resolved (`realpath` in
 * lib/projects.ts, `process.cwd()` after a chdir) name one folder in two spellings and compare
 * unequal. Resolving here keeps every such assertion comparing like with like; on Linux, where
 * `/tmp` is real, this is a no-op, which is why CI never saw it.
 */
export async function temporaryDirectory(prefix = 'terum-test-'): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  TEMP_DIRS.push(dir);
  return dir;
}

export async function git(args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await systemRunner.run('git', args, { cwd, ...(env === undefined ? {} : { env }) });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

const at = (iso: string): NodeJS.ProcessEnv => ({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });

export const TEAM_JSON = { layout_version: 3, name: 'team', categories: [], projects: { Global: { remotes: [], skills: [] as string[] } }, archived: [] as string[], policy: { skill_license: 'UNLICENSED' } };
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
  await git(['commit', '-q', '-m', 'seed'], seed, at('2026-09-01T09:00:00Z'));
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

/**
 * Hold a clone's safeWrite writer lock the way another terum-skills process would; the returned
 * function releases it. A verb that then contends pays withCloneLock's full retry backoff (~3.75 s)
 * before it sees ELOCKED — that is the real contended path, not a test artefact.
 */
export async function holdCloneLock(clone: string): Promise<() => Promise<void>> {
  return lockfile.lock(clone, { lockfilePath: cloneLockPath(clone), realpath: false, stale: 60_000 });
}

export async function originSha(bare: string, ref = 'main'): Promise<string> {
  return (await git(['rev-parse', ref], bare)).trim();
}

export type GhHandler = (args: readonly string[], options?: RunOptions) => CommandResult | Promise<CommandResult>;
export interface RecordedCall { command: 'git' | 'gh'; args: string[]; env?: NodeJS.ProcessEnv; cwd?: string; stdio?: 'inherit'; }

/**
 * Maps a public-looking remote to a local bare fixture in both directions (arguments in, stdout
 * out), records every call, and routes `gh` to a handler (default: "gh is not installed").
 */
export function mappedRunner(publicRemote: string, bare: string, gh?: GhHandler): Runner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(command, args, options) {
      calls.push({ command, args: [...args], env: options?.env, cwd: options?.cwd, stdio: options?.stdio });
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
  return { calls, async run(command, args, options) { calls.push({ command, args: [...args], env: options?.env, cwd: options?.cwd, stdio: options?.stdio }); return command === 'gh' ? handler(args, options) : { code: 0, stdout: '', stderr: '' }; } };
}

/** A runner on a machine with no gh at all (spawn ENOENT); git succeeds trivially. */
export const noGhRunner: Runner = { async run(command) { if (command === 'gh') throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); return { code: 0, stdout: '', stderr: '' }; } };

export async function content(path: string): Promise<string> { return readFile(path, 'utf8'); }
export async function clean(path: string): Promise<void> { await rm(path, { recursive: true, force: true }); }
export const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/** Refuse every call not explicitly allow-listed, including unexpected release destinations. */
export function denyingRunner(allow: Array<{ command: 'git' | 'gh'; argsPrefix: readonly string[]; respond?: (args: readonly string[], options?: RunOptions) => CommandResult | Promise<CommandResult> }>, base?: Runner): Runner {
  return { async run(command, args, options) {
    const rule = allow.find((entry) => entry.command === command && entry.argsPrefix.every((arg, i) => args[i] === arg));
    if (!rule) throw new Error(`unexpected runner call: ${command} ${args.join(' ')}`);
    if (rule.respond) return rule.respond(args, options);
    if (base) return base.run(command, args, options);
    throw new Error(`unexpected runner call: ${command} ${args.join(' ')}`);
  } };
}

export async function taggedBare(tags: string[]) {
  const fixture = await bareTeam();
  for (const tag of tags) await git(['tag', '-a', tag, '-m', tag], fixture.seed);
  await git(['push', '-q', '--tags', 'origin'], fixture.seed);
  return fixture;
}

export function fakeLaunch(kind: Launch['kind'], path?: string): Launch {
  switch (kind) {
    case 'npx': return { kind, path: path ?? '/cache/_npx/hash/node_modules/terum-skills/dist/index.js', cacheDir: '/cache/_npx/hash', request: 'terum-skills@latest' };
    case 'local': return { kind, path: path ?? '/work/app/node_modules/terum-skills/dist/index.js', root: '/work/app', dependencyKind: 'dependencies' };
    case 'source': return { kind, path: path ?? '/work/terum-skills/dist/index.js', root: '/work/terum-skills' };
    case 'global': return { kind, path: path ?? '/opt/homebrew/lib/node_modules/terum-skills/dist/index.js' };
    default: return { kind, path: path ?? '/unknown/index.js' };
  }
}

export async function stateFileAt(root: string, record: unknown): Promise<string> {
  await mkdir(join(root, 'run'), { recursive: true });
  const path = join(root, 'run', 'latest-version.json');
  await writeFile(path, typeof record === 'string' ? record : JSON.stringify(record), { mode: 0o600 });
  return path;
}

export const DASHBOARD_NOW = Date.parse('2026-09-13T12:00:00Z');
export const DASHBOARD_IDS = { deploy: '11111111-1111-4111-8111-111111111111', tdd: '22222222-2222-4222-8222-222222222222', diagnose: '33333333-3333-4333-8333-333333333333' } as const;
export const DASHBOARD_REMOTE = 'github.com/acme/team';

const dashboardSkill = (name: string, id: string, author: string, category: string, description: string, body: string): string =>
  `---\nname: ${name}\ndescription: "${description}"\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: ${author}\n  terum-category: ${category}\n---\n${body}`;

/** A schema-2 receipt with every limb the boards draw; `comparison` is the candidate-vs-baseline record. */
export function dashboardReceipt(input: { skill_id: string | null; skill_name: string; version: string | null; run_id: string; content_digest: string; w: number; l: number; t: number; execution_status?: 'complete' | 'partial' | 'failed'; expected?: number; runner?: string; timestamp?: string; triggers?: boolean }): Receipt {
  const n = input.w + input.l + input.t;
  const expected = input.expected ?? n;
  return receiptSchema.parse({
    schema_version: 2, skill_id: input.skill_id, skill_name: input.skill_name, version: input.version, content_digest: input.content_digest, run_id: input.run_id,
    verdict: 3 * (input.w - input.l) >= n ? 'PASS' : 3 * (input.l - input.w) >= n ? 'FAIL' : 'NEUTRAL', attribution: 'The candidate answered every case with the checklist; the baseline skipped the rollback step twice.',
    execution_status: input.execution_status ?? 'complete', expected_rows: expected, scored_rows: n,
    comparisons: { 'candidate-vs-baseline': { win: input.w, loss: input.l, tie: input.t, net_lift: n === 0 ? 0 : (input.w - input.l) / n, sign_p: 0.03125 } },
    arm_scores: { candidate: 0.8, baseline: 0.5 }, environment_skips: {},
    triggers: input.triggers === false ? null : { recall: 0.8, precision: 1, tp: 4, fn: 1, fp: 0, tn: 5 },
    efficiency: { candidate: { turns: 6.5, duration_ms: 30_000, cost_usd: 0.4 }, baseline: { turns: 5, duration_ms: 20_000, cost_usd: 0.3 } },
    provenance: { engine_version: '0.16.0', engine_commit: 'abc1234', cc_version: '2.1.0', model: 'sonnet', judge_model: 'opus', k: 1, cases: ['rollback', 'canary', 'smoke', 'alerts', 'rollout', 'audit'].slice(0, Math.max(1, expected)), arm_skill_lists: { candidate: [input.skill_name], baseline: null }, timestamp: input.timestamp ?? '2026-09-01T10:00:00Z', runner_handle: input.runner ?? 'seed' },
  });
}

export interface DashboardFixture { root: string; home: string; store: ConfigStore; clone: string; bare: string; runner: Runner & { calls: RecordedCall[] }; projectRoot: string; paths: { deploy: string; tdd: string; notes: string; diagnose: string } }

/**
 * The fixture team of review/2026-09-08-desktop-blank-map/fixture.sh, ported to layout 3 and given
 * what the boards must show (§13): three skills at two versions, three people, receipts at two
 * versions plus one invalid, a stale stamp, a pending install, and a Library with a placed, an
 * edited, an untracked, a symlinked, an invalid-YAML and a project folder, with local receipts.
 * Every date is fixed so a snapshot is stable; `DASHBOARD_NOW` is the clock a board must render with.
 */
export async function dashboardTeam(options: { storeUnderHome?: boolean; localRemote?: boolean } = {}): Promise<DashboardFixture> {
  const team = await bareTeam();
  const home = join(team.root, 'home');
  await mkdir(home, { recursive: true });
  const store = createConfigStore(options.storeUnderHome ? join(home, '.terum', 'skills') : join(team.root, 'state'));
  const remote = options.localRemote ? team.bare : DASHBOARD_REMOTE;
  const seed = team.seed;
  const commit = async (message: string, iso: string): Promise<void> => {
    await git(['add', '--all'], seed); await git(['commit', '-q', '-m', message], seed, at(iso)); await git(['push', '-q', 'origin', 'HEAD:main'], seed);
  };
  const write = async (path: string, content: string): Promise<void> => { await mkdir(join(seed, path, '..'), { recursive: true }); await writeFile(join(seed, path), content); };
  const { deploy, tdd, diagnose } = DASHBOARD_IDS;
  const MIRA = 'Mira Chen <mira@example.com>', SEED = 'Seed <seed@example.com>', RAVI = 'Ravi Patel <ravi@example.com>';
  // team.json, people, skills — one commit per skill version so `updated` dates differ.
  await write('team.json', `${JSON.stringify({ layout_version: 3, name: 'acme', categories: ['ops', 'engineering', 'debugging'], projects: { Global: { remotes: [], skills: [deploy] }, terum: { remotes: ['github.com/acme/terum'], skills: [tdd] } }, archived: [], policy: { skill_license: 'UNLICENSED' } }, null, 2)}\n`);
  await write('people/seed.json', `${JSON.stringify(person('seed', { display_name: 'Seed', role: 'Platform', projects: ['terum'], local_skills: 4, installed: [{ id: deploy, version: 'v1', scope: { kind: 'global' }, since: '2026-08-20T09:00:00Z' }], profile: [{ id: deploy, name: 'deploy-check', version: 'v1', added: '2026-08-20T09:00:00Z', via: 'install' }] }), null, 2)}\n`);
  await write('people/mira.json', `${JSON.stringify(person('mira', { display_name: 'Mira Chen', local_skills: 3, installed: [{ id: deploy, version: 'v1', scope: { kind: 'global' }, since: '2026-08-25T09:00:00Z' }, { id: tdd, version: 'v1', scope: { kind: 'project', project: 'terum' }, since: '2026-08-26T09:00:00Z' }] }), null, 2)}\n`);
  await write('people/ravi.json', `${JSON.stringify(person('ravi', { display_name: 'Ravi Patel', role: 'Debugging' }), null, 2)}\n`);
  await write('skills/deploy-check/v1/SKILL.md', dashboardSkill('deploy-check', deploy, MIRA, 'ops', 'Use this when a deploy needs a checklist. Walks rollback, canary and smoke steps.', '# Deploy check\n\n1. Confirm the rollback path.\n2. Canary one host.\n3. Smoke test.\n'));
  await commit('deploy-check v1', '2026-09-01T10:00:00Z');
  await write('skills/tdd/v1/SKILL.md', dashboardSkill('tdd', tdd, SEED, 'engineering', 'Red, green, refactor. Use when adding behaviour to code with tests.', '# TDD\n\nWrite the failing test first.\n'));
  await commit('tdd v1', '2026-09-02T10:00:00Z');
  await write('skills/diagnose/v1/SKILL.md', dashboardSkill('diagnose', diagnose, RAVI, 'debugging', 'Narrow a failure to one cause before changing anything.', '# Diagnose\n\nReproduce, bisect, fix.\n'));
  await commit('diagnose v1', '2026-09-03T10:00:00Z');
  await write('skills/tdd/v2/SKILL.md', dashboardSkill('tdd', tdd, SEED, 'engineering', 'Red, green, refactor. Use when adding behaviour to code with tests.', '# TDD\n\nWrite the failing test first. Then the smallest change.\n'));
  await commit('tdd v2', '2026-09-04T10:00:00Z');
  await write('skills/deploy-check/v2/SKILL.md', dashboardSkill('deploy-check', deploy, MIRA, 'ops', 'Use this when a deploy needs a checklist. Walks rollback, canary and smoke steps.', '# Deploy check\n\n1. Confirm the rollback path.\n2. Canary one host.\n3. Smoke test.\n4. Watch the alerts for ten minutes.\n'));
  await commit('deploy-check v2', '2026-09-05T10:00:00Z');
  // Receipts: deploy v1 PASS 4W2L0T, deploy v2 NEUTRAL 2W2L2T partial 6/8, tdd v1 PASS 5W1L0T (v2 has none → fallback), diagnose v1 invalid JSON.
  const digest = (name: string, folder: string): Promise<string> => canonicalDigest(join(seed, 'skills', name, folder));
  await write(`evals/${deploy}/v1/20260901T100000Z.json`, `${JSON.stringify(dashboardReceipt({ skill_id: deploy, skill_name: 'deploy-check', version: 'v1', run_id: '20260901T100000Z', content_digest: await digest('deploy-check', 'v1'), w: 4, l: 2, t: 0, runner: 'mira', timestamp: '2026-09-01T11:00:00Z' }), null, 2)}\n`);
  await write(`evals/${deploy}/v2/20260905T100000Z.json`, `${JSON.stringify(dashboardReceipt({ skill_id: deploy, skill_name: 'deploy-check', version: 'v2', run_id: '20260905T100000Z', content_digest: await digest('deploy-check', 'v2'), w: 2, l: 2, t: 2, execution_status: 'partial', expected: 8, runner: 'seed', timestamp: '2026-09-05T11:00:00Z' }), null, 2)}\n`);
  await write(`evals/${tdd}/v1/20260902T100000Z.json`, `${JSON.stringify(dashboardReceipt({ skill_id: tdd, skill_name: 'tdd', version: 'v1', run_id: '20260902T100000Z', content_digest: await digest('tdd', 'v1'), w: 5, l: 1, t: 0, runner: 'seed', timestamp: '2026-09-02T11:00:00Z', triggers: false }), null, 2)}\n`);
  await write(`evals/${diagnose}/v1/20260903T100000Z.json`, '{');
  await commit('receipts', '2026-09-06T10:00:00Z');
  const clone = await cloneWithIdentity(team.bare, store.teamClone('acme'), 'Seed', 'seed@example.com');
  // Library: a placed unedited copy of deploy-check v1, a placed and edited copy of tdd v1, an untracked folder,
  // a symlink, an invalid-YAML folder, and a registered project holding diagnose.
  const skillsRoot = join(home, '.claude', 'skills');
  const paths = { deploy: join(skillsRoot, 'deploy-check'), tdd: join(skillsRoot, 'tdd'), notes: join(skillsRoot, 'notes'), diagnose: join(team.root, 'proj', '.claude', 'skills', 'diagnose') };
  await mkdir(skillsRoot, { recursive: true });
  await cp(join(clone, 'skills', 'deploy-check', 'v1'), paths.deploy, { recursive: true });
  await cp(join(clone, 'skills', 'tdd', 'v1'), paths.tdd, { recursive: true });
  const tddFingerprint = (await snapshotSkillDirectory(paths.tdd)).fingerprint; // recorded BEFORE the edit → `edited`
  await writeFile(join(paths.tdd, 'SKILL.md'), `${await readFile(join(paths.tdd, 'SKILL.md'), 'utf8')}\nLocal note.\n`);
  await mkdir(paths.notes, { recursive: true }); await writeFile(join(paths.notes, 'SKILL.md'), '---\nname: notes\ndescription: "Personal notes on how this team ships. Not shared; not a team skill."\n---\n# Notes\n\nKeep the release calendar here.\n');
  await symlink(paths.notes, join(skillsRoot, 'linked'));
  await mkdir(join(skillsRoot, 'bad-yaml'), { recursive: true }); await writeFile(join(skillsRoot, 'bad-yaml', 'SKILL.md'), '---\nname: [\ndescription: broken\n---\n');
  const projectRoot = join(team.root, 'proj');
  await mkdir(join(projectRoot, '.git'), { recursive: true });
  await mkdir(join(projectRoot, '.claude', 'skills'), { recursive: true });
  await cp(join(clone, 'skills', 'diagnose', 'v1'), paths.diagnose, { recursive: true });
  // Config: identity, the team, the project, two placements, one pending install.
  await store.update((config) => {
    config.default_handle = 'seed'; config.email = 'seed@example.com'; config.display_name = 'Seed'; config.github = 'seed';
    config.teams.acme = { remote, handle: 'seed' };
    config.projects = [{ root: projectRoot, label: 'proj' }];
    config.placements[paths.deploy] = { id: deploy, team: 'acme', version: 'v1', scope: { kind: 'global' }, placed_at: '2026-08-20T09:00:00Z', fingerprint: '' };
    config.placements[paths.tdd] = { id: tdd, team: 'acme', version: 'v1', scope: { kind: 'global' }, placed_at: '2026-08-21T09:00:00Z', fingerprint: tddFingerprint };
    config.pending.push({ op: 'install', id: diagnose, team: 'acme', scope: { kind: 'global' }, started: '2026-09-12T08:00:00Z' });
  });
  const deployFingerprint = (await snapshotSkillDirectory(paths.deploy)).fingerprint;
  await store.update((config) => { config.placements[paths.deploy]!.fingerprint = deployFingerprint; });
  // Local receipts (content-keyed): deploy-check FAIL 1W4L1T with a run.jsonl; tdd's PRISTINE bytes (so the edited folder is stale).
  const localRun = async (path: string, receipt: Receipt): Promise<void> => {
    const dir = join(store.root, 'evals', 'local', receipt.content_digest!.slice(7), receipt.run_id);
    await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`); await writeFile(join(dir, 'run.jsonl'), '{"event":"start"}\n'); void path;
  };
  await localRun(paths.deploy, dashboardReceipt({ skill_id: deploy, skill_name: 'deploy-check', version: null, run_id: '20260912T100000Z', content_digest: await canonicalDigest(paths.deploy), w: 1, l: 4, t: 1, runner: 'seed', timestamp: '2026-09-12T10:00:00Z' }));
  await localRun(paths.tdd, dashboardReceipt({ skill_id: tdd, skill_name: 'tdd', version: null, run_id: '20260911T100000Z', content_digest: await digest('tdd', 'v1'), w: 3, l: 0, t: 0, runner: 'seed', timestamp: '2026-09-11T10:00:00Z', triggers: false }));
  // A stamp three hours old: stale.
  await writeStamp(store.root, 'acme', { head: 'fixture', at: '2026-09-13T09:00:00Z' });
  const stampAt = new Date(DASHBOARD_NOW - 3 * 60 * 60_000); await utimes(join(store.root, 'run', 'acme.stamp'), stampAt, stampAt);
  // pin every Library SKILL.md mtime so "updated" cells are stable across runs
  const fixedMtime = new Date(DASHBOARD_NOW);
  await Promise.all(Object.values(paths).map((folder) => utimes(join(folder, 'SKILL.md'), fixedMtime, fixedMtime)));
  return { root: team.root, home, store, clone, bare: team.bare, runner: mappedRunner(remote, team.bare), projectRoot, paths };
}

/** No team, no Library: the get-started boards. */
export async function emptyMachine(): Promise<{ home: string; store: ConfigStore }> {
  const root = await temporaryDirectory(); const home = join(root, 'home'); await mkdir(home, { recursive: true });
  return { home, store: createConfigStore(join(root, 'state')) };
}

export function redact(text: string, fixture: { root: string; home: string }): string {
  return text.split(fixture.home).join('<HOME>').split(fixture.root).join('<ROOT>');
}
