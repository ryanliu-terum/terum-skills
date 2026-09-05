import { describe, expect, it } from 'vitest';
import { netLift, signTest, summarize, verdictBand } from '../stats.js';

describe('sign test (VE5)', () => {
  it('degenerate and known values', () => {
    expect(signTest(0, 0)).toBe(1.0);
    expect(signTest(5, 1)).toBeCloseTo(0.219, 3); // the §5.3 example: 5W/1L → 0.21875
    expect(signTest(3, 0)).toBeCloseTo(0.25, 10); // §6.1: a 3/3 sweep cannot gate
    expect(signTest(10, 0)).toBeCloseTo(2 / 1024, 10);
  });

  it('is symmetric and capped at 1', () => {
    expect(signTest(5, 1)).toBe(signTest(1, 5));
    expect(signTest(7, 3)).toBe(signTest(3, 7));
    expect(signTest(1, 1)).toBeLessThanOrEqual(1);
    expect(signTest(2, 2)).toBeLessThanOrEqual(1);
  });
});

describe('net lift (VE5)', () => {
  it('ties dilute; empty is zero', () => {
    expect(netLift(0, 0, 0)).toBe(0);
    expect(netLift(2, 1, 1)).toBe(0.25);
    expect(netLift(2, 1, 5)).toBeCloseTo(1 / 8, 10);
    expect(netLift(0, 0, 5)).toBe(0);
    expect(netLift(5, 1, 3)).toBeCloseTo(0.444, 3); // the §5.3 example
  });
});

describe('verdict banding (§16.5)', () => {
  it('PASS ≥ +1/3, FAIL ≤ −1/3, NEUTRAL between — exact at the boundary', () => {
    expect(verdictBand(3, 0, 0)).toBe('PASS');
    expect(verdictBand(1, 0, 2)).toBe('PASS'); // exactly +1/3
    expect(verdictBand(2, 1, 6)).toBe('NEUTRAL');
    expect(verdictBand(0, 1, 2)).toBe('FAIL'); // exactly −1/3
    expect(verdictBand(0, 3, 0)).toBe('FAIL');
    expect(verdictBand(0, 0, 9)).toBe('NEUTRAL');
    expect(verdictBand(0, 0, 0)).toBe('NEUTRAL');
    expect(verdictBand(5, 1, 3)).toBe('PASS');
  });
});

describe('summary line', () => {
  it('prints the skilldeck shape', () => {
    expect(summarize(5, 1, 3)).toBe('+44% net lift (5W / 1L / 3T over 9 comparisons, sign test p=0.219)');
    expect(summarize(0, 0, 0)).toContain('+0% net lift');
  });
});
