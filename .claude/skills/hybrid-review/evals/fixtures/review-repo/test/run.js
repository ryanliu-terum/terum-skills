import assert from 'node:assert/strict';
import { applyDiscount, clamp, lineTotal, roundHalfUp } from '../src/pricing.js';
import {
  MAX_LINE_QTY, addItem, cartSubtotal, createCart, isEmpty, itemCount, removeItem, setQuantity,
} from '../src/cart.js';
import { isTaxable, taxFor, taxRate } from '../src/tax.js';
import { addDays, dueDate, isOverdue, startOfUtcDay } from '../src/dates.js';
import { DEFAULT_TERMS, buildInvoice, resetNumbering } from '../src/invoice.js';

let passed = 0;
const failed = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed.push(name);
    const message = error instanceof Error ? error.message : String(error);
    console.log(`not ok - ${name}\n    ${message.split('\n').join('\n    ')}`);
  }
}

const utc = (iso) => new Date(iso);

// ---- pricing -------------------------------------------------------------

test('roundHalfUp rounds ties up and keeps whole numbers intact', () => {
  assert.equal(roundHalfUp(2.5, 0), 3);
  assert.equal(roundHalfUp(0.125), 0.13);
  assert.equal(roundHalfUp(19.999), 20);
  assert.equal(roundHalfUp(10), 10);
  assert.equal(roundHalfUp(0.1 + 0.2), 0.3);
});

test('clamp bounds a value into [min, max]', () => {
  assert.equal(clamp(5, 1, 3), 3);
  assert.equal(clamp(-2, 0, 100), 0);
  assert.equal(clamp(50, 0, 100), 50);
});

test('lineTotal applies the discount per unit, then multiplies', () => {
  assert.equal(lineTotal({ unitPrice: 19.99, qty: 3 }), 59.97);
  assert.equal(lineTotal({ unitPrice: 19.99, qty: 3, discount: { type: 'percent', value: 10 } }), 53.97);
  assert.equal(lineTotal({ unitPrice: 19.99, qty: 2, discount: { type: 'fixed', value: 5 } }), 29.98);
  assert.equal(lineTotal({ unitPrice: 3, qty: 4, discount: { type: 'fixed', value: 5 } }), 0);
  assert.equal(lineTotal({ unitPrice: 10, qty: 1, discount: { type: 'percent', value: 150 } }), 0);
});

test('applyDiscount rejects an unknown discount type', () => {
  assert.throws(() => applyDiscount(10, { type: 'bogo', value: 1 }), TypeError);
});

// ---- cart ----------------------------------------------------------------

test('addItem merges a repeated SKU by adding quantities', () => {
  const cart = createCart();
  addItem(cart, { sku: 'WIDGET', unitPrice: 19.99, qty: 2 });
  addItem(cart, { sku: 'WIDGET', unitPrice: 24.99, qty: 3 });
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].qty, 5);
  assert.equal(cart.lines[0].unitPrice, 19.99, 'the first price wins');
});

test('addItem defaults the quantity to 1 and caps it at MAX_LINE_QTY', () => {
  const cart = createCart();
  assert.equal(addItem(cart, { sku: 'GIZMO', unitPrice: 5.5 }).qty, 1);
  addItem(cart, { sku: 'BULK', unitPrice: 1, qty: 998 });
  addItem(cart, { sku: 'BULK', unitPrice: 1, qty: 5 });
  assert.equal(cart.lines[1].qty, MAX_LINE_QTY);
});

test('setQuantity replaces the quantity on an existing line', () => {
  const cart = createCart();
  addItem(cart, { sku: 'WIDGET', unitPrice: 19.99, qty: 2 });
  assert.equal(setQuantity(cart, 'WIDGET', 7).qty, 7);
  assert.throws(() => setQuantity(cart, 'NOPE', 1), RangeError);
});

test('quantities must be positive integers', () => {
  const cart = createCart();
  assert.throws(() => addItem(cart, { sku: 'A', unitPrice: 1, qty: 0 }), RangeError);
  assert.throws(() => addItem(cart, { sku: 'A', unitPrice: 1, qty: 1.5 }), RangeError);
  assert.ok(isEmpty(cart));
});

test('cartSubtotal, itemCount and removeItem agree on the lines', () => {
  const cart = createCart();
  addItem(cart, { sku: 'WIDGET', unitPrice: 19.99, qty: 2 });
  addItem(cart, { sku: 'GIZMO', unitPrice: 5.5, qty: 1, discount: { type: 'percent', value: 10 } });
  assert.equal(cartSubtotal(cart), 44.93);
  assert.equal(itemCount(cart), 3);
  assert.equal(removeItem(cart, 'WIDGET'), true);
  assert.equal(removeItem(cart, 'WIDGET'), false);
  assert.equal(cartSubtotal(cart), 4.95);
});

