import { expect, it } from 'vitest';
import { roiFractions } from '../score-fractions';

it('normalizes both costs against the more expensive arm', () => {
  expect(roiFractions(0.4, 0.5)).toEqual([0.8, 1]);
  expect(roiFractions(0.5, 0.4)).toEqual([1, 0.8]);
});

it('returns null when either arm cost is missing', () => {
  expect(roiFractions(null, 0.5)).toBeNull();
  expect(roiFractions(0.4, null)).toBeNull();
  expect(roiFractions(undefined, 0.5)).toBeNull();
  expect(roiFractions(0.4, undefined)).toBeNull();
});

it('returns null when both costs are zero', () => {
  expect(roiFractions(0, 0)).toBeNull();
});

it('returns null for non-finite costs', () => {
  expect(roiFractions(Infinity, 0.5)).toBeNull();
  expect(roiFractions(0.4, NaN)).toBeNull();
});
