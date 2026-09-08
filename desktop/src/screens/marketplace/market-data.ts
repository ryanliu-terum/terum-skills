import type { SkillCard as Card } from '../../backend/types';
export function plural(n: number, word: string) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
export function rawGrants(skill: Card): string[] {
  // Catalog preserves raw fields at runtime, but SkillCard's public type omits grants. Validate before rendering them.
  if (!('grants' in skill)) return [];
  if (!Array.isArray(skill.grants) || !skill.grants.every((grant: unknown) => typeof grant === 'string')) throw new Error(`Catalog ${skill.name}.grants must contain strings.`);
  return skill.grants.filter((grant: unknown): grant is string => typeof grant === 'string');
}

export function activeFacets(raw: string | null | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) ? value : 0;
}
