/**
 * Eval spec §4.3 / §7.1 / §7.3: three-arm execution, ported from skilldeck `evals/execution.py`
 * (42084dc) with the spec's adaptations — full-tree arms (the caller materializes candidate and
 * incumbent directories; there is no SKILL.md-only swap), per-arm samples for arm scores and
 * efficiency, the judge escalation chain, and the contamination refusal.
 *
 *   baseline  — agent with no skill staged          (does the skill help at all?)
 *   candidate — the version under test
 *   incumbent — the last receipted version's tree   (did this edit help?)
 *
 * An AgentRunError or timeout never aborts the matrix: the arm's row is scored against an empty
 * transcript and `execution_status` reflects any unscored holes.
 */
import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import type { CheckResult, CheckSpec } from './checks.js';
import { emptyTranscript, fractionPassed, runChecks } from './checks.js';
import type { AgentApi, Transcript } from './agent.js';
import { AgentRunError, AgentTimeoutError, DEFAULT_MODEL } from './agent.js';
import { shellCommand } from './agent-command.js';
import { DEFAULT_ESCALATION_MODEL, judgePair } from './judge.js';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';
import { stageDependencies, type DependencyPlan } from './dependencies.js';

export const ARMS = ['baseline', 'candidate', 'incumbent', 'rival'] as const;
export type Arm = (typeof ARMS)[number];

const BUCKETS = ['explicit', 'implicit', 'contextual', 'negative', 'adversarial'] as const;

export interface EvalCase {
  name: string;
  task: string;
  fixture?: string;
  files: Record<string, string>;
  setup?: string;
  checks: CheckSpec[];
  judge?: string;
  bucket?: (typeof BUCKETS)[number];
  /** Rev 8: host tools this case needs — `ffmpeg` (PATH probe) or `python3:openpyxl` (import probe). */
  requires: string[];
  timeout_minutes?: number;
  max_turns?: number;
}

/** One independently scored row from a suite's single shared agent session. */
export interface SuiteCase {
  name: string;
  checks: CheckSpec[];
}

/** `evals/suite.yaml`: shared sandbox/session input plus independently checked rows. */
export interface EvalSuite extends Omit<EvalCase, 'checks' | 'judge' | 'bucket'> {
  cases: SuiteCase[];
}

/** Parse one `evals/cases/<case>.yaml` (§5.1); the stem is the case name. */
export function loadCase(source: string, name: string): Result<EvalCase> {
  let raw: unknown;
  try { raw = YAML.parse(source); } catch (error) { return failure(`case '${name}': ${error instanceof Error ? error.message : String(error)}`); }
  return parseCaseRecord((raw ?? {}) as Record<string, unknown>, name);
}

/** Shared loader for ordinary cases and a suite's common fields. */
function parseCaseRecord(record: Record<string, unknown>, name: string): Result<EvalCase> {
  if (typeof record['task'] !== 'string' || !record['task'].trim()) return failure(`case '${name}' needs a 'task'`);
  const bucket = record['bucket'] === undefined ? undefined : String(record['bucket']);
  if (bucket !== undefined && !(BUCKETS as readonly string[]).includes(bucket)) return failure(`case '${name}': unknown bucket '${bucket}'`);
  const files: Record<string, string> = {};
  if (record['files'] !== undefined) {
    if (record['files'] === null || typeof record['files'] !== 'object' || Array.isArray(record['files'])) return failure(`case '${name}': 'files' must be a map`);
    for (const [key, value] of Object.entries(record['files'] as Record<string, unknown>)) files[key] = String(value);
  }
  const timeoutRaw = record['timeout_minutes'];
  if (timeoutRaw !== undefined && (typeof timeoutRaw !== 'number' || !Number.isFinite(timeoutRaw) || timeoutRaw <= 0 || timeoutRaw > 120)) return failure(`case '${name}': 'timeout_minutes' must be a number greater than 0 and at most 120`);
  const timeoutMinutes = timeoutRaw as number | undefined;
  const maxTurnsRaw = record['max_turns'];
  if (maxTurnsRaw !== undefined && (typeof maxTurnsRaw !== 'number' || !Number.isInteger(maxTurnsRaw) || maxTurnsRaw <= 0)) return failure(`case '${name}': 'max_turns' must be a positive integer`);
  const maxTurns = maxTurnsRaw as number | undefined;
  return success({
    name,
    task: record['task'],
    fixture: record['fixture'] === undefined ? undefined : String(record['fixture']),
    files,
    setup: record['setup'] === undefined ? undefined : String(record['setup']),
    checks: Array.isArray(record['checks']) ? (record['checks'] as CheckSpec[]) : [],
    judge: record['judge'] === undefined ? undefined : String(record['judge']),
    bucket: bucket as EvalCase['bucket'],
    requires: Array.isArray(record['requires']) ? record['requires'].map(String) : [],
    ...(timeoutMinutes === undefined ? {} : { timeout_minutes: timeoutMinutes }),
    ...(maxTurns === undefined ? {} : { max_turns: maxTurns }),
  });
}

