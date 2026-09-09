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
  app: ['app'], profile: ['profile', '--role', 'Platform'], decline: ['decline', 'ref'],
  login: ['login'], setup: ['setup'], 'team create': ['team', 'create', 'x'], 'team join': ['team', 'join', 'o/r'], 'team remove': ['team', 'remove', 'h'], 'team leave': ['team', 'leave', 'n'], 'team workflow-update': ['team', 'workflow-update'],
  invite: ['invite', 'u'], ls: ['ls'], status: ['status'], publish: ['publish', 'ref'], validate: ['validate', 'x'], eval: ['eval', 'x'], 'eval-report': ['eval-report', 'x'], connect: ['connect'], install: ['install', 'ref'], 'uninstall-skill': ['uninstall-skill', 'ref'], uninstall: ['uninstall'], sync: ['sync'], search: ['search', 't'], update: ['update'],
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
  const verbs: CliVerbs = { app: asking, profile: asking, decline: asking, login: asking, team: asking, setup: asking, connect: asking, install: asking, uninstall: asking, uninstallMachine: asking, sync: asking, search: asking, invite: asking, ls: asking, status: asking, readme: asking, publish: asking, leave: asking, guardPush: asking, validate: asking, eval: asking, evalReport: asking, receiptCheck: asking, update: asking };

  it('FRAME_VERBS names only registered commands, and every one is covered here', () => {
    const program = buildProgram(async () => undefined, verbs, {});
    const names = new Set<string>();
    for (const command of program.commands) { names.add(command.name()); for (const sub of command.commands) names.add(`${command.name()} ${sub.name()}`); }
    for (const verb of FRAME_VERBS) { expect(names.has(verb), verb).toBe(true); expect(INVOCATIONS[verb], `no invocation for ${verb}`).toBeDefined(); }
  });

  for (const verb of FRAME_VERBS) {
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

  it('a failing Result is a result frame with ok false, exit 1, the error and (for a decline) the declined flag; stderr still gets the one line', async () => {
    const declining = (async () => cancelled('Connect was declined.')) as never;
    const h = harness({ ...verbs, connect: declining });
    await h.run(['connect']);
    expect(h.frames).toEqual([{ t: 'result', verb: 'connect', ok: false, exitCode: 1, error: 'Connect was declined.', declined: true }]);
    expect(h.codes).toEqual([1]);
    expect(h.stderr).toEqual(['Connect was declined.']);
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
    expect(h.frames).toEqual([expect.objectContaining({ t: 'result', verb: 'share', ok: false, exitCode: 1, error: expect.stringContaining('`share` is now `connect`') })]);
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


it('forwards a completed eval value on receipt commit failure through execute and frames', async () => {
  const { run } = await import('../commands/eval.js');
  const { createConfigStore } = await import('../lib/config.js');
  const { bareTeam, cloneWithIdentity, pushFromSeed, wrapRunner } = await import('../lib/__tests__/fixtures.js');
  const { systemRunner } = await import('../lib/runner.js');
  const { Transcript } = await import('../lib/evals/agent.js');
  const { join } = await import('node:path');
  const { readFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', '---\nname: sample\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nbody\n');
  await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: test\nchecks:\n  - transcript_mentions: ok\n');
  const config = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, config.teamClone('team'));
  await config.update(c => { c.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const runner = wrapRunner(systemRunner, async (cmd, args, _options, next) => cmd === 'git' && args[0] === 'push' ? { code: 1, stdout: '', stderr: 'remote: permission denied' } : next());
  const h = harness({ login: asking, team: asking, eval: (args, io) => run({ ...args, config, runner, k: 1, preflight: async () => success({ ccVersion: 'stub' }), agent: { runAgent: async (_task, cwd) => new Transcript([{ type: 'system', subtype: 'init', skills: existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : [] }], 'ok'), askJson: async () => ({}) } }, io) });
  await h.run(['eval', '--commit', '--no-gen', 'sample']);
  const result = h.frames.at(-1) as ResultFrame;
  expect(result, JSON.stringify(result)).toMatchObject({ t: 'result', verb: 'eval', ok: false, exitCode: 1, value: { runDir: expect.any(String), executionStatus: 'complete', commit: { ok: false, error: expect.any(String) } } });
  const value = result.value as { runDir: string; commit: { error: string } };
  expect(result.error).toBe(value.commit.error);
  expect(await readFile(join(value.runDir, 'receipt.json'), 'utf8')).toContain('"schema_version": 1');
});
