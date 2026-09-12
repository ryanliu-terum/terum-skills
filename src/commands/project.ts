import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConfigStore, type ConfigStore } from '../lib/config.js';
import { addLibraryProject, projectPath, underProject } from '../lib/projects.js';
import { canonicalLedger, localSkillCounts, localSkills, nearestRepoRoot, type LocalInventory } from '../lib/local-skills.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, success, type Result } from '../lib/result.js';

/**
 * §7.1 L-PROJ — the Library's local project registry. Renamed from `checkout`: the sidebar's button
 * already said "Add project", and the word the user reads is the word the verb should use. The team
 * project creator this file's name used to belong to is now `team project create`.
 */
export interface ProjectArgs extends WithForm { kind: 'add' | 'remove' | 'list'; path?: string; config?: ConfigStore; home?: string; cwd?: string; }
export interface ProjectRow { path: string; label: string; rootState: LocalInventory['rootState']; skillFolders: number; }
export type ProjectResult = { path: string; label: string; added: boolean } | { path: string; placementsRemaining: number } | { projects: ProjectRow[] };

export async function run(args: ProjectArgs, io: Prompter): Promise<Result<ProjectResult>> {
  try {
    const store = args.config ?? createConfigStore();
    if (args.kind === 'add') {
      const cwd = args.cwd ?? process.cwd();
      const input = args.path ?? await io.text('Which folder?', await nearestRepoRoot(cwd) ?? cwd, { path: true });
      return success(await addLibraryProject(store, resolve(cwd, input), io, { home: args.home ?? homedir() }));
    }
    if (args.kind === 'remove') {
      if (args.path === undefined) throw new Error('Specify a project path.');
      const path = await projectPath(resolve(args.cwd ?? process.cwd(), args.path));
      let placementsRemaining = 0;
      await store.update(async config => {
        const registered = config.projects ?? [];
        const canonical = await Promise.all(registered.map(project => projectPath(project.root)));
        if (!canonical.includes(path)) throw new Error(`${path} is not in your library.`);
        const removed = registered.filter((_, index) => canonical[index] === path);
        config.projects = registered.filter((_, index) => canonical[index] !== path);
        const lexicalRoots = [path, resolve(args.cwd ?? process.cwd(), args.path!), ...removed.map(project => resolve(project.root))];
        placementsRemaining = (await Promise.all(Object.keys(config.placements).map(async target =>
          underProject(await projectPath(target), path) || lexicalRoots.some(root => underProject(resolve(target), root)),
        ))).filter(Boolean).length;
      }, { preserveUnchanged: true });
      io.print(`Removed ${path} from your library.`);
      io.print(`${placementsRemaining} placements recorded under ${path} stay in the ledger; uninstall-skill removes them.`);
      return success({ path, placementsRemaining });
    }
    const config = await store.read(); const ledger = await canonicalLedger(config);
    const projects = await Promise.all((config.projects ?? []).map(async project => {
      const inventory = await localSkills(join(project.root, '.claude', 'skills'), config, { scope: 'project', stateRoot: store.root, ledger });
      return { path: project.root, label: project.label, rootState: inventory.rootState, skillFolders: localSkillCounts(inventory).skillFolders };
    }));
    for (const project of projects) io.print(`${project.label} — ${project.path}; ${project.rootState}; ${project.skillFolders} skill folders`);
    if (!projects.length) io.print('none');
    return success({ projects });
  } catch (error) { return fromError(error); }
}