/** Parse `evals/suite.yaml`; the file stem is its one provenance/session name. */
export function loadSuite(source: string, name: string): Result<EvalSuite> {
  let raw: unknown;
  try { raw = YAML.parse(source); } catch (error) { return failure(`suite '${name}': ${error instanceof Error ? error.message : String(error)}`); }
  const record = (raw ?? {}) as Record<string, unknown>;
  const shared = parseCaseRecord(record, name);
  if (!shared.ok) return failure(shared.error);
  if (!Array.isArray(record['cases']) || record['cases'].length === 0) return failure(`suite '${name}' needs a non-empty 'cases' list`);
  const cases: SuiteCase[] = [];
  const names = new Set<string>();
  const prohibited = ['judge', 'task', 'files', 'fixture', 'setup', 'bucket'];
  for (const item of record['cases']) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return failure(`suite '${name}': each sub-case must be a map`);
    const sub = item as Record<string, unknown>;
    for (const field of prohibited) {
      if (sub[field] !== undefined) return failure(`suite '${name}': sub-case must not carry '${field}'`);
    }
    if (typeof sub['name'] !== 'string' || !sub['name'].trim()) return failure(`suite '${name}': sub-case needs a non-empty 'name'`);
    if (names.has(sub['name'])) return failure(`suite '${name}': duplicate sub-case name '${sub['name']}'`);
    if (!Array.isArray(sub['checks'])) return failure(`suite '${name}': sub-case '${sub['name']}' needs a 'checks' list`);
    names.add(sub['name']);
    // Checks deliberately retain loadCase's deferred behavior: unknown kinds fail when run.
    cases.push({ name: sub['name'], checks: sub['checks'] as CheckSpec[] });
  }
  return success({
    name: shared.value.name, task: shared.value.task, files: shared.value.files,
    requires: shared.value.requires,
    ...(shared.value.fixture === undefined ? {} : { fixture: shared.value.fixture }),
    ...(shared.value.setup === undefined ? {} : { setup: shared.value.setup }),
    ...(shared.value.timeout_minutes === undefined ? {} : { timeout_minutes: shared.value.timeout_minutes }),
    ...(shared.value.max_turns === undefined ? {} : { max_turns: shared.value.max_turns }),
    cases,
  });
}

/**
 * §7.1 rev 8 (option 1, Ajay 2026-09-06): probe a case's host requirements BEFORE spending any
 * agent runs. A missing toolchain must surface as a visible environment skip, never as the false
 * NEUTRAL that both-arms-flail ties produce. Entries: a binary name (PATH probe via `command -v`)
 * or `python3:<module>` (import probe). Probes pass values as argv, never interpolated into shell.
 */
