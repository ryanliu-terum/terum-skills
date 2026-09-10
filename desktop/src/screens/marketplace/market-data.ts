import type { Person, SkillCard as Card } from '../../backend/types';
export function plural(n: number, word: string, words = word + 's') { return `${n} ${pluralWord(n, word, words)}`; }
/** The word alone. A JSX child written `{n}{' ' + pluralWord(n, w)}` keeps the board's `{n} word` text-node split, which subpixel text rendering is sensitive to. */
export function pluralWord(n: number, word: string, words = word + 's') { return n === 1 ? word : words; }
export function personPlaceNote([placed, total]: Person['onDisk']): string {
 if (placed > 0 && total > placed) return `${placed} of ${total} on this machine · install places the other ${total - placed}`;
 if (placed === 0 && total > 0) return `Install places ${plural(total, 'skill')} on this machine`;
 return '';
}
export function rawGrants(skill: Card): string[] {
  // Catalog preserves raw fields at runtime, but SkillCard's public type omits grants. Validate before rendering them.
  if (!('grants' in skill) || skill.grants === null) return [];
  if (!Array.isArray(skill.grants) || !skill.grants.every((grant: unknown) => typeof grant === 'string')) throw new Error(`Catalog ${skill.name}.grants must contain strings.`);
  return skill.grants.filter((grant: unknown): grant is string => typeof grant === 'string' && grant !== 'none');
}

export function activeFacets(raw: string | null | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) ? value : 0;
}

export function personStatus(person: Person): [string, string] {
 if (person.onDisk[1] === 0) return ['Nothing to install', `${person.handle} has no recorded installs to copy`];
 return person.onDisk[0] === person.onDisk[1] ? ['Installed', `${person.onDisk[0]} of ${person.onDisk[1]} skills on this machine`] : ['Not installed', person.placeNote];
}
