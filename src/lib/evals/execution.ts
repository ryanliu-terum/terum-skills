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
import { chmod, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import type { CheckResult, CheckSpec } from './checks.js';
import { emptyTranscript, fractionPassed, runChecks } from './checks.js';
import type { AgentApi, Transcript } from './agent.js';
import { AgentRunError, DEFAULT_MODEL } from './agent.js';
import { DEFAULT_ESCALATION_MODEL, judgePair } from './judge.js';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';

export const ARMS = ['baseline', 'candidate', 'incumbent'] as const;
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
}

/** Parse one `evals/cases/<case>.yaml` (§5.1); the stem is the case name. */
export function loadCase(source: string, name: string): Result<EvalCase> {
  let raw: unknown;
  try { raw = YAML.parse(source); } catch (error) { return failure(`case '${name}': ${error instanceof Error ? error.message : String(error)}`); }
  const record = (raw ?? {}) as Record<string, unknown>;
  if (typeof record['task'] !== 'string' || !record['task'].trim()) return failure(`case '${name}' needs a 'task'`);
  const bucket = record['bucket'] === undefined ? undefined : String(record['bucket']);
  if (bucket !== undefined && !(BUCKETS as readonly string[]).includes(bucket)) return failure(`case '${name}': unknown bucket '${bucket}'`);
  const files: Record<string, string> = {};
  if (record['files'] !== undefined) {
    if (record['files'] === null || typeof record['files'] !== 'object' || Array.isArray(record['files'])) return failure(`case '${name}': 'files' must be a map`);
    for (const [key, value] of Object.entries(record['files'] as Record<string, unknown>)) files[key] = String(value);
  }
  return success({
    name,
    task: record['task'],
    fixture: record['fixture'] === undefined ? undefined : String(record['fixture']),
    files,
    setup: record['setup'] === undefined ? undefined : String(record['setup']),
    checks: Array.isArray(record['checks']) ? (record['checks'] as CheckSpec[]) : [],
    judge: record['judge'] === undefined ? undefined : String(record['judge']),
    bucket: bucket as EvalCase['bucket'],
  });
}

export interface SeedOptions {
  /** Directory the case file lives in — fixture paths resolve relative to it (§5.1). */
  caseDir: string;
  skillName: string;
  /** Full skill tree to stage, or null for the baseline arm. */
  skillDir: string | null;
  scratch: string;
}

/**
 * §4.3, strictly in order: fixture copy → inline files (reject absolute/`..`; `.sh` → 0755) →
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
    if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`case '${evalCase.name}': unsafe file path in case: ${rel}`);
    const target = join(sandbox, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    if (rel.endsWith('.sh')) await chmod(target, 0o755);
  }
  if (evalCase.setup !== undefined) await runSetup(evalCase, sandbox);
  if (options.skillDir !== null) {
    const staged = join(sandbox, '.claude', 'skills', options.skillName);
    await mkdir(dirname(staged), { recursive: true });
    const root = resolve(options.skillDir);
    await cp(root, staged, {
      recursive: true,
      filter: (source) => {
        const top = relative(root, source).split(/[\\/]/)[0];
        return top !== 'evals' && top !== 'fixtures';
      },
    });
  }
  return sandbox;
}

/** The one non-agent subprocess in the engine: the case's own setup hook, inside its sandbox. */
function runSetup(evalCase: EvalCase, sandbox: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/bin/sh', ['-ce', evalCase.setup!], { cwd: sandbox, stdio: ['ignore', 'ignore', 'pipe'] });
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`case '${evalCase.name}': setup failed (rc=${code ?? 'killed'}): ${Buffer.concat(err).toString('utf8').slice(-500)}`));
    });
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
  checks_candidate: CheckResult[];
  checks_opponent: CheckResult[];
}

export interface ArmSample {
  kind: 'arm';
  case: string;
  rep: number;
  arm: Arm;
  failed: boolean;
  fraction: number | null;
  turns: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
  skill_list: string[] | null;
}

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
  skillName: string;
  caseDir: string;
  /** Materialized arm trees; omit `incumbent` when none exists or it equals candidate (§7.1). */
  arms: { candidate: string; incumbent?: string };
  scratch: string;
  /** Transcripts land here as `<case>.<arm>.<rep>.jsonl` (§4.2). */
  transcriptDir: string;
}

