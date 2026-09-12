import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '../../lib/__tests__/fixtures.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
export const pendingIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
export async function pendingSkill(clone: string, name: string, id: string) {
  const dir = join(clone, 'skills', name, 'v1'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
}
export async function seedPending(clone: string, count = 2) {
  for (let i = 0; i < count; i++) await pendingSkill(clone, ['alpha', 'beta'][i]!, pendingIds[i]!);
  await git(['add', '--all'], clone); await git(['commit', '-q', '-m', 'test skills'], clone);
}
/**
 * `scored` gives the receipt a real candidate-vs-baseline comparison and per-arm scores, for callers
 * that read the display numbers rather than only the receipt's presence. Omitted, the receipt keeps
 * its original empty `comparisons`/`arm_scores` — the shape every earlier caller asserts.
 */
export async function pendingReceipt(clone: string, options: { older?: boolean; invalid?: boolean; scored?: boolean; skillName?: string; id?: string } = {}) {
  const name = options.skillName ?? 'alpha';
  const id = options.id ?? pendingIds[0]!;
  const version = options.older ? 'a'.repeat(40) : (await git(['rev-parse', `HEAD:skills/${name}`], clone)).trim();
  const dir = join(clone, 'evals', id, version); await mkdir(dir, { recursive: true });
  const receipt = options.invalid ? { schema_version: 1 } : receiptSchema.parse({
    schema_version: 1, skill_id: id, skill_name: name, version, run_id: '20260101T000000Z', verdict: 'PASS',
    attribution: 'test receipt', execution_status: 'complete', expected_rows: 0, scored_rows: 0,
    comparisons: options.scored ? { 'candidate-vs-baseline': { win: 7, loss: 2, tie: 1, net_lift: 0.5, sign_p: 0.09 } } : {},
    arm_scores: options.scored ? { candidate: 0.82, baseline: 0.61 } : {}, triggers: null, efficiency: {},
    provenance: { engine_version: 'test', engine_commit: 'unknown', cc_version: 'test', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-01-01T00:00:00Z', runner_handle: 'alice' },
  });
  await writeFile(join(dir, '20260101T000000Z.json'), JSON.stringify(receipt));
  await git(['add', '--all'], clone); await git(['commit', '-q', '-m', 'test receipt'], clone);
}

/** Production-schema means; two arms × two cases × three repetitions reconstruct the supplied totals. */
export function measuredReceipt(cost: number | null, duration: number | null) {
  return receiptSchema.parse({
    schema_version: 1, skill_id: pendingIds[0], skill_name: 'alpha', version: 'a'.repeat(40), run_id: '20260909T000000Z', verdict: 'PASS',
    attribution: 'measured fixture', execution_status: 'complete', expected_rows: 12, scored_rows: 12,
    comparisons: {}, arm_scores: {}, triggers: null,
    efficiency: { candidate: { turns: 1, cost_usd: cost === null ? null : cost / 12, duration_ms: duration === null ? null : duration / 12 }, baseline: { turns: 1, cost_usd: cost === null ? null : cost / 12, duration_ms: duration === null ? null : duration / 12 } },
    provenance: { engine_version: 'test', engine_commit: 'unknown', cc_version: 'test', model: 'sonnet', judge_model: 'sonnet', k: 3, cases: ['one','two'], arm_skill_lists: {}, timestamp: '2026-09-09T00:00:00Z', runner_handle: 'alice' },
  });
}
