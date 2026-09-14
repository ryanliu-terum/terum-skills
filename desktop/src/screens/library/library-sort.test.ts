import { expect, it } from 'vitest';
import type { SkillCard } from '../../backend/types';
import { parseSort, sortCards, SORT_LABELS, SORT_OPTIONS } from './library-sort';

/** Only the four fields the sort reads; the rest of a card is irrelevant to the order. */
function card(name: string, category = 'infra', updated: string | null = null): SkillCard {
  return { name, category, updated } as unknown as SkillCard;
}
const names = (cards: readonly SkillCard[]) => cards.map(c => c.name);

it('reads the default order from an absent, unknown or empty sort param', () => {
  expect(parseSort(new URLSearchParams())).toBe('updated');
  expect(parseSort(new URLSearchParams('sort=lift'))).toBe('updated');
  expect(parseSort(new URLSearchParams('sort='))).toBe('updated');
  expect(parseSort(new URLSearchParams('sort=toString'))).toBe('updated');
  expect(parseSort(new URLSearchParams('sort=name'))).toBe('name');
  expect(parseSort(new URLSearchParams('sort=category'))).toBe('category');
  // The button's visible text is the option's label, and the default label is the drawn string.
  expect(SORT_LABELS.updated).toBe('Recently updated');
  expect(SORT_OPTIONS.map(o => o.value)).toEqual(['updated', 'name', 'category']);
});

it('orders by name A–Z without mutating the input', () => {
  const input = [card('zebra'), card('Alpha'), card('mid'), card('alpha')];
  const sorted = sortCards(input, 'name');
  expect(names(sorted)).toEqual(['alpha', 'Alpha', 'mid', 'zebra']);
  expect(names(input)).toEqual(['zebra', 'Alpha', 'mid', 'alpha']);
  expect(sorted).not.toBe(input);
});

it('orders by category A–Z then by name inside a category', () => {
  const sorted = sortCards([card('b', 'ops'), card('z', 'docs'), card('a', 'ops'), card('y', 'docs')], 'category');
  expect(names(sorted)).toEqual(['y', 'z', 'a', 'b']);
});

// The pin that keeps the Library boards from moving: every card the mock serves has updated:null, so
// the default order must be the identity permutation of whatever the backend served.
it('leaves the incoming order untouched when no card carries a stamp', () => {
  const input = [card('deploy-check'), card('release-notes'), card('pr-review'), card('incident-triage'), card('api-docs')];
  expect(names(sortCards(input, 'updated'))).toEqual(names(input));
});

it('puts dated cards newest-first and keeps undated ones, in order, after them', () => {
  const input = [card('no-stamp-a'), card('older', 'infra', '2026-01-02T00:00:00.000Z'), card('no-stamp-b'), card('newest', 'infra', '2026-09-01T00:00:00.000Z'), card('middle', 'infra', '2026-05-05T12:00:00.000Z')];
  expect(names(sortCards(input, 'updated'))).toEqual(['newest', 'middle', 'older', 'no-stamp-a', 'no-stamp-b']);
});

it('treats an unparsable or empty stamp as no stamp rather than as the epoch', () => {
  const input = [card('garbage', 'infra', 'last Tuesday'), card('blank', 'infra', ''), card('real', 'infra', '2020-01-01T00:00:00.000Z')];
  expect(names(sortCards(input, 'updated'))).toEqual(['real', 'garbage', 'blank']);
});

it('keeps equal keys in their incoming order for every sort', () => {
  const same = '2026-03-03T00:00:00.000Z';
  const input = [card('c', 'ops', same), card('a', 'ops', same), card('b', 'ops', same)];
  // Equal stamps: the incoming order survives. Equal categories still fall through to the name.
  expect(names(sortCards(input, 'updated'))).toEqual(['c', 'a', 'b']);
  expect(names(sortCards(input, 'category'))).toEqual(['a', 'b', 'c']);
  expect(names(sortCards([], 'name'))).toEqual([]);
});
