import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArmSample, ComparisonRow } from '../execution.js';
import { aggregate, renderReport, runIdFrom, writeRunTree } from '../results.js';

const row = (outcome: 'win' | 'loss' | 'tie', decidedBy = 'checks', comparison = 'candidate-vs-baseline'): ComparisonRow => ({
  skill: 's', kind: 'execution', case: 'c', rep: 0, comparison, outcome, decided_by: decidedBy, reason: '', checks_candidate: [], checks_opponent: [],
});

const sample = (arm: ArmSample['arm'], fraction: number | null, extra: Partial<ArmSample> = {}): ArmSample => ({
  kind: 'arm', case: 'c', rep: 0, arm, failed: false, retried: false, fraction, turns: 5, duration_ms: 10_000, cost_usd: 0.2, skill_list: null, model_id: null, ...extra,
});

describe('run ids (§4.2, rev 5)', () => {
  it('UTC timestamp — lexicographic order is chronological', () => {
    expect(runIdFrom(new Date(Date.UTC(2026, 8, 4, 22, 15, 0)))).toBe('20260904T221500Z');
  });
});

describe('aggregation (§5.3)', () => {
  it('rolls up comparisons, arm scores, efficiency means, and the verdict band', () => {
    const rows = [row('win'), row('win'), row('win'), row('win'), row('win'), row('loss'), row('tie'), row('tie'), row('tie')];
    const arms = [sample('candidate', 1), sample('candidate', 0.64), sample('baseline', 0.5), sample('baseline', 0.72, { turns: null })];
    const out = aggregate(rows, arms, 9);
    expect(out.comparisons['candidate-vs-baseline']).toMatchObject({ win: 5, loss: 1, tie: 3 });
    expect(out.comparisons['candidate-vs-baseline']!.net_lift).toBeCloseTo(0.444, 3);
    expect(out.comparisons['candidate-vs-baseline']!.sign_p).toBeCloseTo(0.219, 3);
    expect(out.arm_scores['candidate']).toBeCloseTo(0.82, 10);
    expect(out.arm_scores['baseline']).toBeCloseTo(0.61, 10);
    expect(out.efficiency['baseline']).toMatchObject({ turns: 5, duration_ms: 10_000 }); // null samples excluded from the mean
    expect(out).toMatchObject({ verdict: 'PASS', execution_status: 'complete', expected_rows: 9, scored_rows: 9 });
    expect(out.attribution).toContain('wins on execution checks');
  });

  it('never coerces partials: both-arms-failed rows are unscored holes (§5.4)', () => {
    const rows = [row('win'), row('tie', 'both-arms-failed'), row('tie', 'both-arms-failed')];
    const out = aggregate(rows, [sample('candidate', null)], 3);
    expect(out).toMatchObject({ execution_status: 'partial', scored_rows: 1, expected_rows: 3 });
    expect(out.arm_scores['candidate']).toBeNull(); // judge-only cases excluded; null when no checks
  });

  it('all failures → failed; no rows → NEUTRAL with no comparisons', () => {
    expect(aggregate([row('tie', 'both-arms-failed')], [], 1).execution_status).toBe('failed');
    expect(aggregate([], [], 0)).toMatchObject({ verdict: 'NEUTRAL', execution_status: 'complete', attribution: 'no execution comparisons ran' });
  });
});

describe('run tree (§4.2)', () => {
  it('writes meta line plus one line per row', async () => {
    const runDir = join(await mkdtemp(join(tmpdir(), 'run-')), '20260904T221500Z');
    await writeRunTree(runDir, { model: 'sonnet', k: 3 }, [row('win'), sample('candidate', 1)]);
    const lines = (await readFile(join(runDir, 'run.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ _meta: { model: 'sonnet', k: 3 } });
  });
});

describe('report rendering (§6)', () => {
  it('prints verdict, records, arm scores, trigger failures, and efficiency', () => {
    const out = aggregate([row('win'), row('loss', 'judge')], [sample('candidate', 1), sample('baseline', 0.5)], 2);
    const text = renderReport(out, {
      kind: 'triggers', skill: 's', tp: 5, fn: 0, fp: 1, tn: 5, recall: 1, precision: 5 / 6,
      rows: [{ prompt: 'sneaky near miss', expected: false, fired: true, selected: ['s'], correct: false }],
    });
    expect(text).toContain('verdict: NEUTRAL');
    expect(text).toContain('candidate-vs-baseline: +0% net lift (1W / 1L / 0T over 2 comparisons');
    expect(text).toContain('arm scores: candidate 1.00 · baseline 0.50');
    expect(text).toContain('triggers: recall=1.00 precision=0.83 (tp=5 fn=0 fp=1 tn=5)');
    expect(text).toContain('FALSE-FIRE: "sneaky near miss"');
    expect(text).toContain('efficiency: candidate 5.0 turns · 10.0s · $0.20');
  });

  it('greys a partial verdict with the scored counts (§5.4)', () => {
    const out = aggregate([row('win'), row('tie', 'both-arms-failed')], [], 2);
    expect(renderReport(out, null)).toContain('[partial — 1/2 scored]');
  });
});
