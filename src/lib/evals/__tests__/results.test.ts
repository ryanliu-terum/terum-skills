import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../checks.js';
import type { ArmSample, ComparisonRow } from '../execution.js';
import { aggregate, diagnoseChecks, renderReport, runIdFrom, writeRunTree } from '../results.js';

const row = (outcome: 'win' | 'loss' | 'tie', decidedBy = 'checks', comparison = 'candidate-vs-baseline'): ComparisonRow => ({
  skill: 's', kind: 'execution', case: 'c', rep: 0, comparison, outcome, decided_by: decidedBy, reason: '', checks_candidate: [], checks_opponent: [],
});

const check = (name: string, passed: boolean): CheckResult => ({ name, passed, detail: '' });
/** A checks-equal-no-judge tie carrying each arm's per-check results, for the check-quality diagnostics. */
const tieWithChecks = (caseName: string, candidate: CheckResult[], opponent: CheckResult[], decidedBy = 'checks-equal-no-judge', rep = 0): ComparisonRow => ({
  ...row('tie', decidedBy), case: caseName, rep, checks_candidate: candidate, checks_opponent: opponent,
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

  it('environment skips grey the verdict and print in the report (§7.1 rev 8)', () => {
    const out = aggregate([row('win')], [sample('candidate', 1)], 3, { xlsx: ['python3:openpyxl'] });
    expect(out.execution_status).toBe('partial'); // skipped case's rows are unscored holes
    expect(out.environment_skips).toEqual({ xlsx: ['python3:openpyxl'] });
    const text = renderReport(out, null);
    expect(text).toContain('skipped (environment): xlsx — missing python3:openpyxl');
    expect(text).toContain('[partial — 1/3 scored]');
  });
});

describe('tie attribution (§7.1 rev 20)', () => {
  it('an all-tie run with no rubric says neither version swept and no judge ran — never that the checks were level', () => {
    // The 2026-09-14 `parallel-fix` receipt: candidate 1/2 vs baseline 0/2 in one round still tied under §5.1.
    const rows = [
      tieWithChecks('bug-logs', [check('transcript_mentions:triage', true), check('command_matching:git', false)], [check('transcript_mentions:triage', false), check('command_matching:git', false)]),
      row('tie', 'checks-equal-no-judge'),
      row('tie', 'checks-equal-no-judge'),
    ];
    const out = aggregate(rows, [], 3);
    expect(out.attribution).toBe("all 3 rounds drew — neither version passed every check in any case, and a partial lead doesn't win a round; with no rubric, no judge ran");
    expect(out.attribution).not.toContain('level');
    expect(out.attribution).not.toContain('unscored');
    expect(out).toMatchObject({ verdict: 'NEUTRAL', scored_rows: 3 }); // display only: the arithmetic is untouched
    expect(out.comparisons['candidate-vs-baseline']).toMatchObject({ win: 0, loss: 0, tie: 3, net_lift: 0, sign_p: 1 });
  });

  it('names each tie reason with counts when the labels are mixed, and singularises one round', () => {
    expect(aggregate([row('tie', 'judge-split')], [], 1).attribution).toBe('the only round drew — the judge split across the two orderings');
    const mixed = aggregate([row('tie', 'judge'), row('tie', 'judge'), row('tie', 'checks-equal-no-judge'), row('tie', 'judge-network-error')], [], 4).attribution;
    expect(mixed).toBe('all 4 rounds drew — 2 where the judge called it even; 1 where the checks named no winner and, with no rubric, no judge ran; 1 where the judge could not be reached');
  });

  it('a mixed win/loss record still says why its ties tied', () => {
    const out = aggregate([row('win'), row('loss', 'judge'), row('tie', 'checks-equal-no-judge'), row('tie', 'checks-equal-no-judge')], [], 4);
    expect(out.attribution).toBe('wins on execution checks; loses on judge calls; 2 ties (the checks named no winner and, with no rubric, no judge ran)');
  });

  it('only candidate-vs-baseline rows drive the line; the both-arms-failed hole keeps its own wording', () => {
    expect(aggregate([row('tie', 'both-arms-failed'), row('tie', 'judge-refused', 'candidate-vs-incumbent')], [], 2).attribution).toBe('the only round drew — both versions failed to run');
  });
});

describe('check-quality diagnostics (§6 rev 20, report only)', () => {
  const dead = check('transcript_mentions:never-said', false);
  const vacuous = check('file_exists:README.md', true);
  it('classifies checks that fail or pass in every arm on every rep, and leaves informative checks alone', () => {
    const rows = [
      tieWithChecks('c1', [dead, vacuous, check('command_matching:git', true)], [dead, vacuous, check('command_matching:git', false)], 'checks-equal-no-judge', 0),
      tieWithChecks('c1', [dead, vacuous, check('command_matching:git', false)], [dead, vacuous, check('command_matching:git', true)], 'checks-equal-no-judge', 1),
    ];
    expect(diagnoseChecks(rows)).toEqual({ dead: ['c1 › transcript_mentions:never-said'], vacuous: ['c1 › file_exists:README.md'] });
  });

  it('a check is keyed per case, so the same check name in two cases is judged separately', () => {
    const rows = [
      tieWithChecks('c1', [dead], [dead]),
      tieWithChecks('c2', [check('transcript_mentions:never-said', true)], [check('transcript_mentions:never-said', false)]),
    ];
    expect(diagnoseChecks(rows)).toEqual({ dead: ['c1 › transcript_mentions:never-said'], vacuous: [] });
  });

  it('results scored against a failed arm are not evidence about the check', () => {
    // Candidate crashed: its checks failed against the empty transcript. Only the opponent's pass counts.
    const oneArm = tieWithChecks('c1', [check('file_exists:out.txt', false)], [check('file_exists:out.txt', true)], 'candidate-run-failed');
    expect(diagnoseChecks([oneArm])).toEqual({ dead: [], vacuous: [] }); // seen once → unclassified
    expect(diagnoseChecks([oneArm, { ...oneArm, rep: 1 }])).toEqual({ dead: [], vacuous: ['c1 › file_exists:out.txt'] });
    expect(diagnoseChecks([tieWithChecks('c1', [dead], [dead], 'both-arms-failed')])).toEqual({ dead: [], vacuous: [] });
  });

  it('prints a check quality block only when something is dead or vacuous, and keeps it out of scoring', () => {
    const rows = [tieWithChecks('c1', [dead, check('command_matching:git', true)], [dead, check('command_matching:git', false)])];
    const out = aggregate(rows, [sample('candidate', 0.5), sample('baseline', 0)], 1);
    const text = renderReport(out, null);
    expect(text).toContain('check quality: 1 dead (failed in every version) · 0 vacuous (passed in every version)');
    expect(text).toContain('  dead: c1 › transcript_mentions:never-said');
    expect(out.arm_scores).toEqual({ candidate: 0.5, baseline: 0 }); // the dead check still counts toward the §16.4 fraction
    expect(renderReport(aggregate([row('win')], [], 1), null)).not.toContain('check quality');
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
