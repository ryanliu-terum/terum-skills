import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildProgram, type CliVerbs } from '../cli.js';
import { createExecute } from '../lib/execute.js';
import { FRAME_VERBS, frameChannel, type Frame, type ResultFrame } from '../lib/frames.js';
import type { Prompter } from '../lib/prompt.js';
import { cancelled, success } from '../lib/result.js';

/**
 * Every public verb, driven through commander with the frame channel in place of the terminal: the
 * verb asks all three question kinds and prints, the "shell" answers over stdin, and the run ends
 * in exactly one result frame. The verbs are stubs (the real ones need git and a team); what is
 * under test is that the wiring from argv to Prompter to result frame holds for each of them.
 */
const asking = (async (_args: unknown, io: Prompter) => {
  const go = await io.confirm('Proceed?');
  const name = await io.text('Name', 'dflt');
  const pick = await io.select('Pick', ['a', 'b']);
  io.print(`hello ${name}`);
  return success({ go, name, pick });
}) as never;

const INVOCATIONS: Record<string, string[]> = {
  'project add': ['project', 'add'], 'project remove': ['project', 'remove', '/project'], 'project list': ['project', 'list'],
  'team project create': ['team', 'project', 'create', 'Payments'],
  'app-update': ['app-update', '--check'],
  app: ['app'], profile: ['profile', '--role', 'Platform'],
  login: ['login'], setup: ['setup'], 'team create': ['team', 'create', 'x'], 'team join': ['team', 'join', 'o/r'], 'team remove': ['team', 'remove', 'h'], 'team leave': ['team', 'leave', 'n'], 'team workflow-update': ['team', 'workflow-update'],
  invite: ['invite', 'u'], ls: ['ls'], status: ['status'], publish: ['publish', 'ref'], validate: ['validate', 'x'], eval: ['eval', 'x'], 'eval-report': ['eval-report', 'x'], install: ['install', 'ref'], 'uninstall-skill': ['uninstall-skill', 'ref'], uninstall: ['uninstall'], sync: ['sync'], prune: ['prune'], search: ['search', 't'], update: ['update'],
};

function harness(verbs: CliVerbs) {
  const input = new PassThrough(); const output = new PassThrough();
  const frames: Frame[] = []; const stderr: string[] = []; const codes: number[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); let i = buffer.indexOf('\n'); while (i !== -1) { frames.push(JSON.parse(buffer.slice(0, i)) as Frame); buffer = buffer.slice(i + 1); i = buffer.indexOf('\n'); } });
  const channel = frameChannel({ input, output, diagnostic: (line) => stderr.push(line) });
  const execute = createExecute({ io: channel.io, stderr: (line) => stderr.push(line), setExitCode: (code) => codes.push(code), result: (outcome) => channel.result(outcome) });
  const program = buildProgram(execute, verbs, { noUpdateCheck: true });
  program.exitOverride();
  // Answer each ask as it appears, like a shell would.
  let answered = 0;
  output.on('data', () => {
    const asks = frames.filter((frame) => frame.t === 'ask');
    while (answered < asks.length) {
      const ask = asks[answered++]!;
      const value = ask.kind === 'confirm' ? true : ask.kind === 'text' ? '' : 2;
      input.write(`${JSON.stringify({ t: 'answer', id: ask.id, value })}\n`);
    }
  });
  return { frames, stderr, codes, run: (argv: string[]) => program.parseAsync(['node', 'terum-skills', ...argv]) };
}

