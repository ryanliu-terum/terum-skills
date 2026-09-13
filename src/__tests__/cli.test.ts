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
      login: async (args) => { calls.push({ verb: 'login', ...args }); return success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }); },
      team: async (args) => { calls.push({ verb: 'team', ...args }); return args.kind === 'join' && args.target === 'fail/fail' ? failure('nope') : success({ team: 't', remote: 'r' }); },
      setup: async (args) => { calls.push({ verb: 'setup', ...args }); return success({ role: args.target ? 'joiner' : 'creator', team: 't', remote: 'r', steps: {} as never }); },
      invite: async (args) => { calls.push({ verb: 'invite', ...args }); return success({ team: 't', invited: [], already: [] }); },
      status: async (args) => { calls.push({ verb: 'status', ...args }); return success({ version: '0.1.1', teams: [], ledger: { placements: [], approvals: [], shared: [] }, identity: null, tools: { git: true, gh: false }, hostArch: 'arm64', processArch: 'arm64' }); },
      ls: async (args) => { calls.push({ verb: 'ls', ...args }); return success({ roster: [], skills: [], problems: [] }); },
      readme: async (args) => { calls.push({ verb: 'readme', ...args }); return success({ changed: false }); },
      publish: async (args) => { calls.push({ verb: 'publish', ...args }); return args.ref === 'fail' ? failure('nope') : success({ team: 't', id: 'id', name: args.ref, project: 'p', version: 'v1', created: true, identicalTo: null, attachedEvals: 0, profileAdded: false, projectAdded: false }); },
      leave: async (args) => { calls.push({ verb: 'leave', ...args }); return args.name === 'fail' ? failure('nope') : success({ team: args.name, remote: 'r', handle: null, removed: 0, cloneRemoved: false, kept: [] }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    return { program, calls, outcomes };
  };

  it.each([false,true])('routes status --permissions into StatusArgs (%s)', async permissions => {
    const {program,calls}=harness();await program.parseAsync(['status',...(permissions?['--permissions']:[])],{from:'user'});
    expect(calls).toEqual([{verb:'status',...(permissions?{permissions:true}:{})}]);
  });

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

  it.each([[['--app'],true],[['--no-app'],false],[[],undefined]] as const)('forwards setup desktop choice %j as %s',async(flags,app)=>{
    const {program,calls}=harness();
    await program.parseAsync(['setup',...flags],{from:'user'});
    // --no-projects/--no-evals are lone negated options, so commander defaults both to true and setup
    // forwards them on every run; --app stays undefined because --app/--no-app are a pair.
    expect(calls).toStrictEqual([{verb:'setup',form:undefined,target:undefined,cwd:process.cwd(),app,projects:true,evals:true}]);
  });

  it('passes an optional setup target through unchanged', async () => {
    const { program, calls } = harness();
    await program.parseAsync(['setup'], { from: 'user' });
    await program.parseAsync(['setup', 'acme/team'], { from: 'user' });
    expect(calls).toEqual([
      { verb: 'setup', cwd: process.cwd(), target: undefined, projects: true, evals: true },
      { verb: 'setup', cwd: process.cwd(), target: 'acme/team', projects: true, evals: true },
    ]);
  });

  it('routes a failing Result to execute, and login takes no team or remote (rev 9, Decision 4)', async () => {
    const { program, outcomes } = harness();
    await program.parseAsync(['team', 'join', 'fail/fail'], { from: 'user' });
    expect(outcomes).toEqual([false]);
    expect(program.commands.find((command) => command.name() === 'login')?.options.map(option => option.long)).toEqual(['--set']);
    await expect(program.parseAsync(['login', '--team', 'alpha'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });

  it('wires the remaining library verbs and hands a missing install member value to the verb as undefined (the verb owns the usage error)', async () => {
    const calls: unknown[] = []; const outcomes: boolean[] = [];
    const execute: Execute = async (invoke) => { outcomes.push((await invoke(new ScriptedPrompter())).ok); };
    const program = buildProgram(execute, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }), team: async () => success({ team: 't', remote: 'r' }),
      install: async (args) => { calls.push(['install', args]); return success([]); },
      uninstall: async (args) => { calls.push(['uninstall', args]); return success([]); },
      sync: async (args) => { calls.push(['sync', args]); return success({ notices: [], changed: false, teams: [] }); },
      prune: async (args) => { calls.push(['prune', args]); return success({ deleted: 0, kept: 0, declined: false }); },
      search: async (args) => { calls.push(['search', args]); return success([]); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['install', 'sample', '--team', 'team'], { from: 'user' });
    await program.parseAsync(['install', 'member'], { from: 'user' });
    await program.parseAsync(['uninstall-skill', 'sample', '--team', 'team'], { from: 'user' });
    await program.parseAsync(['sync', '--hook'], { from: 'user' });
    await program.parseAsync(['prune'], { from: 'user' });
    await program.parseAsync(['search', 'term', '--category', 'testing'], { from: 'user' });
    expect(calls).toEqual(expect.arrayContaining([
      ['install', expect.objectContaining({ ref: 'sample', team: 'team' })],
      ['install', expect.objectContaining({ kind: 'member', member: undefined })], ['uninstall', expect.objectContaining({ ref: 'sample', team: 'team' })],
      ['sync', expect.objectContaining({ hook: true })], ['prune', expect.anything()], ['search', { term: 'term', category: 'testing' }],
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
    expect(Object.keys(calls[0] as object)).toEqual(['verb', 'form', 'ref', 'cwd']);
    expect(outcomes).toEqual([true, true, true, false, false]);
  });

  it('wires validate with its target and team selection', async () => {
    const calls: unknown[] = [];
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }), team: async () => success({ team: 't', remote: 'r' }),
      validate: async (args) => { calls.push(args); return success({ name: args.target, findings: 0, warnings: 0 }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['validate', 'sample', '--team', 't'], { from: 'user' });
    await program.parseAsync(['validate', 'sample', '--cwd', '/checkout'], { from: 'user' });
    expect(calls).toEqual([{ target: 'sample', team: 't' }, { target: 'sample', cwd: '/checkout' }]);
    const validate = program.commands.find((command) => command.name() === 'validate');
    expect(validate?.description()).toContain('by name or its local source folder by path');
    expect(validate?.description()).toContain('requires a configured team');
    // The epilogue is emitted by outputHelp() (the --help path), not by helpInformation().
    let help = '';
    validate?.configureOutput({ writeOut: (text) => { help += text; } });
    validate?.outputHelp();
    expect(help).toContain('Deterministic and offline');
  });

  it('wires team project create with its optional remote and team selection', async () => {
    const calls: unknown[] = [];
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }),
      team: async (args) => { calls.push(args); return success({ team: 't', name: 'name' in args ? args.name ?? '' : '', remotes: 'remote' in args && args.remote ? [args.remote] : [], skills: 0 }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['team', 'project', 'create', 'Payments', '--remote', 'https://github.com/a/p'], { from: 'user' });
    await program.parseAsync(['team', 'project', 'create', '--team', 't'], { from: 'user' });
    expect(calls).toEqual([
      { form: undefined, kind: 'project-create', name: 'Payments', remote: 'https://github.com/a/p' },
      { form: undefined, kind: 'project-create', name: undefined, team: 't' },
    ]);
    expect(program.helpInformation()).toContain('project');
  });

  /** §7.1: `project` is now the Library's local registry, and never reaches the team verb. */
  it('wires the local project registry to the project verb', async () => {
    const calls: unknown[] = [];
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }), team: async () => success({ team: 't', remote: 'r' }),
      project: async (args) => { calls.push(args.kind); return success({ projects: [] }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    for (const argv of [['project', 'add', '/a'], ['project', 'remove', '/a'], ['project', 'list']]) await program.parseAsync(argv, { from: 'user' });
    expect(calls).toEqual(['add', 'remove', 'list']);
  });

  it('wires workflow-update as print-only and keeps receipt-check hidden like readme', async () => {
    const calls: unknown[] = [];
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }),
      team: async (args) => { calls.push(['team', args]); return success({ workflow: 'yaml' }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['team', 'workflow-update', '--print'], { from: 'user' });
    await program.parseAsync(['receipt-check'], { from: 'user' });
    expect(calls).toEqual([['team', { kind: 'workflow-update', print: true }]]);
    expect(program.helpInformation()).not.toContain('receipt-check');
  });

  it('wires eval as an injectable verb with every local-only option', async () => {
    const calls: unknown[] = [];
    const program = buildProgram(async (invoke) => { await invoke(new ScriptedPrompter()); }, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }), team: async () => success({ team: 't', remote: 'r' }),
      eval: async (args) => { calls.push(args); return success({ team: 't', id: 'id', name: args.ref, runDir: '/tmp/run', ccVersion: 'stub', executionStatus: 'complete', shareHint: true as const }); },
    });
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    await program.parseAsync(['eval', 'sample', '--k', '2', '--triggers-only', '--case', 'happy', '--model', 'sonnet', '--judge-model', 'opus', '--team', 't'], { from: 'user' });
    await program.parseAsync(['eval', 'sample', '--no-gen'], { from: 'user' });
    expect(calls).toEqual([
      // D29 deleted `--gen`; commander still models `--no-gen` as `gen: false`, and false is now the
      // only value it can carry, so the absent case passes nothing at all.
      { ref: 'sample', k: 2, triggersOnly: true, case: 'happy', model: 'sonnet', judgeModel: 'opus', team: 't' },
      { ref: 'sample', noGen: true },
    ]);
  });
});

