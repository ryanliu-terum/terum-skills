import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
/** Local-only orchestration for the eval engine. Receipt commits deliberately begin in IE3. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { type AgentApi, DEFAULT_MODEL, preflight as systemPreflight, systemAgent } from '../lib/evals/agent.js';
import { type ArmSample, type ComparisonRow, loadCase, runCase } from '../lib/evals/execution.js';
import { generate, type GeneratedAssets } from '../lib/evals/generate.js';
import { assessHygiene, HygieneRefused, reportHygieneWarnings } from '../lib/evals/hygiene.js';
import { makeRng } from '../lib/evals/judge.js';
import { buildReceipt, receiptPath } from '../lib/evals/receipt.js';
import { aggregate, renderReport, runIdFrom, writeRunTree } from '../lib/evals/results.js';
import { packageVersion } from '../lib/package.js';
import { parseTriggers, runTriggerEvals, type TriggerSummary } from '../lib/evals/triggers.js';
import { Prompter } from '../lib/prompt.js';
import { failure, type Result, success } from '../lib/result.js';
import { normalizeRemote } from '../lib/remote.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { assertSkillDirectory, sourceFiles } from '../lib/skill-source.js';
import { findSkill, readTeam, skillRecords } from '../lib/skills.js';
import { openTeamRepo, refreshClone } from '../lib/teamRepo.js';
import { materializeVersion, resolveVersion } from '../lib/version.js';

export interface EvalArgs extends WithForm {
  ref: string;
  k?: number;
  triggersOnly?: boolean;
  executionOnly?: boolean;
  case?: string;
  model?: string;
  judgeModel?: string;
  working?: boolean;
  commit?: boolean;
  noGen?: boolean;
  gen?: boolean;
  save?: boolean;
  team?: string;
  config?: ConfigStore;
  runner?: Runner;
  agent?: AgentApi;
  preflight?: (model?: string) => ReturnType<typeof systemPreflight>;
  now?: () => Date;
}

export interface EvalResult {
  team: string;
  id: string;
  name: string;
  runDir: string;
  ccVersion: string;
  executionStatus: 'complete' | 'partial' | 'failed';
  receiptPath?: string;
}

/** §6: fetch/read only from the team clone; --commit adds exactly one immutable receipt via safeWrite. */
export async function run(args: EvalArgs, io: Prompter): Promise<Result<EvalResult>> {
  try {
    if (args.working && args.commit) return failure('--working --commit is refused: receipts pin committed skill trees only.');
    if (args.save && !args.working) return failure('--save is only available with --working; generated assets may only be saved to your shared source.');
    // A named case asserts an authored expectation; forcing regeneration contradicts it, and a
    // generated case sharing the stem would silently evaluate something else (review P2).
    if (args.gen && args.case !== undefined) return failure('--gen cannot be combined with --case: naming a case asserts an authored expectation, and generation would replace the set it selects from.');
    if (args.triggersOnly && args.executionOnly) return failure('--triggers-only and --execution-only cannot be used together.');
    const k = args.k ?? 3;
    if (!Number.isInteger(k) || k < 1) return failure('--k must be a positive integer.');
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const [teamName, binding] = selectTeam(config.teams, args.team, args.form);
    if (args.commit && !binding.handle) return failure(`Team ${teamName} has no joined handle; run \`${invocation(args.form, 'team join')}\` before committing an eval receipt.`);
    const clone = store.teamClone(teamName);
    await refreshClone(runner, clone, { label: teamName });
    const team = await readTeam(clone);
    const record = await findSkill(clone, teamName, args.ref);
    if (!record) return failure(`No skill named or identified by ${args.ref} exists in team ${teamName}.`);

    // Pin the evaluated version and materialize its immutable snapshot BEFORE anything reads
    // skill content: a concurrent sync can refresh the clone mid-run, and the receipt's tree
    // hash must pin the exact skill text AND cases evaluated (§4.1; review P1). A concurrent
    // update may make this an older (but still exact) historical receipt.
    const version = await resolveVersion(clone, record.name, undefined, runner);
    let candidateDir: string;
    if (args.working) {
      const shared = config.shared[record.id];
      if (!shared || shared.team !== teamName) return failure(`${record.name} is not a connected local source for team ${teamName}; --working is unavailable.`);
      await assertSkillDirectory(shared.source);
      candidateDir = shared.source;
    } else {
      candidateDir = await materializeVersion(store, teamName, clone, record.name, version, runner);
    }

    // This is intentionally before preflight, trigger selection, run-tree creation, or any agent call.
    const candidateFiles = await sourceFiles(candidateDir);
    try {
      // A store copy passed connect's consent gate. A working source remains subject to its own mode.
      reportHygieneWarnings((line) => io.print(line), assessHygiene(record.name, candidateFiles, team.policy.skill_license, !args.working));
    } catch (error) {
      if (!(error instanceof HygieneRefused)) throw error;
      reportHygieneWarnings((line) => io.print(line), error.assessment);
      return failure(`Hygiene failed for ${record.name}:\n${error.message}`);
    }

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

    const wantsCases = !args.triggersOnly;
    const wantsTriggers = !args.executionOnly;
    const authoredCasesDir = join(candidateDir, 'evals', 'cases');
    const authoredCaseFiles = (await optionalDirectory(authoredCasesDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
    const authoredTrigger = candidateFiles.files.has('evals/triggers.yaml');
    const authoredSelected = args.case === undefined ? authoredCaseFiles : authoredCaseFiles.filter((file) => file.replace(/\.ya?ml$/i, '') === args.case);
    // A named case is an authored assertion; it intentionally never causes a model call.
    if (wantsCases && args.case !== undefined && authoredSelected.length === 0) return failure(`No eval case named ${args.case} for ${record.name}.`);
    const generateCases = wantsCases && !args.noGen && (Boolean(args.gen) || authoredCaseFiles.length === 0);
    const generateTriggers = wantsTriggers && !args.noGen && (Boolean(args.gen) || !authoredTrigger);
    let generated: GeneratedAssets = {};
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
      await writeGeneratedAssets(join(runDir, 'generated'), generated);
      if (args.save) {
        const shared = config.shared[record.id]!;
        const saved = await saveGeneratedAssets(shared.source, generated);
        if (!saved.ok) return saved;
      }
      if (args.commit) return failure(`--commit is refused for generated eval assets. Review ${join(runDir, 'generated')}, save or copy the reviewed files into the skill's evals/, publish them, then rerun eval --commit at the committed version.`);
    }

    const casesDir = generated.cases === undefined ? authoredCasesDir : join(runDir, 'generated', 'cases');
    const triggerPath = generated.triggers === undefined ? join(candidateDir, 'evals', 'triggers.yaml') : join(runDir, 'generated', 'triggers.yaml');
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
    if (generated.cases !== undefined || generated.triggers !== undefined) {
      const sets = [
        wantsCases ? `cases: ${generated.cases === undefined ? 'authored' : `generated (${generated.cases.names.length})`}` : null,
        wantsTriggers ? `triggers: ${generated.triggers === undefined ? 'authored' : 'generated'}` : null,
      ].filter((line): line is string => line !== null);
      io.print(`eval assets: ${sets.join(' · ')}`);
      io.print(`Generated assets: ${join(runDir, 'generated')} — review before trusting; save or copy reviewed files into the skill before committing a receipt.`);
    }
    io.print(renderReport(summary, triggers));
    let committedPath: string | undefined;
    if (args.commit) {
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
          runner_handle: binding.handle,
        },
      });
      if (!receipt.ok) return failure(receipt.error);
      committedPath = receiptPath(record.id, version, runId);
      const source = `${JSON.stringify(receipt.value, null, 2)}\n`;
      await openTeamRepo(clone, binding.remote, runner).safeWrite(
        (tree) => tree.set(committedPath!, source),
        { action: 'eval', handle: binding.handle, message: `${binding.handle}: eval ${record.name}` },
      );
      io.print(`Committed eval receipt ${committedPath}.`);
    }
    return success({ team: teamName, id: record.id, name: record.name, runDir, ccVersion: preflight.value.ccVersion, executionStatus: summary.execution_status, ...(committedPath === undefined ? {} : { receiptPath: committedPath }) });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

/** Product provenance is read-only and never falls back to the team clone's unrelated HEAD. */
async function runningEngineCommit(runner: Runner): Promise<string> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
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

/** The sole IE5 source write: explicit --working --save, all targets checked before any write. */
async function saveGeneratedAssets(source: string, generated: GeneratedAssets): Promise<Result> {
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
