/**
 * §9.3 — the curated `profile[]` list on a people file.
 *
 * `installed[]` is automatic and means *a copy is on a machine*; `profile[]` is curated and means
 * *I stand behind this*. D5 splits them deliberately, so publishing never writes `installed[]` and
 * this prompt is the only people-file write publish makes.
 */
import { Prompter } from './prompt.js';
import { parseJson, personSchema, type Person } from './schema.js';
import type { ConfigStore } from './config.js';
import type { Runner } from './runner.js';
import { lockWait, openTeamRepo, treeText, type MutableTree, type SafeWriteOptions } from './teamRepo.js';

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
  localSkills?: number | null;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}

/**
 * Asks once, default NO, and writes only on a yes. One entry per id: a re-add updates `version` and
 * `added` in place rather than appending a duplicate.
 */
export async function offerProfileEntry(request: ProfileEntryRequest, io: Prompter): Promise<boolean> {
  const yes = request.preAnswered ?? (request.via === 'install' && !io.interactive ? false : await io.confirm(`Add ${request.name} to your profile?`));
  if (!yes) return false;
  const added = new Date().toISOString().slice(0, 10);
  await openTeamRepo(request.clone, request.remote, request.runner).safeWrite((tree) => {
    writePersonFile(tree, request.handle, person => {
      addProfileEntry(person, { id: request.id, name: request.name, version: request.version, added, via: request.via });
      if (request.localSkills != null) person.local_skills = request.localSkills;
    });
  }, { action: request.via, handle: request.handle, ...request.safeWrite, ...lockWait(io) });
  return true;
}

/** Pure read/validate/write path for the caller's people file; reads the current post-image. */
export function writePersonFile<T>(tree: MutableTree, handle: string, mutate: (person: Person) => T): T {
  const path = `people/${handle}.json`;
  const source = tree.after(path);
  if (source === undefined) throw new Error(`Missing ${path}.`);
  const person = parseJson(personSchema, treeText(source), path);
  const result = mutate(person);
  const validated = personSchema.parse(person);
  tree.set(path, `${JSON.stringify(validated, null, 2)}\n`);
  return result;
}

export function addProfileEntry(person: Person, entry: NonNullable<Person['profile']>[number]): void {
  const profile = person.profile ??= [];
  const at = profile.findIndex(candidate => candidate.id === entry.id);
  if (at === -1) profile.push(entry); else profile[at] = entry;
}

export function removeProfileEntry(person: Person, id: string): void {
  person.profile = (person.profile ?? []).filter(entry => entry.id !== id);
}
