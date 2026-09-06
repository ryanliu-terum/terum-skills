/**
 * Eval spec §5.2 / §7.2: trigger evals, ported from skilldeck `evals/triggers.py` (42084dc).
 * Given the catalog of skill descriptions actually competing for attention (the endorsed set,
 * resolved by the caller), does the model select this skill for prompts that should fire it and
 * leave it alone for near-misses? Errored selection calls count in neither tn nor fp (§15).
 */
import YAML from 'yaml';
import type { AgentApi } from './agent.js';
import { AgentRunError, DEFAULT_MODEL } from './agent.js';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';

const SELECTION_PROMPT = `You are an AI coding agent deciding which skills to load for a user request.
Below is your full skill catalog. Select every skill whose description says it should be used
for this request — and no others. Selecting nothing is often correct.

SKILL CATALOG:
{catalog}

USER REQUEST:
{prompt}

Respond with ONLY a JSON object: {"selected": ["skill-name", ...]}
`;

export interface TriggerSpec {
  shouldTrigger: string[];
  shouldNotTrigger: string[];
}

/** Parse `skills/<name>/evals/triggers.yaml` (§5.2). Both lists optional; entries coerced to strings. */
export function parseTriggers(source: string): Result<TriggerSpec> {
  let raw: unknown;
  try { raw = YAML.parse(source); } catch (error) { return failure(`invalid triggers.yaml: ${error instanceof Error ? error.message : String(error)}`); }
  const record = (raw ?? {}) as Record<string, unknown>;
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
  return success({ shouldTrigger: list(record['should_trigger']), shouldNotTrigger: list(record['should_not_trigger']) });
}

export interface TriggerRow {
  prompt: string;
  expected: boolean;
  fired: boolean | null; // null = the selection call itself errored
  selected: string[];
  correct: boolean;
  error?: string;
}

export interface TriggerSummary {
  kind: 'triggers';
  skill: string;
  rows: TriggerRow[];
  recall: number | null;
  precision: number | null;
  tp: number;
  fn: number;
  fp: number;
  tn: number;
}

export interface TriggerOptions {
  skillName: string;
  /** `- name: description` lines for the endorsed set, skill under eval always included (§7.2). */
  catalog: string;
  spec: TriggerSpec;
  model?: string;
}

export async function runTriggerEvals(agent: AgentApi, options: TriggerOptions): Promise<TriggerSummary> {
  const prompts: Array<[string, boolean]> = [
    ...options.spec.shouldTrigger.map((prompt): [string, boolean] => [prompt, true]),
    ...options.spec.shouldNotTrigger.map((prompt): [string, boolean] => [prompt, false]),
  ];
  const rows: TriggerRow[] = [];
  for (const [prompt, expected] of prompts) {
    const selection = SELECTION_PROMPT.replace('{catalog}', options.catalog).replace('{prompt}', prompt);
    try {
      const verdict = await agent.askJson(selection, { model: options.model ?? DEFAULT_MODEL });
      const selected = Array.isArray(verdict['selected']) ? verdict['selected'].map(String) : [];
      const fired = selected.includes(options.skillName);
      rows.push({ prompt, expected, fired, selected, correct: fired === expected });
    } catch (error) {
      if (!(error instanceof AgentRunError)) throw error;
      rows.push({ prompt, expected, fired: null, selected: [], correct: false, error: error.message });
    }
  }
  const tp = rows.filter((row) => row.expected && row.fired === true).length;
  const fn = rows.filter((row) => row.expected && row.fired !== true).length;
  const fp = rows.filter((row) => !row.expected && row.fired === true).length;
  const tn = rows.filter((row) => !row.expected && row.fired === false).length;
  return {
    kind: 'triggers', skill: options.skillName, rows,
    recall: tp + fn ? tp / (tp + fn) : null,
    precision: tp + fp ? tp / (tp + fp) : null,
    tp, fn, fp, tn,
  };
}