describe('the pre-push hook\'s verb (D12)', () => {
  it('wires the hidden guard-push verb with the refs passed through as one flat list', async () => {
    const calls: unknown[] = [];
    const execute: Execute = async (invoke) => { await invoke(new ScriptedPrompter()); };
    const program = buildProgram(execute, {
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }), team: async () => success({ team: 't', remote: 'r' }),
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
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }),
      team: async () => success({ team: 't', remote: 'r' }),
      uninstall: async (args) => { calls.push(args); return success([]); },
      uninstallMachine: async (args) => { calls.push(args); return success({ teams: [], removedPlacements: 0, hookRemoved: false, wrapperRemoved: false, configRemoved: false, kept: [], record: '', advice: [], launch: args.launch ?? null }); },
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
    expect(errors).toEqual(['To remove a skill, use `npx -y terum-skills@latest uninstall-skill <ref>`.']);
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
      login: async () => success({ gh: { installed: true, authenticated: true }, handle: 'me', updated: [], notice: null }), team: async () => success({ team: 't', remote: 'r' }),
      sync: async (args) => { calls.push(args); return success({ notices: [], changed: false, teams: [] }); },
      update: async (args) => { calls.push(args); return success({ running: null, latest: null, observation: 'unknown', launch: 'unknown', description: 'Latest advertised release: unknown', advice: ['Update this copy with the tool that installed it.'], lines: [] }); },
    }, { launch, noUpdateCheck: true });
    await program.parseAsync(['sync', '--hook'], { from: 'user' }); await program.parseAsync(['update'], { from: 'user' });
    expect(calls).toEqual([{ hook: true }, { launch, noUpdateCheck: true }]);
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

