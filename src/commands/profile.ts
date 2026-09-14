import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { parseJson, teamSchema } from '../lib/schema.js';
import { librarySize } from '../lib/local-skills.js';
import { placementHome } from './install.js';
import { removeProfileEntry, writePersonFile } from '../lib/profile-entry.js';
import { openTeamRepo, type SafeWriteOptions, treeText, lockWait } from '../lib/teamRepo.js';

export interface ProfileArgs extends WithForm {
  name?: string; bio?: string; role?: string; projects?: string[];
  /**
   * D77: the inverse of the entry `publish` now writes with no question — a skill name (or its
   * uuid) to take off `profile[]`. §9.1 promised this as the only way to empty the list; publish
   * writing unasked is what made it owed rather than nice to have.
   */
  remove?: string;
  team?: string; config?: ConfigStore; runner?: Runner; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}
export interface ProfileResult { handle: string; changed: string[]; }

/** Owner-described metadata only; read the document and registry again on every retry. */
export async function run(args: ProfileArgs, io: Prompter): Promise<Result<ProfileResult>> {
  try {
    for (const field of ['email', 'github', 'handle']) if (Object.hasOwn(args, field)) throw new Error(`profile cannot change ${field}.`);
    const store = args.config ?? createConfigStore();
    const [team, binding] = selectTeam((await store.read()).teams, args.team, args.form);
    const localSkills = await librarySize(placementHome(store), await store.read(), store.root);
    const outcome = await openTeamRepo(store.teamClone(team), binding.remote, args.runner ?? systemRunner).safeWrite(tree => writePersonFile(tree, binding.handle!, person => {
      if (args.projects !== undefined) {
        const registry = tree.before('team.json');
        if (registry === undefined) throw new Error('Missing team.json.');
        const document = parseJson(teamSchema, treeText(registry), 'team.json');
        for (const project of args.projects) if (!Object.hasOwn(document.projects, project)) throw new Error(`Unknown project ${project}.`);
      }
      const changed: string[] = [];
      const fields = { display_name: args.name, bio: args.bio, role: args.role, projects: args.projects };
      for (const [key, value] of Object.entries(fields)) if (value !== undefined && JSON.stringify(person[key]) !== JSON.stringify(value)) {
        person[key] = value; changed.push(key);
      }
      if (args.remove !== undefined) {
        // Matched on the entry's own copy of the name, so removal needs no clone read and still
        // works for a skill whose folder is long gone from this machine.
        const entry = (person.profile ?? []).find(candidate => candidate.name === args.remove || candidate.id === args.remove);
        if (entry === undefined) throw new Error(`${args.remove} is not on your profile.`);
        removeProfileEntry(person, entry.id);
        changed.push(`profile (removed ${entry.name})`);
      }
      if (localSkills !== null) person.local_skills = localSkills;
      return changed;
    }), { action: 'profile', handle: binding.handle, ...args.safeWrite, ...lockWait(io) });
    if (args.name !== undefined) await store.update(config => { config.display_name = args.name; });
    io.print(outcome.returned.length ? `Updated ${binding.handle}: ${outcome.returned.join(', ')}.` : `No profile changes for ${binding.handle}.`);
    return success({ handle: binding.handle, changed: outcome.returned });
  } catch (error) { return fromError(error); }
}
