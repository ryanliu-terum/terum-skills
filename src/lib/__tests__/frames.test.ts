import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FRAME_FEATURES, FRAME_PROTOCOL, FRAME_VERBS, frameChannel, isDecline, type Frame } from '../frames.js';
import { PromptClosedError } from '../prompt.js';

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
    expect(s.frames).toEqual([{ t: 'hello', protocol: FRAME_PROTOCOL, version: '0.1.5', verbs: [...FRAME_VERBS], features: FRAME_FEATURES }]);
    expect(Object.values(FRAME_FEATURES).every((value) => value === false)).toBe(true);
  });

  it('confirm, text and select each round-trip through one ask frame; defaults and choices travel with the question', async () => {
    const s = shell();
    const io = s.channel.io;
    expect(io.interactive).toBe(true);
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
    t.channel.result({ verb: 'connect', ok: false, error: 'Connect was declined.', exitCode: 1 });
    expect(t.frames.at(-1)).toEqual({ t: 'result', verb: 'connect', ok: false, exitCode: 1, error: 'Connect was declined.', declined: true });
    const u = shell();
    u.channel.result({ verb: 'sync', ok: false, error: 'Could not fast-forward team: offline', value: { placed: 0 }, exitCode: 1 });
    expect(u.frames.at(-1)).toEqual({ t: 'result', verb: 'sync', ok: false, exitCode: 1, error: 'Could not fast-forward team: offline', value: { placed: 0 } });
    expect(u.channel.closed).toBe(true);
    await expect(u.channel.io.confirm('late?')).rejects.toBeInstanceOf(PromptClosedError);
  });

  it('isDecline recognises every decline message the CLI emits and nothing else', () => {
    for (const message of ['Connect was declined.', 'Forget was declined.', 'Invitation acceptance was declined.', 'Consent was declined for x.', 'Consent was declined for malformed allowed-tools on x.']) expect(isDecline(message), message).toBe(true);
    for (const message of ['Unsupported remote: nope', 'Could not fast-forward team: offline', 'No skill selected.']) expect(isDecline(message), message).toBe(false);
  });
});
