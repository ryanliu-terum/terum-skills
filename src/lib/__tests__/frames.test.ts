import { readFileSync } from 'node:fs';
import { buildProgram } from '../../cli.js';
import type { Command } from 'commander';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FRAME_FEATURES, FRAME_PROTOCOL, FRAME_VERBS, frameChannel, attemptedVerb, type Frame } from '../frames.js';
import { PromptClosedError, terminalPrompter } from '../prompt.js';

/** A shell on the other end: collects every frame the CLI writes and answers questions on cue. */
function shell() {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: Frame[] = [];
  const diagnostics: string[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) { frames.push(JSON.parse(buffer.slice(0, index)) as Frame); buffer = buffer.slice(index + 1); index = buffer.indexOf('\n'); }
  });
  const channel = frameChannel({ input, output, diagnostic: (line) => diagnostics.push(line) });
  const asks = () => frames.filter((frame) => frame.t === 'ask');
  const lastAsk = async () => { while (!asks().length || asks().length === answered) await new Promise((r) => setTimeout(r, 1)); return asks()[asks().length - 1]!; };
  let answered = 0;
  const answer = async (value: string | number | boolean) => { const ask = await lastAsk(); answered++; input.write(`${JSON.stringify({ t: 'answer', id: ask.id, value })}\n`); return ask; };
  return { input, output, frames, diagnostics, channel, asks, answer, raw: (line: string) => input.write(`${line}\n`) };
}

