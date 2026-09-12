/** Offline eval read model: receipts own statistics; local logs only identify runs. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { receiptSchema, type Receipt } from '../lib/evals/receipt.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { failure, fromError, type Result, success } from '../lib/result.js';
import type { Runner } from '../lib/runner.js';
import { findSkill, skillContentDigest } from '../lib/skills.js';
import { listVersions } from '../lib/teamRepo.js';
import { newestReceiptAt, receiptFiles } from '../lib/evals/receipt-store.js';
import { parseVersionFolder } from '../lib/versions.js';
import { resolveLibrarySkill } from '../lib/local-skills.js';
import { sourceFiles } from '../lib/skill-source.js';
import { homedir } from 'node:os';

export interface EvalReportArgs extends WithForm { ref: string; team?: string; config?: ConfigStore; runner?: Runner; /** The home the Library roots derive from (tests); defaults to homedir(). */ home?: string; }
export interface ReceiptView extends Receipt { path: string; }
export interface EvalReport {
  skill: { id: string; name: string };
  versions: { placed: string | null; teamCurrent: string | null; evaluated: string | null };
  latest: ReceiptView | null;
  latestState: 'ok' | 'none' | 'invalid';
  /**
   * §6.4(4) — the version the shown receipt actually came from when it is NOT the current one, so
   * the detail page's headline uses the same receipt the card did instead of quietly disagreeing
   * with it. Null when `latest` is the current version's own newest receipt, or when there is none.
   */
  fallbackFrom: string | null;
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
    // §6.4(1): no published version is an ordinary answer now, not a throw — the local runs are
    // still worth showing for a skill nobody has published yet.
    const teamCurrent = (await listVersions(clone, record.name))[0]?.folder ?? null;
    const root = join(clone, 'evals', record.id);
    let latest: ReceiptView | null = null;
    let latestState: EvalReport['latestState'] = 'none';
    try {
      const newest = teamCurrent === null ? undefined : await newestReceiptAt(join(root, teamCurrent));
      if (newest !== undefined && teamCurrent !== null) {
        const path = join(root, teamCurrent, newest.file);
        if (newest.receipt.skill_id?.toLowerCase() !== record.id.toLowerCase() || newest.receipt.version !== teamCurrent) {
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
      // §6.4(2): a version FOLDER, not a tree hash. `evals/` itself stays lowercase (§3.1).
      if (parseVersionFolder(directory) === null) continue;
      for (const file of await receiptFiles(join(root, directory))) {
        const receipt = await readReceipt(join(root, directory, file));
        if (receipt === null) continue;
        // A committed receipt always carries a version; the null arm is the local-run state.
        history.push({ version: receipt.version ?? '—', run_id: receipt.run_id, verdict: receipt.verdict, execution_status: receipt.execution_status, model: receipt.provenance.model, cc_version: receipt.provenance.cc_version, runner_handle: receipt.provenance.runner_handle, timestamp: receipt.provenance.timestamp, comparison: receipt.comparisons['candidate-vs-baseline'] ?? null, committed: true });
      }
    }
    // §6.4(4): version DESC then run-id DESC, so the rail groups by version instead of interleaving
    // two versions' runs by timestamp.
    history.sort(byVersionThenRun);
    // §6.4(4): when the current version has no receipt of its own, the newest one that IS valid is
    // shown — and `fallbackFrom` names where it came from, so the detail page cannot quietly
    // headline a different receipt than the card.
    let fallbackFrom: string | null = null;
    if (latest === null && latestState === 'none' && history.length) {
      const source = history[0]!;
      const found = await readReceipt(join(root, source.version, `${source.run_id}.json`));
      if (found !== null) { latest = found; latestState = 'ok'; fallbackFrom = source.version; }
    }
    // §6.4(3): new runs land in the CONTENT-KEYED store (§6.2). The legacy per-team tree is read too
    // and merged, display-only — §6.2 does not migrate it, so a report that read only the new store
    // would make every pre-upgrade run vanish from the Evals tab.
    const localRoots: string[] = [resolve(store.root, 'evals', teamName, record.id)];
    const local = await resolveLibrarySkill(args.home ?? homedir(), config, store.root, record.name).catch(() => undefined);
    if (local !== undefined) {
      const digest = skillContentDigest((await sourceFiles(local.path)).files);
      localRoots.unshift(resolve(store.root, 'evals', 'local', digest.replace(/^sha256:/, '')));
    }
    const localRuns: EvalReport['localRuns'] = [];
    const seen = new Set<string>();
    for (const localRoot of localRoots) {
      for (const run_id of await subdirectories(localRoot)) {
        const run_dir = join(localRoot, run_id);
        if (seen.has(run_id)) continue;
        try { if (!(await stat(join(run_dir, 'run.jsonl'))).isFile()) continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        seen.add(run_id);
        const receipt = await readReceipt(join(run_dir, 'receipt.json'));
        localRuns.push({ run_id, run_dir, receipt, execution_status: receipt?.execution_status ?? 'unknown', committed: history.some(row => row.run_id === run_id) });
      }
    }
    localRuns.sort(newestFirst);
    const placed = Object.values(config.placements).find(entry => entry.team === teamName && entry.id === record.id)?.version ?? null;
    return success({ skill: { id: record.id, name: record.name }, versions: { placed, teamCurrent, evaluated: latest?.version ?? null }, latest, latestState, fallbackFrom, history, localRuns });
  } catch (error) { return fromError(error); }
}

function newestFirst(a: { run_id: string }, b: { run_id: string }): number {
  return a.run_id > b.run_id ? -1 : a.run_id < b.run_id ? 1 : 0;
}

/** §6.4(4): version DESC, then run-id DESC. The version compare is NUMERIC: 'v10' < 'v2' lexically. */
function byVersionThenRun(a: { version: string; run_id: string }, b: { version: string; run_id: string }): number {
  const left = parseVersionFolder(a.version) ?? -1;
  const right = parseVersionFolder(b.version) ?? -1;
  return left === right ? newestFirst(a, b) : right - left;
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
