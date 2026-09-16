import { roundHalfUp } from './pricing.js';

/**
 * Sales-tax rates by region code, as PERCENTS: 7.25 means 7.25 %.
 * Finance owns the numbers; keep README "Tax" in sync when they change.
 */
export const TAX_RATES = Object.freeze({
  'US-CA': 7.25,
  'US-TX': 8.25,
  'US-OR': 0,
  'CA-QC': 14.975,
  'GB': 20,
});

/** Region codes are matched case-insensitively and with surrounding whitespace ignored. */
export function normalizeRegion(region) {
  return String(region ?? '').trim().toUpperCase();
}

/** The configured rate for `region`; unknown regions throw rather than default to zero tax. */
export function taxRate(region) {
  const code = normalizeRegion(region);
  if (!Object.hasOwn(TAX_RATES, code)) {
    throw new RangeError(`taxRate: unknown region ${code || '(empty)'}`);
  }
  return TAX_RATES[code];
}

/** Tax owed on `amount` in `region`, rounded to cents. */
export function taxFor(amount, region) {
  const owed = amount * taxRate(region) / 100;
  return roundHalfUp(owed);
}

export function isTaxable(region) {
  return taxRate(region) > 0;
}
