import { lineTotal, roundHalfUp } from './pricing.js';

/** Largest quantity a single line may hold; larger requests are capped, not rejected. */
export const MAX_LINE_QTY = 999;

export function createCart() {
  return { lines: [] };
}

export function isEmpty(cart) {
  return cart.lines.length === 0;
}

function assertQuantity(qty) {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`quantity must be a positive integer, got ${String(qty)}`);
  }
}

function findLine(cart, sku) {
  return cart.lines.find((line) => line.sku === sku);
}

/**
 * Add `item` ({ sku, name?, unitPrice, qty?, discount? }) to the cart. A SKU already in
 * the cart has its quantity increased (capped at MAX_LINE_QTY) and keeps its original
 * unit price and discount. Returns the line.
 */
export function addItem(cart, item) {
  const qty = item.qty ?? 1;
  assertQuantity(qty);
  const existing = findLine(cart, item.sku);
  if (existing) {
    existing.qty = Math.min(existing.qty + qty, MAX_LINE_QTY);
    return existing;
  }
  const line = {
    sku: item.sku,
    name: item.name ?? item.sku,
    unitPrice: item.unitPrice,
    qty: Math.min(qty, MAX_LINE_QTY),
    discount: item.discount,
  };
  cart.lines.push(line);
  return line;
}

/** Remove the line for `sku`; returns true when a line was removed. */
export function removeItem(cart, sku) {
  const index = cart.lines.findIndex((line) => line.sku === sku);
  if (index === -1) return false;
  cart.lines.splice(index, 1);
  return true;
}

/** Replace the quantity on an existing line (capped at MAX_LINE_QTY). */
export function setQuantity(cart, sku, qty) {
  assertQuantity(qty);
  const line = findLine(cart, sku);
  if (!line) throw new RangeError(`setQuantity: no line for sku ${sku}`);
  line.qty = Math.min(qty, MAX_LINE_QTY);
  return line;
}

/** Sum of the line totals, rounded to cents. */
export function cartSubtotal(cart) {
  const sum = cart.lines.reduce((acc, line) => acc + lineTotal(line), 0);
  return roundHalfUp(sum);
}

/** Number of units across all lines. */
export function itemCount(cart) {
  return cart.lines.reduce((acc, line) => acc + line.qty, 0);
}
