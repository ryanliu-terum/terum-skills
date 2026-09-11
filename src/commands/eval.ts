import { packageRoot } from '../lib/package-root.js';
import { invocation } from '../lib/invocation.js';
import type { WithForm, InvocationForm } from '../lib/invocation.js';
/** Local-only orchestration for the eval engine. Receipt commits deliberately begin in IE3. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { reconcileShared } from './connect.js';
import { newestReceiptAt } from './receiptCheck.js';
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
import { fromError, failure, failureWith, type Result, success } from '../lib/result.js';
import { normalizeRemote } from '../lib/remote.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { parseSkillFrontmatter } from '../lib/schema.js';
import { assertSkillDirectory, sourceFiles } from '../lib/skill-source.js';
import { findSkill, readTeam, skillRecords } from '../lib/skills.js';
import { openTeamRepo, refreshClone, treeText, lockWait, skillVersions } from '../lib/teamRepo.js';
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
  /** Test knob: the clone lock's wait budget. Production takes it from the Prompter (teamRepo lockWait). */
  lockWaitMs?: number;
}

export interface EvalResult {
  team: string;
  id: string;
  name: string;
  runDir: string;
  ccVersion: string;
  executionStatus: 'complete' | 'partial' | 'failed';
  receiptPath?: string;
  commit: { ok: true; receiptPath: string } | { ok: false; error: string } | null;
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
    if (args.save && !args.working) return failure('--save is only available with --working; generated assets may only be saved to your shared source.');
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
    const eligibility = commitEligibility({ ...args, team: teamName }, binding, args.form);
    if (eligibility !== null) return failure(eligibility);
    const clone = store.teamClone(teamName);
    await refreshClone(runner, clone, { label: teamName, ...lockWait(io, args.lockWaitMs) });
    const team = await readTeam(clone);
    let record = await findSkill(clone, teamName, args.ref);
    if (!record) return failure(`No skill named or identified by ${args.ref} exists in team ${teamName}.`);

    // Pin the evaluated version and materialize its immutable snapshot BEFORE anything reads
    // skill content: a concurrent sync can refresh the clone mid-run, and the receipt's tree
    // hash must pin the exact skill text AND cases evaluated (§4.1; review P1). A concurrent
    // update may make this an older (but still exact) historical receipt.
    const originalVersion = await resolveVersion(clone, record.name, undefined, runner);
    let version = originalVersion;
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
    let candidateFiles = await sourceFiles(candidateDir);
    try {
      // A store copy passed connect's consent gate. A working source remains subject to its own mode.
      reportHygieneWarnings((line) => io.print(line), assessHygiene(record.name, candidateFiles, team.policy.skill_license, !args.working));
    } catch (error) {
      if (!(error instanceof HygieneRefused)) throw error;
      reportHygieneWarnings((line) => io.print(line), error.assessment);
      return failure(`Hygiene failed for ${record.name}:\n${error.message}`);
    }