export async function missingRequirements(requires: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const requirement of requires) {
    const { file, args, env } = requirement.startsWith('python3:')
      ? { file: 'python3', args: ['-c', 'import importlib, sys; importlib.import_module(sys.argv[1])', requirement.slice('python3:'.length)], env: process.env }
      : shellCommand('command -v -- "$1"', '-c', ['probe', requirement]);
    const present = await new Promise<boolean>((resolvePromise) => {
      // 30s: generous enough that concurrent-startup disk contention can't fake a missing tool
      // (measured: pandas probed as missing under a 14-process wave with a 10s cap).
      const child = spawn(file, args, { stdio: 'ignore', env });
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 30_000);
      child.on('error', () => { clearTimeout(timer); resolvePromise(false); });
      child.on('close', (code) => { clearTimeout(timer); resolvePromise(code === 0); });
    });
    if (!present) missing.push(requirement);
  }
  return missing;
}

/**
 * The ONE path predicate for a case's inline `files` keys, shared by `seedSandbox` (run time) and
 * `validateCases` in generate.ts (generation time) so the two can never drift apart again: a
 * generated case that would fail here used to reach disk and take the whole eval down with it.
 * Returns the reason a key is refused, or null when it may be written into the sandbox.
 */
export function casePathViolation(rel: string): string | null {
  const segments = rel.split(/[\\/]/);
  if (isAbsolute(rel) || segments.includes('..')) return `unsafe file path in case: ${rel}`;
  // A generated case must not seed project settings/hooks into the arm being scored:
  // `--setting-sources project` would load sandbox-root `.claude/` and run model-authored
  // hooks on the host. Only the skill-staging step in seedSandbox may write there.
  if (segments.find((segment) => segment !== '' && segment !== '.') === '.claude') return `unsafe file path in case (seeds .claude): ${rel}`;
  return null;
}

/**
 * IE6 §2: identity and tree travel together. A single `skillName` could not express the
 * contamination invariant once two DIFFERENT skills share one matrix — the staging path and
 * the assertion would read the same name for both arms. `null` is the baseline arm.
 */
export type ArmSpec = { name: string; dir: string } | null;

export interface SeedOptions {
  /** Directory the case file lives in — fixture paths resolve relative to it (§5.1). */
  caseDir: string;
  /** The arm's identity and tree, or null for the baseline arm (IE6 §2). */
  arm: ArmSpec;
  scratch: string;
  /** Resolved once per eval run; baseline arms never apply it. */
  dependencies?: DependencyPlan;
}

/**
 * §4.3, strictly in order: fixture copy → inline files (reject absolute/`..`; `.sh` and `bin/*` → 0755) →
 * `setup` hook (`/bin/sh -ce`, 60s cap, nonzero aborts the case) → skill staging excluding
 * `evals/` and `fixtures/` (the skill must not see its own answer key).
 */