it('registers repeatable login --set once with no default and forwards only explicit pairs', async () => {
  for (const pairs of [[], ['name=Ryan Liu'], ['name=Ryan Liu', 'email=ryan@example.com']]) {
    const calls: unknown[] = [];
    const program = buildProgram(async invoke => { await invoke(new ScriptedPrompter()); }, {
      login: async args => { calls.push(args); return success({ gh: null, handle: null, updated: [], notice: null }); },
      team: async () => success({ team: 't', remote: 'r' }),
    });
    const options = program.commands.find(command => command.name() === 'login')!.options;
    expect(options.filter(option => option.long === '--set')).toHaveLength(1);
    expect(options.find(option => option.long === '--set')!.defaultValue).toBeUndefined();
    expect(options.some(option => option.long === '--team')).toBe(false);
    await program.parseAsync(['login', ...pairs.flatMap(pair => ['--set', pair])], { from: 'user' });
    expect(calls).toEqual([{ form: undefined, ...(pairs.length ? { set: pairs } : {}) }]);
  }
});
it('documents every public command path in a README code span and excludes hidden paths', async () => {
  const { readFile } = await import('node:fs/promises');
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const spans = [...readme.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map(match => match[1]!.replaceAll('\\|', '|'));
  const program = buildProgram(async () => undefined);
  function check(parent: typeof program, prefix = '') {
    const visible = new Set(parent.createHelp().visibleCommands(parent));
    for (const command of parent.commands) {
      const path = prefix + command.name();
      const documented = spans.some(span => span === path || span.startsWith(path + ' '));
      expect(documented, path).toBe(visible.has(command));
      if (visible.has(command)) check(command, path + ' ');
    }
  }
  check(program);
});

it('hides team and local-name overrides from help while keeping their parsers', () => {
  const program = buildProgram(async () => {});
  for (const name of ['install', 'ls', 'status']) expect(program.commands.find(command => command.name() === name)!.helpInformation()).not.toContain('--team');
  const team = program.commands.find(command => command.name() === 'team')!;
  expect(team.commands.find(command => command.name() === 'join')!.helpInformation()).not.toContain('--as');
});

describe('app-update commander registration', () => {
  it('drives app-update through buildProgram and forwards --release, never colliding with the program version option', async () => {
    for (const [argv, expected] of [
      [['--stage','--release','0.1.11'], {stage:true,release:'0.1.11'}],
      [['--check'], {check:true}],
      [['--check','--force'], {check:true,force:true}],
      [['--apply','--release','0.1.11'], {apply:true,release:'0.1.11'}],
      [['--apply-now','--release','0.1.11','--await-pid','42'], {applyNow:true,release:'0.1.11',awaitPid:'42'}],
    ] as const) {
      const calls: unknown[] = [], stdout: string[] = [];
      const program = buildProgram(async invoke => { await invoke(new ScriptedPrompter()); }, {
        login: async () => failure('unused'), team: async () => failure('unused'),
        appUpdate: async args => { calls.push(args); return failure('stub'); },
      });
      program.configureOutput({writeOut: text => stdout.push(text)});
      await expect(program.parseAsync(['app-update',...argv],{from:'user'})).resolves.toBe(program);
      expect(calls).toEqual([{...expected,form:undefined,launch:undefined}]); expect(stdout).toEqual([]);
    }
  });
  it('hides --await-pid and --apply-now from app-update help while keeping their parsers', async () => {
    const calls: unknown[] = [];
    const program=buildProgram(async invoke=>{await invoke(new ScriptedPrompter());},{login:async()=>failure('unused'),team:async()=>failure('unused'),appUpdate:async args=>{calls.push(args);return failure('stub');}});
    const help=program.commands.find(command=>command.name()==='app-update')!.helpInformation();
    expect(help).toContain('--release');expect(help).toContain('--check');expect(help).not.toContain('--await-pid');expect(help).not.toContain('--apply-now');
    await program.parseAsync(['app-update','--apply-now','--await-pid','42'],{from:'user'});expect(calls).toEqual([{applyNow:true,awaitPid:'42',form:undefined,launch:undefined}]);
  });
});
