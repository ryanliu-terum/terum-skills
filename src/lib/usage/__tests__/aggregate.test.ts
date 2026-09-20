import { describe, expect, it } from 'vitest';
import { aggregate, type PlacedSkill } from '../aggregate.js';
import type { UsageEvent } from '../transcripts.js';

const WINDOW = { since: '2026-08-16T00:00:00.000Z', until: '2026-09-15T00:00:00.000Z' };
const placed = (name: string, placedAt: string | null = '2026-07-01T00:00:00.000Z'): PlacedSkill => ({ name, label: 'team', placedAt });
const fire = (kind: 'D1' | 'D2', skill: string, ts = '2026-09-01T00:00:00.000Z'): UsageEvent => ({ kind, skill, ts, entrypoint: 'cli' });

describe('aggregate — the four D1/D2 quadrants', () => {
  it('scores autonomy for a skill the model chose and a person also named', () => {
    const report = aggregate([fire('D1', 'a'), fire('D1', 'a'), fire('D2', 'a')], [placed('a')], WINDOW);
    expect(report.rows[0]).toMatchObject({ skill: 'a', d1: 2, d2: 1 });
    expect(report.rows[0]!.autonomy).toBeCloseTo(2 / 3);
  });

  it('scores autonomy 0 for the case the report exists to find — used, never chosen', () => {
    const report = aggregate([fire('D2', 'codex-spec'), fire('D2', 'codex-spec')], [placed('codex-spec')], WINDOW);
    expect(report.rows[0]).toMatchObject({ skill: 'codex-spec', d1: 0, d2: 2, autonomy: 0 });
  });

  it('scores autonomy 1 when only the model reached for it', () => {
    expect(aggregate([fire('D1', 'a')], [placed('a')], WINDOW).rows[0]).toMatchObject({ d1: 1, d2: 0, autonomy: 1 });
  });

  it('leaves autonomy null when it never fired — a ratio over nothing is not zero', () => {
    const report = aggregate([], [placed('a')], WINDOW);
    expect(report.rows[0]).toMatchObject({ skill: 'a', d1: 0, d2: 0, autonomy: null });
    expect(report.unused).toBe(1);
  });
});

describe('aggregate — the row set is the placements ledger (D1)', () => {
  it('zero-fills a placed skill that never fired', () => {
    expect(aggregate([], [placed('a'), placed('b')], WINDOW).rows.map((row) => row.skill)).toEqual(['a', 'b']);
  });

  it('gives a fired name with no placement no row, only an unrecognised entry', () => {
    const report = aggregate([fire('D1', 'artifact-design')], [placed('a')], WINDOW);
    expect(report.rows.map((row) => row.skill)).toEqual(['a']);
    expect(report.unrecognised).toEqual([{ skill: 'artifact-design', d1: 1, d2: 0 }]);
    // The conflation §2.2 names as the hazard: a bundled skill must never inflate the unused count.
    expect(report.unused).toBe(1);
  });

  it('excludes a skill placed after the window closed — it was never in the room', () => {
    const report = aggregate([], [placed('late', '2026-10-01T00:00:00.000Z')], WINDOW);
    expect(report.rows).toEqual([]);
    expect(report.unused).toBe(0);
  });

  it('ignores events outside the window on both edges', () => {
    const events = [fire('D1', 'a', '2026-08-15T23:59:59.000Z'), fire('D1', 'a', '2026-09-15T00:00:01.000Z')];
    expect(aggregate(events, [placed('a')], WINDOW).rows[0]).toMatchObject({ d1: 0, autonomy: null });
  });
});

describe('aggregate — availability is reconstructed, never assumed (§2.2)', () => {
  it('marks a skill placed mid-window as partial', () => {
    expect(aggregate([], [placed('a', '2026-09-01T00:00:00.000Z')], WINDOW).rows[0]!.availability).toBe('partial');
  });

  it('marks a skill placed before the window as full', () => {
    expect(aggregate([], [placed('a')], WINDOW).rows[0]!.availability).toBe('full');
  });

  it('says unknown rather than guessing when the ledger records no date', () => {
    expect(aggregate([], [placed('a', null)], WINDOW).rows[0]!.availability).toBe('unknown');
  });
});

describe('aggregate — order is the report argument', () => {
  it('puts never-chosen-but-used skills first and never-fired last', () => {
    const events = [fire('D2', 'handoff'), fire('D2', 'handoff'), fire('D1', 'chosen')];
    const report = aggregate(events, [placed('handoff'), placed('chosen'), placed('silent')], WINDOW);
    expect(report.rows.map((row) => row.skill)).toEqual(['handoff', 'chosen', 'silent']);
  });
});