export async function seedSandbox(evalCase: EvalCase, options: SeedOptions): Promise<string> {
  const sandbox = await mkdtemp(join(options.scratch, 'arm-'));
  if (evalCase.fixture !== undefined) {
    const source = resolve(options.caseDir, evalCase.fixture);
    if (!statSync(source, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`case '${evalCase.name}': fixture dir not found: ${source}`);
    await cp(source, sandbox, { recursive: true });
  }
  for (const [rel, content] of Object.entries(evalCase.files)) {
    const violation = casePathViolation(rel);
    if (violation !== null) throw new Error(`case '${evalCase.name}': ${violation}`);
    const target = join(sandbox, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    // `bin/` is where a case stubs an external tool (eval-gen D1: `bin/codex` answering `login
    // status`); a stub that is not executable fails the dry-run and the real run alike.
    if (rel.endsWith('.sh') || rel.split(/[\\/]/).filter((segment) => segment !== '' && segment !== '.')[0] === 'bin') await chmod(target, 0o755);
  }
  if (evalCase.setup !== undefined) await runSetup(evalCase, sandbox);
  if (options.arm !== null) {
    const staged = join(sandbox, '.claude', 'skills', options.arm.name);
    await mkdir(dirname(staged), { recursive: true });
    const root = resolve(options.arm.dir);
    await cp(root, staged, {
      recursive: true,
      filter: (source) => {
        const top = relative(root, source).split(/[\\/]/)[0];
        return top !== 'evals' && top !== 'fixtures';
      },
    });
    if (options.dependencies !== undefined) await stageDependencies(options.dependencies, sandbox);
  }
  return sandbox;
}

/**
 * Eval-gen D3: prove a generated case can START before it is written anywhere. Seeds a throwaway
 * sandbox exactly as an arm would (files, path guard, `setup` under `/bin/sh -ce`) with no skill
 * staged, then removes it. Returns null when the case seeded cleanly, else the message the real
 * run would have aborted with — prose in `setup` is valid shell (`Assume codex is logged in` runs a
 * program named `Assume`), so executing it is the only check that catches it.
 */
export async function dryRunCase(evalCase: EvalCase, scratch: string): Promise<string | null> {
  // Own root per dry-run: a seed that throws never returns its sandbox path, so removing the root
  // is the only way a half-seeded sandbox does not outlive the check.
  const root = await mkdtemp(join(scratch, 'dry-'));
  try {
    await seedSandbox(evalCase, { caseDir: root, arm: null, scratch: root });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Eval-gen mode 2 uses the ordinary suite seeding path before it writes a generated asset.  This
 * deliberately executes the composed setup rather than merely parsing it: probes must agree with
 * the base and planted diff before an arm can be trusted with the fixture.
 */
export async function dryRunSuite(suite: EvalSuite, scratch: string): Promise<string | null> {
  const root = await mkdtemp(join(scratch, 'dry-suite-'));
  try {
    await seedSandbox({ ...suite, checks: [] }, { caseDir: root, arm: null, scratch: root });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Generation-time patch gate.  Like setup hooks, this is intentionally owned by execution.ts so
 * all engine shelling remains behind its subprocess seam.  `git apply` also works outside a repo,
 * which is exactly the clean-files contract the generator promises.
 */
export async function patchApplies(files: Record<string, string>, patch: string, scratch: string): Promise<string | null> {
  const root = await mkdtemp(join(scratch, 'patch-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const violation = casePathViolation(rel);
      if (violation !== null) return violation;
      const target = join(root, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    const patchPath = join(root, '.plants.diff');
    await writeFile(patchPath, patch, 'utf8');
    return await runSubprocess('git', ['apply', '--check', '.plants.diff'], root, 'plants_diff does not apply');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The one non-agent subprocess in the engine: the case's own setup hook, inside its sandbox. */
function runSetup(evalCase: EvalCase, sandbox: string): Promise<void> {
  const shell = shellCommand(evalCase.setup!, '-ce');
  return runSubprocess(shell.file, shell.args, sandbox, `case '${evalCase.name}': setup failed`, { env: shell.env }).then((error) => {
    if (error !== null) throw new Error(error);
  });
}

/** The sole captured-output subprocess seam for eval generation and setup hooks. */
export function runSubprocess(file: string, args: string[], cwd: string, label: string, options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], ...(options.env ? { env: options.env } : {}) });
    const err: Buffer[] = [];
    let settled = false;
    const settle = (value: string | null): void => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise(value); } };
    const killed = (): string => `${label} (rc=killed): ${Buffer.concat(err).toString('utf8').slice(-500)}`;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      // Settle on the kill, not on 'close': on Windows the shell's own children outlive it holding
      // stderr open (Git's bin\sh.exe is a launcher, and MSYS runs each command as its own process),
      // so 'close' waited for whatever the setup had started, past the cap and possibly for ever.
      child.stderr.destroy();
      settle(killed());
    }, options.timeoutMs ?? 60_000);
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => settle(`${label}: ${error.message}`));
    child.on('close', (code) => settle(code === 0 ? null : code === null ? killed() : `${label} (rc=${code}): ${Buffer.concat(err).toString('utf8').slice(-500)}`));
  });
}

/** §7.3: recorded skill lists that contradict the arm's construction refuse the whole run. */
export class ContaminationError extends Error {}

export type Outcome = 'win' | 'loss' | 'tie';

