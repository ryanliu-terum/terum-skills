import { expect, it } from 'vitest';
import { buildProgram, type CliVerbs } from '../cli.js';
import { failure } from '../lib/result.js';
import { ScriptedPrompter } from '../lib/__tests__/fixtures.js';

it.each([undefined, 'bare'] as const)('threads form=%s into every CLI action, including guard-push and nested selectors', async (form) => {
  const calls: object[] = [];
  const stub = async (args: object) => { calls.push(args); return failure('stub'); };
  const verbs: CliVerbs = { login: stub, team: stub, setup: stub, connect: stub, install: stub, uninstall: stub, uninstallMachine: stub, sync: stub, search: stub, invite: stub, ls: stub, status: stub, readme: stub, publish: stub, leave: stub, guardPush: stub, validate: stub, eval: stub, receiptCheck: stub, update: stub };
  for (const argv of [
    ['login'], ['setup'], ['team', 'create'], ['team', 'join', 'org/repo'], ['team', 'remove', 'amy'], ['team', 'leave', 'team'], ['team', 'workflow-update'], ['invite', 'amy'],
    ['ls'], ['ls', 'member', 'amy'], ['ls', 'project', 'app'], ['status'], ['readme'], ['guard-push', 'origin', 'org/repo'], ['publish', 'sample'], ['validate', 'sample'], ['receipt-check'], ['eval', 'sample'], ['connect'],
    ['install', 'sample'], ['install', 'member', 'amy'], ['install', 'project', 'app'], ['uninstall-skill', 'sample'], ['uninstall-skill', 'member', 'amy'], ['uninstall-skill', 'project', 'app'], ['uninstall'], ['sync'], ['sync', '--hook'], ['search', 'term'], ['update'],
  ]) {
    calls.length = 0;
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, verbs, { form });
    await program.parseAsync(argv, { from: 'user' });
    expect(calls, argv.join(' ')).toHaveLength(1);
    expect(calls[0]).toHaveProperty('form', form);
  }
});

it.each([undefined, 'bare'] as const)('routes help and refusal text with form=%s while preserving Usage grammar', async (form) => {
  const errors: string[] = [];
  const prefix = form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest';
  const program = buildProgram(async (invoke) => { const result = await invoke(new ScriptedPrompter()); if (!result.ok) errors.push(result.error); }, undefined, { form });
  let help = ''; program.configureOutput({ writeOut: (line) => { help += line; } });
  program.outputHelp();
  expect(help).toContain('Usage: terum-skills');
  expect(help).toContain(`  Create a team: ${prefix} setup`);
  expect(program.commands.find((command) => command.name() === 'team')?.description()).toContain(`run \`${prefix} team\``);
  await program.parseAsync(['uninstall', 'sample'], { from: 'user' });
  await program.parseAsync(['share'], { from: 'user' });
  expect(errors).toEqual([
    `To remove a skill, use \`${prefix} uninstall-skill <ref>\`.`,
    `\`share\` is now \`connect\`: run \`${prefix} connect '[<path>]'\` (same options: --team, --allow-privileged, --keep-source, --keep-repo, --relocate, --forget).`,
  ]);
});
