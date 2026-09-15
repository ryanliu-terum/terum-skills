import { describe, expect, it } from 'vitest';
import { buildReceipt, receiptPath, receiptSchema, redact } from '../receipt.js';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow…snip…\n-----END RSA PRIVATE KEY-----';

const valid = () => ({
  skill_id: '4e80fd2a-04bc-4d9f-88f7-a849d92879f1',
  skill_name: 'deploy-preflight',
  // §3.4: a version is a `v<N>` folder, and §6.1 requires the digest at schema 2.
  version: 'v3',
  content_digest: `sha256:${'d'.repeat(64)}`,
  run_id: '20260904T221500Z',
  verdict: 'PASS',
  attribution: 'wins on execution checks',
  execution_status: 'complete',
  expected_rows: 9,
  scored_rows: 9,
  comparisons: { 'candidate-vs-baseline': { win: 5, loss: 1, tie: 3, net_lift: 0.444, sign_p: 0.219 } },
  arm_scores: { candidate: 0.82, baseline: 0.61 },
  triggers: null,
  efficiency: { candidate: { turns: 6.2, duration_ms: 41200, cost_usd: 0.38 } },
  provenance: {
    engine_version: '0.1.0', engine_commit: 'abc123def456', cc_version: '2.34.0',
    model: 'sonnet', judge_model: 'sonnet', k: 3, cases: ['happy-path'],
    arm_skill_lists: { baseline: [], candidate: ['deploy-preflight'] },
    timestamp: '2026-09-04T22:15:00Z', runner_handle: 'ajay',
  },
});

describe('redaction (§8, VE4)', () => {
  it('scrubs configured team tokens and every credential pattern', () => {
    const text = `token team-tok-123 then ghp_${'a'.repeat(36)} and github_pat_${'b'.repeat(30)} and sk-ant-api03-xyzabc123 and AKIAABCDEFGHIJKLMNOP and ${PEM} and Bearer eyJa.eyJb.sig-c`;
    const out = redact(text, ['team-tok-123']);
    expect(out).not.toContain('team-tok-123');
    expect(out).not.toContain('ghp_');
    expect(out).not.toContain('github_pat_');
    expect(out).not.toContain('sk-ant-');
    expect(out).not.toContain('AKIA');
    expect(out).not.toContain('PRIVATE KEY');
    expect(out).not.toContain('eyJa');
    expect(out).toContain('[redacted]');
  });

  it('leaves clean text alone and ignores empty secrets', () => {
    expect(redact('routes 6/6, no false fires', [''])).toBe('routes 6/6, no false fires');
  });

  it('redacts a PEM and caller-held slash-bearing value before a receipt crosses the sharing boundary (VE4)', () => {
    const secret = 'judge/reason/with/slashes';
    const built = buildReceipt({ ...valid(), attribution: `reason ${PEM} ${secret} ghp_${'z'.repeat(36)}` }, [secret]);
    expect(built).toMatchObject({ ok: true });
    if (!built.ok) return;
    const committed = JSON.stringify(built.value);
    expect(committed).not.toContain('PRIVATE KEY');
    expect(committed).not.toContain(secret);
    expect(committed).not.toContain('ghp_');
  });
});

describe('dropped cases on the receipt (eval-gen D4)', () => {
  it('carries case → { kind, detail } with the detail redacted, and stays optional for older receipts', () => {
    const built = buildReceipt({ ...valid(), execution_status: 'partial', scored_rows: 6, dropped_cases: { 'quota-gate': { kind: 'setup', detail: `setup failed (rc=1): token ghp_${'q'.repeat(36)} rejected` } } });
    expect(built).toMatchObject({ ok: true });
    if (!built.ok) return;
    expect(built.value.dropped_cases).toEqual({ 'quota-gate': { kind: 'setup', detail: 'setup failed (rc=1): token [redacted] rejected' } });
    const older = buildReceipt(valid());
    expect(older.ok).toBe(true);
    if (older.ok) expect(older.value).not.toHaveProperty('dropped_cases');
    expect(buildReceipt({ ...valid(), dropped_cases: { x: { kind: 'vanished', detail: '' } } }).ok).toBe(false);
  });
});

