import { describe, expect, it } from 'vitest';
import { buildProgram, type CliVerbs } from '../cli.js';
import { createExecute } from '../lib/execute.js';
import { FRAME_VERBS } from '../lib/frames.js';
import { invocation } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { shellArg } from '../lib/render/cells.js';
import { RENDERED_VERBS } from '../lib/render/registry.js';
import { createBoardSink } from '../lib/render/sink.js';
import { success } from '../lib/result.js';

/** Mirrors frames-cli.test.ts: every one-shot verb through commander with the board sink in place of the terminal. */
const INVOCATIONS: Record<string, string[]> = {
  'skill move': ['skill', 'move', '/skills/a', '--to', 'global'], 'skill copy': ['skill', 'copy', '/skills/a', '--to', 'global'], 'skill rename': ['skill', 'rename', '/skills/a', '--to', 'b'], 'skill delete': ['skill', 'delete', '/skills/a'], 'skill enable': ['skill', 'enable', '/skills/a'], 'skill disable': ['skill', 'disable', '/skills/a'], 'skill category': ['skill', 'category', '/skills/a', '--to', 'testing'], 'skill fix': ['skill', 'fix', '/skills/a'],
  'project add': ['project', 'add'], 'project remove': ['project', 'remove', '/project'], 'project list': ['project', 'list'], 'project rename': ['project', 'rename', '/project', '--to', 'Payments'], 'team project create': ['team', 'project', 'create', 'Payments'], 'team project delete': ['team', 'project', 'delete', 'Payments'],
  'app-update': ['app-update', '--check'], app: ['app'], profile: ['profile', '--role', 'Platform'], login: ['login'], setup: ['setup'], 'team create': ['team', 'create', 'x'], 'team join': ['team', 'join', 'o/r'], 'team remove': ['team', 'remove', 'h'], 'team leave': ['team', 'leave', 'n'], 'team move': ['team', 'move', 'o/r2'], 'team workflow-update': ['team', 'workflow-update'],
  invite: ['invite', 'u'], ls: ['ls'], status: ['status'], usage: ['usage'], misses: ['misses'], publish: ['publish', 'ref'], unpublish: ['unpublish', 'ref'], validate: ['validate', 'x'], eval: ['eval', 'x'], 'eval-report': ['eval-report', 'x'], install: ['install', 'ref'], 'uninstall-skill': ['uninstall-skill', 'ref'], uninstall: ['uninstall'], sync: ['sync'], prune: ['prune'], search: ['search', 't'], update: ['update'], reconcile: ['reconcile', '--list'],
};
const printing = (async (_args: unknown, io: Prompter) => { io.print('Resolved: x from the working directory'); io.print('hello'); return success({ ok: 1 }); }) as never;
const asking = (async (_args: unknown, io: Prompter) => { io.print('before'); await io.confirm('Proceed?'); return success({ ok: 1 }); }) as never;

function harness(verbs: CliVerbs, format: 'md' | 'pretty' | 'json' = 'md') {
  const written: string[] = []; const stderr: string[] = []; const codes: number[] = [];
  const sink = createBoardSink({ options: { format, formatGiven: true, host: 'claude', rows: 25, width: 100, color: false }, home: '/home/u', now: () => 0, argv: [], command: 'x', rowsAllCommand: 'x --rows all', write: (text) => written.push(text), stderr: (line) => stderr.push(line), setExitCode: (code) => codes.push(code) });
  const program = buildProgram(createExecute(sink), verbs, { noUpdateCheck: true });
  program.exitOverride();
  return { written, stderr, codes, run: (argv: string[]) => program.parseAsync(['node', 'terum-skills', ...argv]) };
}
const stubs = (verb: unknown): CliVerbs => ({ skill: verb, skillToggle: verb, unpublish: verb, project: verb, app: verb, profile: verb, login: verb, team: verb, setup: verb, install: verb, uninstall: verb, uninstallMachine: verb, sync: verb, prune: verb, search: verb, invite: verb, ls: verb, status: verb, readme: verb, publish: verb, leave: verb, guardPush: verb, validate: verb, eval: verb, evalReport: verb, usage: verb, misses: verb, update: verb, appUpdate: verb, reconcile: verb } as CliVerbs);
const ONE_SHOT = FRAME_VERBS.filter((verb) => verb !== 'serve');

