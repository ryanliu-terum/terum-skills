import { cartSubtotal, isEmpty } from './cart.js';
import { applyDiscount, lineTotal, roundHalfUp } from './pricing.js';
import { taxFor } from './tax.js';
import { dueDate, startOfUtcDay } from './dates.js';

export const DEFAULT_REGION = 'US-CA';
export const DEFAULT_TERMS = Object.freeze({ netDays: 30 });

let nextNumber = 1;

/** Tests and the nightly job reset the counter; production numbering comes from the ledger. */
export function resetNumbering(start = 1) {
  nextNumber = start;
}

/**
 * Build an invoice from a non-empty cart.
 *
 * @param {object} cart
 * @param {object} [options]
 * @param {object} [options.customer]  optional — walk-in sales have no customer record;
 *                                     when present it may carry `region`
 * @param {string} [options.region]    tax region; defaults to the customer's, then DEFAULT_REGION
 * @param {object} [options.discount]  optional order-level discount ({ type, value }), applied
 *                                     to the subtotal after line discounts
 * @param {Date|string} [options.issuedAt]  defaults to now
 * @param {object} [options.terms]     payment terms ({ netDays }); defaults to DEFAULT_TERMS
 */
export function buildInvoice(cart, options = {}) {
  if (isEmpty(cart)) throw new RangeError('buildInvoice: cart is empty');
  const { customer, discount, issuedAt = new Date(), terms = DEFAULT_TERMS } = options;
  const region = options.region ?? customer?.region ?? DEFAULT_REGION;

  const lines = cart.lines.map((line) => ({ ...line, total: lineTotal(line) }));
  const subtotal = cartSubtotal(cart);
  const discounted = applyDiscount(subtotal, discount);
  const discountAmount = roundHalfUp(subtotal - discounted);
  const tax = taxFor(discounted, region);
  const total = roundHalfUp(discounted + tax);
  const issued = startOfUtcDay(issuedAt);

  return {
    number: nextNumber++,
    customer: customer ?? null,
    region,
    lines,
    subtotal,
    discount: discountAmount,
    tax,
    total,
    issuedAt: issued,
    dueAt: dueDate(issued, terms.netDays),
  };
}
