import { describe, expect, it } from 'vitest';
import { buildReceipt, receiptPath, receiptSchema, redact } from '../receipt.js';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow…snip…\n-----END RSA PRIVATE KEY-----';

const valid = () => ({
  skill_id: '4e80fd2a-04bc-4d9f-88f7-a849d92879f1',
  skill_name: 'deploy-preflight',
  version: 'a'.repeat(40),
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
});

describe('receipt schema and build (§5.3)', () => {
  it('accepts the annotated shape and builds with redacted attribution', () => {
    const built = buildReceipt({ ...valid(), attribution: `leaked ghp_${'c'.repeat(36)} via team-tok-9` }, ['team-tok-9']);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.schema_version).toBe(1);
      expect(built.value.attribution).not.toContain('ghp_');
      expect(built.value.attribution).not.toContain('team-tok-9');
    }
  });

  it('rejects malformed identity fields', () => {
    expect(buildReceipt({ ...valid(), version: 'short' }).ok).toBe(false);
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

describe('receipt path (rev 5, append-only)', () => {
  it('is keyed id/version/run', () => {
    expect(receiptPath('4e80fd2a-04bc-4d9f-88f7-a849d92879f1', 'a'.repeat(40), '20260904T221500Z'))
      .toBe(`evals/4e80fd2a-04bc-4d9f-88f7-a849d92879f1/${'a'.repeat(40)}/20260904T221500Z.json`);
  });
});
