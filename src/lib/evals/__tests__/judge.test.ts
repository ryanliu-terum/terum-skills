import { describe, expect, it } from 'vitest';
import { AgentRunError, type AgentApi } from '../agent.js';
import { judgePair, makeRng } from '../judge.js';

const agentReturning = (verdicts: Array<Record<string, unknown> | Error>): { agent: AgentApi; calls: Array<{ model?: string }> } => {
  const calls: Array<{ model?: string }> = [];
  return {
    calls,
    agent: {
      runAgent: () => { throw new Error('not used'); },
      askJson: (_prompt, options) => {
        calls.push({ model: options?.model });
        const next = verdicts[Math.min(calls.length - 1, verdicts.length - 1)]!;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    },
  };
};

const base = { task: 't', rubric: 'r', leftText: 'left transcript', rightText: 'right transcript', sleep: () => Promise.resolve() };

describe('position swap (§7.5)', () => {
  it('maps A/B back through the recorded swap so left/right stay the caller’s labels', async () => {
    const noSwap = await judgePair(agentReturning([{ winner: 'A', reason: 'x' }]).agent, { ...base, rng: () => 0.9 });
    expect(noSwap).toMatchObject({ winner: 'left', swapped: false, decidedBy: 'judge' });
    const swapped = await judgePair(agentReturning([{ winner: 'A', reason: 'x' }]).agent, { ...base, rng: () => 0.1 });
    expect(swapped).toMatchObject({ winner: 'right', swapped: true, decidedBy: 'judge' });
    const swappedB = await judgePair(agentReturning([{ winner: 'b', reason: 'x' }]).agent, { ...base, rng: () => 0.1 });
    expect(swappedB).toMatchObject({ winner: 'left', swapped: true });
  });

  it('a parsed but invalid winner is a judged tie, not an escalation', async () => {
    const { agent, calls } = agentReturning([{ winner: 'C', reason: 'confused' }]);
    expect(await judgePair(agent, { ...base, rng: () => 0.9 })).toMatchObject({ winner: 'tie', decidedBy: 'judge', reason: 'confused' });
    expect(calls).toHaveLength(1);
  });

  it('makeRng is deterministic for a seed (seed 0 reproducible)', () => {
    const first = makeRng(0);
    const second = makeRng(0);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });
});

describe('escalation chain (§7.5)', () => {
  it('parse failure → retry → escalation model → tie judge-unparseable', async () => {
    const { agent, calls } = agentReturning([new AgentRunError('model did not return JSON: garbage')]);
    const verdict = await judgePair(agent, { ...base, rng: () => 0.9, model: 'sonnet', escalationModel: 'opus' });
    expect(verdict).toMatchObject({ winner: 'tie', decidedBy: 'judge-unparseable' });
    expect(calls.map((call) => call.model)).toEqual(['sonnet', 'sonnet', 'opus']);
  });

  it('the escalation model can rescue the verdict', async () => {
    const { agent, calls } = agentReturning([
      new AgentRunError('model did not return JSON'),
      new AgentRunError('model did not return JSON'),
      { winner: 'B', reason: 'clearer' },
    ]);
    const verdict = await judgePair(agent, { ...base, rng: () => 0.9 });
    expect(verdict).toMatchObject({ winner: 'right', decidedBy: 'judge' });
    expect(calls).toHaveLength(3);
  });

  it('a usage-policy refusal is a tie with judge-refused, never coerced (§7.5)', async () => {
    const { agent, calls } = agentReturning([new AgentRunError('model did not return JSON: I cannot help with analyzing this due to our usage policy')]);
    const verdict = await judgePair(agent, { ...base, rng: () => 0.9 });
    expect(verdict).toMatchObject({ winner: 'tie', decidedBy: 'judge-refused' });
    expect(calls).toHaveLength(1); // refusals do not retry
  });

  it('non-agent errors propagate', async () => {
    const { agent } = agentReturning([new TypeError('bug')]);
    await expect(judgePair(agent, { ...base, rng: () => 0.9 })).rejects.toThrow(TypeError);
  });
});
