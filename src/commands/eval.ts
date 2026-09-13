import { runEvalBatch, EVAL_PARALLEL_DEFAULT, EVAL_LOCK_WAIT_MS } from '../lib/evals/batch.js';
import { dequeueEvals, queueKey, readEvalQueue, updateEvalQueue, withEvalQueueLock, type EvalQueueItem } from '../lib/evals/queue.js';
import { packageRoot } from '../lib/package-root.js';
import type { WithForm } from '../lib/invocation.js';
/** Local-only orchestration for the eval engine. Receipt commits deliberately begin in IE3. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { Config } from '../lib/schema.js';
import { localReceiptsFor, newestReceiptAt } from '../lib/evals/receipt-store.js';
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
import { type Runner, systemRunner } from '../lib/runner.js';
import { inspectSkillSource, sourceFiles } from '../lib/skill-source.js';
import { findSkill, readTeam, skillContentDigest, skillRecords } from '../lib/skills.js';
import { parseSkillFrontmatter } from '../lib/schema.js';
import { resolveLibrarySkill } from '../lib/local-skills.js';
import { parseVersionFolder, type SkillVersion } from '../lib/versions.js';
import { refreshClone, lockWait, listVersions, skillVersions } from '../lib/teamRepo.js';

export interface EvalArgs extends WithForm {
  ref: string;
  /** The home the Library roots derive from (tests); defaults to homedir(). */
  home?: string;
  /** Queue guard, re-keyed on the CONTENT HASH (§6.6): never bill bytes other than the queued ones. */
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
  /** §6.3: null when the folder belongs to no team — the local-folder resolve has neither. */
  team: string | null;
  /** §6.1: the folder's declared `metadata.id` when it has one; null before its first publish. */
  id: string | null;
  /** §6.3: the caller's cue for "To share these results, publish the skill again." */
  shareHint?: true;
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
    if (args.triggersOnly && args.executionOnly) return failure('--triggers-only and --execution-only cannot be used together.');
    // Default k=1 (spec rev 18; Ajay, 2026-09-10) — overrides the 2026-09-07 "keep default k=3"
    // ruling (Terum 5aa9a4b2) on cost: k=3 -> k=1 takes a 3-case run from ~$4.40 to ~$1.50 measured.
    // A receipt you intend to gate on wants --k 3 or more; §16.6 carries the noise caveat.
    const k = args.k ?? 1;
    if (!Number.isInteger(k) || k < 1) return failure('--k must be a positive integer.');
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    // §6.3 / D42: eval targets a LOCAL folder, so the team is best-effort. It supplies exactly three
    // things — the incumbent arm (§6.5), the hygiene license policy, and the receipt's `skill_id`/
    // `team` — and a machine with no team configured evaluates single-arm rather than being turned
    // away, which is the whole reason §6.2 re-keyed the local store by content. `selectTeam` still
    // throws on an ambiguous --team-less multi-team machine: that is a machine the user can
    // disambiguate with one flag, not a skill that belongs to nobody.
    const selected = args.team !== undefined || Object.keys(config.teams).length > 0 ? selectTeam(config.teams, args.team, args.form) : null;
    const teamName = selected === null ? null : selected[0];
    const handle = selected === null ? null : selected[1].handle;
    const clone = teamName === null ? null : store.teamClone(teamName);
    if (clone !== null && teamName !== null) await refreshClone(runner, clone, { label: teamName, ...lockWait(io, args.lockWaitMs) });
    const team = clone === null ? null : await readTeam(clone);
    // §6.3: the bytes come from the Library, not the clone. The clone is still read for the incumbent
    // arm and the policy, but a folder that belongs to no team is evaluable.
    const local = await resolveLibrarySkill(args.home ?? homedir(), config, store.root, args.ref);
    if (!local) return failure(`No local skill folder named \`${args.ref}\` in your library; install it from the marketplace first, or pass \`--path\`.`);
    // Best-effort, never a gate: a folder the team has never seen is still evaluable (§6.3).
    const record = clone === null || teamName === null ? undefined : await findSkill(clone, teamName, args.ref);

    // Pin the evaluated version and materialize its immutable snapshot BEFORE anything reads
    // skill content: a concurrent sync can refresh the clone mid-run, and the receipt's tree
    // hash must pin the exact skill text AND cases evaluated (§4.1; review P1). A concurrent
    // update may make this an older (but still exact) historical receipt.
    // §6.3: eval targets a LOCAL folder. There is no version number at run time — the skill may never
    // have been published — so the candidate is identified by its content digest (§6.1) and publish
    // resolves that to a version when it attaches the run.
    const candidateDir = local.path;

    // This is intentionally before preflight, trigger selection, run-tree creation, or any agent call.
    const candidateFiles = await sourceFiles(candidateDir);
    const candidateDigest = skillContentDigest(candidateFiles.files);
    // §6.1: the id is the FOLDER's declared `metadata.id` when it has one — never the team record's,
    // which may not exist — and null before the folder's first publish. Read through the lenient
    // inspector, because an unpublished folder legitimately carries no managed fields at all (§6.3).
    const inspected = inspectSkillSource(candidateFiles.files.get('SKILL.md')?.toString('utf8') ?? '');
    const skillId = (inspected.ok ? inspected.id : null) ?? record?.id ?? null;
    const description = (inspected.ok ? inspected.description : inspected.description) ?? record?.frontmatter.description ?? '';
    if (args.skipReceipted || args.expectedVersion !== undefined) {
      // Both queue guards are re-keyed on the content hash (§6.6): the bytes, not an ordinal, are what
      // a queued item was queued against.
      if (args.expectedVersion !== undefined && args.expectedVersion !== candidateDigest) {
        return failure(`The queued bytes of ${local.name} are no longer what is on disk; dequeue it and queue it again.`);
      }
      const already = await localReceiptsFor(store.root, candidateDigest, line => io.print(line));
      if (args.skipReceipted && already.length) {
        const newest = already[already.length - 1]!;
        io.print(`Already evaluated these exact bytes of ${local.name}.`);
        return success({ team: teamName, id: skillId, name: local.name, runDir: '', ccVersion: newest.receipt.provenance.cc_version, executionStatus: newest.receipt.execution_status, alreadyEvaluated: true });
      }
    }
    try {
      // §6.3: the folder as it is on disk — eval never injects — so HYG1 treats `license` and the
      // three managed `metadata.*` fields as optional. Every other HYG1 clause and every HYG2–HYG6
      // predicate stay unchanged and fail-closed. With no team there is no policy license to conform
      // to, so HYG5 compares the frontmatter against the bundled LICENSE files alone.
      reportHygieneWarnings((line) => io.print(line), assessHygiene(local.name, candidateFiles, team?.policy.skill_license ?? null, false, true));
    } catch (error) {
      if (!(error instanceof HygieneRefused)) throw error;
      reportHygieneWarnings((line) => io.print(line), error.assessment);
      return failure(`Hygiene failed for ${local.name}:\n${error.message}`);
    }

    const wantsCases = !args.triggersOnly;
    const wantsTriggers = !args.executionOnly;
    const authoredCasesDir = join(candidateDir, 'evals', 'cases');
    const authoredCaseFiles = (await optionalDirectory(authoredCasesDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
    const authoredTrigger = candidateFiles.files.has('evals/triggers.yaml');
    const assets = { name: local.name, wantsCases, wantsTriggers, authoredCaseFiles, authoredTrigger };

    const model = args.model ?? DEFAULT_MODEL;
    const preflight = await (args.preflight ?? systemPreflight)(model);
    if (!preflight.ok) return failure(preflight.error);

    const runAt = (args.now ?? (() => new Date()))();
    const runId = runIdFrom(runAt);

    const authoredSelected = args.case === undefined ? authoredCaseFiles : authoredCaseFiles.filter((file) => file.replace(/\.ya?ml$/i, '') === args.case);
    // A named case is an authored assertion; it intentionally never causes a model call.
    if (wantsCases && args.case !== undefined && authoredSelected.length === 0) return failure(`No eval case named ${args.case} for ${local.name}.`);
    const { generateCases, generateTriggers } = plannedGeneration(args, assets);
    let generated: GeneratedAssets = {};
    if (generateCases || generateTriggers) {
      const catalog = await endorsedCatalog(local.libraryRoot, { name: local.name, description });
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
      // §6.3/D9: the write-back into the LOCAL skill folder — the only route by which a generated
      // eval asset ever reaches anywhere. It only ever runs for an asset that was MISSING, so it
      // cannot overwrite authored work. With `--gen` deleted the user never asked for it, so this
      // line naming the path and the consequence is the only signal they get. It is a PRINT, not a
      // prompt: nothing leaves the machine here, publish still asks before anything does, and
      // publish already writes into this same folder (§5.1 step 6b).
      const written = [generated.cases === undefined ? null : 'evals/cases/', generated.triggers === undefined ? null : 'evals/triggers.yaml'].filter((entry): entry is string => entry !== null);
      io.print(`Writing generated ${written.join(' and ')} into ${candidateDir} — they were missing, so this run made them. That changes the skill's content: the next publish mints a new version and the current local eval score blanks. To regenerate, delete evals/cases/ and run eval again.`);
      const saved = await saveGeneratedAssets(candidateDir, generated);
      if (!saved.ok) return failure(saved.error);
    }

    // §6.1/D9: the run has to be keyed on the bytes that were actually EVALUATED, and the write-back
    // above is part of them — `evals/` is inside `skillContentDigest` by D9, and the candidate arm below
    // runs `candidateDir` as it now stands on disk. Digesting before the write-back gave every
    // generating run a `content_digest` naming a folder state that no longer existed anywhere, so
    // publish could never resolve it to a version: NO generating run was ever attachable, paid
    // `--drain` runs included. Re-read rather than merge `generated` in by hand, so the digest has the
    // same oracle publish uses — the folder.
    //
    // The PRE-write digest above deliberately stays the key for the two queue guards at the top: what
    // was queued is what was on disk when it was queued, and re-checking `--skipReceipted` after
    // generation would mean paying for the model call before discovering the bytes were receipted.
    // The next run of an already-generated folder reads the written-back bytes and matches this one.
    const regenerated = generated.cases !== undefined || generated.triggers !== undefined;
    const evaluatedDigest = regenerated ? skillContentDigest((await sourceFiles(candidateDir)).files) : candidateDigest;

    // §6.2: content-keyed, so a skill belonging to NO team can be evaluated at all.
    const runDir = join(store.root, 'evals', 'local', evaluatedDigest.replace(/^sha256:/, ''), runId);
    const transcriptDir = join(runDir, 'transcripts');
    const scratch = join(runDir, 'sandboxes');
    await mkdir(transcriptDir, { recursive: true, mode: 0o700 });
    await mkdir(scratch, { recursive: true, mode: 0o700 });
    const generatedRoot = join(runDir, 'generated');
    if (regenerated) await writeGeneratedAssets(generatedRoot, generated);

    const casesDir = generated.cases === undefined ? authoredCasesDir : join(generatedRoot, 'cases');
    const triggerPath = generated.triggers === undefined ? join(candidateDir, 'evals', 'triggers.yaml') : join(generatedRoot, 'triggers.yaml');
    let triggers: TriggerSummary | null = null;
    if (wantsTriggers) {
      const source = await optionalText(triggerPath);
      if (source !== undefined) {
        const parsed = parseTriggers(source);
        if (!parsed.ok) return failure(parsed.error);
        const catalog = await endorsedCatalog(local.libraryRoot, { name: local.name, description });
        triggers = await runTriggerEvals(args.agent ?? systemAgent, { skillName: local.name, catalog, spec: parsed.value, model });
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
      if (args.case !== undefined && selected.length === 0) return failure(`No eval case named ${args.case} for ${local.name}.`);
      caseNames.push(...selected.map((file) => file.replace(/\.ya?ml$/i, '')));
      // §6.5: no clone, no team, no id, no receipted version — every one of them means NO incumbent
      // and a single-arm run, exactly as eval-engine §7.1 already names it.
      const incumbent = clone === null || skillId === null ? undefined : await incumbentDir(clone, local.name, await listVersions(clone, local.name), skillId, evaluatedDigest);
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
          { k, skillName: local.name, caseDir: casesDir, arms: { candidate: candidateDir, ...(incumbent === undefined ? {} : { incumbent }) }, scratch, transcriptDir },
        );
        rows.push(...output.rows); arms.push(...output.arms);
        if (output.skipped) environmentSkips[name] = output.skipped;
      }
    }
    const summary = aggregate(rows, arms, expectedRows, environmentSkips);
    await writeRunTree(runDir, {
      team: teamName, skill_id: skillId, skill_name: local.name, run_id: runId,
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
      skill_id: skillId,
      skill_name: local.name,
      // §6.1: a local run has NO version — publish fills it in when it resolves the digest to a
      // version folder. Identity at run time is the content digest, computed by the same
      // `skillContentDigest` the publish comparison uses, over the folder exactly as it is on disk.
      version: null,
      content_digest: evaluatedDigest,
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
        runner_handle: handle ?? 'local',
      },
    });
    if (!receipt.ok) return failure(receipt.error);
    const source = `${JSON.stringify(receipt.value, null, 2)}\n`;
    await writeFile(join(runDir, 'receipt.json'), source, 'utf8');
    if (generated.cases !== undefined || generated.triggers !== undefined) announceGeneratedAssets(io, wantsCases, wantsTriggers, generated, join(runDir, 'generated'));
    io.print(renderReport(summary, triggers));

    return success({ team: teamName, id: skillId, name: local.name, runDir, ccVersion: preflight.value.ccVersion, executionStatus: summary.execution_status, shareHint: true });
  } catch (error) { return fromError(error); }
}

