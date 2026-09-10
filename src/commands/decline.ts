import { ConfigStore, createConfigStore } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { parseJson, personSchema } from '../lib/schema.js';
import { findSkill } from '../lib/skills.js';
import { openTeamRepo, type SafeWriteOptions, treeText, lockWait } from '../lib/teamRepo.js';
import { parseRef, teamForReference } from './install.js';

export interface DeclineArgs extends WithForm { ref: string; team?: string; config?: ConfigStore; runner?: Runner; safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>; }
export interface DeclineResult { handle: string; id: string; declined: true; }
export async function run(args: DeclineArgs, io: Prompter): Promise<Result<DeclineResult>> {
  try {
    const store = args.config ?? createConfigStore(), config = await store.read();
    const ref = parseRef(args.ref);
    const team = await teamForReference(config, ref.team ?? args.team, ref.remote, ref.name, args.form);
    const binding = config.teams[team]!;
    const skill = await findSkill(store.teamClone(team), team, ref.name);
    if (!skill) throw new Error(`No skill ${args.ref} in team ${team}.`);
    await openTeamRepo(store.teamClone(team), binding.remote, args.runner ?? systemRunner).safeWrite(tree => {
      const path = `people/${binding.handle}.json`, raw = tree.before(path);
      if (raw === undefined) throw new Error(`Missing ${path}.`);
      const person = parseJson(personSchema, treeText(raw), path);
      if (person.installed.some(item => item.id === skill.id)) throw new Error(`${skill.name} is installed; run uninstall-skill first.`);
      if (!person.declined.includes(skill.id)) {
        person.declined.push(skill.id);
        tree.set(path, `${JSON.stringify(person, null, 2)}\n`);
      }
    }, { action: 'decline', handle: binding.handle, ...args.safeWrite, ...lockWait(io) });
    io.print(`Declined ${skill.name} for ${binding.handle}.`);
    return success({ handle: binding.handle, id: skill.id, declined: true });
  } catch (error) { return fromError(error); }
}
