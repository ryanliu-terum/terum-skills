import { runEvalBatch, EVAL_PARALLEL_DEFAULT, EVAL_LOCK_WAIT_MS } from '../lib/evals/batch.js';
import { dequeueEvals, queueKey, readEvalQueue, updateEvalQueue, withEvalQueueLock, type EvalQueueItem } from '../lib/evals/queue.js';
import { packageRoot } from '../lib/package-root.js';
import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
/** Local-only orchestration for the eval engine. Receipt commits deliberately begin in IE3. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { newestReceiptAt } from '../lib/evals/receipt-store.js';
import { type AgentApi, DEFAULT_MODEL, preflight as systemPreflight, systemAgent } from '../lib/evals/agent.js';
import { type ArmSample, type ComparisonRow, loadCase, runCase } from '../lib/evals/execution.js';
import { generate, type GeneratedAssets } from '../lib/evals/generate.js';
import { assessHygiene, HygieneRefused, reportHygieneWarnings } from '../lib/evals/hygiene.js';
import { makeRng } from '../lib/evals/judge.js';
import { buildReceipt } from '../lib/evals/receipt.js';
import { aggregate, renderReport, runIdFrom, writeRunTree } from '../lib/evals/results.js';
import { packageVersion } from '../lib/package.js';
import { parseTriggers, runTriggerEvals, type TriggerSummary } from '../lib/evals/triggers.js';
import { Prompter } from '../lib/prompt.js';
import { fromError, failure, failureWith, type Result, success } from '../lib/result.js';
import { normalizeRemote } from '../lib/remote.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { sourceFiles } from '../lib/skill-source.js';
import { findSkill, readTeam, skillRecords } from '../lib/skills.js';
import { refreshClone, lockWait, skillVersions } from '../lib/teamRepo.js';
import { materializeVersion, resolveVersion } from '../lib/version.js';

export interface EvalArgs extends WithForm {
  ref: string;
  /** Queue guard: never bill a different version than the one requested. */
  expectedVersion?: string;
  /** Queue-only: reuse a receipt found after refresh, before any paid work. */
  skipReceipted?: boolean;
  k?: number;
  triggersOnly?: boolean;
  executionOnly?: boolean;
  case?: string;
  model?: string;
  judgeModel?: string;
  noGen?: boolean;
  gen?: boolean;
  team?: string;
  config?: ConfigStore;
  runner?: Runner;
  agent?: AgentApi;
  preflight?: (model?: string) => ReturnType<typeof systemPreflight>;
  now?: () => Date;
  /** Test knob: the clone lock's wait budget. Production takes it from the Prompter (teamRepo lockWait). */
  lockWaitMs?: number;
}

export interface EvalResult {
  alreadyEvaluated?: boolean;
  team: string;
  id: string;
  name: string;
  runDir: string;
  ccVersion: string;
  executionStatus: 'complete' | 'partial' | 'failed';
  receiptPath?: string;
}

/**
 * §6: fetch/read only from the team clone; --commit adds exactly one immutable receipt via
 * safeWrite. When the run generated its eval assets, --commit first shows them and pauses on one
 * y/N: a confirmed run commits them into the skill through the ordinary write path (any member —
 * Terum 6fafb8d3), re-runs at the committed tree, and lands the receipt there; a decline keeps
 * them in the run tree and lands no receipt.
 */
