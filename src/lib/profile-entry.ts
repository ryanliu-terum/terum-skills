/**
 * §9.3 — the curated `profile[]` list on a people file.
 *
 * `installed[]` is automatic and means *a copy is on a machine*; `profile[]` is curated and means
 * *I stand behind this*. D5 splits them deliberately, so publishing never writes `installed[]` and
 * this prompt is the only people-file write publish makes.
 */
import { Prompter } from './prompt.js';
import { parseJson, personSchema } from './schema.js';
import type { ConfigStore } from './config.js';
import type { Runner } from './runner.js';
import { openTeamRepo, treeText } from './teamRepo.js';

export interface ProfileEntryRequest {
  store: ConfigStore;
  clone: string;
  team: string;
  handle: string;
  remote: string;
  runner: Runner;
  id: string;
  name: string;
  /** The `v<N>` the skill now sits at — the minted one, or the identical one. Never null. */
  version: string;
  via: 'publish' | 'install';
  /** Pre-answers the prompt for the desktop and for tests. */
  preAnswered?: boolean;
}

/**
 * Asks once, default NO, and writes only on a yes. One entry per id: a re-add updates `version` and
 * `added` in place rather than appending a duplicate.
 */
export async function offerProfileEntry(request: ProfileEntryRequest, io: Prompter): Promise<boolean> {
  const yes = request.preAnswered ?? await io.confirm(`Add ${request.name} to your profile?`);
  if (!yes) return false;
  const repo = openTeamRepo(request.clone, request.remote, request.runner);
  const path = `people/${request.handle}.json`;
  await repo.safeWrite((tree) => {
    const source = tree.before(path);
    if (source === undefined) throw new Error(`Cannot add to your profile: ${path} is not in the team repository.`);
    const person = parseJson(personSchema, treeText(source), path);
    const profile = [...(person.profile ?? [])];
    const added = new Date().toISOString().slice(0, 10);
    const at = profile.findIndex((entry) => entry.id === request.id);
    const entry = { id: request.id, name: request.name, version: request.version, added, via: request.via };
    if (at === -1) profile.push(entry); else profile[at] = entry;
    tree.set(path, `${JSON.stringify({ ...person, profile }, null, 2)}\n`);
  }, { action: 'publish', handle: request.handle });
  return true;
}
