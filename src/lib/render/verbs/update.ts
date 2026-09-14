import { board, kv, status, text, textBlock, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, str } from './shared.js';

export const render = (raw: unknown, _ctx: RenderContext): Board => { void _ctx;
  const value = asRecord(raw); const running = str(value['running']); const observation = str(value['observation']);
  const b = board(`terum-skills ${running ?? 'version unknown'}`);
  const tone = observation === 'older' ? 'warn' : observation === 'same' ? 'ok' : 'muted';
  b.headline = observation === 'older' ? `A newer release is advertised: ${str(value['latest']) ?? '?'}` : observation === 'same' ? 'This copy matches the advertised release.' : observation === 'newer' ? 'This copy is ahead of the advertised release.' : 'No release advertisement is known.';
  b.sections.push(kv([['latest', status(tone, str(value['latest']) ?? 'unknown')], ['observation', text(observation)], ['launch', text(value['launch'])]]));
  const description = str(value['description']); if (description !== null && description !== '') b.sections.push(textBlock(description.split('\n'), { title: 'Release check' }));
  const advice = asArray(value['advice']).map(String);
  const printed = new Set(asArray(value['lines']).map(String));
  const shown = advice.length > 0 && advice.every((line) => printed.has(line)); // update.ts prints advice only when the copy does not match the advertisement
  if (shown) b.sections.push(textBlock(advice, { title: 'How to update' }));
  const command = shown ? advice.find((line) => line.startsWith('  '))?.trim() : undefined;
  if (command !== undefined) b.next.push({ label: 'Update', raw: command });
  return b;
};
/** Every line `update` prints is in `value.lines`; a line outside it is a note. */
export function uncovered(lines: readonly string[], raw: unknown): string[] { const printed = new Set(asArray(asRecord(raw)['lines']).map(String)); return lines.filter((line) => !printed.has(line)); }
export const renderer: Renderer = { render, covered: [], uncovered };
