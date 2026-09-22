import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArmSample, ComparisonRow } from '../execution.js';
import { aggregate, caseRunTally, perCaseRows, renderReport, runIdFrom, writeRunTree } from '../results.js';

const row = (outcome: 'win' | 'loss' | 'tie', decidedBy = 'checks', comparison = 'candidate-vs-baseline', extra: Partial<ComparisonRow> = {}): ComparisonRow => ({
  skill: 's', kind: 'execution', case: 'c', rep: 0, comparison, outcome, decided_by: decidedBy, reason: '', checks_candidate: [], checks_opponent: [], ...extra,
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

  it('excludes either dead arm from all scored summaries and case-runs', () => {
    const out = aggregate([row('win'), row('tie', 'candidate-run-failed', 'candidate-vs-baseline')], [sample('candidate', 1), sample('baseline', 0), sample('candidate', null, { case: 'dead', rep: 0, failed: true }), sample('baseline', 1, { case: 'dead', rep: 0 })], 2);
    expect(out).toMatchObject({ execution_status: 'partial', scored_rows: 1, verdict: 'PASS' });
    expect(out.comparisons['candidate-vs-baseline']).toMatchObject({ win: 1, loss: 0, tie: 0 });
    expect(out.per_case.map((entry) => entry.case)).toEqual(['c']);
    expect(out.case_runs).toEqual({ candidate: { passed: 0, total: 0 }, baseline: { passed: 0, total: 0 } });
  });

  it('a dead arm carries no score: its empty-transcript fraction never enters arm_scores', () => {
    const out = aggregate(
      [row('win'), row('tie', 'opponent-run-failed', 'candidate-vs-incumbent'), row('win', 'checks', 'candidate-vs-baseline', { case: 'd', rep: 0 })],
      [sample('candidate', 1), sample('baseline', 0), sample('incumbent', 0, { failed: true }), sample('candidate', 1, { case: 'd', rep: 0 }), sample('baseline', 1, { case: 'd', rep: 0 })],
      3,
    );
    expect(out.scored_rows).toBe(2);
    expect(out.arm_scores).toEqual({ candidate: 1, baseline: 0.5 });
    expect(out.efficiency['incumbent']).toBeUndefined();
  });

  it('all failures → failed; no rows → NEUTRAL with no comparisons', () => {
    expect(aggregate([row('tie', 'both-arms-failed')], [], 1).execution_status).toBe('failed');
    expect(aggregate([], [], 0)).toMatchObject({ verdict: 'NEUTRAL', execution_status: 'complete', attribution: 'no execution comparisons ran' });
  });

  it('fixes sign p at 1.0 for any receipt containing suite rows because a session is not independent', () => {
    expect(aggregate([row('win'), row('win')], [sample('candidate', 1), sample('baseline', 0)], 2).comparisons['candidate-vs-baseline']!.sign_p).not.toBe(1);
    expect(aggregate([row('win'), row('win')], [sample('candidate', 1), sample('baseline', 0)], 2, {}, {}, true).comparisons['candidate-vs-baseline']!.sign_p).toBe(1);
  });

  it('environment skips grey the verdict and print in the report (§7.1 rev 8)', () => {
    const out = aggregate([row('win')], [sample('candidate', 1)], 3, { xlsx: ['python3:openpyxl'] });
    expect(out.execution_status).toBe('partial'); // skipped case's rows are unscored holes
    expect(out.environment_skips).toEqual({ xlsx: ['python3:openpyxl'] });
    const text = renderReport(out, null);
    expect(text).toContain('skipped (environment): xlsx — missing python3:openpyxl');
    expect(text).toContain('[partial — 1/3 scored]');
  });

  it('dropped cases grey the verdict and the report names each one with its kind (eval-gen D4)', () => {
    const out = aggregate([row('win')], [sample('candidate', 1)], 3, {}, { 'no-agents-md': { kind: 'setup', detail: 'setup failed (rc=127): /bin/sh: No: command not found' }, 'abs-path': { kind: 'staging', detail: 'unsafe file path in case: /tmp/x' } });
    expect(out).toMatchObject({ execution_status: 'partial', scored_rows: 1, expected_rows: 3 });
    expect(Object.keys(out.dropped_cases)).toEqual(['no-agents-md', 'abs-path']);
    const text = renderReport(out, null);
    expect(text).toContain('dropped (setup): no-agents-md — setup failed (rc=127): /bin/sh: No: command not found');
    expect(text).toContain('dropped (staging): abs-path — unsafe file path in case: /tmp/x');
  });
});

