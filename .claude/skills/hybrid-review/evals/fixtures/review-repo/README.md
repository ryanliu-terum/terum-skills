# ledger-lite

Cart, pricing, tax and invoice arithmetic for a small storefront. Plain Node ESM,
no dependencies. Run the tests with `npm test` (or `node test/run.js`).

## Modules

| Module | Exports | Depends on |
| --- | --- | --- |
| `src/pricing.js` | `roundHalfUp`, `clamp`, `discountAmount`, `applyDiscount`, `lineTotal` | — |
| `src/cart.js` | `createCart`, `addItem`, `removeItem`, `setQuantity`, `cartSubtotal`, `itemCount`, `isEmpty`, `MAX_LINE_QTY` | pricing |
| `src/tax.js` | `TAX_RATES`, `normalizeRegion`, `taxRate`, `taxFor`, `isTaxable` | pricing |
| `src/dates.js` | `startOfUtcDay`, `addDays`, `dueDate`, `isOverdue`, `MS_PER_DAY` | — |
| `src/invoice.js` | `buildInvoice`, `resetNumbering`, `DEFAULT_REGION`, `DEFAULT_TERMS` | cart, pricing, tax, dates |

## Rules the code relies on

**Money.** Amounts are plain numbers in major units (`12.5` is twelve fifty) and are
never negative. Every function that returns money rounds through `roundHalfUp`
(ties round toward +∞, the `Math.round` convention), so a total never carries
binary-float dust. Known caveat: `roundHalfUp(1.005)` currently yields `1` because
`1.005 * 100` is `100.49999999999999` in binary floating point.

**Discounts.** A discount is `{ type: 'percent', value }` (clamped to 0–100) or
`{ type: 'fixed', value }` (never below zero). `applyDiscount(unitPrice, discount)`
returns the discounted **unit** price, rounded to cents; a line total is that unit
price times the quantity. Rounding per unit, not per line, is deliberate: it is what
the receipt printer shows.

**Quantities.** Integers from 1 to `MAX_LINE_QTY`. Adding a SKU that is already in
the cart increases that line's quantity (capped) and keeps its original price and
discount.

**Tax.** `TAX_RATES` holds sales-tax rates by region code as **percents**
(`7.25` means 7.25 %). `taxFor(amount, region)` is the tax owed, rounded to cents.
Unknown regions throw; a zero-rated region is a valid entry, not a missing one.

**Terms.** An invoice is due `netDays` after its issue date (midnight UTC). It is
overdue from the day **after** the due date: on the due date itself it is still
current. Explicit terms win, then the house default (`DEFAULT_TERMS`, net 30).
A customer record is optional — walk-in sales have none — and when present it may
carry a `region`.
