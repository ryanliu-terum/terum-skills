/**
 * Eval spec §7.5: pairwise LLM judge, ported from skilldeck `evals/judge.py` (42084dc) plus the
 * adopted escalation chain (skilldeck has none): parse failure → one retry → re-ask on the
 * escalation model → final failure = tie `judge-unparseable`. A usage-policy refusal is a
 * documented failure mode: tie with `judge-refused`, surfaced, never coerced.
 * Never scores a transcript in isolation — pairwise with randomized A/B is far more stable.
 */
import type { AgentApi } from './agent.js';
import { AgentRunError, DEFAULT_MODEL } from './agent.js';

export const TRANSCRIPT_TAIL = 6000; // chars of each transcript shown to the judge
export const DEFAULT_ESCALATION_MODEL = 'opus'; // §16.9 [provisional]

const PROMPT = `You are judging two AI agent transcripts for the same task. Decide which one
better satisfies the rubric. Be strict; "tie" is a valid answer when neither is clearly better.

TASK GIVEN TO BOTH AGENTS:
{task}

RUBRIC:
{rubric}

TRANSCRIPT A (tail):
{a}

TRANSCRIPT B (tail):
{b}

Respond with ONLY a JSON object: {"winner": "A" | "B" | "tie", "reason": "<one sentence>"}
`;

/** Deterministic seeded RNG (mulberry32) — §7.5: seed 0, reproducible position swaps. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REFUSAL = /usage policy|policy violation|can(?:no|')t (?:help|assist)|unable to (?:help|assist)/i;

export interface JudgeVerdict {
  winner: 'left' | 'right' | 'tie';
  reason: string;
  swapped: boolean;
  decidedBy: 'judge' | 'judge-unparseable' | 'judge-refused';
}

export interface JudgeOptions {
  task: string;
  rubric: string;
  leftText: string;
  rightText: string;
  rng: () => number;
  model?: string;
  escalationModel?: string;
  /** Injectable for tests; production default is a short backoff between chain attempts. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Compare two transcripts. left/right are the caller's labels; A/B assignment is randomized here
 * so the judge can't develop a position bias, and the swap is recorded in the row.
 */
export async function judgePair(agent: AgentApi, options: JudgeOptions): Promise<JudgeVerdict> {
  const model = options.model ?? DEFAULT_MODEL;
  const sleep = options.sleep ?? defaultSleep;
  const swap = options.rng() < 0.5;
  const [a, b] = swap ? [options.rightText, options.leftText] : [options.leftText, options.rightText];
  const prompt = PROMPT
    .replace('{task}', options.task)
    .replace('{rubric}', options.rubric)
    .replace('{a}', a.slice(-TRANSCRIPT_TAIL))
    .replace('{b}', b.slice(-TRANSCRIPT_TAIL));

  const chain = [model, model, options.escalationModel ?? DEFAULT_ESCALATION_MODEL];
  let lastError = '';
  for (let attempt = 0; attempt < chain.length; attempt++) {
    try {
      const verdict = await agent.askJson(prompt, { model: chain[attempt]! });
      const winner = String(verdict['winner'] ?? 'tie').trim().toUpperCase();
      const reason = String(verdict['reason'] ?? '');
      if (winner !== 'A' && winner !== 'B') return { winner: 'tie', reason, swapped: swap, decidedBy: 'judge' };
      const mapped = (winner === 'A') !== swap ? 'left' : 'right';
      return { winner: mapped, reason, swapped: swap, decidedBy: 'judge' };
    } catch (error) {
      if (!(error instanceof AgentRunError)) throw error;
      lastError = error.message;
      if (REFUSAL.test(lastError)) return { winner: 'tie', reason: lastError.slice(0, 300), swapped: swap, decidedBy: 'judge-refused' };
      if (attempt < chain.length - 1) await sleep(500 * (attempt + 1));
    }
  }
  return { winner: 'tie', reason: lastError.slice(0, 300), swapped: swap, decidedBy: 'judge-unparseable' };
}