export interface ComparisonRow {
  skill: string;
  kind: 'execution';
  case: string;
  rep: number;
  comparison: string;
  outcome: Outcome;
  decided_by: string;
  reason: string;
  /** §7.5: first judge ordering was A/B-swapped (absent when no judge ran). */
  swapped?: boolean;
  checks_candidate: CheckResult[];
  checks_opponent: CheckResult[];
}

export interface ArmSample {
  kind: 'arm';
  case: string;
  rep: number;
  arm: Arm;
  failed: boolean;
  /** Rev 7: true when the first attempt died on an AgentRunError and the retry was used. */
  retried: boolean;
  fraction: number | null;
  turns: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
  skill_list: string[] | null;
  /** Rev 7: resolved model snapshot from the init event — the request alias floats. */
  model_id: string | null;
  spawns_agents?: boolean | null;
}

/**
 * Eval-gen D4: a case that never started. `setup` — its hook exited nonzero (or was killed at 60 s);
 * `staging` — its files or fixture could not be placed (unsafe path, missing fixture dir). Neither
 * says anything about the skill, so the case is an unscored hole — but a hole the receipt names,
 * so "partial" reads as a reason, not a fraction.
 */
export interface DroppedCase { kind: 'setup' | 'staging'; detail: string }

export interface RunCaseDeps {
  agent: AgentApi;
  rng: () => number;
  model?: string;
  judgeModel?: string;
  escalationModel?: string;
  log?: (line: string) => void;
}

export interface RunCaseOptions {
  k: number;
  caseDir: string;
  /**
   * IE6 §2: the arm table. `baseline` (null) and `candidate` are always present; `incumbent`
   * is omitted when none exists or it equals candidate (§7.1), and `rival` only in
   * head-to-head. An absent key is an arm that does not run; a null value is the baseline.
   */
  arms: Partial<Record<Arm, ArmSpec>>;
  scratch: string;
  /** Transcripts land here as `<case>.<arm>.<rep>.jsonl` (§4.2). */
  transcriptDir: string;
  dependencies?: DependencyPlan;
}

type RunOutput = { rows: ComparisonRow[]; arms: ArmSample[]; skipped?: string[]; dropped?: DroppedCase };

/**
 * The one arm path for case and suite sessions: fresh seed, crash-only retry with preserved
 * transcript, then the unchanged resolved-skill contamination assertion.
 */
async function runArm(
  deps: RunCaseDeps, evalCase: Pick<EvalCase, 'name' | 'task' | 'timeout_minutes' | 'max_turns'>,
  options: RunCaseOptions, arm: Arm, spec: ArmSpec, evaluated: ReadonlySet<string>, rep: number, transcriptStem: string,
): Promise<{ sandbox: string; transcript: Transcript | null; retried: boolean }> {
  const log = deps.log ?? (() => undefined);
  let sandbox = '';
  let transcript: Transcript | null = null;
  let retried = false;
  const transcriptPath = join(options.transcriptDir, `${transcriptStem}.${arm}.${rep}.jsonl`);
  for (let attempt = 0; attempt < 2 && transcript === null; attempt++) {
    sandbox = await seedSandbox(evalCase as EvalCase, { caseDir: options.caseDir, arm: spec, scratch: options.scratch, ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }) });
    try {
      transcript = await deps.agent.runAgent(evalCase.task, sandbox, {
        transcriptPath, model: deps.model ?? DEFAULT_MODEL,
        timeoutMs: (evalCase.timeout_minutes ?? 120) * 60_000,
        maxTurns: evalCase.max_turns ?? 200,
      });
    } catch (error) {
      if (!(error instanceof AgentRunError)) throw error;
      if (error instanceof AgentTimeoutError) {
        log(`  ${evalCase.name} rep${rep} ${arm}: timed out, not retried: ${error.message}`);
        break;
      }
      if (attempt === 0) {
        retried = true;
        try { await rename(transcriptPath, join(options.transcriptDir, `${transcriptStem}.${arm}.${rep}.attempt-1.jsonl`)); }
        catch (renameError) { if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError; }
      }
      log(`  ${evalCase.name} rep${rep} ${arm}: agent run failed${attempt === 0 ? ', retrying once' : ' twice, scoring empty'}: ${error.message}`);
    }
  }
  const skillList = transcript?.skillList() ?? null;
  if (transcript !== null && spec !== null && skillList === null) {
    throw new ContaminationError(`arm '${arm}' did not report its resolved skill list; refusing the run (§7.3)`);
  }
  if (skillList !== null) {
    // IE6 §2: per-arm, over every skill under evaluation in this run. This arm must contain
    // exactly the one it staged and none of the others, so a rival tree leaking into the
    // candidate's arm refuses the run instead of scoring clean. One name in a single-skill
    // run, where this reduces exactly to the rev-6 membership check.
    for (const name of evaluated) {
      const expected = spec !== null && spec.name === name;
      if (skillList.includes(name) !== expected) {
        throw new ContaminationError(`arm '${arm}' resolved skills [${skillList.join(', ')}] — '${name}' ${expected ? 'is missing from an arm that staged it' : 'leaked into an arm that did not stage it'}; refusing the run (§7.3)`);
      }
    }
  }
  return { sandbox, transcript, retried };
}

