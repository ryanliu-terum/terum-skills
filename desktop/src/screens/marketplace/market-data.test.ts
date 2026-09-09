import { expect, it } from 'vitest';
import { plural } from './market-data';

it('pluralizes a dynamic count, singular at exactly one', () => {
  expect(plural(0, 'install')).toBe('0 installs');
  expect(plural(1, 'install')).toBe('1 install');
  expect(plural(2, 'install')).toBe('2 installs');
});

it('takes an irregular plural form for words that do not just append s', () => {
  expect(plural(1, 'category', 'categories')).toBe('1 category');
  expect(plural(10, 'category', 'categories')).toBe('10 categories');
});