describe('per-case rows and the case-run tally (§5.3 rev 20)', () => {
  const check = (name: string, passed: boolean) => ({ name, passed, detail: passed ? '' : `${name} did not hold — matched: ["rm -rf /"]` });
  const rows: ComparisonRow[] = [
    // rep 0: candidate passes every check, baseline fails one → decided by checks.
    { ...row('win'), case: 'summary', rep: 0, checks_candidate: [check('file_exists:summary.md', true), check('transcript_mentions:openpyxl', true)], checks_opponent: [check('file_exists:summary.md', false), check('transcript_mentions:openpyxl', true)] },
    // rep 1: both arms miss a check → checks-equal, tie.
    { ...row('tie', 'checks-equal-no-judge'), case: 'summary', rep: 1, checks_candidate: [check('file_exists:summary.md', false), check('transcript_mentions:openpyxl', true)], checks_opponent: [check('file_exists:summary.md', false), check('transcript_mentions:openpyxl', false)] },
    // a judge-only case has no checks: nobody's verdict can be stated.
    { ...row('win', 'judge'), case: 'tone', rep: 0, checks_candidate: [], checks_opponent: [] },
    // the incumbent comparison shares the candidate's checks and supplies the incumbent's own.
    { ...row('loss', 'checks', 'candidate-vs-incumbent'), case: 'summary', rep: 0, checks_candidate: [check('file_exists:summary.md', true), check('transcript_mentions:openpyxl', true)], checks_opponent: [check('file_exists:summary.md', true), check('transcript_mentions:openpyxl', true)] },
  ];
  const arms: ArmSample[] = [
    sample('candidate', 1, { case: 'summary', rep: 0 }), sample('baseline', 0.5, { case: 'summary', rep: 0 }), sample('incumbent', 1, { case: 'summary', rep: 0 }),
    sample('candidate', 0.5, { case: 'summary', rep: 1 }), sample('baseline', 0, { case: 'summary', rep: 1 }),
    sample('candidate', null, { case: 'tone', rep: 0 }), sample('baseline', null, { case: 'tone', rep: 0 }),
  ];

  it('folds rows and arm samples into one entry per (case × rep), in execution order, with [name, passed] per check and no detail string', () => {
    const perCase = perCaseRows(rows, arms);
    expect(perCase.map((run) => [run.case, run.rep])).toEqual([['summary', 0], ['summary', 1], ['tone', 0]]);
    expect(perCase[0]).toEqual({
      case: 'summary', rep: 0,
      arms: {
        candidate: { passed: true, checks: [['file_exists:summary.md', true], ['transcript_mentions:openpyxl', true]] },
        baseline: { passed: false, checks: [['file_exists:summary.md', false], ['transcript_mentions:openpyxl', true]] },
        incumbent: { passed: true, checks: [['file_exists:summary.md', true], ['transcript_mentions:openpyxl', true]] },
      },
      outcomes: { 'candidate-vs-baseline': 'win', 'candidate-vs-incumbent': 'loss' },
    });
    expect(perCase[1]!.arms).toEqual({ candidate: { passed: false, checks: [['file_exists:summary.md', false], ['transcript_mentions:openpyxl', true]] }, baseline: { passed: false, checks: [['file_exists:summary.md', false], ['transcript_mentions:openpyxl', false]] } });
    expect(JSON.stringify(perCase)).not.toContain('rm -rf');
  });

  it('a case with no checks and an arm that failed twice are null verdicts — never a pass, never a fail', () => {
    const failedRun: ComparisonRow = { ...row('win', 'opponent-run-failed'), case: 'summary', rep: 2, checks_candidate: [check('file_exists:summary.md', true)], checks_opponent: [check('file_exists:summary.md', false)] };
    const perCase = perCaseRows([...rows, failedRun], [...arms, sample('candidate', 1, { case: 'summary', rep: 2 }), sample('baseline', 0, { case: 'summary', rep: 2, failed: true })]);
    expect(perCase.find((run) => run.case === 'tone')!.arms).toEqual({ candidate: { passed: null, checks: [] }, baseline: { passed: null, checks: [] } });
    expect(perCase.find((run) => run.case === 'summary' && run.rep === 2)!.arms).toEqual({ candidate: { passed: true, checks: [['file_exists:summary.md', true]] }, baseline: { passed: null, checks: [] } });
  });

  it('tallies passed over decidable case-runs per arm, keyed like arm_scores, and the receipt numbers and report carry it', () => {
    expect(caseRunTally(perCaseRows(rows, arms), ['candidate', 'baseline', 'incumbent'])).toEqual({ candidate: { passed: 1, total: 2 }, baseline: { passed: 0, total: 2 }, incumbent: { passed: 1, total: 1 } });
    const out = aggregate(rows, arms, 4);
    expect(out.case_runs).toEqual({ candidate: { passed: 1, total: 2 }, baseline: { passed: 0, total: 2 }, incumbent: { passed: 1, total: 1 } });
    expect(out.per_case).toHaveLength(3);
    expect(renderReport(out, null)).toContain('case-runs passed: candidate 1/2 · baseline 0/2 · incumbent 1/1');
  });

  it('an arm sample with no row keeps its own fraction as the verdict; no arms and no rows → empty', () => {
    expect(perCaseRows([], [sample('candidate', 1, { case: 'solo', rep: 0 }), sample('baseline', 0.5, { case: 'solo', rep: 0 })])).toEqual([{ case: 'solo', rep: 0, arms: { candidate: { passed: true, checks: [] }, baseline: { passed: false, checks: [] } }, outcomes: {} }]);
    expect(aggregate([], [], 0)).toMatchObject({ per_case: [], case_runs: {} });
    expect(renderReport(aggregate([], [], 0), null)).not.toContain('case-runs');
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

describe('head-to-head report mode (IE6 §4)', () => {
  const head = { candidate: 'codex-spec', rival: 'ultraspec', cases: 5, k: 5, briefPath: '/runs/brief.md', briefSource: 'derived' as const };

  // §4's own sample: 14W 6L 5T against baseline, 11W 9L 5T against the rival.
  const sampleRows = [
    ...Array.from({ length: 14 }, () => row('win')), ...Array.from({ length: 6 }, () => row('loss')), ...Array.from({ length: 5 }, () => row('tie')),
    ...Array.from({ length: 11 }, () => row('win', 'judge', 'candidate-vs-rival')),
    ...Array.from({ length: 9 }, () => row('loss', 'judge', 'candidate-vs-rival')),
    ...Array.from({ length: 5 }, () => row('tie', 'judge', 'candidate-vs-rival')),
  ];
  const sampleArms = [sample('candidate', 0.82), sample('rival', 0.71), sample('baseline', 0.61)];
  const h2h = (rows = sampleRows, arms = sampleArms, expected = 50) => aggregate(rows, arms, expected, {}, {}, false, 'head-to-head');

  it('prints no verdict and no why line, and carries the sign test instead of net lift', () => {
    const out = h2h();
    expect(out.verdict).toBeNull();
    const report = renderReport(out, null, head);
    expect(report).not.toMatch(/^verdict:/m);
    expect(report).not.toMatch(/^why:/m);
    expect(report).not.toMatch(/net lift/);
    expect(report).not.toMatch(/NEUTRAL|PASS|FAIL/);
    expect(report).toContain('head-to-head: codex-spec vs ultraspec — 5 cases · k=5');
    // 11W-9L is a coin flip; the p-value is what says so once the band is gone.
    expect(report).toContain('candidate-vs-rival: 11W 9L 5T over 25 comparisons, sign test p=0.824');
    expect(report).toContain('candidate-vs-baseline: 14W 6L 5T over 25 comparisons, sign test p=0.115');
  });

  it('states the denominator on a complete run and flags it on a partial one', () => {
    expect(renderReport(h2h(), null, head)).toContain('scored: 50/50 rows');
    expect(renderReport(h2h(), null, head)).not.toContain('[partial]');
    expect(renderReport(h2h(sampleRows.slice(0, 37)), null, head)).toContain('scored: 37/50 rows [partial]');
  });

  it('orders arms candidate · rival · baseline regardless of sample order', () => {
    const shuffled = [sample('baseline', 0.61), sample('rival', 0.71), sample('candidate', 0.82)];
    expect(renderReport(h2h(sampleRows, shuffled), null, head)).toContain('arm scores: candidate 0.82 · rival 0.71 · baseline 0.61');
  });

  it('names the brief and its provenance, and keeps the caveat in front of the reader', () => {
    expect(renderReport(h2h(), null, head)).toContain('brief: /runs/brief.md (human-confirmed)');
    expect(renderReport(h2h(), null, { ...head, briefSource: 'supplied' })).toContain('brief: /runs/brief.md (supplied)');
    expect(renderReport(h2h(), null, head)).toContain('not a ranking');
  });

  it('leaves standard mode untouched — verdict, why, and net lift all still print', () => {
    const out = aggregate(sampleRows.filter((r) => r.comparison === 'candidate-vs-baseline'), sampleArms, 25);
    const report = renderReport(out, null);
    expect(out.verdict).toBe('NEUTRAL');
    expect(report).toMatch(/^verdict: NEUTRAL/m);
    expect(report).toMatch(/^why:/m);
    expect(report).toContain('net lift');
  });
});
