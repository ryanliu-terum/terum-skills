/**
 * §9.3 — the curated `profile[]` list on a people file.
 *
 * `installed[]` is automatic and means *a copy is on a machine*; `profile[]` is curated and means
 * *I stand behind this*. D5 splits them deliberately, so publishing never writes `installed[]` and
 * this entry is the only people-file write publish makes.
 *
 * D77 (Ryan, 2026-09-14): **publish writes the entry with no question.** Typing `publish` IS the
 * endorsement — the publisher chose the skill, the team and the project by hand — so a second
 * "Add <name> to your profile?" asked for consent that was already given, and its default-no
 * meant the ordinary path left the publisher's own profile empty. `install` still asks: installing
 * someone else's skill is a copy onto a machine, not a statement about the skill. Either entry is
 * reversible with `profile --remove`.
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
  /** Pre-answers `install`'s prompt for the desktop and for tests; `publish` never asks (D77). */
  preAnswered?: boolean;
  localSkills?: number | null;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}

/**
 * Writes the entry: unconditionally for `publish` (D77), and for `install` after asking once,
 * default NO — a non-interactive install declines rather than throwing on a question it cannot ask.
 * One entry per id: a re-add updates `version` and `added` in place rather than appending a duplicate.
 */
export async function recordProfileEntry(request: ProfileEntryRequest, io: Prompter): Promise<boolean> {
  const yes = request.via === 'publish' || (request.preAnswered ?? (io.interactive ? await io.confirm(`Add ${request.name} to your profile?`) : false));
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
