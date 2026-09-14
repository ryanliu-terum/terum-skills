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

/**
 * The model's own answer, verbatim and unmatched — or null when the list is empty, the model could
 * not be reached, the caller abandoned the call, or the reply was not a string. Never throws.
 *
 * Split out of `suggestCategory` so publish can START the ask against the category list it already
 * has on disk while its `git fetch` is still in flight, and MATCH the answer afterwards against the
 * list that fetch brought back. Asking and matching are two different moments for that caller; for
 * everyone else `suggestCategory` still does both at once.
 */
export async function askCategory(skillMd: string, categories: readonly string[], agent: AgentApi = systemAgent, signal?: AbortSignal): Promise<string | null> {
  if (!categories.length) return null;
  try {
    const answer = await agent.askJson(`Classify this Claude Code skill into exactly one category.

Allowed categories (choose one verbatim): ${categories.join(', ')}.

If none clearly fits, answer "misc".

Reply with only {"category": "<one of the allowed values>"}.

--- SKILL.md ---
${skillMd.slice(0, 2000)}`, { model: 'haiku', timeoutMs: 20_000, settingSources: '', ...(signal ? { signal } : {}) });
    const value = answer['category'];
    return typeof value === 'string' ? value : null;
  } catch {
    // Missing binary, authentication, timeout, abandonment and malformed JSON all leave publish usable offline.
    return null;
  }
}

/**
 * A raw answer read against the categories that are current NOW: the team's own spelling when it is
 * on the list, and the disclosed fallback when it is absent or names a bucket this team does not
 * have. Pure, so a caller that asked earlier can re-read the same answer against a newer list.
 */
export function resolveCategory(raw: string | null, categories: readonly string[]): CategorySuggestion {
  if (raw === null) return { category: DEFAULT_CATEGORY, suggested: false };
  const category = teamCategory(raw, categories);
  return category === undefined ? { category: DEFAULT_CATEGORY, suggested: false } : { category, suggested: true };
}

/** Never throws. Any failure is the disclosed fallback, never an invented bucket. */
export async function suggestCategory(skillMd: string, categories: readonly string[], agent: AgentApi = systemAgent, signal?: AbortSignal): Promise<CategorySuggestion> {
  return resolveCategory(await askCategory(skillMd, categories, agent, signal), categories);
}