interface PlannedAssets { name: string; wantsCases: boolean; wantsTriggers: boolean; authoredCaseFiles: string[]; authoredTrigger: boolean }

/** The one derivation of what this run would generate, shared by the run body and both pre-run builders. */
function plannedGeneration(args: EvalArgs, assets: PlannedAssets): { generateCases: boolean; generateTriggers: boolean } {
  // D29: use the assets that are there, generate only the ones that are missing — per asset. With
  // `--gen` deleted nothing can ever overwrite an authored file, which is what makes §6.3's
  // write-back into the user's own skill folder safe.
  const generateCases = assets.wantsCases && !args.noGen && assets.authoredCaseFiles.length === 0;
  const generateTriggers = assets.wantsTriggers && !args.noGen && !assets.authoredTrigger;
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
  io.print(`Generated assets: ${root} — this run's copy, kept for the record; the skill folder now holds them too. Review before trusting them.`);
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

/**
 * §6.3 — the one write-back into the user's own skill folder. `plannedGeneration` only ever asks for
 * an asset that is MISSING (D29 deleted `--gen`, the only thing that could force a regeneration), so
 * the two `--save refused:` guards this used to carry became unreachable and went with the flag.
 * Regenerating is deleting `evals/cases/` and re-running.
 */
export async function saveGeneratedAssets(source: string, generated: GeneratedAssets): Promise<Result> {
  const cases = join(source, 'evals', 'cases');
  const triggers = join(source, 'evals', 'triggers.yaml');
  // Restored from the pre-refactor verb, which had both refusals. The write-back's claim that it
  // "only ever runs for an asset that was MISSING" holds only for the EXACT spelling: `authoredTrigger`
  // is a case-SENSITIVE lookup in the `sourceFiles` map, while the write lands on a case-INSENSITIVE
  // volume. On macOS an authored `evals/Triggers.yaml` is invisible to that lookup, so generation
  // proceeds and the write replaces its contents — with the directory still listing the authored
  // name, which is what makes it silent. Verified on this repo's own APFS volume: after writing
  // `triggers.yaml` the listing still reads `['Triggers.yaml']` and its bytes are the model's.
  // The check asks the FILESYSTEM, so it is correct on both kinds of volume: on a case-sensitive one
  // the two names are different files and generation proceeds as it should.
  if (generated.cases !== undefined && await pathExists(cases)) return failure(`${cases} already exists, so the generated eval cases were not written — a generated asset never overwrites an authored one. Rename or delete it, then run eval again.`);
  if (generated.triggers !== undefined && await pathExists(triggers)) return failure(`${triggers} already exists, so the generated triggers were not written — a generated asset never overwrites an authored one. Rename or delete it, then run eval again.`);
  await writeGeneratedAssets(join(source, 'evals'), generated);
  return success(undefined);
}

/** Existence as the FILESYSTEM resolves it, which on a case-insensitive volume is the question that
 *  matters: `readFile` finds `Triggers.yaml` when asked for `triggers.yaml`, and so would the write. */
async function pathExists(path: string): Promise<boolean> {
  try { await readFile(path); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    if (code === 'EISDIR') return true;
    throw error;
  }
}

/**
 * §6.3 — the trigger catalog is a purely LOCAL set now: the direct child skill folders of the Library
 * root that holds the folder under eval. `team.json.global` and `endorsedCandidates` are both deleted,
 * and a teamless run has the same catalog rule as a team one — no team read, no clone. Eval-engine
 * §7.2's "endorsed set" is superseded by this.
 *
 * The skill under eval is always included, even when it lives outside every registered root.
 */
async function endorsedCatalog(libraryRoot: string, evaluated: { name: string; description: string }): Promise<string> {
  const rows = new Map<string, string>([[evaluated.name, evaluated.description]]);
  const names = await readdir(libraryRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of names) {
    if (!entry.isDirectory() || rows.has(entry.name)) continue;
    const source = await readFile(join(libraryRoot, entry.name, 'SKILL.md'), 'utf8').catch(() => undefined);
    if (source === undefined) continue;
    const parsed = parseSkillFrontmatter(source);
    // D16: a folder the Library marks rejected or failed is not offered as a trigger.
    if (parsed.ok) rows.set(entry.name, parsed.data.description);
  }
  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, description]) => `- ${name}: ${description}`).join('\n');
}