function sampleFor(arm: Arm, caseName: string, rep: number, transcript: Transcript | null, retried: boolean, checks: CheckResult[]): ArmSample {
  const efficiency = transcript?.efficiency() ?? { turns: null, duration_ms: null, cost_usd: null };
  const spawnsAgents = transcript === null ? null : transcript.toolUses().some((name) => ['Task', 'Agent', 'Workflow'].includes(name))
    || transcript.bashCommands().some((command) => /\bcodex\b|claude -p/.test(command));
  return { kind: 'arm', case: caseName, rep, arm, failed: transcript === null, retried, fraction: fractionPassed(checks), ...efficiency, skill_list: transcript?.skillList() ?? null, model_id: transcript?.modelId() ?? null, spawns_agents: spawnsAgents };
}

/**
 * IE6 §2: the run's arm table, in ARMS order so the matrix is deterministic, plus the set of
 * skills under evaluation that the contamination assertion ranges over.
 */
function armTable(options: RunCaseOptions): { specs: Array<[Arm, ArmSpec]>; candidate: NonNullable<ArmSpec>; evaluated: Set<string> } {
  const specs: Array<[Arm, ArmSpec]> = ARMS.filter((arm) => Object.hasOwn(options.arms, arm)).map((arm) => [arm, options.arms[arm] ?? null]);
  const candidate = options.arms.candidate ?? null;
  if (candidate === null) throw new Error('runCase requires a candidate arm with a name and tree (IE6 §2)');
  // `baseline: null` is always present. A caller that omits it would silently run no baseline
  // arm and lose candidate-vs-baseline, the headline comparison — so it is loud.
  if (!Object.hasOwn(options.arms, 'baseline')) throw new Error('runCase requires an explicit `baseline: null` arm (IE6 §2)');
  return { specs, candidate, evaluated: new Set(specs.map(([, spec]) => spec).filter((spec): spec is NonNullable<ArmSpec> => spec !== null).map((spec) => spec.name)) };
}

/** IE6 §2.1: candidate stays on the left; `rival` only exists in head-to-head. */
const OPPONENTS = ['baseline', 'incumbent', 'rival'] as const;

/**
 * Run one case, k reps × available arms. Returns one row per (rep × opponent) plus per-arm
 * samples; a case whose host requirements are missing runs nothing and returns `skipped` with
 * the missing entries (rev 8) — its absent rows grey the verdict as unscored holes.
 */
