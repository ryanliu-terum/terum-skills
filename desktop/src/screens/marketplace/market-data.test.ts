import { expect, it } from 'vitest';
import { personPlaceNote, plural, pluralWord, rawGrants } from './market-data';
import type { SkillCard } from '../../backend/types';

it.each<[number, number, string]>([
  [1, 2, '1 of 2 on this machine · install places the other 1'],
  [2, 5, '2 of 5 on this machine · install places the other 3'],
  [0, 1, 'Install places 1 skill on this machine'],
  [0, 3, 'Install places 3 skills on this machine'],
  [0, 0, ''], [2, 2, ''],
])('composes placement notes for %i of %i', (placed, total, expected) => {
  expect(personPlaceNote([placed, total])).toBe(expected);
});
it.each([null, ['none'], []])('omits absent or empty tool grants %j', grants => {
  expect(rawGrants({ grants } as SkillCard)).toEqual([]);
});
it('keeps actual grants and rejects malformed preview data', () => {
  expect(rawGrants({ grants: ['Read', 'Bash'] } as SkillCard)).toEqual(['Read', 'Bash']);
  expect(() => rawGrants({ name: 'bad', grants: [12] } as unknown as SkillCard)).toThrow('Catalog bad.grants must contain strings.');
});

it('pluralWord returns the bare word so JSX can keep the board text-node split', () => {
  expect(pluralWord(1, 'skill')).toBe('skill');
  expect(pluralWord(0, 'skill')).toBe('skills');
  expect(pluralWord(2, 'person', 'people')).toBe('people');
  expect(plural(1, 'person', 'people')).toBe('1 person');
  expect(plural(3, 'skill')).toBe('3 skills');
});