/**
 * §6.5 — the incumbent arm. The candidate has **no ordinal** at run time: it is a local folder
 * identified by its content digest (§6.1), so the incumbent is chosen by receipt recency, not by
 * ordinal, and read straight from `<clone>/skills/<name>/v<K>/`.
 *
 * A version folder is already an immutable checkout inside the clone, so there is nothing to
 * materialize — which is what made deleting `materializeVersion` safe. **The old `origin/main^`
 * fallback is deleted, not re-expressed:** with no clone, no team, no receipted version, or nothing
 * left after excluding the candidate's own bytes, there is simply NO incumbent and the run is
 * single-arm, exactly as eval-engine §7.1 already names it.
 */
async function incumbentDir(clone: string | null, name: string, versions: readonly SkillVersion[], id: string, candidateDigest: string): Promise<string | undefined> {
  if (clone === null) return undefined;
  const chosen = await latestReceiptedVersion(clone, id, versions, name, candidateDigest);
  return chosen === undefined ? undefined : join(clone, 'skills', name, chosen);
}

/**
 * The receipted version whose newest run-id is most recent, excluding any version whose bytes equal
 * the candidate's.
 *
 * **Ordinal order is deliberately NOT the tie-breaker.** A `v2` re-evaluated today is a more current
 * comparison than a `v4` evaluated last month; §14.1 pins that.
 */
