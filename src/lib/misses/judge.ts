/**
 * Layer 3, stage 4 (spec §5.4): the sampled judge.
 *
 * Reuses layer 1's seam — `askJson` is `claude -p --max-turns 1 --disallowedTools '*'`,
 * subscription-backed, no API key, consistent with the repo's deliberate stance. The prompt is
 * layer 1's `SELECTION_PROMPT` widened to a BATCH, because §6 costs the unbatched form at ~350 calls
 * a week for one person against ~35 batched.
 *
 * The judge is biased toward saying a skill applies (2026-09-08 assessment). That bias is *useful*
 * here — high recall, low precision is the right trade for a queue a human reads — and is exactly
 * why §7 forbids presenting any of this as a rate.
 */
import type { AgentApi } from '../evals/agent.js';
import { AgentRunError, DEFAULT_MODEL } from '../evals/agent.js';
import { catalogAsOf, renderCatalog, type CatalogEntry } from './catalog.js';
import type { HarvestedPrompt } from './harvest.js';
import type { Judged } from './reconcile.js';

/** §6 — ~10 prompts per call turns a weekly run into ~35 short calls. */
export const BATCH_SIZE = 10;

const BATCH_PROMPT = `You are an AI coding agent deciding which skills to load for each user request below.
Below is your full skill catalog. For every request, select every skill whose description says it
should be used for that request — and no others. Selecting nothing is often correct.

Each request may carry preceding conversation as CONTEXT. Use it to resolve what the request refers
to; judge the REQUEST, not the context.

SKILL CATALOG:
{catalog}

REQUESTS:
{requests}

Respond with ONLY a JSON object mapping each request id to its selections:
{"1": ["skill-name", ...], "2": [], ...}
`;

export interface JudgeOptions {
  agent: AgentApi;
  /** The full placement inventory; the as-of-T catalog is derived per batch. */
  entries: readonly CatalogEntry[];
  model?: string;
  batchSize?: number;
}

/** One batch's request block. Ids are 1-based and local to the batch, so a reply cannot cross batches. */
function renderRequests(batch: readonly HarvestedPrompt[]): string {
  return batch
    .map((prompt, index) => {
      const context = prompt.context.length > 0 ? `CONTEXT:\n${prompt.context.join('\n---\n')}\n` : '';
      return `[${index + 1}]\n${context}REQUEST:\n${prompt.text}`;
    })
    .join('\n\n');
}

/** The reply's selections for one batch, or null for every prompt when the call could not be used. */
function readSelections(reply: Record<string, unknown>, size: number): (string[] | null)[] {
  const out: (string[] | null)[] = [];
  for (let index = 0; index < size; index += 1) {
    const value = reply[String(index + 1)];
    // A missing id is not an empty selection — the judge did not answer for it, and scoring silence
    // as "nothing applies" would manufacture a clean result out of a broken reply.
    out.push(Array.isArray(value) ? value.map(String) : null);
  }
  return out;
}

/**
 * Judge every prompt, in batches.
 *
 * The catalog is rebuilt per batch from the FIRST prompt's timestamp, so a batch never shows the
 * judge a skill that did not exist yet (§5.3). Batches are cut on the corpus order the harvest
 * already guarantees, and prompts are close in time within one, so one catalog per batch is honest;
 * the batch boundary is the granularity, and it is stated here rather than left to a reader.
 */
export async function judgePrompts(prompts: readonly HarvestedPrompt[], options: JudgeOptions): Promise<Judged[]> {
  const size = options.batchSize ?? BATCH_SIZE;
  const judged: Judged[] = [];
  for (let start = 0; start < prompts.length; start += size) {
    const batch = prompts.slice(start, start + size);
    const first = batch[0];
    if (first === undefined) continue;
    const catalog = renderCatalog(catalogAsOf(options.entries, first.ts));
    // Nothing was installed yet at this point in history: no skill could have been passed over, so
    // there is nothing to judge and no call worth spending.
    if (catalog.length === 0) {
      for (const prompt of batch) judged.push({ prompt, selected: [] });
      continue;
    }
    const task = BATCH_PROMPT.replace('{catalog}', () => catalog).replace('{requests}', () => renderRequests(batch));
    let selections: (string[] | null)[];
    try {
      const reply = await options.agent.askJson(task, { model: options.model ?? DEFAULT_MODEL });
      selections = readSelections(reply, batch.length);
    } catch (error) {
      // §11 — an errored call yields no judgment in EITHER direction, mirroring layer 1's rule that
      // a failed selection counts in neither tn nor fp. Never a false "applies", never a false clean.
      if (!(error instanceof AgentRunError)) throw error;
      selections = batch.map(() => null);
    }
    batch.forEach((prompt, index) => judged.push({ prompt, selected: selections[index] ?? null }));
  }
  return judged;
}

/** How many model calls a run of this many prompts costs. Printed by §7 so the cost is never hidden. */
export const batchCount = (prompts: number, size: number = BATCH_SIZE): number => Math.ceil(prompts / size);
