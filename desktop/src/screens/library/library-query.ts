import type { SkillCard } from '../../backend/types';

/** The Library's search predicate, unchanged from the one the screen has always applied inline: name and
 *  description, case-insensitive substring. An empty query matches every card. It lived in the facet module
 *  until #212 (2026-09-14) took every facet out of the search rows; the query stayed. */
export function libraryQueryMatches(card: Pick<SkillCard, 'name' | 'desc'>, query: string): boolean {
  return (card.name + ' ' + card.desc).toLowerCase().includes(query.toLowerCase());
}
