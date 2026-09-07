/** Local-only orchestration for the eval engine. Receipt commits deliberately begin in IE3. */
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { type AgentApi, DEFAULT_MODEL, preflight as systemPreflight, systemAgent } from '../lib/evals/agent.js';
import { type ArmSample, type ComparisonRow, loadCase, runCase } from '../lib/evals/execution.js';
import { formatHygieneFindings, hygieneFrontmatter, inspectHygiene } from '../lib/evals/hygiene.js';
import { makeRng } from '../lib/evals/judge.js';
import { aggregate, renderReport, runIdFrom, writeRunTree } from '../lib/evals/results.js';
import { parseTriggers, runTriggerEvals, type TriggerSummary } from '../lib/evals/triggers.js';
import { Prompter } from '../lib/prompt.js';
import { failure, type Result, success } from '../lib/result.js';
import { normalizeRemote } from '../lib/remote.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { assertSkillDirectory, sourceFiles } from '../lib/skill-source.js';
import { findSkill, readTeam, skillRecords } from '../lib/skills.js';
import { refreshClone } from '../lib/teamRepo.js';
import { materializeVersion, resolveVersion } from '../lib/version.js';

export interface EvalArgs {
  ref: string;
  k?: number;
  triggersOnly?: boolean;
  executionOnly?: boolean;
  case?: string;
  model?: string;
  judgeModel?: string;
  working?: boolean;
  commit?: boolean;
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
}

/** §6: fetch/read only from the team clone; writes are confined to the local run tree. */
export async function run(args: EvalArgs, io: Prompter): Promise<Result<EvalResult>> {
  try {
    if (args.commit) return failure('--commit is not available until receipt commits land; run without --commit.');
    if (args.triggersOnly && args.executionOnly) return failure('--triggers-only and --execution-only cannot be used together.');
    const k = args.k ?? 3;
    if (!Number.isInteger(k) || k < 1) return failure('--k must be a positive integer.');
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const [teamName] = selectTeam(config.teams, args.team);
    const clone = store.teamClone(teamName);
    await refreshClone(runner, clone, { label: teamName });
    const team = await readTeam(clone);
    const record = await findSkill(clone, teamName, args.ref);
    if (!record) return failure(`No skill named or identified by ${args.ref} exists in team ${teamName}.`);

    let candidateDir = record.directory;
    if (args.working) {
      const shared = config.shared[record.id];
      if (!shared || shared.team !== teamName) return failure(`${record.name} is not a shared local source for team ${teamName}; --working is unavailable.`);
      await assertSkillDirectory(shared.source);
      candidateDir = shared.source;
    }

    // This is intentionally before preflight, trigger selection, run-tree creation, or any agent call.
    const candidateFiles = await sourceFiles(candidateDir);
    const skill = candidateFiles.files.get('SKILL.md');
    const hygiene = inspectHygiene({
      name: record.name,
      frontmatter: skill === undefined ? undefined : hygieneFrontmatter(skill),
      files: candidateFiles.files,
      executable: candidateFiles.executable,
      policy: { skill_license: team.policy.skill_license },
      // A store copy passed share's consent gate. A working source remains subject to its own mode.
      allowExecutable: !args.working,
    });
    if (hygiene.length) return failure(`Hygiene failed for ${record.name}:\n${formatHygieneFindings(hygiene)}`);

    const model = args.model ?? DEFAULT_MODEL;
    const preflight = await (args.preflight ?? systemPreflight)(model);
    if (!preflight.ok) return failure(preflight.error);

    const runId = runIdFrom((args.now ?? (() => new Date()))());
    const runDir = join(store.root, 'evals', teamName, record.id, runId);
    const transcriptDir = join(runDir, 'transcripts');
    const scratch = join(runDir, 'sandboxes');
    await mkdir(transcriptDir, { recursive: true, mode: 0o700 });
    await mkdir(scratch, { recursive: true, mode: 0o700 });

    const records = await skillRecords(clone, teamName);
    const catalog = await endorsedCatalog(team, records, record.id, runner);
    let triggers: TriggerSummary | null = null;
    if (!args.executionOnly) {
      const source = await optionalText(join(candidateDir, 'evals', 'triggers.yaml'));
      if (source !== undefined) {
        const parsed = parseTriggers(source);
        if (!parsed.ok) return failure(parsed.error);
        triggers = await runTriggerEvals(args.agent ?? systemAgent, { skillName: record.name, catalog, spec: parsed.value, model });
      }
    }

    const rows: ComparisonRow[] = [];
    const arms: ArmSample[] = [];
    const environmentSkips: Record<string, string[]> = {};
    const rng = makeRng(0);
    let expectedRows = 0;
    if (!args.triggersOnly) {
      const casesDir = join(candidateDir, 'evals', 'cases');
      const caseFiles = (await optionalDirectory(casesDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
      const selected = args.case === undefined ? caseFiles : caseFiles.filter((file) => file.replace(/\.ya?ml$/i, '') === args.case);
      if (args.case !== undefined && selected.length === 0) return failure(`No eval case named ${args.case} for ${record.name}.`);
      const candidateTree = await resolveVersion(clone, record.name, undefined, runner);
      const incumbent = await materializeIncumbent(store, teamName, clone, { name: record.name, id: record.id }, candidateTree, runner);
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
    }, [...rows, ...arms, ...(triggers === null ? [] : [triggers])]);
    io.print(renderReport(summary, triggers));
    return success({ team: teamName, id: record.id, name: record.name, runDir, ccVersion: preflight.value.ccVersion, executionStatus: summary.execution_status });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

async function optionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function optionalDirectory(path: string): Promise<string[]> {
  try { return await readdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
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
