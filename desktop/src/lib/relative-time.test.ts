import { expect, it } from 'vitest';
import { FIXTURE_NOW, relativeTime } from './relative-time';
it.each([['2026-09-05T00:00:00Z','1 day ago'],['2026-09-05T23:48:00Z','12 minutes ago'],['2026-09-07T00:00:00Z','in 1 day'],[null,'—'],['yesterday','—'],['invalid','—']])('formats only ISO evidence %s with the frozen fixture clock',(instant,expected)=>{expect(relativeTime(instant,()=>FIXTURE_NOW)).toBe(expected);});
it('uses the supplied clock each time rather than persisting a relative string',()=>{expect(relativeTime('2026-09-05T00:00:00Z',()=>FIXTURE_NOW+86400000)).toBe('2 days ago');});

it.each([
 ['2026-09-09T01:33:11-07:00', '1 day ago'],
 ['2026-09-10T08:32:41Z', '30 seconds ago'],
 ['2026-09-10T07:33:11Z', '1 hour ago'],
 ['2026-09-03T08:33:11Z', '1 week ago'],
 ['2026-08-11T08:33:11Z', '1 month ago'],
 ['2025-09-10T08:33:11Z', '1 year ago'],
 ['2026-99-99T00:00:00Z', '—'],
])('formats marketplace timestamps with a fixed clock: %s', (instant, expected) => {
 expect(relativeTime(instant, () => Date.parse('2026-09-10T08:33:11Z'))).toBe(expected);
});
