import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConfigStore, type ConfigStore } from '../lib/config.js';
import { checkoutPath, registerCheckout, underCheckout } from '../lib/checkouts.js';
import { canonicalLedger, localSkillCounts, localSkills, nearestRepoRoot, type LocalInventory } from '../lib/local-skills.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { failure, fromError, success, type Result } from '../lib/result.js';

import { DEFAULT_BUDGET_MS, DEFAULT_MAX_DEPTH, discoverSkillRoots, type DiscoverResult } from '../lib/discover.js';
import { printable } from '../lib/skill-source.js';

export interface CheckoutArgs extends WithForm { kind: 'add' | 'remove' | 'list' | 'discover'; path?: string; under?: string[]; depth?: number; budgetMs?: number; register?: boolean; config?: ConfigStore; home?: string; cwd?: string; }
export type CheckoutResult = { path: string; registered: boolean } | { path: string; placementsRemaining: number } | { checkouts: { path: string; rootState: LocalInventory['rootState']; skillFolders: number }[] } | DiscoverResult;

export async function run(args: CheckoutArgs, io: Prompter): Promise<Result<CheckoutResult>> {
  try {
    const store = args.config ?? createConfigStore();
    if (args.kind === 'add') {
      const cwd = args.cwd ?? process.cwd();
      const input = args.path ?? await io.text('Which folder?', await nearestRepoRoot(cwd) ?? cwd);
      return success(await registerCheckout(store, resolve(cwd, input), io, { home: args.home ?? homedir(), explicit: true }));
    }
    if (args.kind === 'remove') {
      if (args.path === undefined) throw new Error('Specify a checkout path.');
      const path = await checkoutPath(resolve(args.cwd ?? process.cwd(), args.path));
      let placementsRemaining = 0;
      await store.update(async config => {
        const registered = config.checkouts ?? [];
        const canonical = await Promise.all(registered.map(checkoutPath));
        if (!canonical.includes(path)) throw new Error(`${path} is not registered.`);
        const removed = registered.filter((_, index) => canonical[index] === path);
        config.checkouts = registered.filter((_, index) => canonical[index] !== path);
        const lexicalRoots = [path, resolve(args.cwd ?? process.cwd(), args.path!), ...removed.map(root => resolve(root))];
        placementsRemaining = (await Promise.all(Object.keys(config.placements).map(async target =>
          underCheckout(await checkoutPath(target), path) || lexicalRoots.some(root => underCheckout(resolve(target), root)),
        ))).filter(Boolean).length;
      }, { preserveUnchanged: true });
      io.print(`Removed ${path} from your library.`);
      io.print(`${placementsRemaining} placements recorded under ${path} stay in the ledger; uninstall-skill removes them.`);
      return success({ path, placementsRemaining });
    }
    if (args.kind === 'discover') {
      const depth = args.depth ?? DEFAULT_MAX_DEPTH;
      if (!Number.isInteger(depth) || depth < 0) return failure('--depth must be a non-negative integer.');
      const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS;
      if (!Number.isInteger(budgetMs) || budgetMs < 0) return failure('--budget-ms must be a non-negative integer.');
      const home = args.home ?? homedir();
      const cwd = args.cwd ?? process.cwd();
      const roots = (args.under?.length ? args.under : [home]).map((dir) => resolve(cwd, dir));
      const config = await store.read();
      const found = await discoverSkillRoots({
        under: roots, home, checkouts: config.checkouts ?? [], stateRoot: store.root, config,
        maxDepth: depth, budgetMs,
        onProgress: (progress) => io.progress?.({ step: 'discover', current: progress.scanned }),
      });
      io.print(`Looked in ${found.scanned} folders under ${roots.map(printable).join(', ')}…`);
      for (const candidate of found.candidates) io.print(`${printable(candidate.path)} — ${candidate.skillFolders} skill folders${candidate.registered ? ' · already registered' : ''}`);
      if (!found.candidates.length) io.print('none found');
      if (found.truncated) io.print(`(stopped after ${Math.round(budgetMs / 1000)} s; pass --budget-ms to look longer)`);
      for (const problem of found.problems) io.print(`Could not look in ${printable(problem.path)}: ${printable(problem.reason)}`);
      if (args.register) {
        for (const candidate of found.candidates) {
          if (candidate.registered) continue;
          try {
            await registerCheckout(store, candidate.path, io, { home, explicit: true });
            candidate.registered = true;
          } catch (error) {
            io.print(`Could not register ${printable(candidate.path)}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      return success(found);
    }
    const config = await store.read(); const ledger = await canonicalLedger(config);
    const checkouts = await Promise.all((config.checkouts ?? []).map(async path => {
      const inventory = await localSkills(join(path, '.claude', 'skills'), config, { scope: 'project', stateRoot: store.root, ledger });
      return { path, rootState: inventory.rootState, skillFolders: localSkillCounts(inventory).skillFolders };
    }));
    for (const root of checkouts) io.print(`${root.path} — ${root.rootState}; ${root.skillFolders} skill folders`);
    if (!checkouts.length) io.print('none');
    return success({ checkouts });
  } catch (error) { return fromError(error); }
}
