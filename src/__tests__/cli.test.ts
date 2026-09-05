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

  it('wires every M2 verb and passes a missing install member value through as a clear command failure', async () => {
    const calls: unknown[] = []; const outcomes: boolean[] = [];
    const execute: Execute = async (invoke) => { outcomes.push((await invoke(new ScriptedPrompter())).ok); };
    const program = buildProgram(execute, {
      login: async () => success({ authenticated: true, github: true }), team: async () => success({ team: 't', remote: 'r' }),
      share: async (args) => { calls.push(['share', args]); return success(undefined); },
      install: async (args) => { calls.push(['install', args]); return args.kind === 'member' && !args.member ? failure('Provide a member handle.') : success([]); },
      uninstall: async (args) => { calls.push(['uninstall', args]); return success([]); },
      sync: async (args) => { calls.push(['sync', args]); return success({ placed: 0, deferred: [], notices: [], changed: false, hook: Boolean(args.hook) }); },
      search: async (args) => { calls.push(['search', args]); return success([]); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['share', 'folder', '--team', 'team'], { from: 'user' });
    await program.parseAsync(['install', 'sample', '--team', 'team'], { from: 'user' });
    await program.parseAsync(['install', 'member'], { from: 'user' });
    await program.parseAsync(['uninstall', 'sample', '--team', 'team'], { from: 'user' });
    await program.parseAsync(['sync', '--hook'], { from: 'user' });
    await program.parseAsync(['search', 'term', '--category', 'testing'], { from: 'user' });
    expect(calls).toEqual(expect.arrayContaining([
      ['share', expect.objectContaining({ path: 'folder', team: 'team' })], ['install', expect.objectContaining({ ref: 'sample', team: 'team' })],
      ['install', expect.objectContaining({ kind: 'member', member: undefined })], ['uninstall', expect.objectContaining({ ref: 'sample', team: 'team' })],
      ['sync', { hook: true, prune: undefined }], ['search', { term: 'term', category: 'testing' }],
    ]));
    expect(outcomes).toEqual([true, true, false, true, true, true]);
  });
});
