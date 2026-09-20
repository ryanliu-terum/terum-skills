/**
 * Money arithmetic for line items. Amounts are plain, non-negative numbers in
 * major units (12.5 === twelve fifty). Every function here that returns money
 * rounds through `roundHalfUp` so a total never carries binary-float dust.
 */

/** Round `value` to `places` decimals; ties round toward +∞ (Math.round). */
export function roundHalfUp(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Clamp `value` into the closed interval [min, max]. */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Amount a discount takes off ONE unit, rounded to cents.
 * `percent` values outside 0–100 are clamped; `fixed` never takes more than the price.
 */
export function discountAmount(unitPrice, discount) {
  if (discount == null) return 0;
  if (discount.type === 'percent') {
    const pct = clamp(discount.value, 0, 100);
    return roundHalfUp(unitPrice * (pct / 100));
  }
  if (discount.type === 'fixed') {
    return roundHalfUp(Math.min(unitPrice, discount.value));
  }
  throw new TypeError(`applyDiscount: unknown discount type ${String(discount.type)}`);
}

/** The discounted unit price (a number, rounded to cents). */
export function applyDiscount(unitPrice, discount) {
  if (discount == null) return unitPrice;
  const saved = discountAmount(unitPrice, discount);
  const price = roundHalfUp(unitPrice - saved);
  return price;
}

/** Total for a cart line: the discounted unit price times the quantity. */
export function lineTotal(line) {
  const unit = applyDiscount(line.unitPrice, line.discount);
  return roundHalfUp(unit * line.qty);
}
