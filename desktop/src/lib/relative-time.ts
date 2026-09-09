export type Clock = () => number;
export const FIXTURE_NOW = Date.parse('2026-09-06T00:00:00Z');
/** Only ISO instants enter the formatter; missing or invalid evidence is unknown. */
export function relativeTime(instant: string | null, now: Clock = Date.now): string {
 if (!instant || !/^\d{4}-\d{2}-\d{2}T/.test(instant)) return '—';
 const timestamp = Date.parse(instant); if (!Number.isFinite(timestamp)) return '—';
 const seconds = (timestamp - now()) / 1000;
 const [unit, divisor]: [Intl.RelativeTimeFormatUnit, number] = Math.abs(seconds) < 60 ? ['second',1] : Math.abs(seconds) < 3600 ? ['minute',60] : Math.abs(seconds) < 86400 ? ['hour',3600] : Math.abs(seconds) < 604800 ? ['day',86400] : Math.abs(seconds) < 2592000 ? ['week',604800] : Math.abs(seconds) < 31536000 ? ['month',2592000] : ['year',31536000];
 return new Intl.RelativeTimeFormat('en', { numeric:'always' }).format(Math.round(seconds/divisor), unit);
}