describe('frame mode — the Prompter serialised (docs/frame-protocol.md)', () => {
  it('hello is the first frame and carries protocol, version, the public verbs and the feature map', () => {
    const s = shell();
    s.channel.hello('0.1.5');
    expect(FRAME_FEATURES.libraryProjects).toBe(true);
    expect(s.frames).toEqual([{ t: 'hello', protocol: FRAME_PROTOCOL, version: '0.1.5', verbs: [...FRAME_VERBS], features: FRAME_FEATURES }]);
    expect(FRAME_FEATURES).toEqual({
      memberRole: true, localIdentity: true, libraryProjects: true, projects: true, roles: true,
      favorites: false, follow: false, lastSeen: false, installScope: true, inviteScoping: false,
      disablePerMachine: false, projectMembers: false, liftOnCards: true, runEvalInApp: true, perCase: false, progress: true,
      refresh: true, appUpdate: true, serve: true,
    });
  });

  it('confirm, text and select each round-trip through one ask frame; defaults and choices travel with the question', async () => {
    const s = shell();
    const io = s.channel.io;
    expect(io.interactive).toBe(true);
    expect(io.channel).toBe('frames');
    const confirm = io.confirm('Proceed?');
    expect(await s.answer(true)).toEqual({ t: 'ask', id: 'q1', kind: 'confirm', question: 'Proceed?' });
    expect(await confirm).toBe(true);
    const text = io.text('Team name', 'terum');
    expect(await s.answer('')).toEqual({ t: 'ask', id: 'q2', kind: 'text', question: 'Team name', default: 'terum' });
    expect(await text).toBe('terum');
    const select = io.select('Pick one', ['alpha', 'beta']);
    expect(await s.answer(2)).toEqual({ t: 'ask', id: 'q3', kind: 'select', question: 'Pick one', choices: ['alpha', 'beta'] });
    expect(await select).toBe('beta');
    io.print('done');
    expect(s.frames.at(-1)).toEqual({ t: 'print', level: 'info', line: 'done' });
  });

  it('carries decision detail on the ask and omits an empty detail list', async () => {
    const s = shell();
    const detail = ['Identity: @me — Me <me@x.test> (GitHub: octocat)'];
    const identity = s.channel.io.confirm('Use this identity?', { detail });
    expect(await s.answer(true)).toEqual({ t: 'ask', id: 'q1', kind: 'confirm', question: 'Use this identity?', detail });
    expect(await identity).toBe(true);
    const proceed = s.channel.io.confirm('Proceed?', { detail: [] });
    expect(await s.answer(false)).toEqual({ t: 'ask', id: 'q2', kind: 'confirm', question: 'Proceed?' });
    expect(await proceed).toBe(false);
  });

  it('text and every select attempt carry the whole decision context', async () => {
    const s = shell(), detail = ['Read this first'];
    const text = s.channel.io.text('Name', 'old', { detail });
    expect(await s.answer('new')).toEqual({ t: 'ask', id: 'q1', kind: 'text', question: 'Name', default: 'old', detail });
    expect(await text).toBe('new');
    const select = s.channel.io.select('Pick', ['a'], undefined, { detail });
    expect(await s.answer('invalid')).toEqual({ t: 'ask', id: 'q2', kind: 'select', question: 'Pick', choices: ['a'], detail });
    expect(await s.answer('a')).toEqual({ t: 'ask', id: 'q3', kind: 'select', question: 'Pick', choices: ['a'], detail });
    expect(await select).toBe('a');
  });

  it('confirm accepts booleans and y/yes/true strings; anything else is no', async () => {
    const s = shell();
    for (const [value, expected] of [[true, true], [false, false], ['y', true], ['YES', true], ['true', true], ['n', false], ['', false], [1, false]] as const) {
      const pending = s.channel.io.confirm('Sure?');
      await s.answer(value);
      expect(await pending, String(value)).toBe(expected);
    }
  });

  it('select accepts a 1-based number or the exact choice, re-asks on an invalid answer with a warn frame, and gives up after three', async () => {
    const s = shell();
    const first = s.channel.io.select('Pick', ['a', 'b', 'c']);
    await s.answer('b');
    expect(await first).toBe('b');
    const second = s.channel.io.select('Pick', ['a', 'b', 'c']);
    await s.answer(9);
    await s.answer('zzz');
    await s.answer(3);
    expect(await second).toBe('c');
    expect(s.frames.filter((frame) => frame.t === 'print' && frame.level === 'warn')).toHaveLength(2);
    const third = s.channel.io.select('Pick', ['a']);
    await s.answer(0); await s.answer(0); await s.answer(0);
    await expect(third).rejects.toThrow('No valid choice after 3 attempts');
  });

  it('a cancel frame fails every pending question closed, and later questions fail immediately', async () => {
    const s = shell();
    const pending = s.channel.io.text('Name');
    await new Promise((r) => setTimeout(r, 5));
    s.raw(JSON.stringify({ t: 'cancel' }));
    await expect(pending).rejects.toBeInstanceOf(PromptClosedError);
    await expect(s.channel.io.confirm('Again?')).rejects.toThrow('Input ended before "Again?" was answered.');
    expect(s.channel.closed).toBe(true);
  });

  it('stdin ending behaves like cancel', async () => {
    const s = shell();
    const pending = s.channel.io.confirm('Go?');
    await new Promise((r) => setTimeout(r, 5));
    s.input.end();
    await expect(pending).rejects.toBeInstanceOf(PromptClosedError);
  });

  it('malformed lines and answers to unknown ids are reported as diagnostics, never written to stdout, and do not disturb a pending question', async () => {
    const s = shell();
    const pending = s.channel.io.text('Handle');
    await new Promise((r) => setTimeout(r, 5));
    s.raw('not json');
    s.raw(JSON.stringify({ t: 'answer', id: 'q99', value: 'x' }));
    s.raw(JSON.stringify({ t: 'bogus' }));
    await s.answer('ryan');
    expect(await pending).toBe('ryan');
    expect(s.diagnostics).toEqual([
      expect.stringContaining('malformed line "not json"'),
      expect.stringContaining('unknown question id "q99"'),
      expect.stringContaining('malformed line'),
    ]);
    expect(s.frames.filter((frame) => frame.t !== 'ask')).toEqual([]);
  });

  it('result carries verb, ok, exit code, error, value; a decline is flagged; the channel closes', async () => {
    const s = shell();
    s.channel.result({ verb: 'status', ok: true, value: { teams: [] }, exitCode: 0 });
    expect(s.frames.at(-1)).toEqual({ t: 'result', verb: 'status', ok: true, exitCode: 0, value: { teams: [] } });
    const t = shell();
    t.channel.result({ verb: 'connect', ok: false, error: 'Connect was declined.', cancelled: true, exitCode: 1 });
    expect(t.frames.at(-1)).toEqual({ t: 'result', verb: 'connect', ok: false, exitCode: 1, error: 'Connect was declined.', declined: true });
    const u = shell();
    u.channel.result({ verb: 'sync', ok: false, error: 'Could not fast-forward team: offline', value: { placed: 0 }, exitCode: 1 });
    expect(u.frames.at(-1)).toEqual({ t: 'result', verb: 'sync', ok: false, exitCode: 1, error: 'Could not fast-forward team: offline', value: { placed: 0 } });
    expect(u.channel.closed).toBe(true);
    await expect(u.channel.io.confirm('late?')).rejects.toBeInstanceOf(PromptClosedError);
  });

  it.each([
    'Connect was declined.', 'Forget was declined.', 'Invitation acceptance was declined.',
    'Consent was declined for x.', 'Consent was declined for malformed allowed-tools on x.',
    'Publish was cancelled.', 'Leave was cancelled.', 'Team removal was cancelled.', 'Uninstall was cancelled.',
  ])('uses typed cancellation for %s', (error) => {
    const s = shell();
    s.channel.result({ verb: 'install', ok: false, error, cancelled: true, exitCode: 1 });
    expect(s.frames).toEqual([{ t: 'result', verb: 'install', ok: false, error, declined: true, exitCode: 1 }]);
  });

  it.each(['Unsupported remote: nope', "error: unknown option '--declined'", 'Connect was declined.'])('never infers a decline from error text: %s', error => {
    const s = shell();
    s.channel.result({ verb: 'install', ok: false, error, exitCode: 1 });
    expect(s.frames).toEqual([{ t: 'result', verb: 'install', ok: false, error, exitCode: 1 }]);
  });

  it.each([
    [[], 'terum-skills'], [[''], 'terum-skills'], [['--frames'], '--frames'], [['--frames', 'team'], '--frames'],
    [['install', '-x'], 'install'], [['team', 'join', 'acme'], 'team join'], [['team', '--flag', 'join'], 'team'],
    [['unknown', 'verb'], 'unknown'], [['team'], 'team'], [['team', 'remove', '--', '-x'], 'team remove'],
  ])('names the attempted verb for %j', (operands, expected) => {
    expect(attemptedVerb(operands as string[])).toBe(expected);
  });
});

