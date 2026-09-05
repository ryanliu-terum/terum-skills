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

describe('double-ask with position swap (§7.5 rev 7)', () => {
  it('an order-consistent judge decides; left/right stay the caller’s labels through the swap', async () => {
    // First ask unswapped (rng 0.9): A = left. Second ask swapped: B = left. Consistent → left.
    const noSwap = await judgePair(agentReturning([{ winner: 'A', reason: 'x' }, { winner: 'B', reason: 'y' }]).agent, { ...base, rng: () => 0.9 });
    expect(noSwap).toMatchObject({ winner: 'left', swapped: false, decidedBy: 'judge', reason: 'x' });
    // First ask swapped (rng 0.1): A = right. Second ask unswapped: B = right. Consistent → right.
    const swapped = await judgePair(agentReturning([{ winner: 'a', reason: 'x' }, { winner: 'b', reason: 'y' }]).agent, { ...base, rng: () => 0.1 });
    expect(swapped).toMatchObject({ winner: 'right', swapped: true, decidedBy: 'judge' });
  });

  it('a position-biased judge (always A) is a tie labeled judge-split, never a coin flip', async () => {
    const { agent, calls } = agentReturning([{ winner: 'A', reason: 'x' }]);
    const verdict = await judgePair(agent, { ...base, rng: () => 0.9 });
    expect(verdict).toMatchObject({ winner: 'tie', decidedBy: 'judge-split' });
    expect(verdict.reason).toContain('orderings disagree');
    expect(calls).toHaveLength(2);
  });

  it('two ties agree into a judged tie; a tie against a pick splits', async () => {
    const bothTie = await judgePair(agentReturning([{ winner: 'tie', reason: 'even' }]).agent, { ...base, rng: () => 0.9 });
    expect(bothTie).toMatchObject({ winner: 'tie', decidedBy: 'judge', reason: 'even' });
    const half = await judgePair(agentReturning([{ winner: 'A', reason: 'x' }, { winner: 'tie', reason: 'even' }]).agent, { ...base, rng: () => 0.9 });
    expect(half).toMatchObject({ winner: 'tie', decidedBy: 'judge-split' });
  });

  it('a parsed but invalid winner counts as that ask saying tie', async () => {
    const { agent, calls } = agentReturning([{ winner: 'C', reason: 'confused' }]);
    expect(await judgePair(agent, { ...base, rng: () => 0.9 })).toMatchObject({ winner: 'tie', decidedBy: 'judge', reason: 'confused' });
    expect(calls).toHaveLength(2);
  });

  it('makeRng is deterministic for a seed (seed 0 reproducible)', () => {
    const first = makeRng(0);
    const second = makeRng(0);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });
});

describe('escalation chain (§7.5)', () => {
  it('first ask exhausting the chain → tie judge-unparseable, no second ask', async () => {
    const { agent, calls } = agentReturning([new AgentRunError('model did not return JSON: garbage')]);
    const verdict = await judgePair(agent, { ...base, rng: () => 0.9, model: 'sonnet', escalationModel: 'opus' });
    expect(verdict).toMatchObject({ winner: 'tie', decidedBy: 'judge-unparseable' });
    expect(calls.map((call) => call.model)).toEqual(['sonnet', 'sonnet', 'opus']);
  });

  it('the escalation model can rescue the first ask; the second ask still runs and must agree', async () => {
    const { agent, calls } = agentReturning([
      new AgentRunError('model did not return JSON'),
      new AgentRunError('model did not return JSON'),
      { winner: 'B', reason: 'clearer' },   // first ask (unswapped): B = right
      { winner: 'A', reason: 'clearer' },   // second ask (swapped): A = right
    ]);
    const verdict = await judgePair(agent, { ...base, rng: () => 0.9 });
    expect(verdict).toMatchObject({ winner: 'right', decidedBy: 'judge' });
    expect(calls).toHaveLength(4);
  });

  it('a second-ask chain failure ties as judge-unparseable', async () => {
    const { agent, calls } = agentReturning([
      { winner: 'A', reason: 'x' },
      new AgentRunError('model did not return JSON'),
    ]);
    const verdict = await judgePair(agent, { ...base, rng: () => 0.9 });
    expect(verdict).toMatchObject({ winner: 'tie', decidedBy: 'judge-unparseable' });
    expect(calls).toHaveLength(4); // 1 judged + 3 chain attempts
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
