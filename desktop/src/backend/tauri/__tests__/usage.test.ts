import { describe, expect, it } from 'vitest';
import { cliUsage, mapUsage, type CliUsage } from '../usage';

const report = (rows: CliUsage['rows']): CliUsage => ({
  since: '2026-08-16T00:00:00.000Z', until: '2026-09-15T00:00:00.000Z',
  rows, unused: 0, unrecognised: [], caveats: ['Counts are invocations, not outcome-changing uses; reopenings are not deduped.'],
});
const row = (skill: string, d1: number, d2: number, availability: 'full' | 'partial' | 'unknown' = 'full'): CliUsage['rows'][number] =>
  ({ skill, label: 'team', d1, d2, autonomy: d1 + d2 === 0 ? null : d1 / (d1 + d2), availability });

describe('mapUsage — never-installed and never-fired are different answers', () => {
  it('returns null firings for a skill with no placement on this machine', () => {
    expect(mapUsage(report([row('other', 1, 0)]), 'deploy-check').firings).toBeNull();
  });

  it('returns zeroed firings — NOT null — for a skill placed here that never fired', () => {
    // The case the whole feature exists to surface. Collapsing it into null throws it away.
    expect(mapUsage(report([row('deploy-check', 0, 0)]), 'deploy-check').firings).toEqual({ d1: 0, d2: 0, autonomy: null, availability: 'full' });
  });

  it('carries the autonomy ratio for the used-but-never-chosen case', () => {
    expect(mapUsage(report([row('codex-spec', 0, 4)]), 'codex-spec').firings).toMatchObject({ d1: 0, d2: 4, autonomy: 0 });
  });

  it('carries the window and every caveat through unchanged', () => {
    const model = mapUsage(report([row('a', 1, 1)]), 'a');
    expect(model.since).toBe('2026-08-16T00:00:00.000Z');
    expect(model.caveats[0]).toContain('invocations, not outcome-changing uses');
  });

  it('preserves a partial-window placement rather than flattening it to full', () => {
    expect(mapUsage(report([row('a', 0, 1, 'partial')]), 'a').firings?.availability).toBe('partial');
  });
});

describe('cliUsage — a read degrades rather than throws', () => {
  it('accepts unknown fields from a newer CLI', () => {
    const parsed = cliUsage.parse({ ...report([row('a', 1, 0)]), archived: 3, usedArchive: false, somethingNew: true });
    expect(parsed.rows[0]!.skill).toBe('a');
  });

  it('rejects a payload missing the fields the panel reads', () => {
    expect(() => cliUsage.parse({ since: 'x', until: 'y', rows: [{ skill: 'a' }], unused: 0, unrecognised: [], caveats: [] })).toThrow();
  });

  it('rejects an availability value the panel has no branch for', () => {
    expect(() => cliUsage.parse(report([{ skill: 'a', label: 'team', d1: 0, d2: 0, autonomy: null, availability: 'sometimes' } as never]))).toThrow();
  });
});
