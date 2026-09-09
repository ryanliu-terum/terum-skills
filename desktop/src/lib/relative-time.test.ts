import { expect, it } from 'vitest';
import { FIXTURE_NOW, relativeTime } from './relative-time';
it.each([['2026-09-05T00:00:00Z','1 day ago'],['2026-09-05T23:48:00Z','12 minutes ago'],['2026-09-07T00:00:00Z','in 1 day'],[null,'—'],['yesterday','—'],['invalid','—']])('formats only ISO evidence %s with the frozen fixture clock',(instant,expected)=>{expect(relativeTime(instant,()=>FIXTURE_NOW)).toBe(expected);});
it('uses the supplied clock each time rather than persisting a relative string',()=>{expect(relativeTime('2026-09-05T00:00:00Z',()=>FIXTURE_NOW+86400000)).toBe('2 days ago');});
