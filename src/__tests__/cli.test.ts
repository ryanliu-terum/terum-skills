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
      login: async (args) => { calls.push({ verb: 'login', ...args }); return success({ gh: { installed: true, authenticated: true }, handle: 'me' }); },
      team: async (args) => { calls.push({ verb: 'team', ...args }); return args.kind === 'join' && args.target === 'fail/fail' ? failure('nope') : success({ team: 't', remote: 'r' }); },
      invite: async (args) => { calls.push({ verb: 'invite', ...args }); return success({ team: 't', invited: [], already: [] }); },
      ls: async (args) => { calls.push({ verb: 'ls', ...args }); return success({ roster: [], skills: [] }); },
      readme: async (args) => { calls.push({ verb: 'readme', ...args }); return success({ changed: false }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    return { program, calls, outcomes };
  };

  it('maps every flag onto the verb arguments', async () => {
    const { program, calls } = harness();
    await program.parseAsync(['team', 'create', 'alpha', '--org', 'acme', '--remote', 'https://x/y.git'], { from: 'user' });
    await program.parseAsync(['team', 'join', 'acme/alpha', '--as', 'local-alpha'], { from: 'user' });
    await program.parseAsync(['login'], { from: 'user' });
    await program.parseAsync(['team', 'create', '--repo', 'skills-repo'], { from: 'user' });
    expect(calls).toEqual([
      { verb: 'team', kind: 'create', name: 'alpha', org: 'acme', remote: 'https://x/y.git' },
      { verb: 'team', kind: 'join', target: 'acme/alpha', as: 'local-alpha' },
      { verb: 'login' },
      { verb: 'team', kind: 'create', name: undefined, repo: 'skills-repo' },
    ]);
  });

  it('routes a failing Result to execute, and login takes no team or remote (rev 9, Decision 4)', async () => {
    const { program, outcomes } = harness();
    await program.parseAsync(['team', 'join', 'fail/fail'], { from: 'user' });
    expect(outcomes).toEqual([false]);
    expect(program.commands.find((command) => command.name() === 'login')?.options).toEqual([]);
  });

  it('wires every M2 verb and passes a missing install member value through as a clear command failure', async () => {
    const calls: unknown[] = []; const outcomes: boolean[] = [];
    const execute: Execute = async (invoke) => { outcomes.push((await invoke(new ScriptedPrompter())).ok); };
    const program = buildProgram(execute, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me' }), team: async () => success({ team: 't', remote: 'r' }),
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

  it('wires the M3 team-layer commands, keeping readme hidden from help', async () => {
    const { program, calls } = harness();
    await program.parseAsync(['invite', 'amy', 'bea', '--team', 't'], { from: 'user' });
    await program.parseAsync(['team', 'remove', 'amy', '--archive-only', '--team', 't'], { from: 'user' });
    await program.parseAsync(['ls', 'project', 'app', '--team', 't'], { from: 'user' });
    await program.parseAsync(['readme', '--pr-comment', 'origin/main'], { from: 'user' });
    expect(calls).toEqual([
      { verb: 'invite', logins: ['amy', 'bea'], team: 't' },
      { verb: 'team', kind: 'remove', handle: 'amy', archiveOnly: true, team: 't' },
      { verb: 'ls', kind: 'project', value: 'app', team: 't' },
      { verb: 'readme', prComment: 'origin/main' },
    ]);
    expect(program.helpInformation()).not.toContain('readme');
  });

  it('keeps omitted archiveOnly false and supports parent-level ls team options', async () => {
    const parse = async (argv: string[]) => {
      const { program, calls } = harness();
      await program.parseAsync(argv, { from: 'user' });
      return calls;
    };
    expect(await parse(['team', 'remove', 'cy', '--team', 't'])).toEqual([{ verb: 'team', kind: 'remove', handle: 'cy', team: 't' }]);
    expect(await parse(['ls', '--team', 't'])).toEqual([{ verb: 'ls', kind: 'all', team: 't' }]);
    expect(await parse(['ls', '--team', 't', 'member', 'amy'])).toEqual([{ verb: 'ls', kind: 'member', value: 'amy', team: 't' }]);
  });
});
