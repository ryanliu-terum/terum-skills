import { describe, expect, it } from 'vitest';
import { verdictBand as engineBand } from '../../evals/stats.js';
import {
  adoption, applyRowCap, attentionCounts, displayName, evalEstimate, groupNotOffered, historyOrder, libraryOrder, libraryState, liftPercent, liftText,
  localRunsOrder, marketplaceOrder, parseVersionOrdinal, peopleOrder, projectsOrder, roiFractions, roundHalfEven, shortDescription, stripText,
  summariseReceipt, updateAvailable, verdictBand, verdictCounts,
} from '../policies.js';

describe('policies (§5) — the desktop\'s semantics', () => {
  it.each([[12.5, 12], [13.5, 14], [-12.5, -12], [-13.5, -14], [2.4, 2], [2.6, 3]])('rounds %s half to even', (n, expected) => expect(roundHalfEven(n)).toBe(expected));
  it('refuses a non-finite number', () => { expect(() => roundHalfEven(Number.POSITIVE_INFINITY)).toThrow(RangeError); });

  it.each([
    [4, 2, 0, 'PASS'], [3, 2, 1, 'NEUTRAL'], [1, 3, 2, 'FAIL'], [2, 2, 2, 'NEUTRAL'], [1, 0, 0, 'PASS'], [0, 1, 0, 'FAIL'], [0, 0, 0, null],
  ] as const)('bands %dW %dL %dT as %s', (w, l, t, band) => {
    expect(verdictBand(w, l, t)).toBe(band);
    if (band !== null) expect(engineBand(w, l, t)).toBe(band);
  });

  it('computes lift half-even and words its sign', () => {
    expect(liftPercent(4, 2, 0)).toBe(33); expect(liftText(33)).toBe('+33%');
    expect(liftPercent(1, 4, 1)).toBe(-50); expect(liftText(-50)).toBe('−50%');
    expect(liftPercent(2, 2, 2)).toBe(0); expect(liftText(0)).toBe('±0%');
    expect(liftPercent(0, 0, 0)).toBeNull(); expect(liftText(null)).toBe('—');
    expect(liftPercent(1, 0, 7)).toBe(12);   // 12.5 → 12 (half to even)
  });

  it('summarises one receipt from its candidate-vs-baseline comparison and keeps its own sign p', () => {
    const receipt = { verdict: 'PASS' as const, execution_status: 'partial' as const, expected_rows: 6, scored_rows: 4, comparisons: { 'candidate-vs-baseline': { win: 3, loss: 1, tie: 0, net_lift: 0.5, sign_p: 0.03125 }, 'candidate-vs-incumbent': { win: 1, loss: 1, tie: 2, net_lift: 0, sign_p: 1 } } };
    expect(summariseReceipt(receipt)).toEqual({ verdict: 'PASS', w: 3, l: 1, t: 0, n: 4, lift: 50, partial: [4, 6], signP: '0.031' });
    expect(summariseReceipt({ ...receipt, comparisons: {} })).toEqual({ verdict: 'PASS', w: 0, l: 0, t: 0, n: 0, lift: null, partial: [4, 6], signP: null });
    expect(summariseReceipt(null)).toBeNull();
    expect(stripText(4, 2, 0)).toBe('WWWWLL');
  });

  it('orders the marketplace by installs then name, the library by the state ladder then name', () => {
    const rows = [{ installs: 1, name: 'b' }, { installs: 3, name: 'z' }, { installs: 3, name: 'a' }];
    expect([...rows].sort(marketplaceOrder).map((r) => r.name)).toEqual(['a', 'z', 'b']);
    const lib = [
      { name: 'u', edited: false, tracked: false, known: false },
      { name: 'p', edited: false, tracked: true, known: true },
      { name: 'e', edited: true, tracked: true, known: true },
      { name: 'b', edited: false, tracked: false, known: false, problem: 'x' },
      { name: 's', edited: false, tracked: false, known: true },
      { name: 'a', edited: false, tracked: false, known: false },
    ];
    expect([...lib].sort(libraryOrder).map((r) => r.name)).toEqual(['b', 'e', 'p', 's', 'a', 'u']);
    expect(libraryState(lib[3]!)).toBe('broken'); expect(libraryState(lib[2]!)).toBe('edited'); expect(libraryState(lib[1]!)).toBe('placed'); expect(libraryState(lib[4]!)).toBe('shared'); expect(libraryState(lib[0]!)).toBe('untracked');
  });

  it('orders people by adoption of their authored skills, projects by member count, history by version then run', () => {
    const installs = new Map([['a', 5], ['b', 1]]);
    const people = [{ handle: 'zed', authored: ['b'] }, { handle: 'amy', authored: ['a'] }, { handle: 'bob', authored: ['a'] }, { handle: 'eve', authored: [] }];
    expect(adoption(people[0]!, installs)).toBe(1);
    expect([...people].sort(peopleOrder(installs)).map((p) => p.handle)).toEqual(['amy', 'bob', 'zed', 'eve']);
    const members = new Map([['x', 2], ['y', 3]]);
    expect([{ name: 'x' }, { name: 'z' }, { name: 'y' }].sort(projectsOrder(members)).map((p) => p.name)).toEqual(['y', 'x', 'z']);
    const history = [{ version: 'v2', run_id: '20260901T000000Z' }, { version: 'v10', run_id: '20260801T000000Z' }, { version: 'v2', run_id: '20260902T000000Z' }, { version: '—', run_id: '20260903T000000Z' }];
    expect([...history].sort(historyOrder).map((h) => `${h.version}/${h.run_id.slice(0, 8)}`)).toEqual(['v10/20260801', 'v2/20260902', 'v2/20260901', '—/20260903']);
    expect([{ run_id: 'b' }, { run_id: 'c' }, { run_id: 'a' }].sort(localRunsOrder).map((r) => r.run_id)).toEqual(['c', 'b', 'a']);
  });

  it('counts attention and verdicts without inventing zeros', () => {
    expect(attentionCounts([
      { localVerdict: 'FAIL', edited: false, broken: false }, { localVerdict: null, edited: true, broken: false }, { localVerdict: null, edited: false, broken: true }, { localVerdict: 'PASS', edited: false, broken: false },
    ])).toEqual({ failing: 1, notEvaluated: 1, edited: 1, attention: 3 });
    expect(verdictCounts(['PASS', null, 'FAIL', 'PASS', 'NEUTRAL'])).toEqual({ PASS: 2, NEUTRAL: 1, FAIL: 1, notEvaluated: 1 });
  });

  it('marks an update only when the viewer holds a numerically older v<N> folder', () => {
    expect(parseVersionOrdinal('v10')).toBe(10); expect(parseVersionOrdinal('v0')).toBeNull(); expect(parseVersionOrdinal(null)).toBeNull(); expect(parseVersionOrdinal('deadbeefcafe')).toBeNull();
    expect(updateAvailable('v3', 'v1')).toBe(true); expect(updateAvailable('v3', 'v3')).toBe(false); expect(updateAvailable('v3', null)).toBe(false); expect(updateAvailable('v3', 'deadbeefcafe')).toBe(false); expect(updateAvailable('v1', 'v3')).toBe(false);
  });

  it('caps rows and groups the not-offered list above five', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => i);
    expect(applyRowCap(thirty, 25)).toEqual({ rows: thirty.slice(0, 25), more: 5 });
    expect(applyRowCap(thirty, 'all')).toEqual({ rows: thirty, more: 0 });
    expect(applyRowCap([1, 2], 25)).toEqual({ rows: [1, 2], more: 0 });
    const six = [{ reason: 'symlink' }, { reason: 'invalid-yaml' }, { reason: 'symlink' }, { reason: 'symlink' }, { reason: 'failed' }, { reason: 'invalid-yaml' }];
    expect(groupNotOffered(six, 25)).toEqual({ grouped: true, groups: [{ reason: 'symlink', count: 3 }, { reason: 'invalid-yaml', count: 2 }, { reason: 'failed', count: 1 }] });
    expect(groupNotOffered(six, 'all')).toEqual({ grouped: false, groups: [] });
    expect(groupNotOffered(six.slice(0, 5), 25)).toEqual({ grouped: false, groups: [] });
  });

  it('shortens a description to its first sentence or 80 characters, on one line', () => {
    expect(shortDescription('Use this when a deploy needs a checklist. Then more text.')).toBe('Use this when a deploy needs a checklist.');
    expect(shortDescription('A'.repeat(100))).toBe(`${'A'.repeat(80)}…`);
    expect(shortDescription('line one\nline two.')).toBe('line one line two.');
    expect(shortDescription(null)).toBe('—'); expect(shortDescription('')).toBe('—');
    expect(shortDescription('Short. Second.', 5)).toBe('Short…');
    expect(displayName('Mira Chen <mira@example.com>')).toBe('Mira Chen'); expect(displayName('  anon ')).toBe('anon'); expect(displayName('')).toBe('—');
  });

  it('estimates an eval from per-arm efficiency and gives ROI fractions like the desktop', () => {
    expect(evalEstimate({ cases: 6, k: 1, efficiency: { candidate: { duration_ms: 30_000, cost_usd: 0.4 }, baseline: { duration_ms: 20_000, cost_usd: 0.3 } } })).toEqual({ cases: 6, k: 1, arms: 2, runs: 12, minutes: 5, dollars: 4 });
    expect(evalEstimate({ cases: 6, k: 1, efficiency: { candidate: { duration_ms: null, cost_usd: 0.4 } } })).toBeNull();
    expect(evalEstimate({ cases: 0, k: 1, efficiency: { candidate: { duration_ms: 1, cost_usd: 1 } } })).toBeNull();
    expect(roiFractions(0.4, 0.5)).toEqual([0.8, 1]); expect(roiFractions(0.5, 0.4)).toEqual([1, 0.8]);
    expect(roiFractions(null, 0.5)).toBeNull(); expect(roiFractions(0, 0)).toBeNull(); expect(roiFractions(Number.NaN, 1)).toBeNull();
  });
});