export async function runCase(deps: RunCaseDeps, evalCase: EvalCase, options: RunCaseOptions): Promise<RunOutput> {
  const log = deps.log ?? (() => undefined);
  const missing = await missingRequirements(evalCase.requires);
  if (missing.length) {
    log(`  ${evalCase.name}: SKIPPED (environment) — missing ${missing.join(', ')}`);
    return { rows: [], arms: [], skipped: missing };
  }
  const { specs: armSpecs, candidate: candidateSpec, evaluated } = armTable(options);

  const rows: ComparisonRow[] = [];
  const samples: ArmSample[] = [];
  try {
  for (let rep = 0; rep < options.k; rep++) {
    const transcripts = new Map<Arm, Transcript | null>();
    const checksByArm = new Map<Arm, CheckResult[]>();
    for (const [arm, spec] of armSpecs) {
      const session = await runArm(deps, evalCase, options, arm, spec, evaluated, rep, evalCase.name);
      const checks = runChecks(evalCase.checks, session.transcript ?? emptyTranscript, session.sandbox);
      transcripts.set(arm, session.transcript);
      checksByArm.set(arm, checks);
      samples.push(sampleFor(arm, evalCase.name, rep, session.transcript, session.retried, checks));
    }

    for (const opponent of OPPONENTS) {
      if (!armSpecs.some(([arm]) => arm === opponent)) continue;
      const outcome = await decide(deps, evalCase, transcripts.get('candidate') ?? null, transcripts.get(opponent) ?? null, checksByArm.get('candidate') ?? [], checksByArm.get(opponent) ?? []);
      rows.push({
        skill: candidateSpec.name, kind: 'execution', case: evalCase.name, rep,
        comparison: `candidate-vs-${opponent}`,
        outcome: outcome.result, decided_by: outcome.decidedBy, reason: outcome.reason,
        ...(outcome.swapped === undefined ? {} : { swapped: outcome.swapped }),
        checks_candidate: checksByArm.get('candidate') ?? [], checks_opponent: checksByArm.get(opponent) ?? [],
      });
      log(`  ${evalCase.name} rep${rep} candidate-vs-${opponent}: ${outcome.result} (${outcome.decidedBy})`);
    }
  }
  } catch (error) {
    // A seed failure makes this case an unscored hole, not a failure of the entire case matrix:
    // the other cases still provide useful evidence. Before D4 only `setup` took this path and a
    // staging throw escaped it, so one unsafe path in one case cost the skill its whole receipt.
    const dropped = seedFailure(evalCase.name, error);
    if (dropped !== null) {
      log(`  ${evalCase.name}: ABORTED (${dropped.kind}) — ${dropped.detail}`);
      return { rows: [], arms: [], dropped };
    }
    throw error;
  }
  return { rows, arms: samples };
}

/**
 * Run one shared session per arm and score every suite sub-case against that transcript. The
 * session mechanics intentionally route through `runArm`, the same path ordinary cases use.
 */
export async function runSuite(deps: RunCaseDeps, suite: EvalSuite, options: RunCaseOptions): Promise<RunOutput> {
  const log = deps.log ?? (() => undefined);
  const missing = await missingRequirements(suite.requires);
  if (missing.length) {
    log(`  ${suite.name}: SKIPPED (environment) — missing ${missing.join(', ')}`);
    return { rows: [], arms: [], skipped: missing };
  }
  const { specs: armSpecs, candidate: candidateSpec, evaluated } = armTable(options);
  const rows: ComparisonRow[] = [];
  const samples: ArmSample[] = [];
  try {
    for (let rep = 0; rep < options.k; rep++) {
      const sessions = new Map<Arm, { sandbox: string; transcript: Transcript | null; retried: boolean }>();
      for (const [arm, spec] of armSpecs) sessions.set(arm, await runArm(deps, suite, options, arm, spec, evaluated, rep, suite.name));
      for (const subCase of suite.cases) {
        const checksByArm = new Map<Arm, CheckResult[]>();
        for (const [arm] of armSpecs) {
          const session = sessions.get(arm)!;
          const checks = runChecks(subCase.checks, session.transcript ?? emptyTranscript, session.sandbox);
          checksByArm.set(arm, checks);
          // The session-level efficiency values are deliberately repeated for every defect row.
          samples.push(sampleFor(arm, subCase.name, rep, session.transcript, session.retried, checks));
        }
        for (const opponent of OPPONENTS) {
          if (!armSpecs.some(([arm]) => arm === opponent)) continue;
          // Suites never have a rubric; an equal check result is therefore the no-judge tie.
          const outcome = await decide(deps, { ...suite, name: subCase.name, checks: subCase.checks }, sessions.get('candidate')!.transcript, sessions.get(opponent)!.transcript, checksByArm.get('candidate') ?? [], checksByArm.get(opponent) ?? []);
          rows.push({
            skill: candidateSpec.name, kind: 'execution', case: subCase.name, rep,
            comparison: `candidate-vs-${opponent}`,
            outcome: outcome.result, decided_by: outcome.decidedBy, reason: outcome.reason,
            checks_candidate: checksByArm.get('candidate') ?? [], checks_opponent: checksByArm.get(opponent) ?? [],
          });
          log(`  ${subCase.name} rep${rep} candidate-vs-${opponent}: ${outcome.result} (${outcome.decidedBy})`);
        }
      }
    }
  } catch (error) {
    const dropped = seedFailure(suite.name, error);
    if (dropped !== null) {
      log(`  ${suite.name}: ABORTED (${dropped.kind}) — ${dropped.detail}`);
      return { rows: [], arms: [], dropped };
    }
    throw error;
  }
  return { rows, arms: samples };
}

