import { DEFAULT_CATEGORY } from './skills.js';
import { systemAgent, type AgentApi } from './evals/agent.js';

export interface CategorySuggestion { category: string; suggested: boolean; }

/**
 * The team's own spelling of `value` — matched after trimming, case-insensitively — or undefined when
 * it is on no team category. The ONE matching rule for every category source: the model's answer
 * below and `--category` in publish.ts. Hybrid review r1 (medium, publish.ts:98): the flag used to be
 * stored raw, so ` ops ` and `Ops` each became a Browse bucket of their own beside the team's `ops`.
 */
export function teamCategory(value: string, categories: readonly string[]): string | undefined {
  const wanted = value.trim().toLowerCase();
  return categories.find(candidate => candidate.toLowerCase() === wanted);
}

/** Never throws. Any failure is the disclosed fallback, never an invented bucket. */
export async function suggestCategory(skillMd: string, categories: readonly string[], agent: AgentApi = systemAgent): Promise<CategorySuggestion> {
  const fallback = { category: DEFAULT_CATEGORY, suggested: false };
  if (!categories.length) return fallback;
  try {
    const answer = await agent.askJson(`Classify this Claude Code skill into exactly one category.

Allowed categories (choose one verbatim): ${categories.join(', ')}.

If none clearly fits, answer "misc".

Reply with only {"category": "<one of the allowed values>"}.

--- SKILL.md ---
${skillMd.slice(0, 2000)}`, { model: 'haiku', timeoutMs: 20_000, settingSources: '' });
    const value = answer['category'];
    if (typeof value !== 'string') return fallback;
    const category = teamCategory(value, categories);
    return category === undefined ? fallback : { category, suggested: true };
  } catch {
    // Missing binary, authentication, timeout and malformed JSON all leave publish usable offline.
    return fallback;
  }
}
