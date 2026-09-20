import { describe, expect, it } from 'vitest';
import type { HarvestedPrompt, Observation } from '../harvest.js';
import { reconcile, type Judged } from '../reconcile.js';

const prompt = (text: string, ts: string, observations: Observation[] = []): HarvestedPrompt =>
  ({ text, ts, context: [], noPriorContext: false, observations });
const judged = (p: HarvestedPrompt, selected: string[] | null): Judged => ({ prompt: p, selected });
const at = (n: number): string => `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`;

describe('reconcile — a candidate is a (prompt, skill) pair', () => {
  it('drops a judged skill that fired autonomously (D1)', () => {
    const q = reconcile([judged(prompt('x', at(1), [{ skill: 'alpha', kind: 'D1' }]), ['alpha'])], { limit: 20 });
    expect(q.candidates).toBe(0);
  });

  it('drops a judged skill that fired EXPLICITLY (D2) — the human already chose', () => {
    // That is layer 2's row, not a miss. Without D2 evidence this is the false-miss bug.
    const q = reconcile([judged(prompt('x', at(1), [{ skill: 'alpha', kind: 'D2' }]), ['alpha'])], { limit: 20 });
    expect(q.candidates).toBe(0);
  });

  it('keeps a judged skill when a DIFFERENT skill fired in the same window', () => {
    const q = reconcile([judged(prompt('x', at(1), [{ skill: 'other', kind: 'D1' }]), ['alpha'])], { limit: 20 });
    expect(q.groups[0]!.skill).toBe('alpha');
    expect(q.candidates).toBe(1);
  });

  it('yields three candidates in three groups for one prompt judged for three skills', () => {
    const q = reconcile([judged(prompt('x', at(1)), ['a', 'b', 'c'])], { limit: 20 });
    expect(q.candidates).toBe(3);
    expect(q.groups).toHaveLength(3);
    expect(q.prompts).toBe(1);
  });

  it('counts prompts and candidates as different units — the headline names both', () => {
    const q = reconcile([judged(prompt('x', at(1)), ['a', 'b'])], { limit: 20 });
    expect(q.candidates).toBe(2);
    expect(q.prompts).toBe(1);
  });

  it('never scores an errored batch as "nothing applies"', () => {
    const q = reconcile([judged(prompt('x', at(1)), null)], { limit: 20 });
    expect(q.candidates).toBe(0);
    expect(q.unjudged).toBe(1);
  });
});

describe('reconcile — ordering is total and the cap is global', () => {
  it('orders groups by candidate count descending, ties by name ascending', () => {
    const q = reconcile([
      judged(prompt('p1', at(1)), ['zeta', 'alpha']),
      judged(prompt('p2', at(2)), ['zeta']),
    ], { limit: 20 });
    expect(q.groups.map((g) => g.skill)).toEqual(['zeta', 'alpha']);
  });

  it('breaks a count tie by skill name, not by insertion order', () => {
    const q = reconcile([judged(prompt('p', at(1)), ['zulu', 'alpha'])], { limit: 20 });
    expect(q.groups.map((g) => g.skill)).toEqual(['alpha', 'zulu']);
  });

  it('orders rows inside a group by timestamp descending', () => {
    const q = reconcile([
      judged(prompt('older', at(1)), ['a']),
      judged(prompt('newer', at(9)), ['a']),
    ], { limit: 20 });
    expect(q.groups[0]!.candidates.map((c) => c.prompt)).toEqual(['newer', 'older']);
  });

  it('keeps corpus order under an equal timestamp, so two runs print identically', () => {
    const q = reconcile([
      judged(prompt('first', at(1)), ['a']),
      judged(prompt('second', at(1)), ['a']),
    ], { limit: 20 });
    expect(q.groups[0]!.candidates.map((c) => c.prompt)).toEqual(['first', 'second']);
  });

  it('caps GLOBALLY on pairs and truncates mid-group', () => {
    const q = reconcile([
      judged(prompt('p1', at(1)), ['a']),
      judged(prompt('p2', at(2)), ['a']),
      judged(prompt('p3', at(3)), ['a']),
    ], { limit: 2 });
    expect(q.candidates).toBe(2);
    expect(q.truncated).toBe(true);
  });

  it('does not claim truncation when everything fits', () => {
    expect(reconcile([judged(prompt('p', at(1)), ['a'])], { limit: 20 }).truncated).toBe(false);
  });

  it('narrows to one skill when named, without touching what was judged', () => {
    const q = reconcile([judged(prompt('p', at(1)), ['a', 'b'])], { limit: 20, ref: 'a' });
    expect(q.groups.map((g) => g.skill)).toEqual(['a']);
  });
});