    const wantsCases = !args.triggersOnly;
    const wantsTriggers = !args.executionOnly;
    let authoredCasesDir = join(candidateDir, 'evals', 'cases');
    let authoredCaseFiles = (await optionalDirectory(authoredCasesDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
    const authoredTrigger = candidateFiles.files.has('evals/triggers.yaml');
    const assets = { name: record.name, wantsCases, wantsTriggers, authoredCaseFiles, authoredTrigger };
    const assetEligibility = commitEligibility(args, binding, args.form, assets);
    if (assetEligibility !== null) return failure(assetEligibility);
    const notice = generationCommitNotice(args, args.form, assets);
    if (notice !== null) io.print(notice);

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
    let generatedRoot = join(runDir, 'generated');
    let commit = Boolean(args.commit);
    let announcedGenerated = false;
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
      if (args.save) {
        const shared = config.shared[record.id]!;
        const saved = await saveGeneratedAssets(shared.source, generated);
        if (!saved.ok) return saved;
      }
      // Any member may confirm the generated assets into the skill and land a receipt at the
      // committed tree (Terum decision 6fafb8d3, Ajay, 2026-09-09 — supersedes the author-only
      // clause of a5ec5efd; the non-author run-tree-only refusal is retired).
      if (commit) {
        announceGeneratedAssets(io, wantsCases, wantsTriggers, generated, generatedRoot);
        announcedGenerated = true;
        const confirmed = io.interactive ? await io.confirm(`Commit generated eval assets for ${record.name}?`) : false;
        if (!confirmed) commit = false;
        else {
          const shared = config.shared[record.id];
          if (shared?.team === teamName) {
            // The runner's own connected source: land the assets there first, then reuse sync's
            // only skill-content mutation. Its strict one-skill mode makes a failed hygiene/
            // network/guard pass fail this run instead of leaving a receipt at the old tree.
            const saved = await saveGeneratedAssets(shared.source, generated);
            if (!saved.ok) return saved;
            await reconcileShared(store, runner, io, new Set(), () => undefined, args.form, { ids: new Set([record.id]), failFast: true });
          } else {
            // No connected source on this machine: the assets land through the same safeWrite the
            // receipt uses, under the guard's append-only eval-assets row — a NEW cases/*.yaml or
            // triggers.yaml on an existing skill, never overwriting a committed file.
            await openTeamRepo(clone, binding.remote, runner).safeWrite((tree) => {
              const skillSource = tree.before(`skills/${record!.name}/SKILL.md`);
              const parsed = skillSource === undefined ? undefined : parseSkillFrontmatter(treeText(skillSource));
              if (!parsed?.ok || parsed.data.metadata.id !== record!.id) throw new Error(`${record!.name} is no longer in the repository as ${record!.id.slice(0, 8)}; run ${invocation(args.form, 'sync')} and retry.`);
              for (const [path, content] of generatedAssetEntries(record!.name, generated)) {
                if (tree.before(path) !== undefined) throw new Error(`${path} already exists upstream; generated eval assets never overwrite committed files. Rerun eval to evaluate the authored assets.`);
                tree.set(path, content);
              }
            }, { action: 'eval-assets', handle: binding.handle, message: `${binding.handle}: eval assets ${record.name}`, label: teamName, ...lockWait(io, args.lockWaitMs) });
          }
          // The commit path is the ordinary write path, so it may also have carried the runner's
          // pending source edits — a rename included (review P2). Re-resolve the record by its
          // stable id and re-read EVERY asset from the committed tree the receipt will pin, so the
          // run never evaluates a stale snapshot against a fresh hash (review P1).
          const reconciled = await findSkill(clone, teamName, record.id);
          if (!reconciled) throw new Error(`Skill ${record.name} disappeared from the clone after committing its eval assets; refusing to write a receipt.`);
          record = reconciled;
          version = await resolveVersion(clone, record.name, undefined, runner);
          if (version === originalVersion) throw new Error(`Generated eval assets for ${record.name} were not committed; refusing to write a receipt at the pre-generation version.`);
          candidateDir = await materializeVersion(store, teamName, clone, record.name, version, runner);
          candidateFiles = await sourceFiles(candidateDir);
          generatedRoot = join(candidateDir, 'evals');
          authoredCasesDir = join(candidateDir, 'evals', 'cases');
          authoredCaseFiles = (await optionalDirectory(authoredCasesDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
        }
      }
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
    if ((generated.cases !== undefined || generated.triggers !== undefined) && !announcedGenerated) announceGeneratedAssets(io, wantsCases, wantsTriggers, generated, join(runDir, 'generated'));
    io.print(renderReport(summary, triggers));

    const value: EvalResult = { team: teamName, id: record.id, name: record.name, runDir, ccVersion: preflight.value.ccVersion, executionStatus: summary.execution_status, commit: null };
    if (commit) {
      try {
        const committedPath = receiptPath(record.id, version, runId);
        await openTeamRepo(clone, binding.remote, runner).safeWrite(
          (tree) => tree.set(committedPath, source),
          { action: 'eval', handle: binding.handle, message: `${binding.handle}: eval ${record.name}`, label: teamName, ...lockWait(io, args.lockWaitMs) },
        );
        io.print(`Committed eval receipt ${committedPath}.`);
        return success({ ...value, receiptPath: committedPath, commit: { ok: true, receiptPath: committedPath } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureWith({ ...value, commit: { ok: false as const, error: message } }, message);
      }
    }
    return success(value);
  } catch (error) { return fromError(error); }
}

interface PlannedAssets { name: string; wantsCases: boolean; wantsTriggers: boolean; authoredCaseFiles: string[]; authoredTrigger: boolean }

/** The one derivation of what this run would generate, shared by the run body and both pre-run builders. */
function plannedGeneration(args: EvalArgs, assets: PlannedAssets): { generateCases: boolean; generateTriggers: boolean } {
  const generateCases = assets.wantsCases && !args.noGen && (Boolean(args.gen) || assets.authoredCaseFiles.length === 0);
  const generateTriggers = assets.wantsTriggers && !args.noGen && (Boolean(args.gen) || !assets.authoredTrigger);
  return { generateCases, generateTriggers };
}

/** Deterministic refusal before refresh (identity) or any paid work (asset generation). */
function commitEligibility(args: EvalArgs, binding: { handle?: string }, form: InvocationForm | undefined, assets?: PlannedAssets): string | null {
  if (assets === undefined) {
    if (args.commit && !binding.handle) return `Team ${args.team} has no joined handle; run \`${invocation(form, 'team join')}\` before committing an eval receipt.`;
    if (args.working && args.commit) return '--working --commit is refused: receipts pin committed skill trees only.';
    return null;
  }
  const { generateCases, generateTriggers } = plannedGeneration(args, assets);
  // Forced regeneration is always review-only: it must never replace an authored dataset.
  if (args.commit && args.gen && (generateCases || generateTriggers)) {
    return `--gen --commit is refused: forced regeneration is review-only and never replaces authored eval assets. Run \`${invocation(form, `eval ${assets.name} --gen`)}\` to review the regenerated set, or \`${invocation(form, `eval ${assets.name} --commit`)}\` without --gen.`;
  }
  return null;
}

/**
 * The pre-run heads-up for a --commit run that will generate assets (also the app's Run-eval dialog
 * detail): the run pauses on one y/N before anything enters the skill (Terum 6fafb8d3).
 */
function generationCommitNotice(args: EvalArgs, form: InvocationForm | undefined, assets: PlannedAssets): string | null {
  const { generateCases, generateTriggers } = plannedGeneration(args, assets);
  if (!args.commit || (!generateCases && !generateTriggers)) return null;
  const kinds = generateCases && generateTriggers ? 'eval cases and triggers.yaml' : generateCases ? 'eval cases' : 'triggers.yaml';
  return `--commit with generated eval assets: ${assets.name} would generate ${kinds}. This run generates the assets, shows them, and asks before committing them into the skill; declining keeps them in the run tree and lands no receipt. Run \`${invocation(form, `eval ${assets.name}`)}\` without --commit to only review them.`;
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

/** The generated files as repo paths under the skill, for the confirm-commit safeWrite mutation. */
function generatedAssetEntries(name: string, generated: GeneratedAssets): [string, string][] {
  const entries: [string, string][] = [];
  if (generated.triggers !== undefined) entries.push([`skills/${name}/evals/triggers.yaml`, generated.triggers]);
  if (generated.cases !== undefined) for (const [file, source] of Object.entries(generated.cases.files)) entries.push([`skills/${name}/evals/cases/${file}`, source]);
  return entries;
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