async function latestReceiptedVersion(clone: string, skillId: string, versions: readonly SkillVersion[], name: string, candidateDigest: string): Promise<string | undefined> {
  const root = join(clone, 'evals', skillId);
  let present: string[];
  try { present = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  let latest: { folder: string; runId: string } | undefined;
  for (const folder of present) {
    if (parseVersionFolder(folder) === null) continue;
    if (!versions.some((version) => version.folder === folder)) continue;
    // Exclude the candidate's own bytes — the version-folder form of "excluding the candidate's hash".
    const committed = await sourceFiles(join(clone, 'skills', name, folder)).catch(() => undefined);
    if (committed && skillContentDigest(committed.files) === candidateDigest) continue;
    let files: string[];
    try { files = await readdir(join(root, folder)); } catch { continue; }
    for (const file of files) {
      const runId = /^([0-9]{8}T[0-9]{6}Z)\.json$/.exec(file)?.[1];
      if (runId !== undefined && (latest === undefined || runId > latest.runId)) latest = { folder, runId };
    }
  }
  return latest?.folder;
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
export async function skillsWithoutReceipt(clone: string, team: string, report: (line: string) => void): Promise<PendingEvalScan> {
  const records = await skillRecords(clone, team, { onProblem: ({ name, message }) => report(`${name}: ${message}`) });
  // §6.5: the new `skillVersions` shape — a name with no version folder never reaches `skillRecords`,
  // so the old "could not resolve the current version" arm has nothing left to report.
  const versions = await skillVersions(clone, records.map((record) => record.name));
  const pending: PendingEval[] = [];
  let considered = 0;
  for (const record of records) {
    const highest = versions.get(record.name)?.[0];
    if (highest === undefined) continue;
    considered += 1;
    try {
      if (await newestReceiptAt(join(clone, 'evals', record.id, highest.folder)) === undefined) pending.push({ id: record.id, name: record.name, version: highest.folder });
    } catch (error) {
      report(`${record.name}: the newest receipt for the current version is invalid (${error instanceof Error ? error.message : String(error)}); evaluate it on its own when you have time.`);
    }
  }
  return { pending, shared: records.length, considered };
}


/**
 * §6.6 — the producer side of the queue. A queued eval names the BYTES it was queued against, so
 * queueing resolves each skill to a folder on this machine and digests it now.
 *
 * A team skill with no copy here cannot be evaluated at all after §6.3, so it is reported and left
 * OUT rather than queued as a paid run that would fail at 01:00 with nobody watching.
 */
export async function queueItemsFor(
  input: { home: string; config: Pick<Config, 'placements' | 'projects'>; stateRoot: string; team?: string; names: readonly string[]; requestedAt: string; window: 'overnight' | 'later' },
  report: (line: string) => void,
): Promise<EvalQueueItem[]> {
  const items: EvalQueueItem[] = [];
  for (const name of input.names) {
    const local = await resolveLibrarySkill(input.home, input.config, input.stateRoot, name);
    if (local === undefined) { report(`${name}: no copy of this skill on this machine, so it cannot be evaluated; install it first.`); continue; }
    // Symmetrical with the miss above: one folder that cannot be read costs that folder, not the
    // whole batch. Unguarded, a single unreadable directory threw out of the loop and every other
    // skill the user asked to queue was silently lost with it.
    let files;
    try { files = await sourceFiles(local.path); }
    catch (error) { report(`${name}: could not read ${local.path} (${error instanceof Error ? error.message : String(error)}), so it was not queued; the rest were.`); continue; }
    items.push({
      skill: local.name, path: local.path, contentHash: skillContentDigest(files.files),
      requestedAt: input.requestedAt, window: input.window,
      ...(input.team === undefined ? {} : { team: input.team }),
    });
  }
  return items;
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
    if (args.noGen || args.case !== undefined || args.triggersOnly || args.executionOnly || args.expectedVersion !== undefined || args.team !== undefined) return failure('Queue modes use the queued team and the full committed skill; per-skill selection flags are unavailable.');
    const store = args.config ?? createConfigStore();
    if (args.queueList || args.dequeue !== undefined) {
      const queue = args.dequeue === undefined ? await readEvalQueue(store.root, line => io.print(line)) : await dequeueEvals(store.root, args.dequeue, line => io.print(line));
      if (queue.items.length === 0) io.print('No queued evals.');
      // §6.6: a queued item is keyed on the BYTES it was queued against, and its team is optional.
      for (const item of queue.items) io.print(`${item.team === undefined ? '' : `${item.team}/`}${item.skill}@${item.contentHash} · ${item.window} · ${item.requestedAt}${item.lastError === undefined ? '' : ` · ${item.lastError}`}`);
      return success({ items: queue.items });
    }
    return await withEvalQueueLock(store.root, 'drain', async assertHeld => {
      const pending = (await readEvalQueue(store.root, line => io.print(line))).items.filter(item => args.window === undefined || item.window === args.window).slice(0, args.max);
      if (!pending.length) { io.print('No queued evals.'); return success({ items: (await readEvalQueue(store.root)).items, attempted: 0, completed: 0, failures: [] }); }
      let attempted = 0, completed = 0;
      const failures: { item: EvalQueueItem; error: string }[] = [];
      let probe: ReturnType<typeof systemPreflight> | undefined;
      const preflight: EvalArgs['preflight'] = model => probe ??= (args.preflight ?? systemPreflight)(model);
      const byId = new Map(pending.map(item => [queueKey(item), item]));
      io.print(`Evaluating ${pending.length} skills, ${args.parallel ?? EVAL_PARALLEL_DEFAULT} at a time…`);
      const batch = await runEvalBatch({
        // `version` is only a label here; §6.6 re-keyed the queue on content, so the content hash is
        // what identifies the queued bytes.
        items: pending.map(item => ({ id: queueKey(item), name: item.skill, version: item.contentHash })),
        parallel: args.parallel ?? EVAL_PARALLEL_DEFAULT, io,
        run: async (candidate, captured) => {
          const item = byId.get(candidate.id)!;
          assertHeld();
          if (!(await readEvalQueue(store.root)).items.some(current => queueKey(current) === queueKey(item) && current.requestedAt === item.requestedAt)) return failure('Item was dequeued before it started.');
          attempted += 1;
          let outcome: Result<EvalResult>;
          try { outcome = await (args.evaluate ?? run)({ ...args, config: store, ref: item.skill, ...(item.team === undefined ? {} : { team: item.team }), expectedVersion: item.contentHash, skipReceipted: true, preflight, lockWaitMs: EVAL_LOCK_WAIT_MS }, captured); }
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
