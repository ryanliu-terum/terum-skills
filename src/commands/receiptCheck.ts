import type { WithForm } from '../lib/invocation.js';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { receiptSchema, Receipt } from '../lib/evals/receipt.js';
import { verdictBand } from '../lib/evals/stats.js';
import { Prompter } from '../lib/prompt.js';
import { fromError, failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { teamSchema } from '../lib/schema.js';
import { readTeam, skillRecords } from '../lib/skills.js';

export interface ReceiptCheckArgs extends WithForm { cwd?: string; base?: string; runner?: Runner; }
export interface ReceiptCheckResult { endorsed: string[]; checked: number; }

type CheckedReceipt = { file: string; receipt: Receipt };

/** Hidden CI entry point: validate the deterministic publish-PR receipt predicate (§6.1). */
export async function run(args: ReceiptCheckArgs, io: Prompter): Promise<Result<ReceiptCheckResult>> {
  try {
    const cwd = resolve(args.cwd ?? '.');
    const base = args.base ?? 'origin/main';
    const runner = args.runner ?? systemRunner;
    const before = await runner.run('git', ['show', `${base}:team.json`], { cwd });
    if (before.code !== 0) throw new Error(`Could not read ${base}:team.json: ${(before.stderr || before.stdout).trim()}`);
    const baseTeam = teamSchema.parse(JSON.parse(before.stdout));
    const current = await readTeam(cwd);
    const endorsed = addedEndorsements(baseTeam, current);
    if (endorsed.length === 0) return failure('Publish PR must endorse at least one skill; team.json adds no global or project skill IDs.', { endorsed, checked: 0 });

    const records = await skillRecords(cwd, 'checkout');
    const failures: string[] = [];
    for (const id of endorsed) {
      const record = records.find((candidate) => candidate.id === id);
      if (!record) {
        const line = `${id}: FAIL — endorsed skill is absent or has invalid metadata in HEAD.`;
        io.print(line); failures.push(line); continue;
      }
      const outcome = await checkSkill({ cwd, base, id, name: record.name, runner });
      io.print(`${record.name}: ${outcome.ok ? 'PASS' : 'FAIL'} — ${outcome.message}`);
      if (!outcome.ok) failures.push(`${record.name}: ${outcome.message}`);
    }
    if (failures.length) return failure(`Receipt check failed:\n${failures.join('\n')}`, { endorsed, checked: endorsed.length });
    return success({ endorsed, checked: endorsed.length });
  } catch (error) { return fromError(error); }
}

/** Per-scope diff: adding an already-project-endorsed skill to global (or another project) is
 *  still an endorsement — a flattened set comparison would hide it (review P2). */
function addedEndorsements(base: { global: string[]; projects: Record<string, { skills: string[] }> }, current: { global: string[]; projects: Record<string, { skills: string[] }> }): string[] {
  const added = new Set<string>();
  const baseGlobal = new Set(base.global);
  for (const id of current.global) if (!baseGlobal.has(id)) added.add(id);
  for (const [key, project] of Object.entries(current.projects)) {
    const prior = new Set(base.projects[key]?.skills ?? []);
    for (const id of project.skills) if (!prior.has(id)) added.add(id);
  }
  return [...added].sort();
}

async function checkSkill(input: { cwd: string; base: string; id: string; name: string; runner: Runner }): Promise<{ ok: boolean; message: string }> {
  try {
    const versionResult = await input.runner.run('git', ['rev-parse', `HEAD:skills/${input.name}`], { cwd: input.cwd });
    if (versionResult.code !== 0) return { ok: false, message: `could not resolve HEAD:skills/${input.name}: ${(versionResult.stderr || versionResult.stdout).trim()}` };
    const version = versionResult.stdout.trim();
    const root = join(input.cwd, 'evals', input.id);
    const newest = await newestReceiptAt(join(root, version));
    if (newest === undefined) {
      const other = await validReceiptsOutsideVersion(root, version);
      return { ok: false, message: other ? `stale receipt: receipts exist for ${input.id}, but none are at current tree hash ${version}.` : `missing receipt at current tree hash ${version}.` };
    }
    // z.uuid() admits either hex case, so the id compare is tolerant — matching the README lookup.
    if (newest.receipt.skill_id.toLowerCase() !== input.id.toLowerCase() || newest.receipt.version !== version) return { ok: false, message: `newest receipt ${newest.file} does not match the receipt path: its skill ID or version disagrees.` };

    const incumbent = newest.receipt.comparisons['candidate-vs-incumbent'];
    if (incumbent !== undefined) {
      // §16.7: the publish gate bands the INCUMBENT comparison itself. The receipt's top-level
      // verdict bands candidate-vs-baseline (§16.5) and is informational at PR time — a candidate
      // that beats baseline but regresses against the incumbent must still block.
      return verdictBand(incumbent.win, incumbent.loss, incumbent.tie) === 'FAIL'
        ? { ok: false, message: 'candidate-vs-incumbent comparison bands FAIL.' }
        : { ok: true, message: `current receipt ${newest.file} carries a non-FAIL incumbent comparison.` };
    }

    const priorReceipt = await validReceiptsOutsideVersion(root, version);
    const baseSkill = await input.runner.run('git', ['rev-parse', '--verify', `${input.base}:skills/${input.name}`], { cwd: input.cwd });
    if (priorReceipt || baseSkill.code === 0) return { ok: false, message: 'prior version exists, but the current receipt has no candidate-vs-incumbent comparison.' };
    return { ok: true, message: `first publish accepted with current receipt ${newest.file}.` };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
}

/** Receipts select by filename order. A malformed newest file fails closed rather than hiding behind an older run. */
export async function receiptFiles(directory: string): Promise<string[]> {
  let names: string[];
  try { names = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return names;
}

/** The displayed/gating receipt is the lexicographically latest run for this exact version. */
export async function newestReceiptAt(directory: string): Promise<CheckedReceipt | undefined> {
  const file = (await receiptFiles(directory)).at(-1);
  if (file === undefined) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(directory, file), 'utf8')); }
  catch { throw new Error(`schema-invalid receipt ${join(directory, file)}: invalid JSON.`); }
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`schema-invalid receipt ${join(directory, file)}.`);
  return { file, receipt: parsed.data };
}

async function hasSchemaValidReceipt(directory: string): Promise<boolean> {
  for (const file of await receiptFiles(directory)) {
    try {
      const parsed = receiptSchema.safeParse(JSON.parse(await readFile(join(directory, file), 'utf8')));
      if (parsed.success) return true;
    } catch { /* An invalid historical file is not evidence of a prior evaluated version. */ }
  }
  return false;
}

async function validReceiptsOutsideVersion(root: string, currentVersion: string): Promise<boolean> {
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === currentVersion) continue;
    if (await hasSchemaValidReceipt(join(root, entry.name))) return true;
  }
  return false;
}