// ---- tax -----------------------------------------------------------------

test('taxFor charges the configured rate for each region', () => {
  assert.equal(taxFor(100, 'US-CA'), 7.25);
  assert.equal(taxFor(100, 'US-TX'), 8.25);
  assert.equal(taxFor(100, 'US-OR'), 0);
  assert.equal(taxFor(59.99, 'GB'), 12);
  assert.equal(taxFor(1000, 'CA-QC'), 149.75);
});

test('region codes are normalized; unknown regions throw', () => {
  assert.equal(taxRate(' us-tx '), taxRate('US-TX'));
  assert.equal(isTaxable('US-OR'), false);
  assert.equal(isTaxable('GB'), true);
  assert.throws(() => taxFor(10, 'ZZ'), RangeError);
  assert.throws(() => taxFor(10, undefined), RangeError);
});

// ---- dates ---------------------------------------------------------------

test('startOfUtcDay and addDays work in whole UTC days', () => {
  assert.equal(startOfUtcDay('2026-03-10T15:30:00Z').toISOString(), '2026-03-10T00:00:00.000Z');
  assert.equal(addDays('2026-01-31', 1).toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(dueDate('2026-03-10T09:00:00Z', 30).toISOString(), '2026-04-09T00:00:00.000Z');
  assert.throws(() => addDays('2026-01-01', 1.5), TypeError);
});

test('isOverdue turns true the day after the due date, not on it', () => {
  const due = utc('2026-04-09T00:00:00Z');
  assert.equal(isOverdue(due, utc('2026-04-08T12:00:00Z')), false);
  assert.equal(isOverdue(due, utc('2026-04-09T00:00:00Z')), false);
  assert.equal(isOverdue(due, utc('2026-04-09T23:59:00Z')), false);
  assert.equal(isOverdue(due, utc('2026-04-10T00:00:00Z')), true);
});

// ---- invoice -------------------------------------------------------------

function sampleCart() {
  const cart = createCart();
  addItem(cart, { sku: 'WIDGET', name: 'Widget', unitPrice: 19.99 });
  addItem(cart, { sku: 'GIZMO', name: 'Gizmo', unitPrice: 5.5, discount: { type: 'percent', value: 10 } });
  return cart;
}

test('buildInvoice applies an order-level fixed discount before tax', () => {
  resetNumbering(1000);
  const invoice = buildInvoice(sampleCart(), {
    customer: { name: 'Ada', region: 'US-CA' },
    terms: { netDays: 14 },
    discount: { type: 'fixed', value: 5 },
    issuedAt: '2026-03-10T09:00:00Z',
  });
  assert.equal(invoice.number, 1000);
  assert.equal(invoice.subtotal, 24.94);
  assert.equal(invoice.discount, 5);
  assert.equal(invoice.tax, 1.45);
  assert.equal(invoice.total, 21.39);
  assert.equal(invoice.dueAt.toISOString(), '2026-03-24T00:00:00.000Z');
});

test('buildInvoice applies an order-level percent discount before tax', () => {
  const invoice = buildInvoice(sampleCart(), {
    customer: { name: 'Ada', region: 'US-CA' },
    discount: { type: 'percent', value: 10 },
    issuedAt: '2026-03-10T09:00:00Z',
  });
  assert.equal(invoice.discount, 2.49);
  assert.equal(invoice.tax, 1.63);
  assert.equal(invoice.total, 24.08);
});

test('a walk-in sale (no customer record) uses the house terms and region', () => {
  const invoice = buildInvoice(sampleCart(), { issuedAt: '2026-03-10T09:00:00Z' });
  assert.equal(invoice.customer, null);
  assert.equal(invoice.region, 'US-CA');
  assert.equal(invoice.dueAt.toISOString(), addDays('2026-03-10', DEFAULT_TERMS.netDays).toISOString());
});

test('a customer without negotiated terms gets the house terms; their region wins', () => {
  const invoice = buildInvoice(sampleCart(), {
    customer: { name: 'Grace', region: 'GB' },
    issuedAt: '2026-03-10T09:00:00Z',
  });
  assert.equal(invoice.region, 'GB');
  assert.equal(invoice.dueAt.toISOString(), '2026-04-09T00:00:00.000Z');
});

test('buildInvoice refuses an empty cart', () => {
  assert.throws(() => buildInvoice(createCart()), RangeError);
});

// ---- summary -------------------------------------------------------------

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.log(failed.map((name) => `  FAIL ${name}`).join('\n'));
  process.exit(1);
}