export async function run(args: EvalArgs, io: Prompter): Promise<Result<EvalResult>> {
  try {
    // A named case asserts an authored expectation; forcing regeneration contradicts it, and a
    // generated case sharing the stem would silently evaluate something else (review P2).
    if (args.gen && args.case !== undefined) return failure('--gen cannot be combined with --case: naming a case asserts an authored expectation, and generation would replace the set it selects from.');
    if (args.triggersOnly && args.executionOnly) return failure('--triggers-only and --execution-only cannot be used together.');
    // Default k=1 (spec rev 18; Ajay, 2026-09-10) — overrides the 2026-09-07 "keep default k=3"
    // ruling (Terum 5aa9a4b2) on cost: k=3 -> k=1 takes a 3-case run from ~$4.40 to ~$1.50 measured.
    // A receipt you intend to gate on wants --k 3 or more; §16.6 carries the noise caveat.
    const k = args.k ?? 1;
    if (!Number.isInteger(k) || k < 1) return failure('--k must be a positive integer.');
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const [teamName, binding] = selectTeam(config.teams, args.team, args.form);
    if (!binding.handle) return failure(`Team ${teamName} has no joined handle; run \`${invocation(args.form, 'team join')}\` first.`);
    const clone = store.teamClone(teamName);
    await refreshClone(runner, clone, { label: teamName, ...lockWait(io, args.lockWaitMs) });
    const team = await readTeam(clone);
    const record = await findSkill(clone, teamName, args.ref);
    if (!record) return failure(`No skill named or identified by ${args.ref} exists in team ${teamName}.`);

    // Pin the evaluated version and materialize its immutable snapshot BEFORE anything reads
    // skill content: a concurrent sync can refresh the clone mid-run, and the receipt's tree
    // hash must pin the exact skill text AND cases evaluated (§4.1; review P1). A concurrent
    // update may make this an older (but still exact) historical receipt.
    const originalVersion = await resolveVersion(clone, record.name, undefined, runner);
    if (args.skipReceipted) {
      const directory = join('evals', record.id, args.expectedVersion ?? originalVersion);
      const existing = await newestReceiptAt(join(clone, directory));
      if (existing) {
        const path = join(directory, existing.file);
        io.print(`Already evaluated ${record.name}; using committed receipt ${path}.`);
        return success({ team: teamName, id: record.id, name: record.name, runDir: '', ccVersion: existing.receipt.provenance.cc_version, executionStatus: existing.receipt.execution_status, receiptPath: path, alreadyEvaluated: true });
      }
    }
    if (args.expectedVersion !== undefined && args.expectedVersion !== originalVersion) return failure(`Queued version ${args.expectedVersion} of ${record.name} is no longer current; dequeue it and run setup again to choose the new version.`);
    const version = originalVersion;
    const candidateDir = await materializeVersion(store, teamName, clone, record.name, version, runner);

    // This is intentionally before preflight, trigger selection, run-tree creation, or any agent call.
    const candidateFiles = await sourceFiles(candidateDir);
    try {
      reportHygieneWarnings((line) => io.print(line), assessHygiene(record.name, candidateFiles, team.policy.skill_license));
    } catch (error) {
      if (!(error instanceof HygieneRefused)) throw error;
      reportHygieneWarnings((line) => io.print(line), error.assessment);
      return failure(`Hygiene failed for ${record.name}:\n${error.message}`);
    }

    const wantsCases = !args.triggersOnly;
    const wantsTriggers = !args.executionOnly;
    const authoredCasesDir = join(candidateDir, 'evals', 'cases');
    const authoredCaseFiles = (await optionalDirectory(authoredCasesDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
    const authoredTrigger = candidateFiles.files.has('evals/triggers.yaml');
    const assets = { name: record.name, wantsCases, wantsTriggers, authoredCaseFiles, authoredTrigger };

    const model = args.model ?? DEFAULT_MODEL;
    const preflight = await (args.preflight ?? systemPreflight)(model);
    if (!preflight.ok) return failure(preflight.error);

    const runAt = (args.now ?? (() => new Date()))();
    const runId = runIdFrom(runAt);
    const runDir = join(store.root, 'evals', teamName, record.id, runId);
    const transcriptDir = join(runDir, 'transcripts');
    const scratch = join(runDir, 'sandboxes');
    await mkdir(transcriptDir, { recursive: true, mode: 0o700 });
    await mkdir(scratch, { recursive: true, mode: 0o700 });

    const authoredSelected = args.case === undefined ? authoredCaseFiles : authoredCaseFiles.filter((file) => file.replace(/\.ya?ml$/i, '') === args.case);
    // A named case is an authored assertion; it intentionally never causes a model call.
    if (wantsCases && args.case !== undefined && authoredSelected.length === 0) return failure(`No eval case named ${args.case} for ${record.name}.`);
    const { generateCases, generateTriggers } = plannedGeneration(args, assets);
    let generated: GeneratedAssets = {};
    const generatedRoot = join(runDir, 'generated');
    if (generateCases || generateTriggers) {
      const records = await skillRecords(clone, teamName);
      const catalog = await endorsedCatalog(team, records, record.id, runner);
      const built = await generate({
        agent: args.agent ?? systemAgent,
        skill: candidateFiles.files.get('SKILL.md')?.toString('utf8') ?? '',
        files: [...candidateFiles.files.keys()].sort(),
        catalog,
        model,
        engineVersion: packageVersion() ?? 'unknown',
        now: runAt,
        cases: generateCases,
        triggers: generateTriggers,
      });
      if (!built.ok) return failure(built.error);
      generated = built.value;
      await writeGeneratedAssets(generatedRoot, generated);
    }

    const casesDir = generated.cases === undefined ? authoredCasesDir : join(generatedRoot, 'cases');
    const triggerPath = generated.triggers === undefined ? join(candidateDir, 'evals', 'triggers.yaml') : join(generatedRoot, 'triggers.yaml');
    let triggers: TriggerSummary | null = null;
    if (wantsTriggers) {
      const source = await optionalText(triggerPath);
      if (source !== undefined) {
        const parsed = parseTriggers(source);
        if (!parsed.ok) return failure(parsed.error);
        const records = await skillRecords(clone, teamName);
        const catalog = await endorsedCatalog(team, records, record.id, runner);
        triggers = await runTriggerEvals(args.agent ?? systemAgent, { skillName: record.name, catalog, spec: parsed.value, model });
      }
    }

    const rows: ComparisonRow[] = [];
    const arms: ArmSample[] = [];
    const environmentSkips: Record<string, string[]> = {};
    const caseNames: string[] = [];
    const rng = makeRng(0);
    let expectedRows = 0;
    if (wantsCases) {
      const caseFiles = generated.cases === undefined ? authoredCaseFiles : (await optionalDirectory(casesDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
      const selected = args.case === undefined ? caseFiles : caseFiles.filter((file) => file.replace(/\.ya?ml$/i, '') === args.case);
      if (args.case !== undefined && selected.length === 0) return failure(`No eval case named ${args.case} for ${record.name}.`);
      caseNames.push(...selected.map((file) => file.replace(/\.ya?ml$/i, '')));
      const incumbent = await materializeIncumbent(store, teamName, clone, { name: record.name, id: record.id }, version, runner);
      const opponents = incumbent === undefined ? 1 : 2;
      // Includes every selected authored case before requirement probes or setup failures.
      expectedRows = selected.length * k * opponents;
      for (const file of selected) {
        const name = file.replace(/\.ya?ml$/i, '');
        const parsed = loadCase(await readFile(join(casesDir, file), 'utf8'), name);
        if (!parsed.ok) return failure(parsed.error);
        const output = await runCase(
          { agent: args.agent ?? systemAgent, rng, model, judgeModel: args.judgeModel ?? model, log: (line) => io.print(line) },
          parsed.value,
          { k, skillName: record.name, caseDir: casesDir, arms: { candidate: candidateDir, ...(incumbent === undefined ? {} : { incumbent }) }, scratch, transcriptDir },
        );
        rows.push(...output.rows); arms.push(...output.arms);
        if (output.skipped) environmentSkips[name] = output.skipped;
      }
    }
    const summary = aggregate(rows, arms, expectedRows, environmentSkips);
    await writeRunTree(runDir, {
      team: teamName, skill_id: record.id, skill_name: record.name, run_id: runId,
      cc_version: preflight.value.ccVersion, model, judge_model: args.judgeModel ?? model,
      expected_rows: expectedRows,
      arm_skill_lists: Object.fromEntries([...new Set(arms.map((arm) => arm.arm))].map((arm) => [arm, arms.find((sample) => sample.arm === arm)?.skill_list ?? null])),
      ...(generated.cases !== undefined || generated.triggers !== undefined ? { generated_assets: { cases: generated.cases !== undefined, triggers: generated.triggers !== undefined } } : {}),
    }, [...rows, ...arms, ...(triggers === null ? [] : [triggers])]);
    const armSkillLists = Object.fromEntries([...new Set(arms.map((arm) => arm.arm))]
      .map((arm) => [arm, arms.find((sample) => sample.arm === arm)?.skill_list ?? null]));
    // Source checkouts record their running product commit. Published packages have no checkout;
    // in that case the explicit unknown is more honest than a team-repo commit.
    const engineCommit = await runningEngineCommit(runner);
    const receipt = buildReceipt({
      skill_id: record.id,
      skill_name: record.name,
      version,
      run_id: runId,
      verdict: summary.verdict,
      attribution: summary.attribution,
      execution_status: summary.execution_status,
      expected_rows: summary.expected_rows,
      scored_rows: summary.scored_rows,
      comparisons: summary.comparisons,
      arm_scores: summary.arm_scores,
      environment_skips: summary.environment_skips,
      triggers: triggers === null ? null : { recall: triggers.recall, precision: triggers.precision, tp: triggers.tp, fn: triggers.fn, fp: triggers.fp, tn: triggers.tn },
      efficiency: summary.efficiency,
      provenance: {
        engine_version: packageVersion() ?? 'unknown',
        engine_commit: engineCommit,
        cc_version: preflight.value.ccVersion,
        model,
        judge_model: args.judgeModel ?? model,
        k,
        cases: caseNames,
        arm_skill_lists: armSkillLists,
        timestamp: runAt.toISOString(),
        runner_handle: binding.handle ?? 'local',
      },
    });
    if (!receipt.ok) return failure(receipt.error);
    const source = `${JSON.stringify(receipt.value, null, 2)}\n`;
    await writeFile(join(runDir, 'receipt.json'), source, 'utf8');
    if (generated.cases !== undefined || generated.triggers !== undefined) announceGeneratedAssets(io, wantsCases, wantsTriggers, generated, join(runDir, 'generated'));
    io.print(renderReport(summary, triggers));

    return success({ team: teamName, id: record.id, name: record.name, runDir, ccVersion: preflight.value.ccVersion, executionStatus: summary.execution_status });
  } catch (error) { return fromError(error); }
}

interface PlannedAssets { name: string; wantsCases: boolean; wantsTriggers: boolean; authoredCaseFiles: string[]; authoredTrigger: boolean }

/** The one derivation of what this run would generate, shared by the run body and both pre-run builders. */
function plannedGeneration(args: EvalArgs, assets: PlannedAssets): { generateCases: boolean; generateTriggers: boolean } {
  const generateCases = assets.wantsCases && !args.noGen && (Boolean(args.gen) || assets.authoredCaseFiles.length === 0);
  const generateTriggers = assets.wantsTriggers && !args.noGen && (Boolean(args.gen) || !assets.authoredTrigger);
  return { generateCases, generateTriggers };
}


/** Product provenance is read-only and never falls back to the team clone's unrelated HEAD. */
async function runningEngineCommit(runner: Runner): Promise<string> {
  const root = packageRoot();
  if (root === null) return 'unknown';
  // An npm-installed package sits inside the CONSUMER's repository, and git walks upward — that
  // HEAD is not engine provenance (§5.3: "terum-skills commit of the running CLI"; review P2).
  const toplevel = await runner.run('git', ['rev-parse', '--show-toplevel'], { cwd: root });
  if (toplevel.code !== 0 || resolve(toplevel.stdout.trim()) !== resolve(root)) return 'unknown';
  const result = await runner.run('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root });
  const commit = result.code === 0 ? result.stdout.trim() : '';
  return /^[0-9a-f]{12}$/i.test(commit) ? commit.toLowerCase() : 'unknown';
}

async function optionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function optionalDirectory(path: string): Promise<string[]> {
  try { return await readdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

function announceGeneratedAssets(io: Prompter, wantsCases: boolean, wantsTriggers: boolean, generated: GeneratedAssets, root: string): void {
  const sets = [
    wantsCases ? `cases: ${generated.cases === undefined ? 'authored' : `generated (${generated.cases.names.length})`}` : null,
    wantsTriggers ? `triggers: ${generated.triggers === undefined ? 'authored' : 'generated'}` : null,
  ].filter((line): line is string => line !== null);
  io.print(`eval assets: ${sets.join(' · ')}`);
  io.print(`Generated assets: ${root} — review before trusting; save or copy reviewed files into the skill before committing a receipt.`);
}


/** Generated files first land in the run tree, keeping §6.0's team/store write invariant intact. */
async function writeGeneratedAssets(root: string, generated: GeneratedAssets): Promise<void> {
  if (generated.triggers !== undefined) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(join(root, 'triggers.yaml'), generated.triggers, 'utf8');
  }
  if (generated.cases !== undefined) {
    const cases = join(root, 'cases');
    await mkdir(cases, { recursive: true, mode: 0o700 });
    for (const [name, source] of Object.entries(generated.cases.files)) await writeFile(join(cases, name), source, 'utf8');
  }
}

/** The sole source-write seam: explicit --working --save, and the confirmed commit path when the runner has this skill connected. All targets are checked before any write. */
export async function saveGeneratedAssets(source: string, generated: GeneratedAssets): Promise<Result> {
  const cases = join(source, 'evals', 'cases');
  const triggers = join(source, 'evals', 'triggers.yaml');
  if (generated.cases !== undefined && await pathExists(cases)) return failure(`--save refused: ${cases} already exists; generated cases never overwrite authored assets.`);
  if (generated.triggers !== undefined && await pathExists(triggers)) return failure(`--save refused: ${triggers} already exists; generated triggers never overwrite authored assets.`);
  await writeGeneratedAssets(join(source, 'evals'), generated);
  return success(undefined);
}

async function pathExists(path: string): Promise<boolean> {
  try { await readFile(path); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    if (code === 'EISDIR') return true;
    throw error;
  }
}

async function endorsedCatalog(team: Awaited<ReturnType<typeof readTeam>>, records: Awaited<ReturnType<typeof skillRecords>>, evaluatedId: string, runner: Runner): Promise<string> {
  const ids = new Set(team.global);
  const root = await runner.run('git', ['rev-parse', '--show-toplevel']);
  if (root.code === 0) {
    const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: root.stdout.trim() });
    if (origin.code === 0) {
      const current = Object.values(team.projects).find((project) => project.remotes.some((remote) => normalizeRemote(remote) === normalizeRemote(origin.stdout.trim())));
      for (const id of current?.skills ?? []) ids.add(id);
    }
  }
  ids.add(evaluatedId);
  return records.filter((record) => ids.has(record.id)).map((record) => `- ${record.name}: ${record.frontmatter.description}`).join('\n');
}

async function materializeIncumbent(store: ConfigStore, team: string, clone: string, skill: { name: string; id: string }, candidateTree: string, runner: Runner): Promise<string | undefined> {
  // §6.1: latest receipted tree by UTC run-id wins. IE2 does not create receipts,
  // but it must honor receipts already present in a team clone. §5.3 keys the
  // receipt tree by the skill's uuid, never its folder name.
  const receipted = await latestReceiptedTree(clone, skill.id, candidateTree);
  if (receipted !== undefined) return materializeVersion(store, team, clone, skill.name, receipted, runner);
  // No prior receipt: use origin/main's prior tree, if that skill existed there.
  const previous = await runner.run('git', ['rev-parse', '--verify', `origin/main^:skills/${skill.name}`], { cwd: clone });
  const tree = previous.code === 0 ? previous.stdout.trim().toLowerCase() : undefined;
  if (!tree || !/^[0-9a-f]{40}$/.test(tree) || tree === candidateTree) return undefined;
  return materializeVersion(store, team, clone, skill.name, tree, runner);
}

async function latestReceiptedTree(clone: string, skillId: string, candidateTree: string): Promise<string | undefined> {
  const root = join(clone, 'evals', skillId);
  let trees: string[];
  try { trees = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  let latest: { tree: string; runId: string } | undefined;
  for (const tree of trees) {
    if (!/^[0-9a-f]{40}$/.test(tree) || tree === candidateTree) continue;
    let files: string[];
    try { files = await readdir(join(root, tree)); } catch { continue; }
    for (const file of files) {
      const runId = /^([0-9]{8}T[0-9]{6}Z)\.json$/.exec(file)?.[1];
      if (runId !== undefined && (latest === undefined || runId > latest.runId)) latest = { tree, runId };
    }
  }
  return latest?.tree;
}

export interface PendingEval { id: string; name: string; version: string }
/**
 * Why `pending` is empty matters to the caller: an empty batch because the team shares nothing, because the
 * version reader failed, and because every skill is already receipted are three different sentences to a person.
 */
export interface PendingEvalScan {
  pending: PendingEval[];
  /** Shared skills the team has at all. Zero means there is nothing to evaluate, not that everything is receipted. */
  shared: number;
  /** Of those, the ones whose current version resolved, so their receipts could actually be looked for. */
  considered: number;
  /** Set when the version reader itself failed, so not one skill could be checked. */
  versionProblem?: string;
}

/**
 * Read-only, offline selector for setup's batch: current shared skill versions with no receipt.
 * An unresolved version or invalid newest receipt is reported and excluded, never automatically rerun.
 */
export async function skillsWithoutReceipt(clone: string, team: string, runner: Runner, report: (line: string) => void): Promise<PendingEvalScan> {
  const records = await skillRecords(clone, team, { onProblem: ({ name, message }) => report(`${name}: ${message}`) });
  let versionProblem: string | undefined;
  const versions = await skillVersions(runner, clone).catch((error: unknown) => { versionProblem = error instanceof Error ? error.message : String(error); return new Map<string, string>(); });
  const pending: PendingEval[] = [];
  let considered = 0;
  for (const record of records) {
    const version = versions.get(record.name);
    if (version === undefined) { report(`${record.name}: could not resolve the current version${versionProblem === undefined ? ': absent from HEAD:skills' : `: ${versionProblem}`}`); continue; }
    considered += 1;
    try {
      if (await newestReceiptAt(join(clone, 'evals', record.id, version)) === undefined) pending.push({ id: record.id, name: record.name, version });
    } catch (error) {
      report(`${record.name}: the newest receipt for the current version is invalid (${error instanceof Error ? error.message : String(error)}); evaluate it on its own when you have time.`);
    }
  }
  return { pending, shared: records.length, considered, ...(versionProblem === undefined ? {} : { versionProblem }) };
}


export interface EvalQueueArgs extends Omit<EvalArgs, 'ref'> {
  ref?: string;
  parallel?: number;
  queueList?: boolean;
  drain?: boolean;
  dequeue?: string;
  window?: string;
  max?: number;
  /** Test seam; production always reuses the ordinary eval engine. */
  evaluate?: typeof run;
}
export interface EvalQueueResult {
  items: EvalQueueItem[];
  attempted?: number;
  completed?: number;
  failures?: { item: EvalQueueItem; error: string }[];
}
export async function runQueue(args: EvalQueueArgs, io: Prompter): Promise<Result<EvalQueueResult>> {
  try {
    const modes = Number(Boolean(args.queueList)) + Number(Boolean(args.drain)) + Number(args.dequeue !== undefined);
    if (modes > 1) return failure('Choose only one of --queue-list, --drain, or --dequeue.');
    if (!args.drain && (args.window !== undefined || args.max !== undefined || args.parallel !== undefined)) return failure('--window, --max and --parallel require --drain.');
    if (args.window !== undefined && args.window !== 'overnight') return failure('--window must be overnight.');
    if (args.max !== undefined && (!Number.isSafeInteger(args.max) || args.max < 1)) return failure('--max must be a positive integer.');
    if (args.parallel !== undefined && (!Number.isSafeInteger(args.parallel) || args.parallel < 1)) return failure('--parallel must be a positive integer.');
    if (modes === 0) return failure('Provide a skill, --queue-list, --drain, or --dequeue.');
    if (args.ref !== undefined) return failure('Queue modes do not accept a skill argument.');
    if (args.gen || args.noGen || args.case !== undefined || args.triggersOnly || args.executionOnly || args.expectedVersion !== undefined || args.team !== undefined) return failure('Queue modes use the queued team and the full committed skill; per-skill selection flags are unavailable.');
    const store = args.config ?? createConfigStore();
    if (args.queueList || args.dequeue !== undefined) {
      const queue = args.dequeue === undefined ? await readEvalQueue(store.root) : await dequeueEvals(store.root, args.dequeue);
      if (queue.items.length === 0) io.print('No queued evals.');
      for (const item of queue.items) io.print(`${item.team}/${item.skill}@${item.version} · ${item.window} · ${item.requestedAt}${item.lastError === undefined ? '' : ` · ${item.lastError}`}`);
      return success({ items: queue.items });
    }
    return await withEvalQueueLock(store.root, 'drain', async assertHeld => {
      const pending = (await readEvalQueue(store.root)).items.filter(item => args.window === undefined || item.window === args.window).slice(0, args.max);
      if (!pending.length) { io.print('No queued evals.'); return success({ items: (await readEvalQueue(store.root)).items, attempted: 0, completed: 0, failures: [] }); }
      let attempted = 0, completed = 0;
      const failures: { item: EvalQueueItem; error: string }[] = [];
      let probe: ReturnType<typeof systemPreflight> | undefined;
      const preflight: EvalArgs['preflight'] = model => probe ??= (args.preflight ?? systemPreflight)(model);
      const byId = new Map(pending.map(item => [queueKey(item), item]));
      io.print(`Evaluating ${pending.length} skills, ${args.parallel ?? EVAL_PARALLEL_DEFAULT} at a time…`);
      const batch = await runEvalBatch({
        items: pending.map(item => ({ id: queueKey(item), name: item.skill, version: item.version })),
        parallel: args.parallel ?? EVAL_PARALLEL_DEFAULT, io,
        run: async (candidate, captured) => {
          const item = byId.get(candidate.id)!;
          assertHeld();
          if (!(await readEvalQueue(store.root)).items.some(current => queueKey(current) === queueKey(item) && current.requestedAt === item.requestedAt)) return failure('Item was dequeued before it started.');
          attempted += 1;
          let outcome: Result<EvalResult>;
          try { outcome = await (args.evaluate ?? run)({ ...args, config: store, ref: item.skill, team: item.team, expectedVersion: item.version, skipReceipted: true, preflight, lockWaitMs: EVAL_LOCK_WAIT_MS }, captured); }
          catch (error) { outcome = fromError(error); }
          const error = !outcome.ok ? outcome.error : undefined;
          if (outcome.ok && outcome.value.executionStatus !== 'complete') captured.print(`Eval completed with ${outcome.value.executionStatus} results.`);
          assertHeld();
          await updateEvalQueue(store.root, items => items.flatMap(current => queueKey(current) !== queueKey(item) || current.requestedAt !== item.requestedAt ? [current] : error === undefined ? [] : [{ ...current, lastError: error }]));
          if (error === undefined) completed += 1;
          else { failures.push({ item, error }); return failure(error); }
          return outcome;
        },
      });
      io.print(`Evaluated ${batch.ok} of ${pending.length}; ${batch.failed} failed.`);
      for (const [index, outcome] of batch.outcomes.entries()) {
        const item = pending[index]!;
        if (!outcome.ok && !failures.some(failed => queueKey(failed.item) === queueKey(item))) {
          assertHeld();
          failures.push({ item, error: outcome.error });
          await updateEvalQueue(store.root, items => items.map(current => queueKey(current) === queueKey(item) && current.requestedAt === item.requestedAt ? { ...current, lastError: outcome.error } : current));
        }
      }
      const value = { items: (await readEvalQueue(store.root)).items, attempted, completed, failures };
      return failures.length ? failureWith(value, `${failures.length} queued evals failed; they remain queued.`) : success(value);
    });
  } catch (error) { return fromError(error); }
}
