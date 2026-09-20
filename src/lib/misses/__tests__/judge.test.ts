import { describe, expect, it } from 'vitest';
import type { AgentApi } from '../../evals/agent.js';
import { AgentRunError } from '../../evals/agent.js';
import type { CatalogEntry } from '../catalog.js';
import type { HarvestedPrompt } from '../harvest.js';
import { batchCount, judgePrompts } from '../judge.js';

const at = (n: number): string => `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`;
const prompt = (text: string, ts = at(5)): HarvestedPrompt => ({ text, ts, context: [], noPriorContext: true, observations: [] });
const entries: CatalogEntry[] = [{ name: 'alpha', description: 'does alpha', placedAt: at(1) }];

/** No test in this file may spend a subscription call: the agent is always a stub. */
const stub = (askJson: AgentApi['askJson']): AgentApi => ({ askJson, runAgent: (() => { throw new Error('not used'); }) as AgentApi['runAgent'] });

describe('judge — batching', () => {
  it('splits into batches and rejoins in order', async () => {
    const seen: string[] = [];
    const agent = stub(async (task: string) => {
      seen.push(task);
      return { '1': ['alpha'], '2': [], '3': [] };
    });
    const prompts = [prompt('a'), prompt('b'), prompt('c'), prompt('d')];
    const out = await judgePrompts(prompts, { agent, entries, batchSize: 3 });
    expect(seen).toHaveLength(2);
    expect(out.map((row) => row.prompt.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(out[0]!.selected).toEqual(['alpha']);
  });

  it('counts the calls a run costs, so the cost is never hidden', () => {
    expect(batchCount(340, 10)).toBe(34);
    expect(batchCount(0, 10)).toBe(0);
  });

  it('sends the prompt context to the judge — context blindness is the main validity limit', async () => {
    let task = '';
    const agent = stub(async (t: string) => { task = t; return { '1': [] }; });
    await judgePrompts([{ ...prompt('ok do that'), context: ['earlier: settle the forks'], noPriorContext: false }], { agent, entries });
    expect(task).toContain('earlier: settle the forks');
    expect(task).toContain('ok do that');
  });
});

describe('judge — failures never invent a verdict', () => {
  it('yields no judgment in EITHER direction when the call errors', async () => {
    const agent = stub(async () => { throw new AgentRunError('model call failed'); });
    const out = await judgePrompts([prompt('a')], { agent, entries });
    expect(out[0]!.selected).toBeNull();
  });

  it('treats a missing id as unjudged, not as an empty selection', async () => {
    // Scoring silence as "nothing applies" would manufacture a clean result from a broken reply.
    const agent = stub(async () => ({ '1': ['alpha'] }));
    const out = await judgePrompts([prompt('a'), prompt('b')], { agent, entries, batchSize: 2 });
    expect(out[0]!.selected).toEqual(['alpha']);
    expect(out[1]!.selected).toBeNull();
  });

  it('survives a reply whose value is not an array', async () => {
    const agent = stub(async () => ({ '1': 'alpha' }));
    expect((await judgePrompts([prompt('a')], { agent, entries }))[0]!.selected).toBeNull();
  });

  it('rethrows a non-agent error rather than swallowing a bug', async () => {
    const agent = stub(async () => { throw new TypeError('bug'); });
    await expect(judgePrompts([prompt('a')], { agent, entries })).rejects.toThrow(TypeError);
  });
});

describe('judge — the as-of-T catalog', () => {
  it('spends no call when nothing was installed yet at that point in history', async () => {
    let calls = 0;
    const agent = stub(async () => { calls += 1; return {}; });
    const out = await judgePrompts([prompt('a', at(1))], { agent, entries: [{ name: 'alpha', description: 'x', placedAt: at(9) }] });
    expect(calls).toBe(0);
    expect(out[0]!.selected).toEqual([]);
  });

  it('never shows the judge a skill that did not exist yet', async () => {
    let task = '';
    const agent = stub(async (t: string) => { task = t; return { '1': [] }; });
    await judgePrompts([prompt('a', at(5))], {
      agent,
      entries: [{ name: 'old', description: 'd', placedAt: at(1) }, { name: 'future', description: 'd', placedAt: at(9) }],
    });
    expect(task).toContain('old');
    expect(task).not.toContain('future');
  });
});