describe('frame mode through commander — every public verb', () => {
  const verbs: CliVerbs = { project: asking, app: asking, profile: asking, login: asking, team: asking, setup: asking, install: asking, uninstall: asking, uninstallMachine: asking, sync: asking, prune: asking, search: asking, invite: asking, ls: asking, status: asking, readme: asking, publish: asking, leave: asking, guardPush: asking, validate: asking, eval: asking, evalReport: asking, update: asking, appUpdate: asking };

  /**
   * `serve` is a session, not a one-shot verb: it holds stdin open, answers many requests, and writes one
   * `result` per request rather than one per run (docs/frame-protocol.md). The ask/answer drive below asserts
   * the one-run-per-verb contract, which `serve` is the single documented exception to, so it is exempt from
   * that loop alone. It is NOT exempt from the registration check: every FRAME_VERBS entry, `serve` included,
   * must still be a command commander knows. Its own behaviour is covered in src/commands/__tests__/serve.test.ts.
   */
  const SESSION_VERBS = new Set(['serve']);
  const ONE_SHOT_VERBS = FRAME_VERBS.filter((verb) => !SESSION_VERBS.has(verb));

  it('FRAME_VERBS names only registered commands, and every one is covered here', () => {
    const program = buildProgram(async () => undefined, verbs, {});
    const names = new Set<string>();
    // Recursive, not two deep: §7.1 made `team project create` a three-segment verb, and `attemptedVerb`
    // matches the longest leading prefix at any depth, so the registration check must reach as far.
    const walk = (parent: { commands: readonly { name(): string; commands: readonly unknown[] }[] }, prefix = ''): void => {
      for (const command of parent.commands as readonly { name(): string; commands: readonly unknown[] }[]) {
        const path = prefix ? `${prefix} ${command.name()}` : command.name();
        names.add(path);
        walk(command as never, path);
      }
    };
    walk(program as never);
    for (const verb of FRAME_VERBS) expect(names.has(verb), verb).toBe(true);
    for (const verb of ONE_SHOT_VERBS) expect(INVOCATIONS[verb], `no invocation for ${verb}`).toBeDefined();
    // The exemption cannot rot into a blanket one: every name in it must still be a real public verb.
    for (const verb of SESSION_VERBS) expect(FRAME_VERBS, `${verb} is exempt but not public`).toContain(verb);
  });

  for (const verb of ONE_SHOT_VERBS) {
    it(`${verb}: confirm, text, select and print become frames; the run ends in one ok result with the verb's value`, async () => {
      const h = harness(verbs);
      await h.run(INVOCATIONS[verb]!);
      const kinds = h.frames.map((frame) => frame.t === 'ask' ? `ask:${frame.kind}` : frame.t);
      expect(kinds).toEqual(['ask:confirm', 'ask:text', 'ask:select', 'print', 'result']);
      const result = h.frames.at(-1) as ResultFrame;
      expect(result).toMatchObject({ t: 'result', ok: true, exitCode: 0, value: { go: true, name: 'dflt', pick: 'b' } });
      expect(result.verb.startsWith(verb.split(' ')[0]!)).toBe(true);
      expect(h.codes).toEqual([]);
      expect(h.stderr).toEqual([]);
    });
  }

  it('a cancelled Result is a result frame with ok false, exit 1, and the declined flag; stderr still gets the one line', async () => {
    const declining = (async () => cancelled('Prune was declined.')) as never;
    const h = harness({ ...verbs, prune: declining });
    await h.run(['prune']);
    expect(h.frames).toEqual([{ t: 'result', verb: 'prune', ok: false, exitCode: 1, error: 'Prune was declined.', declined: true }]);
    expect(h.codes).toEqual([1]);
    expect(h.stderr).toEqual(['Prune was declined.']);
  });

  it('a verb that throws (a question cancelled by the shell) ends in a result frame, not a hang', async () => {
    const cancelling = (async (_args: unknown, io: Prompter) => { await io.confirm('Proceed?'); return success(1); }) as never;
    const g = harnessWithCancel({ ...verbs, status: cancelling });
    await g.run(['status']);
    expect(g.frames.map((frame) => frame.t)).toEqual(['ask', 'result']);
    expect(g.frames.at(-1)).toMatchObject({ t: 'result', verb: 'status', ok: false, exitCode: 1, error: expect.stringContaining('Input ended before "Proceed?"') });
  });

  it('the legacy `share` refusal is a result frame too (no prompt, exit 1)', async () => {
    const h = harness(verbs);
    await h.run(['share', 'x']);
    expect(h.frames).toEqual([expect.objectContaining({ t: 'result', verb: 'share', ok: false, exitCode: 1, error: expect.stringContaining('`share` is retired') })]);
  });
});

function harnessWithCancel(verbs: CliVerbs) {
  const input = new PassThrough(); const output = new PassThrough();
  const frames: Frame[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); let i = buffer.indexOf('\n'); while (i !== -1) { frames.push(JSON.parse(buffer.slice(0, i)) as Frame); buffer = buffer.slice(i + 1); i = buffer.indexOf('\n'); } if (frames.some((frame) => frame.t === 'ask')) input.write(`${JSON.stringify({ t: 'cancel' })}\n`); });
  const channel = frameChannel({ input, output });
  const execute = createExecute({ io: channel.io, stderr: () => undefined, setExitCode: () => undefined, result: (outcome) => channel.result(outcome) });
  const program = buildProgram(execute, verbs, { noUpdateCheck: true });
  return { frames, run: (argv: string[]) => program.parseAsync(['node', 'terum-skills', ...argv]) };
}