// ls member/project are selectors of the public ls verb; team is a verb group.
it('CP-19: the hello inventory and public commander verbs agree in both directions', () => {
  const program = buildProgram(async () => {});
  function inventory(command: Command, prefix = ''): string[] {
    return command.commands.filter(child => !(child as Command & { _hidden?: boolean })._hidden).flatMap(child => {
      const name = `${prefix}${child.name()}`;
      const hasAction = Boolean((child as Command & { _actionHandler?: unknown })._actionHandler);
      return [...(hasAction ? [name.startsWith('ls ') ? 'ls' : name] : []), ...inventory(child, `${name} `)];
    });
  }
  // D24: migration is a human's terminal operation, explicitly excluded from the app protocol.
  expect(inventory(program)).toContain('team migrate');
  expect(FRAME_VERBS).not.toContain('team migrate');
  expect([...FRAME_VERBS].sort()).toEqual([...new Set(inventory(program).filter(verb => verb !== 'team migrate'))].sort());
});
it('CP-19: every feature is named in the protocol features sentence', () => {
  const doc = readFileSync(new URL('../../../docs/frame-protocol.md', import.meta.url), 'utf8');
  const sentence = doc.split('\n').find(line => line.startsWith('`hello.features` names'));
  expect(sentence).toBeDefined();
  for (const key of Object.keys(FRAME_FEATURES)) expect(sentence).toContain(`\`${key}\``);
});

