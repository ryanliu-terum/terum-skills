import { expect, it } from 'vitest';
import { libraryQueryMatches } from './library-query';

it('keeps the query predicate the screen has always used: name and description, case-insensitive, empty matches all', () => {
  const target = { name: 'deploy-check', desc: 'A pre-deploy checklist' };
  expect(libraryQueryMatches(target, '')).toBe(true);
  expect(libraryQueryMatches(target, 'DEPLOY')).toBe(true);
  expect(libraryQueryMatches(target, 'checklist')).toBe(true);
  expect(libraryQueryMatches(target, 'deploy prod')).toBe(false);
  expect(libraryQueryMatches({ name: 'x', desc: '' }, ' ')).toBe(true);
});
