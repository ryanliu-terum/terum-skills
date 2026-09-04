import { describe, expect, it } from 'vitest';
import { buildProgram, Execute } from '../cli.js';
import { failure, success } from '../lib/result.js';
import { ScriptedPrompter } from '../lib/__tests__/fixtures.js';

describe('CLI wiring (§3: commander wiring only)', () => {
  const harness = () => {
    const calls: unknown[] = [];
    const outcomes: boolean[] = [];
    const execute: Execute = async (invoke) => { const result = await invoke(new ScriptedPrompter()); outcomes.push(result.ok); };
    const program = buildProgram(execute, {
      login: async (args) => { calls.push({ verb: 'login', ...args }); return success({ authenticated: true, github: true }); },
      team: async (args) => { calls.push({ verb: 'team', ...args }); return args.kind === 'join' && args.target === 'fail/fail' ? failure('nope') : success({ team: 't', remote: 'r' }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    return { program, calls, outcomes };
  };

  it('maps every flag onto the verb arguments', async () => {
    const { program, calls } = harness();
    await program.parseAsync(['team', 'create', 'alpha', '--org', 'acme', '--remote', 'https://x/y.git'], { from: 'user' });
    await program.parseAsync(['team', 'join', 'acme/alpha', '--as', 'local-alpha'], { from: 'user' });
    await program.parseAsync(['login', '--team', 'alpha', '--remote', 'github.com/acme/alpha'], { from: 'user' });
    expect(calls).toEqual([
      { verb: 'team', kind: 'create', name: 'alpha', org: 'acme', remote: 'https://x/y.git' },
      { verb: 'team', kind: 'join', target: 'acme/alpha', as: 'local-alpha' },
      { verb: 'login', team: 'alpha', remote: 'github.com/acme/alpha' },
    ]);
  });

  it('routes a failing Result to execute and rejects a login without its required flags', async () => {
    const { program, outcomes } = harness();
    await program.parseAsync(['team', 'join', 'fail/fail'], { from: 'user' });
    expect(outcomes).toEqual([false]);
    await expect(program.parseAsync(['login', '--team', 'alpha'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
  });
});
