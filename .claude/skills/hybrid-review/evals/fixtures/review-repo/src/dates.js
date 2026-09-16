export const MS_PER_DAY = 86_400_000;

/** Midnight UTC of the calendar day containing `date` (a Date, timestamp, or ISO string). */
export function startOfUtcDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError(`startOfUtcDay: invalid date ${String(date)}`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** `days` whole days after the UTC day containing `date`. */
export function addDays(date, days) {
  if (!Number.isInteger(days)) throw new TypeError(`addDays: days must be an integer, got ${String(days)}`);
  return new Date(startOfUtcDay(date).getTime() + days * MS_PER_DAY);
}

/** The due date: `netDays` after the issue date, at midnight UTC. */
export function dueDate(issuedAt, netDays) {
  return addDays(issuedAt, netDays);
}

/**
 * An invoice is overdue from the day AFTER its due date; on the due date itself
 * it is still current (README "Terms"). Time of day is ignored on both sides.
 */
export function isOverdue(due, asOf = new Date()) {
  return startOfUtcDay(asOf).getTime() > startOfUtcDay(due).getTime();
}
