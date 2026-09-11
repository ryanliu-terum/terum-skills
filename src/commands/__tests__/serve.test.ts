import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { buildProgram, type Execute } from '../../cli.js';
import { success } from '../../lib/result.js';
import type { Prompter } from '../../lib/prompt.js';
import { SERVE_READ_VERBS, type Frame } from '../../lib/frames.js';
import { run } from '../serve.js';

type Action = (argv: string[], io: Prompter) => Promise<unknown>;
function shell(action: Action = async argv => argv, frames = true, builder?: (execute: Execute) => Command) {
  const input = new PassThrough(), output = new PassThrough();
  const received: Frame[] = [], diagnostics: string[] = [];
  output.on('data', chunk => { for (const line of String(chunk).trim().split('\n')) received.push(JSON.parse(line) as Frame); });
  const invoked: string[][] = [];
  const onCancel = vi.fn();
  const done = run({ input, output, frames, version: 'test', diagnostic: line => diagnostics.push(line), onCancel,
    buildProgram: builder ?? (execute => {
      const program = new Command().exitOverride();
      for (const verb of [...SERVE_READ_VERBS, 'install']) program.command(`${verb} [arg]`).action(async arg => {
        const argv = [verb, ...(arg === undefined ? [] : [String(arg)])];
        invoked.push(argv);
        await execute(async io => success(await action(argv, io)), { verb, notices: false });
      });
      return program;
    }),
  });
  const send = (frame: object) => input.write(`${JSON.stringify(frame)}\n`);
  const request = (id: string, argv: string[], cwd?: string) => send({ t: 'request', id, argv, ...(cwd === undefined ? {} : { cwd }) });
  const results = () => received.filter(frame => frame.t === 'result');
  return { input, received, diagnostics, done, onCancel, invoked, send, request, results };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe('serve serial frame session', () => {
  it('writes one hello and exactly one id-stamped result per request in arrival order', async () => {
    const s = shell(async (argv, io) => { io.print(argv[0]!); io.progress?.({ step: 'read' }); return argv; });
    s.request('r1', ['status']); s.request('r2', ['ls']); s.input.end();
    expect(await s.done).toBe(0);
    expect(s.received.filter(frame => frame.t === 'hello')).toHaveLength(1);
    expect(s.received[0]).not.toHaveProperty('id');
    expect(s.results().map(frame => [frame.id, frame.ok])).toEqual([['r1', true], ['r2', true]]);
    expect(s.received.slice(1).map(frame => 'id' in frame ? frame.id : undefined)).toEqual(['r1', 'r1', 'r1', 'r2', 'r2', 'r2']);
  });

  it('queues a second arrival while the first invocation is in flight', async () => {
    const gate = deferred(), order: string[] = [];
    const s = shell(async argv => { order.push(`start ${argv[0]}`); if (argv[0] === 'status') await gate.promise; order.push(`end ${argv[0]}`); });
    s.request('a', ['status']); s.request('b', ['ls']);
    expect(order).toEqual(['start status']);
    gate.resolve(); s.input.end(); await s.done;
    expect(order).toEqual(['start status', 'end status', 'start ls', 'end ls']);
  });

  it.each(['install', 'sync', 'eval', 'connect', 'publish', 'uninstall', 'serve'])('refuses %s before executing anything', async verb => {
    const s = shell(); s.request('a', [verb]); s.input.end(); await s.done;
    expect(s.invoked).toEqual([]);
    expect(s.results()).toMatchObject([{ id: 'a', ok: false, error: `serve does not run ${verb}; spawn it as its own process` }]);
  });

  it('a thrown verb and commander usage error each fail once and the next request survives', async () => {
    const s = shell(async argv => { if (argv[0] === 'status') throw new Error('read failed'); return 'next'; });
    s.request('a', ['status']); s.request('b', ['ls', '--unknown']); s.request('c', ['ls']); s.input.end(); await s.done;
    expect(s.results()).toMatchObject([{ id: 'a', ok: false, error: 'read failed' }, { id: 'b', ok: false }, { id: 'c', ok: true, value: 'next' }]);
  });

  it('uses a fresh commander program and a fresh request Prompter each time', async () => {
    const s = shell(async (argv, io) => { return [argv, await io.text('Name')]; });
    s.request('a', ['status', 'first']); s.request('b', ['status']);
    expect(s.received.at(-1)).toMatchObject({ t: 'ask', id: 'a', question: 'Name' });
    s.send({ t: 'answer', id: 'a', value: 'Alice' });
    await vi.waitFor(() => expect(s.received.at(-1)).toMatchObject({ t: 'ask', id: 'b' }));
    s.send({ t: 'answer', id: 'b', value: 'Bob' }); s.input.end(); await s.done;
    expect(s.results().map(frame => frame.value)).toEqual([[['status', 'first'], 'Alice'], [['status'], 'Bob']]);
  });

  it('malformed, unknown, duplicate and wrong-answer lines never disturb a pending question', async () => {
    const s = shell(async (_argv, io) => io.confirm('Continue?'));
    s.request('a', ['status']);
    const before = [...s.received];
    s.input.write('not json\n'); s.send({ t: 'unknown' });
    s.request('a', ['ls']); s.send({ t: 'answer', id: 'other', value: true });
    s.send({ t: 'request', id: '', argv: ['ls'] }); s.send({ t: 'request', id: 'x'.repeat(65), argv: ['ls'] });
    s.send({ t: 'request', id: 'b', argv: [1] }); s.send({ t: 'request', id: 'b', argv: ['ls'], cwd: 1 });
    expect(s.received).toEqual(before); expect(s.diagnostics).toHaveLength(8);
    s.send({ t: 'answer', id: 'a', value: true }); s.input.end(); await s.done;
    expect(s.results()).toMatchObject([{ id: 'a', ok: true, value: true }]);
  });

  it('cancels only the active request and continues the queue', async () => {
    const s = shell(async (argv, io) => argv[0] === 'status' ? io.confirm('Wait?') : 'next');
    s.request('a', ['status']); s.request('b', ['ls']); s.send({ t: 'cancel', id: 'a' }); s.input.end(); await s.done;
    expect(s.results()).toMatchObject([{ id: 'a', ok: false, error: 'cancelled', declined: true }, { id: 'b', ok: true }]);
    expect(s.onCancel).not.toHaveBeenCalled();
  });

  it('does not overlap cwd or leak late output after cancelling a read that has not unwound', async () => {
    const gate = deferred();
    const s = shell(async (argv, io) => { if (argv[0] === 'status') { await gate.promise; io.print('late'); io.progress?.({ step: 'late' }); } });
    s.request('a', ['status']); s.request('b', ['ls']); s.send({ t: 'cancel', id: 'a' });
    expect(s.invoked).toEqual([['status']]);
    expect(s.results()).toMatchObject([{ id: 'a', error: 'cancelled' }]);
    gate.resolve(); s.input.end(); await s.done;
    expect(s.received.filter(frame => frame.t === 'print' || frame.t === 'progress')).toEqual([]);
    expect(s.results()).toHaveLength(2);
  });

  it('cancels a queued request without ever executing it', async () => {
    const gate = deferred(), s = shell(async () => gate.promise);
    s.request('a', ['status']); s.request('b', ['ls']); s.send({ t: 'cancel', id: 'b' });
    gate.resolve(); s.input.end(); await s.done;
    expect(s.invoked).toEqual([['status']]);
    expect(s.results().find(frame => frame.id === 'b')).toMatchObject({ error: 'cancelled', declined: true });
  });

  it('a bare cancel invokes shutdown, returns 143 and drains nothing', async () => {
    const s = shell(async (_argv, io) => io.confirm('Wait?'));
    s.request('a', ['status']); s.request('b', ['ls']); s.send({ t: 'cancel' });
    expect(await s.done).toBe(143); expect(s.onCancel).toHaveBeenCalledOnce();
    await Promise.resolve(); expect(s.invoked).toEqual([['status']]); expect(s.results()).toEqual([]);
  });

  it('EOF waits for the in-flight read, including a final line without a newline', async () => {
    const gate = deferred(), s = shell(async () => gate.promise);
    s.input.end('{"t":"request","id":"a","argv":["status"]}');
    await vi.waitFor(() => expect(s.invoked).toHaveLength(1));
    expect(s.results()).toEqual([]); gate.resolve();
    expect(await s.done).toBe(0); expect(s.results()).toMatchObject([{ id: 'a', ok: true }]);
  });

  it('EOF fails an unanswered ask closed and still emits its result', async () => {
    const s = shell(async (_argv, io) => io.text('Name'));
    s.request('a', ['status']); s.input.end(); expect(await s.done).toBe(0);
    expect(s.results()).toMatchObject([{ id: 'a', ok: false }]);
  });

  it('serve without --frames returns a result-shaped failure immediately', async () => {
    const s = shell(undefined, false);
    expect(await s.done).toBe(1);
    expect(s.received).toEqual([{ t: 'result', verb: 'serve', ok: false, exitCode: 1, error: 'serve requires --frames' }]);
    expect(s.invoked).toEqual([]);
  });

  it.each([false, true])('restores cwd after a request (throws=%s)', async throws => {
    const original = process.cwd(), directory = await mkdtemp(path.join(tmpdir(), 'serve-cwd-'));
    try {
      const observed: string[] = [];
      const s = shell(async argv => { observed.push(process.cwd()); if (throws && argv[0] === 'status') throw new Error('oops'); });
      s.request('a', ['status'], directory); s.request('b', ['ls']); s.input.end(); await s.done;
      expect(observed).toEqual([directory, original]); expect(process.cwd()).toBe(original);
      expect(s.results()).toHaveLength(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('an invalid cwd fails just that request without executing the verb', async () => {
    const s = shell(); s.request('a', ['status'], '/no/such/serve/cwd'); s.request('b', ['ls']); s.input.end(); await s.done;
    expect(s.invoked).toEqual([['ls']]); expect(s.results()).toMatchObject([{ id: 'a', ok: false }, { id: 'b', ok: true }]);
  });

  it('runs the real commander wiring with injected read verbs', async () => {
    const status = vi.fn(async () => success({ version: 'test', teams: [], ledger: { placements: [], approvals: [], shared: [] }, identity: null, tools: { git: true, gh: false } }));
    const s = shell(undefined, true, execute => buildProgram(execute, { login: vi.fn(), team: vi.fn(), status }));
    s.request('a', ['status']); s.request('b', ['status', '--bad']); s.input.end(); await s.done;
    expect(status).toHaveBeenCalledOnce(); expect(s.results()).toMatchObject([{ id: 'a', ok: true, value: { version: 'test' } }, { id: 'b', ok: false }]);
  });

  it('enables the optional compile cache before the bin does application work', () => {
    const source = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
    expect(source.indexOf('try { module.enableCompileCache(); }')).toBeLessThan(source.indexOf('const launch ='));
    expect(source).toContain('a cache miss is a slower start, never a wrong answer');
  });
});
