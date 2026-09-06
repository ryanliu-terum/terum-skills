/**
 * Eval spec §5.3–5.4 / §8: the committed receipt — zod schema (`.passthrough()` at every level,
 * the phase-1 forward-compat convention), the append-only receipt path (rev 5), and secret
 * redaction at the sharing boundary. Pure (ME1): no I/O.
 */
import { z } from 'zod';
import { describeIssues } from '../schema.js';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';

/**
 * §8: patterns scrubbed from anything that leaves the machine. Transcripts and run trees stay
 * local and un-redacted for debugging; the boundary is sharing, not recording.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

/** Replace every configured team token and every credential-shaped substring with `[redacted]`. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('[redacted]');
  for (const pattern of CREDENTIAL_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

const comparisonSchema = z.object({
  win: z.number().int().min(0),
  loss: z.number().int().min(0),
  tie: z.number().int().min(0),
  net_lift: z.number(),
  sign_p: z.number(),
}).passthrough();

const efficiencySchema = z.object({
  turns: z.number().nullable(),
  duration_ms: z.number().nullable(),
  cost_usd: z.number().nullable(),
}).passthrough();

export const RUN_ID_PATTERN = /^\d{8}T\d{6}Z$/;
const VERSION_PATTERN = /^[0-9a-f]{40}$/;

export const receiptSchema = z.object({
  schema_version: z.literal(1),
  skill_id: z.uuid(),
  skill_name: z.string().min(1),
  version: z.string().regex(VERSION_PATTERN, 'a version is the 40-char lowercase tree hash'),
  run_id: z.string().regex(RUN_ID_PATTERN, 'a run id is a UTC timestamp, YYYYMMDDTHHMMSSZ'),
  verdict: z.enum(['PASS', 'NEUTRAL', 'FAIL']),
  attribution: z.string(),
  execution_status: z.enum(['complete', 'partial', 'failed']),
  expected_rows: z.number().int().min(0),
  scored_rows: z.number().int().min(0),
  comparisons: z.record(z.string(), comparisonSchema),
  arm_scores: z.record(z.string(), z.number().nullable()),
  triggers: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    tp: z.number().int().min(0),
    fn: z.number().int().min(0),
    fp: z.number().int().min(0),
    tn: z.number().int().min(0),
  }).passthrough().nullable(),
  efficiency: z.record(z.string(), efficiencySchema),
  provenance: z.object({
    engine_version: z.string(),
    engine_commit: z.string(),
    cc_version: z.string(),
    model: z.string(),
    judge_model: z.string(),
    k: z.number().int().min(1),
    cases: z.array(z.string()),
    arm_skill_lists: z.record(z.string(), z.array(z.string()).nullable()),
    timestamp: z.string(),
    runner_handle: z.string(),
  }).passthrough(),
}).passthrough();
export type Receipt = z.infer<typeof receiptSchema>;

/** Rev 5: append-only — one immutable file per committed run, grouped by version. */
export function receiptPath(skillId: string, version: string, runId: string): string {
  return `evals/${skillId}/${version}/${runId}.json`;
}

/**
 * Assemble and validate a receipt. Free text (§5.3: today only `attribution`) passes through
 * `redact()` before the receipt exists; numbers and enums cannot carry secrets.
 */
export function buildReceipt(raw: Record<string, unknown>, secrets: readonly string[] = []): Result<Receipt> {
  const candidate = { ...raw, schema_version: 1, attribution: redact(String(raw['attribution'] ?? ''), secrets) };
  const parsed = receiptSchema.safeParse(candidate);
  if (!parsed.success) return failure(`invalid receipt: ${describeIssues(parsed.error)}`);
  return success(parsed.data);
}
