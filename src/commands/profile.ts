import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { parseJson, personSchema, teamSchema } from '../lib/schema.js';
import { openTeamRepo, type SafeWriteOptions, treeText, lockWait } from '../lib/teamRepo.js';

export interface ProfileArgs extends WithForm { name?: string; bio?: string; role?: string; projects?: string[]; team?: string; config?: ConfigStore; runner?: Runner; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>; }
export interface ProfileResult { handle: string; changed: string[]; }

/** Owner-described metadata only; read the document and registry again on every retry. */
export async function run(args: ProfileArgs, io: Prompter): Promise<Result<ProfileResult>> {
  try {
    for (const field of ['email', 'github', 'handle']) if (Object.hasOwn(args, field)) throw new Error(`profile cannot change ${field}.`);
    const store = args.config ?? createConfigStore();
    const [team, binding] = selectTeam((await store.read()).teams, args.team, args.form);
    const outcome = await openTeamRepo(store.teamClone(team), binding.remote, args.runner ?? systemRunner).safeWrite(tree => {
      const path = `people/${binding.handle}.json`, raw = tree.before(path);
      if (raw === undefined) throw new Error(`Missing ${path}.`);
      const person = parseJson(personSchema, treeText(raw), path);
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
      const validated = personSchema.parse(person);
      if (changed.length) tree.set(path, `${JSON.stringify(validated, null, 2)}\n`);
      return changed;
    }, { action: 'profile', handle: binding.handle, ...args.safeWrite, ...lockWait(io) });
    if (args.name !== undefined) await store.update(config => { config.display_name = args.name; });
    io.print(outcome.returned.length ? `Updated ${binding.handle}: ${outcome.returned.join(', ')}.` : `No profile changes for ${binding.handle}.`);
    return success({ handle: binding.handle, changed: outcome.returned });
  } catch (error) { return fromError(error); }
}
