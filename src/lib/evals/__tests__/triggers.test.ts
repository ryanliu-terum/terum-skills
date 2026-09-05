import { describe, expect, it } from 'vitest';
import { AgentRunError, type AgentApi } from '../agent.js';
import { parseTriggers, runTriggerEvals } from '../triggers.js';

const fakeAgent = (byPrompt: Record<string, string[] | Error>): AgentApi => ({
  runAgent: () => { throw new Error('not used'); },
  askJson: (prompt) => {
    const key = Object.keys(byPrompt).find((candidate) => prompt.includes(candidate));
    const value = key === undefined ? [] : byPrompt[key]!;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve({ selected: value });
  },
});

describe('triggers.yaml parsing (§5.2)', () => {
  it('reads both lists, tolerates absence, rejects bad YAML', () => {
    const parsed = parseTriggers('should_trigger: ["a"]\nshould_not_trigger: ["b", "c"]\n');
    expect(parsed).toMatchObject({ ok: true, value: { shouldTrigger: ['a'], shouldNotTrigger: ['b', 'c'] } });
    expect(parseTriggers('')).toMatchObject({ ok: true, value: { shouldTrigger: [], shouldNotTrigger: [] } });
    expect(parseTriggers('should_trigger: [\n').ok).toBe(false);
  });
});

describe('trigger scoring (§7.2, port of triggers.py)', () => {
  it('membership per prompt; MISS and FALSE-FIRE derive from expected vs fired', async () => {
    const agent = fakeAgent({ 'fires': ['deploy-preflight'], 'silent': [], 'near-miss fires': ['deploy-preflight'], 'near-miss silent': ['other-skill'] });
    const summary = await runTriggerEvals(agent, {
      skillName: 'deploy-preflight',
      catalog: '- deploy-preflight: checks env before deploy\n- other-skill: something else',
      spec: { shouldTrigger: ['fires', 'silent'], shouldNotTrigger: ['near-miss fires', 'near-miss silent'] },
    });
    expect(summary).toMatchObject({ tp: 1, fn: 1, fp: 1, tn: 1, recall: 0.5, precision: 0.5 });
    expect(summary.rows.map((row) => row.correct)).toEqual([true, false, false, true]);
  });

  it('an errored selection call counts in neither tn nor fp (§15 adversarial)', async () => {
    const agent = fakeAgent({ 'good': ['s'], 'boom': new AgentRunError('network down') });
    const summary = await runTriggerEvals(agent, {
      skillName: 's', catalog: '- s: d',
      spec: { shouldTrigger: ['good'], shouldNotTrigger: ['boom'] },
    });
    expect(summary).toMatchObject({ tp: 1, fn: 0, fp: 0, tn: 0 });
    expect(summary.rows[1]).toMatchObject({ fired: null, correct: false, error: expect.stringContaining('network down') });
  });

  it('recall and precision are null-safe on empty lists', async () => {
    const summary = await runTriggerEvals(fakeAgent({}), { skillName: 's', catalog: '- s: d', spec: { shouldTrigger: [], shouldNotTrigger: [] } });
    expect(summary.recall).toBeNull();
    expect(summary.precision).toBeNull();
  });

  it('non-agent errors propagate', async () => {
    const agent = fakeAgent({ 'x': new TypeError('bug') });
    await expect(runTriggerEvals(agent, { skillName: 's', catalog: '', spec: { shouldTrigger: ['x'], shouldNotTrigger: [] } })).rejects.toThrow(TypeError);
  });
});
