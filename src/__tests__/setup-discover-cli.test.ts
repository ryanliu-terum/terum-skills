import { expect, it, vi } from 'vitest';
import { buildProgram, type Execute } from '../cli.js';
import { run as login } from '../commands/login.js';
import { run as team } from '../commands/team.js';
import { success } from '../lib/result.js';
import { ScriptedPrompter } from '../lib/__tests__/fixtures.js';
const execute: Execute = async invoke => { await invoke(new ScriptedPrompter()); };
it('keeps repeated and leading-dash discovery roots intact and forwards the limits', async () => {
  const checkout = vi.fn(async () => success({ candidates: [], scanned: 0, truncated: false, problems: [] }));
  const program = buildProgram(execute, { login, team, checkout });
  await program.parseAsync(['checkout', 'discover', '--under=-x', '--under', '/two', '--depth', '0', '--budget-ms', '0', '--register'], { from: 'user' });
  expect(checkout).toHaveBeenCalledWith({ form: undefined, kind: 'discover', under: ['-x', '/two'], depth: 0, budgetMs: 0, register: true, cwd: process.cwd() }, expect.any(ScriptedPrompter));
});
it.each([[], ['--no-discover', '--no-evals']])('forwards setup optional-step flags %j', async (...flags) => {
  const setup = vi.fn(async () => success({ team: 'team', remote: 'remote', role: 'creator' as const, steps: {} }));
  await buildProgram(execute, { login, team, setup }).parseAsync(['setup', ...flags], { from: 'user' });
  expect(setup).toHaveBeenCalledWith(expect.objectContaining({ discover: flags.length === 0, evals: flags.length === 0 }), expect.any(ScriptedPrompter));
});