it('a typed refusal emits refused without declined', () => {
  const s = shell();
  s.channel.result({ verb: 'setup', ok: false, error: 'One team per machine: stop', refused: true, exitCode: 1 });
  expect(s.frames).toEqual([{ t: 'result', verb: 'setup', ok: false, error: 'One team per machine: stop', refused: true, exitCode: 1 }]);
});


it.each(['', undefined])('select carries its default and accepts an empty or absent answer (%s)', async value => {
  const s = shell();
  const pending = s.channel.io.select('Install to', ['Global', 'Checkout'], 'Checkout');
  expect(s.asks()[0]).toMatchObject({ choices: ['Global', 'Checkout'], default: 'Checkout' });
  s.raw(JSON.stringify({ t: 'answer', id: s.asks()[0]!.id, value }));
  expect(await pending).toBe('Checkout');
  expect(s.diagnostics).toEqual([]);
  s.channel.result({ verb: 'install', ok: true, exitCode: 0 });
});


it('carries uninstall disclosure in exactly one ask frame with no preceding print', async () => {
  const s = shell(), question = 'Remove terum-skills from this machine?';
  const detail = Array.from({ length: 24 }, (_, i) => `  Inventory ${i}`);
  const pending = s.channel.io.confirm(question, { detail });
  const ask = await s.answer(false);
  expect(await pending).toBe(false);
  expect(s.frames).toEqual([{ t: 'ask', id: ask.id, kind: 'confirm', question, detail }]);
  s.input.end();
});


it('progress frames carry the step and only the numbers the verb knows', () => {
  const s = shell(); s.channel.io.progress?.({ step: 'evals', current: 2, total: 5 }); s.channel.io.progress?.({ step: 'discover', current: 7 });
  expect(s.frames).toEqual([{ t: 'progress', step: 'evals', current: 2, total: 5 }, { t: 'progress', step: 'discover', current: 7 }]);
  s.channel.result({ verb: 'setup', ok: true, exitCode: 0 });
});
it('progress after the result frame is dropped', () => {
  const s = shell(); s.channel.result({ verb: 'setup', ok: true, exitCode: 0 }); s.channel.io.progress?.({ step: 'evals', current: 1 });
  expect(s.frames).toEqual([{ t: 'result', verb: 'setup', ok: true, exitCode: 0 }]);
});
describe('W-02 progress channel', () => {
  it('writes one progress frame per progress() call, omitting absent counters', () => {
    const s = shell(); s.channel.io.progress?.({ step: 'Placing x' }); s.channel.io.progress?.({ step: 'Placing x', current: 2, total: 4 });
    expect(s.frames).toEqual([{ t: 'progress', step: 'Placing x' }, { t: 'progress', step: 'Placing x', current: 2, total: 4 }]);
    s.channel.result({ verb: 'install', ok: true, exitCode: 0 });
  });
  it('writes no progress frame after result', () => {
    const s = shell(); s.channel.result({ verb: 'install', ok: true, exitCode: 0 });
    const before = [...s.frames]; s.channel.io.progress?.({ step: 'too late' }); expect(s.frames).toEqual(before);
  });
  it('advertises progress as supported', () => { expect(FRAME_FEATURES.progress).toBe(true); });
  it('the terminal prompter reports no progress channel', () => {
    const input = new PassThrough(), output = new PassThrough();
    expect(terminalPrompter({ input, output }).progress).toBeUndefined(); expect(output.read()).toBeNull();
  });
  it('keeps the protocol at 1', () => { expect(FRAME_PROTOCOL).toBe(1); });
});
