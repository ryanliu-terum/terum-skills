import { expect, it } from 'vitest';
import { buildProgram } from '../../cli.js';
import { createExecute } from '../../lib/execute.js';
import type { ResultOutcome } from '../../lib/frames.js';
import { ScriptedPrompter } from '../../lib/__tests__/fixtures.js';

it.each([
  ['--drain', '--parallel', '2'], ['--queue-list'], ['--drain', '--window', 'overnight', '--max', '1'], ['--dequeue', 'team/alpha'],
])('public eval mode %j accepts no skill operand and exposes a structured result', async (...flags) => {
  const outcomes: ResultOutcome[] = [], codes: number[] = [];
  const execute = createExecute({ io: new ScriptedPrompter(), stderr: () => {}, setExitCode: code => codes.push(code), result: result => outcomes.push(result) });
  await buildProgram(execute).parseAsync(['eval', ...flags], { from: 'user' });
  expect(codes).toEqual([]); expect(outcomes).toHaveLength(1);
  expect(outcomes[0]).toMatchObject({ verb: 'eval', ok: true, exitCode: 0, value: { items: [] } });
});
it('lists every queue flag in public eval help', () => {
  const help = buildProgram(async () => {}).commands.find(command => command.name() === 'eval')!.helpInformation();
  for (const flag of ['--queue-list', '--drain', '--window', '--max', '--dequeue', '--parallel', '--batch', '--pending']) expect(help).toContain(flag);
  expect(help).toContain('[skills...]');
});
it.each([[], ['--parallel', '2'], ['--drain', '--parallel', '0'], ['--drain', '--parallel', '1.5'], ['--drain', '--max', '0'], ['--queue-list', '--drain'], ['--window', 'overnight'], ['alpha', '--drain'], ['--batch', '2'], ['alpha', '--window', 'overnight', '--batch', '2'], ['alpha', 'beta', '--drain']])('fails invalid eval arguments %j through the result channel', async (...flags) => {
  const outcomes: ResultOutcome[] = [];
  const execute = createExecute({ io: new ScriptedPrompter(), stderr: () => {}, setExitCode: () => {}, result: result => outcomes.push(result) });
  await buildProgram(execute).parseAsync(['eval', ...flags], { from: 'user' });
  expect(outcomes[0]).toMatchObject({ verb: 'eval', ok: false, exitCode: 1 });
});
