import { expect, it } from 'vitest';
import { parseCliFrame } from '../frames';

it.each(['confirm', 'text', 'select', 'path'] as const)('parses an ask of kind %s (every kind the CLI emits)', kind => {
  expect(parseCliFrame(JSON.stringify({ t: 'ask', id: 'q1', kind, question: 'Which folder?', default: '/home/me/repo' }))).toEqual({ t: 'ask', id: 'q1', kind, question: 'Which folder?', default: '/home/me/repo' });
});
it('rejects an ask kind the CLI never emits', () => {
  expect(parseCliFrame(JSON.stringify({ t: 'ask', id: 'q1', kind: 'multi', question: 'Which?' }))).toBeNull();
});