describe('receipt schema and build (§5.3)', () => {
  it('accepts the annotated shape and builds with redacted attribution', () => {
    const built = buildReceipt({ ...valid(), attribution: `leaked ghp_${'c'.repeat(36)} via team-tok-9` }, ['team-tok-9']);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.schema_version).toBe(2);
      expect(built.value.attribution).not.toContain('ghp_');
      expect(built.value.attribution).not.toContain('team-tok-9');
    }
  });

  it('rejects malformed identity fields', () => {
    expect(buildReceipt({ ...valid(), version: 'short' }).ok).toBe(false);
    expect(buildReceipt({ ...valid(), version: 'v0' }).ok).toBe(false);
    // §6.1: the digest is required at schema 2 — declared and never enforced would mean a receipt
    // that can never attach at publish, with nothing saying so.
    expect(buildReceipt({ ...valid(), content_digest: undefined }).ok).toBe(false);
    expect(buildReceipt({ ...valid(), content_digest: 'sha256:nope' }).ok).toBe(false);
    // Both are legitimate for a LOCAL run, which happens before the skill has either.
    expect(buildReceipt({ ...valid(), version: null, skill_id: null }).ok).toBe(true);
    // The 40-hex arm is retained on READ so no historical receipt becomes unparseable.
    expect(receiptSchema.safeParse({ ...valid(), schema_version: 1, version: 'a'.repeat(40), content_digest: undefined }).success).toBe(true);
    expect(buildReceipt({ ...valid(), run_id: '2026-09-04' }).ok).toBe(false);
    expect(buildReceipt({ ...valid(), skill_id: 'not-a-uuid' }).ok).toBe(false);
    expect(buildReceipt({ ...valid(), verdict: 'GREAT' }).ok).toBe(false);
  });

  it('passes unknown fields through at every level (VE8 contract)', () => {
    const parsed = receiptSchema.parse({ ...valid(), schema_version: 1, future_field: true, provenance: { ...valid().provenance, future: 'yes' } });
    expect((parsed as Record<string, unknown>)['future_field']).toBe(true);
    expect((parsed.provenance as Record<string, unknown>)['future']).toBe('yes');
  });
});

describe('per-case rows and case-run tally (§5.3 rev 20)', () => {
  const perCase = () => [{
    case: 'happy-path', rep: 0,
    arms: { candidate: { passed: true, checks: [['file_exists:out.md', true], ['transcript_mentions:tok_live_abc123', true]] }, baseline: { passed: null, checks: [] } },
    outcomes: { 'candidate-vs-baseline': 'win' },
  }];

  it('accepts the rows and tally, and a receipt written before rev 20 still validates without them', () => {
    const built = buildReceipt({ ...valid(), per_case: perCase(), case_runs: { candidate: { passed: 1, total: 1 }, baseline: { passed: 0, total: 0 } } });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.case_runs).toEqual({ candidate: { passed: 1, total: 1 }, baseline: { passed: 0, total: 0 } });
    expect(receiptSchema.safeParse({ ...valid(), schema_version: 1, version: 'a'.repeat(40), content_digest: undefined }).success).toBe(true);
  });

  it('rejects a verdict that is not a boolean-or-null, a check that is not [name, passed], or a negative tally', () => {
    const arms = (arm: Record<string, unknown>) => [{ ...perCase()[0], arms: { candidate: arm } }];
    expect(receiptSchema.safeParse({ ...valid(), per_case: arms({ passed: 0.5, checks: [] }) }).success).toBe(false);
    expect(receiptSchema.safeParse({ ...valid(), per_case: arms({ passed: true, checks: [['file_exists:out.md', 'yes']] }) }).success).toBe(false);
    expect(receiptSchema.safeParse({ ...valid(), per_case: [{ ...perCase()[0], outcomes: { 'candidate-vs-baseline': 'draw' } }] }).success).toBe(false);
    expect(receiptSchema.safeParse({ ...valid(), case_runs: { candidate: { passed: -1, total: 1 } } }).success).toBe(false);
  });

  it('redacts a team token inside a check name — the only free text the rows carry', () => {
    const built = buildReceipt({ ...valid(), per_case: perCase() }, ['tok_live_abc123']);
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.per_case![0]!.arms['candidate']!.checks).toEqual([['file_exists:out.md', true], ['transcript_mentions:[redacted]', true]]);
  });
});

describe('receipt path (rev 5, append-only)', () => {
  it('is keyed id/version/run', () => {
    expect(receiptPath('4e80fd2a-04bc-4d9f-88f7-a849d92879f1', 'v3', '20260904T221500Z'))
      .toBe('evals/4e80fd2a-04bc-4d9f-88f7-a849d92879f1/v3/20260904T221500Z.json');
  });
});
