/**
 * Eval spec §5.3–5.4 / §8: the committed receipt — zod schema (`.passthrough()` at every level,
 * the phase-1 forward-compat convention), the append-only receipt path (rev 5), and secret
 * redaction at the sharing boundary. Pure (ME1): no I/O.
 */
import { z } from 'zod';
import { persistedVersionSchema } from '../schema.js';
import { describeIssues } from '../schema.js';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';

/**
 * §8: patterns scrubbed from anything that leaves the machine. Transcripts and run trees stay
 * local and un-redacted for debugging; the boundary is sharing, not recording.
 */
/** §8's shared credential signatures. Hygiene imports this rather than maintaining a second list. */
export const CREDENTIAL_PATTERNS: readonly RegExp[] = [
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

/** §5.3 rev 20: one arm on one (case × rep) — the §5.1 all-or-nothing verdict and [name, passed] per check. */
const caseRunArmSchema = z.object({
  passed: z.boolean().nullable(),
  checks: z.array(z.tuple([z.string(), z.boolean()])),
}).passthrough();

const caseRunSchema = z.object({
  case: z.string().min(1),
  rep: z.number().int().min(0),
  arms: z.record(z.string(), caseRunArmSchema),
  outcomes: z.record(z.string(), z.enum(['win', 'loss', 'tie'])),
}).passthrough();

const caseRunTallySchema = z.object({
  passed: z.number().int().min(0),
  total: z.number().int().min(0),
}).passthrough();

export const RUN_ID_PATTERN = /^\d{8}T\d{6}Z$/;

/** §6.1: the current receipt shape. Schema 1 is read-only history. */
export const RECEIPT_SCHEMA_VERSION = 2;
/** The `runner_handle` a run carries when this machine holds no team binding at all (eval on a folder no team
 *  knows). It is this machine's own placeholder, never a teammate, so `ls --local` treats a receipt stamped with
 *  it as run here. */
export const NO_TEAM_RUNNER_HANDLE = 'local';

export const receiptSchema = z.object({
  // A union, so no historical receipt becomes unparseable — the whole point of §6.1.
  schema_version: z.union([z.literal(1), z.literal(2)]),
  /**
   * Null for a local run on a folder with no `metadata.id`; publish fills it in when it attaches the
   * run. A COMMITTED receipt is never null.
   */
  skill_id: z.union([z.uuid(), z.null()]),
  skill_name: z.string().min(1),
  /**
   * §3.4 — `'v3'`, the retained read-only 40-hex arm, or null. **Null is the normal state of a local
   * run:** a local eval happens before the skill has a remote version number at all, so binding it to
   * an ordinal at run time is impossible. Publish resolves the digest to a version when it attaches.
   */
  version: persistedVersionSchema,
  /**
   * §6.1 — identity at run time. Computed by the SAME `skillContentDigest` the publish comparison
   * uses, over the folder exactly as it is on disk, so publish's attach step is provable rather than
   * trusted. Required at `schema_version: 2`; absent on schema-1 history.
   */
  content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  run_id: z.string().regex(RUN_ID_PATTERN, 'a run id is a UTC timestamp, YYYYMMDDTHHMMSSZ'),
  verdict: z.enum(['PASS', 'NEUTRAL', 'FAIL']),
  attribution: z.string(),
  execution_status: z.enum(['complete', 'partial', 'failed']),
  expected_rows: z.number().int().min(0),
  scored_rows: z.number().int().min(0),
  comparisons: z.record(z.string(), comparisonSchema),
  arm_scores: z.record(z.string(), z.number().nullable()),
  // Rev 8: cases skipped for missing host tools (case → missing requirements). Optional for
  // forward-compat with receipts written before rev 8.
  environment_skips: z.record(z.string(), z.array(z.string())).optional(),
  // Eval-gen D4: cases that never started (case → { kind, detail }). `kind` is `setup` (hook exited
  // nonzero) or `staging` (files/fixture could not be placed). Optional: receipts written before
  // D4 recorded the hole only as scored < expected.
  dropped_cases: z.record(z.string(), z.object({ kind: z.enum(['setup', 'staging']), detail: z.string() }).passthrough()).optional(),
  // Rev 20: per-(case × rep) check verdicts and the passed-case-runs tally per arm — what the
  // desktop's Quality figure and case table read. Optional: receipts written before rev 20 have
  // neither, and a surface says so instead of deriving them.
  per_case: z.array(caseRunSchema).optional(),
  case_runs: z.record(z.string(), caseRunTallySchema).optional(),
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
}).passthrough().superRefine((receipt, ctx) => {
  // Schema 2 binds a run to the bytes it evaluated. Without this the field is declared and never
  // enforced, and a schema-2 receipt with no digest would silently never attach at publish.
  if (receipt.schema_version === 2 && receipt.content_digest === undefined) {
    ctx.addIssue({ code: 'custom', path: ['content_digest'], message: 'a schema-2 receipt records the content digest of the bytes it evaluated' });
  }
});
export type Receipt = z.infer<typeof receiptSchema>;

/** Rev 20: the check names inside `per_case` are the only free text there; everything else is a verdict. */
function redactCaseRuns(perCase: unknown, secrets: readonly string[]): { per_case?: unknown } {
  if (!Array.isArray(perCase)) return {};
  return {
    per_case: perCase.map((run) => {
      if (run === null || typeof run !== 'object' || !('arms' in run) || run.arms === null || typeof run.arms !== 'object') return run;
      const arms = Object.fromEntries(Object.entries(run.arms as Record<string, unknown>).map(([arm, value]) => {
        if (value === null || typeof value !== 'object' || !Array.isArray((value as { checks?: unknown }).checks)) return [arm, value];
        const checks = ((value as { checks: unknown[] }).checks).map((check) => (Array.isArray(check) && typeof check[0] === 'string' ? [redact(check[0], secrets), check[1]] : check));
        return [arm, { ...(value as object), checks }];
      }));
      return { ...run, arms };
    }),
  };
}

/** D4: `detail` is a setup hook's stderr tail — free text from inside the sandbox, so it crosses the boundary redacted. */
function redactDroppedCases(dropped: unknown, secrets: readonly string[]): { dropped_cases?: unknown } {
  if (dropped === null || typeof dropped !== 'object' || Array.isArray(dropped)) return {};
  return {
    dropped_cases: Object.fromEntries(Object.entries(dropped as Record<string, unknown>).map(([caseName, value]) => {
      if (value === null || typeof value !== 'object' || typeof (value as { detail?: unknown }).detail !== 'string') return [caseName, value];
      return [caseName, { ...(value as object), detail: redact((value as { detail: string }).detail, secrets) }];
    })),
  };
}

/** Rev 5: append-only — one immutable file per committed run, grouped by version. */
export function receiptPath(skillId: string, version: string, runId: string): string {
  return `evals/${skillId}/${version}/${runId}.json`;
}

/**
 * Assemble and validate a receipt. Free text (§5.3: `attribution`, and since rev 20 the check names
 * in `per_case` — a check name carries its argument from the case file) passes through `redact()`
 * before the receipt exists; numbers and enums cannot carry secrets.
 */
export function buildReceipt(raw: Record<string, unknown>, secrets: readonly string[] = []): Result<Receipt> {
  const candidate = { ...raw, schema_version: RECEIPT_SCHEMA_VERSION, attribution: redact(String(raw['attribution'] ?? ''), secrets), ...redactCaseRuns(raw['per_case'], secrets), ...redactDroppedCases(raw['dropped_cases'], secrets) };
  const parsed = receiptSchema.safeParse(candidate);
  if (!parsed.success) return failure(`invalid receipt: ${describeIssues(parsed.error)}`);
  return success(parsed.data);
}