/** Classify a `seedSandbox` throw for this case; anything else (contamination, an agent error) stays fatal. */
function seedFailure(caseName: string, error: unknown): DroppedCase | null {
  if (!(error instanceof Error) || !error.message.startsWith(`case '${caseName}': `)) return null;
  const detail = error.message.slice(`case '${caseName}': `.length);
  if (detail.startsWith('setup failed')) return { kind: 'setup', detail };
  if (detail.startsWith('unsafe file path') || detail.startsWith('fixture dir not found')) return { kind: 'staging', detail };
  return null;
}

/**
 * §7.1 verdict per row, in order: both failed → tie; one failed → other wins; all-checks-passed
 * differs → decided by checks (§5.1: all-or-nothing per arm); equal + no rubric → tie; equal +
 * rubric → judge. Exported for tests.
 */
export async function decide(
  deps: RunCaseDeps, evalCase: EvalCase,
  candidate: Transcript | null, opponent: Transcript | null,
  candidateChecks: CheckResult[], opponentChecks: CheckResult[],
): Promise<{ result: Outcome; decidedBy: string; reason: string; swapped?: boolean }> {
  if (candidate === null && opponent === null) return { result: 'tie', decidedBy: 'both-arms-failed', reason: '' };
  if (candidate === null) return { result: 'tie', decidedBy: 'candidate-run-failed', reason: '' };
  if (opponent === null) return { result: 'tie', decidedBy: 'opponent-run-failed', reason: '' };

  const candidatePass = candidateChecks.every((check) => check.passed);
  const opponentPass = opponentChecks.every((check) => check.passed);
  if (candidatePass !== opponentPass) return { result: candidatePass ? 'win' : 'loss', decidedBy: 'checks', reason: '' };

  if (evalCase.judge === undefined) return { result: 'tie', decidedBy: 'checks-equal-no-judge', reason: '' };
  const verdict = await judgePair(deps.agent, {
    task: evalCase.task, rubric: evalCase.judge,
    leftText: candidate.allText(), rightText: opponent.allText(),
    rng: deps.rng, model: deps.judgeModel ?? deps.model ?? DEFAULT_MODEL,
    escalationModel: deps.escalationModel ?? DEFAULT_ESCALATION_MODEL,
  });
  const result: Outcome = verdict.decidedBy === 'judge' ? ({ left: 'win', right: 'loss', tie: 'tie' } as const)[verdict.winner] : 'tie';
  return { result, decidedBy: verdict.decidedBy, reason: verdict.reason, swapped: verdict.swapped };
}

/** Convenience for callers wiring transcripts into §4.2 run trees. */
export function transcriptName(caseName: string, arm: Arm, rep: number): string {
  return `${basename(caseName)}.${arm}.${rep}.jsonl`;
}