describe('board mode through commander — every public verb', () => {
  for (const verb of ONE_SHOT) {
    it(`${verb}: prints become a board, one write, exit 0`, async () => {
      const h = harness(stubs(printing));
      await h.run(INVOCATIONS[verb]!);
      expect(h.written).toHaveLength(1);
      expect(h.written[0]!.startsWith('## ')).toBe(true);
      expect(h.written[0]).toContain('_Resolved: x from the working directory_');
      expect(h.written[0]!.endsWith('\n')).toBe(true);
      expect(RENDERED_VERBS.includes(verb) || h.written[0]!.includes('```\nhello\n```')).toBe(true);
      expect(h.stderr).toEqual([]); expect(h.codes).toEqual([]);
    });
    it(`${verb}: a question is refused as not interactive — failure board, one stderr line, exit 1`, async () => {
      const h = harness(stubs(asking));
      await h.run(INVOCATIONS[verb]!);
      expect(h.codes).toEqual([1]);
      expect(h.stderr).toHaveLength(1); expect(h.stderr[0]).toContain('Proceed?');
      expect(h.written[0]).toContain('> ❌ ');
      expect(h.written[0]).toContain('before');
    });
  }
  it('json mode writes one document per run with every printed line', async () => {
    const h = harness(stubs(printing), 'json');
    await h.run(['status']);
    expect(JSON.parse(h.written[0]!)).toEqual({ verb: 'status', ok: true, exitCode: 0, value: { ok: 1 }, lines: ['Resolved: x from the working directory', 'hello'] });
  });
  // R2: the --rows all footer command is built from ctx.command, which index.ts assembles with shellArg — a
  // multi-word user token must come back single-quoted (invocation()'s POSIX quoting), the same as nextCommand.
  it('quotes a multi-word term in the --rows all footer via shellArg (R2)', async () => {
    const written: string[] = [];
    const command = invocation(undefined, 'search', ...['deploy check'].map(shellArg), { raw: '--format md' });
    const sink = createBoardSink({
      options: { format: 'md', formatGiven: true, host: 'claude', rows: 1, width: 100, color: false },
      home: '/home/u', now: () => 0, argv: ['search', 'deploy check'], command, rowsAllCommand: `${command} --rows all`,
      write: (text) => written.push(text), stderr: () => undefined, setExitCode: () => undefined,
    });
    await createExecute(sink)(async () => success([
      { id: 'a', name: 'deploy-check', description: 'd', author: 'Mira', category: 'ops', latest: 'v1', installs: 2, updated: null, team: 'acme' },
      { id: 'b', name: 'deploy-check-2', description: 'd2', author: 'Mira', category: 'ops', latest: 'v1', installs: 1, updated: null, team: 'acme' },
    ]), { verb: 'search', notices: false });
    expect(written[0]).toContain("search 'deploy check' --format md --rows all");
  });
  it('uses a row-cap command whose board flags precede a literal -- separator', async () => {
    const written: string[] = [];
    const command = 'npx -y terum-skills@latest ls --local --format md --';
    const rowsAllCommand = 'npx -y terum-skills@latest ls --local --format md --rows all --';
    const sink = createBoardSink({
      options: { format: 'md', formatGiven: true, host: 'claude', rows: 1, width: 100, color: false },
      home: '/home/u', now: () => 0, argv: ['ls', '--local', '--'], command, rowsAllCommand,
      write: (text) => written.push(text), stderr: () => undefined, setExitCode: () => undefined,
    });
    await createExecute(sink)(async () => success({
      local: [{ root: '/home/u/.claude/skills', label: 'Global', rootState: 'scanned', registered: false, notOffered: [], rows: [
        { name: 'alpha', path: '/home/u/.claude/skills/alpha' },
        { name: 'beta', path: '/home/u/.claude/skills/beta' },
      ] }],
    }), { verb: 'ls', notices: false });
    expect(written[0]).toContain('_… and 1 more — run `npx -y terum-skills@latest ls --local --format md --rows all --`_');
  });
});
