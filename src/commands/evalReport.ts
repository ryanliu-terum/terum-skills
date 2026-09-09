/** Offline eval read model: receipts own statistics; local logs only identify runs. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { receiptSchema, type Receipt } from '../lib/evals/receipt.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { failure, fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { findSkill } from '../lib/skills.js';
import { resolveVersion } from '../lib/version.js';
import { newestReceiptAt, receiptFiles } from './receiptCheck.js';

export interface EvalReportArgs extends WithForm { ref: string; team?: string; config?: ConfigStore; runner?: Runner; }
export interface ReceiptView extends Receipt { path: string; }
export interface EvalReport {
  skill: { id: string; name: string };
  versions: { placed: string | null; teamCurrent: string; evaluated: string | null };
  latest: ReceiptView | null;
  latestState: 'ok' | 'none' | 'invalid';
  history: { version: string; run_id: string; verdict: Receipt['verdict']; execution_status: Receipt['execution_status']; model: string; cc_version: string; runner_handle: string; timestamp: string; comparison: { win: number; loss: number; tie: number; net_lift: number; sign_p: number } | null; committed: true }[];
  localRuns: { run_id: string; run_dir: string; execution_status: 'complete' | 'partial' | 'failed' | 'unknown'; committed: boolean; receipt: ReceiptView | null }[];
}

export async function run(args: EvalReportArgs, io: Prompter): Promise<Result<EvalReport>> {
  try {
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const [teamName] = selectTeam(config.teams, args.team, args.form);
    const clone = resolve(store.teamClone(teamName));
    const record = await findSkill(clone, teamName, args.ref);
    if (!record) return failure(`No skill named or identified by ${args.ref} exists in team ${teamName}.`);
    const teamCurrent = await resolveVersion(clone, record.name, undefined, args.runner ?? systemRunner);
    const root = join(clone, 'evals', record.id);
    const currentDirectory = join(root, teamCurrent);
    let latest: ReceiptView | null = null;
    let latestState: EvalReport['latestState'] = 'none';
    try {
      const newest = await newestReceiptAt(currentDirectory);
      if (newest !== undefined) {
        const path = join(currentDirectory, newest.file);
        if (newest.receipt.skill_id.toLowerCase() !== record.id.toLowerCase() || newest.receipt.version !== teamCurrent) {
          throw new Error(`receipt ${path} does not match the receipt path: its skill ID or version disagrees.`);
        }
        latest = { ...newest.receipt, path };
        latestState = 'ok';
      }
    } catch (error) {
      latestState = 'invalid';
      // newestReceiptAt's error includes the absolute filename even when JSON cannot be parsed.
      io.print(`warning: the newest receipt is invalid (${error instanceof Error ? error.message : String(error)}); older receipts are listed in history only.`);
    }
    const history: EvalReport['history'] = [];
    for (const directory of await subdirectories(root)) {
      if (!/^[0-9a-f]{40}$/i.test(directory)) continue;
      for (const file of await receiptFiles(join(root, directory))) {
        const receipt = await readReceipt(join(root, directory, file));
        if (receipt === null) continue;
        history.push({ version: receipt.version, run_id: receipt.run_id, verdict: receipt.verdict, execution_status: receipt.execution_status, model: receipt.provenance.model, cc_version: receipt.provenance.cc_version, runner_handle: receipt.provenance.runner_handle, timestamp: receipt.provenance.timestamp, comparison: receipt.comparisons['candidate-vs-baseline'] ?? null, committed: true });
      }
    }
    history.sort(newestFirst);
    const localRoot = resolve(store.root, 'evals', teamName, record.id);
    const localRuns: EvalReport['localRuns'] = [];
    for (const run_id of await subdirectories(localRoot)) {
      const run_dir = join(localRoot, run_id);
      try { if (!(await stat(join(run_dir, 'run.jsonl'))).isFile()) continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const receipt = await readReceipt(join(run_dir, 'receipt.json'));
      localRuns.push({ run_id, run_dir, receipt, execution_status: receipt?.execution_status ?? 'unknown', committed: history.some(row => row.run_id === run_id) });
    }
    localRuns.sort(newestFirst);
    const placed = Object.values(config.placements).find(entry => entry.team === teamName && entry.id === record.id)?.version ?? null;
    return success({ skill: { id: record.id, name: record.name }, versions: { placed, teamCurrent, evaluated: latest?.version ?? null }, latest, latestState, history, localRuns });
  } catch (error) { return fromError(error); }
}

function newestFirst(a: { run_id: string }, b: { run_id: string }): number {
  return a.run_id > b.run_id ? -1 : a.run_id < b.run_id ? 1 : 0;
}

async function subdirectories(path: string): Promise<string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

async function readReceipt(path: string): Promise<ReceiptView | null> {
  try {
    const parsed = receiptSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return parsed.success ? { ...parsed.data, path } : null;
  } catch { return null; }
}
