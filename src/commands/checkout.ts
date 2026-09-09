import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConfigStore, type ConfigStore } from '../lib/config.js';
import { checkoutPath, registerCheckout, underCheckout } from '../lib/checkouts.js';
import { canonicalLedger, localSkillCounts, localSkills, nearestRepoRoot, type LocalInventory } from '../lib/local-skills.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, success, type Result } from '../lib/result.js';

export interface CheckoutArgs extends WithForm { kind: 'add' | 'remove' | 'list'; path?: string; config?: ConfigStore; home?: string; cwd?: string; }
export type CheckoutResult = { path: string; registered: boolean } | { path: string; placementsRemaining: number } | { checkouts: { path: string; rootState: LocalInventory['rootState']; skillFolders: number }[] };

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