/** Run one case, k reps × available arms. Returns one row per (rep × opponent) plus per-arm samples. */
export async function runCase(deps: RunCaseDeps, evalCase: EvalCase, options: RunCaseOptions): Promise<{ rows: ComparisonRow[]; arms: ArmSample[] }> {
  const log = deps.log ?? (() => undefined);
  const armDirs: Array<[Arm, string | null]> = [['baseline', null], ['candidate', options.arms.candidate]];
  if (options.arms.incumbent !== undefined) armDirs.push(['incumbent', options.arms.incumbent]);

  const rows: ComparisonRow[] = [];
  const samples: ArmSample[] = [];
  for (let rep = 0; rep < options.k; rep++) {
    const transcripts = new Map<Arm, Transcript | null>();
    const checksByArm = new Map<Arm, CheckResult[]>();
    for (const [arm, skillDir] of armDirs) {
      const sandbox = await seedSandbox(evalCase, { caseDir: options.caseDir, skillName: options.skillName, skillDir, scratch: options.scratch });
      let transcript: Transcript | null = null;
      try {
        transcript = await deps.agent.runAgent(evalCase.task, sandbox, {
          transcriptPath: join(options.transcriptDir, `${evalCase.name}.${arm}.${rep}.jsonl`),
          model: deps.model ?? DEFAULT_MODEL,
        });
      } catch (error) {
        if (!(error instanceof AgentRunError)) throw error;
        log(`  ${evalCase.name} rep${rep} ${arm}: agent run failed: ${error.message}`);
      }
      const skillList = transcript?.skillList() ?? null;
      // §7.3 (rev 6): the CLI's init event always lists its built-in skills, so the contamination
      // signal is membership of the skill under eval, never list equality. Everything else in the
      // list is CLI-provided; user/global skills are excluded by construction (--setting-sources
      // project), measured on CC 2.1.236 (VE1).
      if (skillList !== null) {
        const staged = skillDir !== null;
        if (skillList.includes(options.skillName) !== staged) {
          throw new ContaminationError(`arm '${arm}' resolved skills [${skillList.join(', ')}] — '${options.skillName}' ${staged ? 'is missing from an arm that staged it' : 'leaked into an arm without it staged'}; refusing the run (§7.3)`);
        }
      }
      const checks = runChecks(evalCase.checks, transcript ?? emptyTranscript, sandbox);
      transcripts.set(arm, transcript);
      checksByArm.set(arm, checks);
      const efficiency = transcript?.efficiency() ?? { turns: null, duration_ms: null, cost_usd: null };
      samples.push({ kind: 'arm', case: evalCase.name, rep, arm, failed: transcript === null, fraction: fractionPassed(checks), ...efficiency, skill_list: skillList });
    }

    for (const opponent of ['baseline', 'incumbent'] as const) {
      if (!armDirs.some(([arm]) => arm === opponent)) continue;
      const outcome = await decide(deps, evalCase, transcripts.get('candidate') ?? null, transcripts.get(opponent) ?? null, checksByArm.get('candidate') ?? [], checksByArm.get(opponent) ?? []);
      rows.push({
        skill: options.skillName, kind: 'execution', case: evalCase.name, rep,
        comparison: `candidate-vs-${opponent}`,
        outcome: outcome.result, decided_by: outcome.decidedBy, reason: outcome.reason,
        checks_candidate: checksByArm.get('candidate') ?? [], checks_opponent: checksByArm.get(opponent) ?? [],
      });
      log(`  ${evalCase.name} rep${rep} candidate-vs-${opponent}: ${outcome.result} (${outcome.decidedBy})`);
    }
  }
  return { rows, arms: samples };
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
): Promise<{ result: Outcome; decidedBy: string; reason: string }> {
  if (candidate === null && opponent === null) return { result: 'tie', decidedBy: 'both-arms-failed', reason: '' };
  if (candidate === null) return { result: 'loss', decidedBy: 'candidate-run-failed', reason: '' };
  if (opponent === null) return { result: 'win', decidedBy: 'opponent-run-failed', reason: '' };

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
  return { result, decidedBy: verdict.decidedBy, reason: verdict.reason };
}

/** Convenience for callers wiring transcripts into §4.2 run trees. */
export function transcriptName(caseName: string, arm: Arm, rep: number): string {
  return `${basename(caseName)}.${arm}.${rep}.jsonl`;
}
