import { describe, expect, it } from 'vitest';
import { buildProgram, Execute } from '../cli.js';
import { failure, success } from '../lib/result.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createExecute } from '../lib/execute.js';
import { createConfigStore } from '../lib/config.js';
import { run as share } from '../commands/share.js';
import { NonInteractivePrompter, temporaryDirectory, ScriptedPrompter } from '../lib/__tests__/fixtures.js';

describe('CLI wiring (§3: commander wiring only)', () => {
  const harness = () => {
    const calls: unknown[] = [];
    const outcomes: boolean[] = [];
    const execute: Execute = async (invoke) => { const result = await invoke(new ScriptedPrompter()); outcomes.push(result.ok); };
    const program = buildProgram(execute, {
      login: async (args) => { calls.push({ verb: 'login', ...args }); return success({ gh: { installed: true, authenticated: true }, handle: 'me' }); },
      team: async (args) => { calls.push({ verb: 'team', ...args }); return args.kind === 'join' && args.target === 'fail/fail' ? failure('nope') : success({ team: 't', remote: 'r' }); },
      setup: async (args) => { calls.push({ verb: 'setup', ...args }); return success({ role: args.target ? 'joiner' : 'creator', team: 't', remote: 'r', steps: {} as never }); },
      invite: async (args) => { calls.push({ verb: 'invite', ...args }); return success({ team: 't', invited: [], already: [] }); },
      status: async (args) => { calls.push({ verb: 'status', ...args }); return success({ version: '0.1.1', teams: [] }); },
      ls: async (args) => { calls.push({ verb: 'ls', ...args }); return success({ roster: [], skills: [] }); },
      readme: async (args) => { calls.push({ verb: 'readme', ...args }); return success({ changed: false }); },
      publish: async (args) => { calls.push({ verb: 'publish', ...args }); return args.ref === 'fail' ? failure('nope') : success({ team: 't', id: 'id', name: args.ref, scope: { kind: 'global' as const }, policy: 'pr' as const, changed: false, branch: null, prUrl: null, compareUrl: null }); },
      leave: async (args) => { calls.push({ verb: 'leave', ...args }); return args.name === 'fail' ? failure('nope') : success({ team: args.name, remote: 'r', handle: null, removed: 0, cloneRemoved: false, kept: [] }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    return { program, calls, outcomes };
  };

  it('wires status, limits selection to --team, and exposes its query semantics in help', async () => {
    const { program, calls } = harness();
    await program.parseAsync(['status'], { from: 'user' });
    await program.parseAsync(['status', '--team', 't'], { from: 'user' });
    expect(calls).toEqual([{ verb: 'status' }, { verb: 'status', team: 't' }]);
    expect(program.helpInformation()).toContain('status');
    expect(program.commands.find((command) => command.name() === 'status')?.description()).toContain('not a setup-readiness or membership test');
    await expect(program.parseAsync(['status', 'foo'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.excessArguments' });
  });

  it.each([['ls', '--local'], ['ls', '--local', 'member', 'amy'], ['ls', '--local', 'project', 'app']])('issue 9 wires %j', async (...argv) => {
    const { program, calls } = harness();
    await program.parseAsync(argv, { from: 'user' });
    expect(calls).toEqual([{ verb: 'ls', cwd: process.cwd(), kind: argv[2] ?? 'all', local: true, ...(argv[3] ? { value: argv[3], team: undefined } : {}) }]);
  });

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

  it('passes an optional setup target through unchanged', async () => {
    const { program, calls } = harness();
    await program.parseAsync(['setup'], { from: 'user' });
    await program.parseAsync(['setup', 'acme/team'], { from: 'user' });
    expect(calls).toEqual([{ verb: 'setup', cwd: process.cwd(), target: undefined }, { verb: 'setup', cwd: process.cwd(), target: 'acme/team' }]);
  });

  it('routes a failing Result to execute, and login takes no team or remote (rev 9, Decision 4)', async () => {
    const { program, outcomes } = harness();
    await program.parseAsync(['team', 'join', 'fail/fail'], { from: 'user' });
    expect(outcomes).toEqual([false]);
    expect(program.commands.find((command) => command.name() === 'login')?.options).toEqual([]);
    await expect(program.parseAsync(['login', '--team', 'alpha'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });

  it('wires every M2 verb and hands a missing install member value to the verb as undefined (the verb owns the usage error)', async () => {
    const calls: unknown[] = []; const outcomes: boolean[] = [];
    const execute: Execute = async (invoke) => { outcomes.push((await invoke(new ScriptedPrompter())).ok); };
    const program = buildProgram(execute, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me' }), team: async () => success({ team: 't', remote: 'r' }),
      share: async (args) => { calls.push(['share', args]); return success(undefined); },
      install: async (args) => { calls.push(['install', args]); return success([]); },
      uninstall: async (args) => { calls.push(['uninstall', args]); return success([]); },
      sync: async (args) => { calls.push(['sync', args]); return success({ placed: 0, deferred: [], notices: [], changed: false, hook: Boolean(args.hook) }); },
      search: async (args) => { calls.push(['search', args]); return success([]); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['share', 'folder', '--team', 'team'], { from: 'user' });
    await program.parseAsync(['install', 'sample', '--team', 'team'], { from: 'user' });
    await program.parseAsync(['install', 'member'], { from: 'user' });
    await program.parseAsync(['uninstall-skill', 'sample', '--team', 'team'], { from: 'user' });
    await program.parseAsync(['sync', '--hook'], { from: 'user' });
    await program.parseAsync(['search', 'term', '--category', 'testing'], { from: 'user' });
    expect(calls).toEqual(expect.arrayContaining([
      ['share', expect.objectContaining({ path: 'folder', team: 'team' })], ['install', expect.objectContaining({ ref: 'sample', team: 'team' })],
      ['install', expect.objectContaining({ kind: 'member', member: undefined })], ['uninstall', expect.objectContaining({ ref: 'sample', team: 'team' })],
      ['sync', { hook: true, prune: undefined }], ['search', { term: 'term', category: 'testing' }],
    ]));
    expect(outcomes).toEqual([true, true, true, true, true, true]);
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
      { verb: 'ls', cwd: process.cwd(), kind: 'project', value: 'app', team: 't' },
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
    expect(await parse(['ls', '--team', 't'])).toEqual([{ verb: 'ls', cwd: process.cwd(), kind: 'all', team: 't' }]);
    expect(await parse(['ls', '--team', 't', 'member', 'amy'])).toEqual([{ verb: 'ls', cwd: process.cwd(), kind: 'member', value: 'amy', team: 't' }]);
  });

  it('wires publish (bare and with every flag) and team leave, and routes their failing Results to execute', async () => {
    const { program, calls, outcomes } = harness();
    await program.parseAsync(['publish', 'x'], { from: 'user' });
    await program.parseAsync(['publish', 'x', '--project', 'p', '--team', 't'], { from: 'user' });
    await program.parseAsync(['team', 'leave', 't'], { from: 'user' });
    await program.parseAsync(['publish', 'fail'], { from: 'user' });
    await program.parseAsync(['team', 'leave', 'fail'], { from: 'user' });
    expect(calls).toEqual([
      { verb: 'publish', cwd: process.cwd(), ref: 'x' },
      { verb: 'publish', cwd: process.cwd(), ref: 'x', project: 'p', team: 't' },
      { verb: 'leave', name: 't' },
      { verb: 'publish', cwd: process.cwd(), ref: 'fail' },
      { verb: 'leave', name: 'fail' },
    ]);
    expect(Object.keys(calls[0] as object)).toEqual(['verb', 'ref', 'cwd']);
    expect(outcomes).toEqual([true, true, true, false, false]);
  });

  it('wires validate with its target and team selection', async () => {
    const calls: unknown[] = [];
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me' }), team: async () => success({ team: 't', remote: 'r' }),
      validate: async (args) => { calls.push(args); return success({ name: args.target, findings: 0 }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['validate', 'sample', '--team', 't'], { from: 'user' });
    expect(calls).toEqual([{ target: 'sample', team: 't' }]);
  });

  it('wires eval as an injectable verb with every local-only option', async () => {
    const calls: unknown[] = [];
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me' }), team: async () => success({ team: 't', remote: 'r' }),
      eval: async (args) => { calls.push(args); return success({ team: 't', id: 'id', name: args.ref, runDir: '/tmp/run', ccVersion: 'stub', executionStatus: 'complete' }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['eval', 'sample', '--k', '2', '--triggers-only', '--case', 'happy', '--model', 'sonnet', '--judge-model', 'opus', '--working', '--team', 't'], { from: 'user' });
    expect(calls).toEqual([{ ref: 'sample', k: 2, triggersOnly: true, case: 'happy', model: 'sonnet', judgeModel: 'opus', working: true, team: 't' }]);
  });
});

describe('the pre-push hook\'s verb (D12)', () => {
  it('wires the hidden guard-push verb with the refs passed through as one flat list', async () => {
    const calls: unknown[] = [];
    const execute: Execute = async (invoke) => { await invoke(new ScriptedPrompter()); };
    const program = buildProgram(execute, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me' }), team: async () => success({ team: 't', remote: 'r' }),
      guardPush: async (args) => { calls.push(args); return success({ team: 't', checked: 0 }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['guard-push', 'origin', 'https://x/y.git', 'refs/heads/main', 'a', 'refs/heads/main', 'b'], { from: 'user' });
    expect(calls).toEqual([{ remote: 'origin', url: 'https://x/y.git', refs: ['refs/heads/main', 'a', 'refs/heads/main', 'b'] }]);
    // Hidden: an internal hook verb has no place in `terum-skills --help` (the same rule `readme` follows above).
    expect(program.helpInformation()).not.toContain('guard-push');
  });
});


describe('machine uninstall wiring', () => {
  function machineHarness(launch?: import('../lib/launch.js').Launch) {
    const calls: unknown[] = []; const outcomes: boolean[] = []; const errors: string[] = [];
    const execute: Execute = async (invoke) => { const result = await invoke(new ScriptedPrompter()); outcomes.push(result.ok); if (!result.ok) errors.push(result.error); };
    const program = buildProgram(execute, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me' }),
      team: async () => success({ team: 't', remote: 'r' }),
      uninstall: async (args) => { calls.push(args); return success([]); },
      uninstallMachine: async (args) => { calls.push(args); return success({ teams: [], removedPlacements: 0, hookRemoved: false, configRemoved: false, kept: [], record: '', launch: args.launch ?? null }); },
    }, launch ? { launch } : {});
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    return { program, calls, outcomes, errors };
  }
  it('dispatches bare uninstall with no arguments and advertises both verbs', async () => {
    const { program, calls, outcomes } = machineHarness();
    await program.parseAsync(['uninstall'], { from: 'user' });
    expect(calls).toEqual([{}]); expect(outcomes).toEqual([true]);
    expect(program.helpInformation()).toContain('uninstall-skill');
    expect(program.helpInformation()).toMatch(/^\s*uninstall\s/m);
  });
  it('refuses an operand without calling either verb', async () => {
    const { program, calls, outcomes, errors } = machineHarness();
    await program.parseAsync(['uninstall', 'sample'], { from: 'user' });
    expect(calls).toEqual([]); expect(outcomes).toEqual([false]);
    expect(errors).toEqual(['To remove a skill, use `terum-skills uninstall-skill <ref>`.']);
  });
  it('rejects --team as an unknown option', async () => {
    const { program, calls } = machineHarness();
    await expect(program.parseAsync(['uninstall', '--team', 't'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownOption' });
    expect(calls).toEqual([]);
  });
  it('passes launch context as data', async () => {
    const launch = { kind: 'unknown' as const, path: '/repo/src/index.ts' };
    const { program, calls } = machineHarness(launch);
    await program.parseAsync(['uninstall'], { from: 'user' }); expect(calls).toEqual([{ launch }]);
  });
});

describe('release command eligibility', () => {
  it.each([
    [['update'], 'update', false], [['sync', '--hook'], 'sync', false], [['sync'], 'sync', true],
    [['guard-push', 'origin', 'remote'], 'guard-push', false], [['readme'], 'readme', false], [['ls'], 'ls', true],
  ] as const)('passes explicit notice metadata for %j', async (argv, verb, notices) => {
    const calls: unknown[] = [];
    const program = buildProgram(async (_invoke, meta) => { calls.push(meta); });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync([...argv], { from: 'user' }); expect(calls).toEqual([{ verb, notices }]);
  });
  it('passes launch and opt-out data through to sync and update', async () => {
    const calls: unknown[] = []; const launch = { kind: 'unknown' as const, path: '/copy/index.js' };
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me' }), team: async () => success({ team: 't', remote: 'r' }),
      sync: async (args) => { calls.push(args); return success({ placed: 0, deferred: [], notices: [], changed: false, hook: Boolean(args.hook) }); },
      update: async (args) => { calls.push(args); return success(undefined); },
    }, { launch, noUpdateCheck: true });
    await program.parseAsync(['sync', '--hook'], { from: 'user' }); await program.parseAsync(['update'], { from: 'user' });
    expect(calls).toEqual([{ hook: true, prune: undefined, launch, noUpdateCheck: true }, { launch, noUpdateCheck: true }]);
  });
  it('prints the reader version and never executes help/version/usage paths', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    for (const [argv, code] of [[['--version'], 'commander.version'], [['--help'], 'commander.helpDisplayed'], [['--bogus'], 'commander.unknownOption']] as const) {
      let executions = 0; const lines: string[] = [];
      const program = buildProgram(async () => { executions++; });
      program.configureOutput({ writeOut: (line) => { lines.push(line); }, writeErr: () => undefined });
      await expect(program.parseAsync([...argv], { from: 'user' })).rejects.toMatchObject({ code });
      expect(executions).toBe(0); if (code === 'commander.version') expect(lines).toEqual([`${manifest.version}\n`]);
    }
  });
});

it('issue 9 bare share reaches the verb with an undefined path', async () => {
  const calls: unknown[] = []; const io = new ScriptedPrompter();
  const program = buildProgram(async (invoke) => { await invoke(io); }, {
    login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me' }), team: async () => success({ team: 't', remote: 'r' }),
    share: async (args) => { calls.push(args); return success(undefined); },
  });
  await program.parseAsync(['share'], { from: 'user' });
  expect(calls).toEqual([{ path: undefined, cwd: process.cwd() }]);
});

it('issue 9 non-interactive bare share exits 1 through createExecute', async () => {
  const home = await temporaryDirectory(); const root = join(home, '.claude', 'skills', 'sample'); await mkdir(root, { recursive: true }); await writeFile(join(root, 'SKILL.md'), '---\nname: sample\ndescription: x\n---\n');
  const store = createConfigStore(join(home, 'state')); await store.update((config) => { config.teams.team = { remote: 'unused', handle: 'seed' }; });
  const io = new NonInteractivePrompter(); const errors: string[] = []; const codes: number[] = [];
  const execute = createExecute({ io, stderr: (line) => { errors.push(line); }, setExitCode: (code) => { codes.push(code); } });
  await execute((received) => share({ config: store, home }, received), { verb: 'share', notices: false });
  expect(codes).toEqual([1]); expect(errors).toEqual(["No skill selected. In an interactive terminal, run `npx -y terum-skills@latest share --team 'team'`, or pass an explicit skill folder path."]); expect(io.asked).toEqual([]);
});
