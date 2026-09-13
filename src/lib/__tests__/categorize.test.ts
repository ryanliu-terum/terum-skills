import { describe, expect, it, vi } from 'vitest';
import { suggestCategory } from '../categorize.js';
import { AgentRunError, type AgentApi } from '../evals/agent.js';

const categories = ['debugging', 'testing', 'docs', 'workflow', 'research', 'infra', 'review', 'misc'];
const fallback = { category: 'misc', suggested: false };
const agentFor = (answer: Record<string, unknown>): AgentApi => ({ askJson: vi.fn().mockResolvedValue(answer), runAgent: vi.fn() });

describe('suggestCategory — the graded prompt and answer contract', () => {
  it('uses the exact grading prompt, capped input, Haiku, 20 seconds and no project settings', async () => {
    const agent = agentFor({ category: 'review' });
    const skill = '---\nname: ultrareview\ndescription: Review code for defects\n---\n'.padEnd(2100, 'x');
    expect(await suggestCategory(skill, categories, agent)).toEqual({ category: 'review', suggested: true });
    expect(agent.askJson).toHaveBeenCalledExactlyOnceWith(`Classify this Claude Code skill into exactly one category.

Allowed categories (choose one verbatim): debugging, testing, docs, workflow, research, infra, review, misc.

If none clearly fits, answer "misc".

Reply with only {"category": "<one of the allowed values>"}.

--- SKILL.md ---
${skill.slice(0, 2000)}`, { model: 'haiku', timeoutMs: 20_000, settingSources: '' });
    expect(agent.runAgent).not.toHaveBeenCalled();
  });

  it('trims and canonicalises to the team spelling', async () => {
    expect(await suggestCategory('skill', ['Review', 'misc'], agentFor({ category: '  rEVIEW  ' }))).toEqual({ category: 'Review', suggested: true });
  });
  it('distinguishes a model-selected misc from an unavailable model', async () => {
    expect(await suggestCategory('skill', categories, agentFor({ category: 'misc' }))).toEqual({ category: 'misc', suggested: true });
  });
  it.each([{ category: 'invented' }, {}, { category: 7 }, { category: null }, { category: '' }, { category: '   ' }])('falls back for invalid answer %j', async answer => {
    expect(await suggestCategory('skill', categories, agentFor(answer))).toEqual(fallback);
  });
  it.each(['binary absent', 'not logged in', 'offline', 'rate limited', 'model did not return JSON', 'model returned unparseable JSON', 'model call timed out after 20000ms'])('never throws or retries: %s', async message => {
    const agent = agentFor({});
    vi.mocked(agent.askJson).mockRejectedValue(new AgentRunError(message));
    expect(await suggestCategory('skill', categories, agent)).toEqual(fallback);
    expect(agent.askJson).toHaveBeenCalledTimes(1);
  });
  it('makes no call for an empty taxonomy', async () => {
    const agent = agentFor({ category: 'review' });
    expect(await suggestCategory('skill', [], agent)).toEqual(fallback);
    expect(agent.askJson).not.toHaveBeenCalled();
  });
});
