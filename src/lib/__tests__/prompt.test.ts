import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { PassThrough } from 'node:stream';
import { ESLint } from 'eslint';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { NonInteractivePrompter, PromptClosedError, terminalPrompter } from '../prompt.js';

describe('Prompter boundary (§3, §12 "prompter")', () => {
  it('a verb handed the non-interactive Prompter cannot call confirm/text/select — compile-time', () => {
    // `npm run typecheck` includes this file, so these assertions fail the typecheck gate, not just the suite.
    expectTypeOf<NonInteractivePrompter>().not.toHaveProperty('confirm');
    expectTypeOf<NonInteractivePrompter>().not.toHaveProperty('text');
    expectTypeOf<NonInteractivePrompter>().not.toHaveProperty('select');
    expectTypeOf<NonInteractivePrompter>().toHaveProperty('print');
    const hookIo: NonInteractivePrompter = { interactive: false, print: () => undefined };
    // @ts-expect-error — the hook Prompter has no way to ask a human anything
    void hookIo.confirm;
    expect(hookIo.interactive).toBe(false);
  });

  // The repo root, independent of the cwd vitest was launched from.
  const eslint = new ESLint({ cwd: resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..') });
  const lint = async (code: string, filePath: string) => (await eslint.lintText(code, { filePath }))[0]?.messages.map((message) => message.ruleId) ?? [];
  const BOUNDARY = ['no-restricted-globals', 'no-restricted-properties', 'no-restricted-imports', 'no-restricted-syntax'];
  const flagged = async (code: string, filePath = 'src/commands/probe.ts') => (await lint(code, filePath)).filter((rule) => BOUNDARY.includes(rule ?? ''));

  it('the lint rule catches the direct, aliased, globalThis, and dynamic-import ways a module could bypass the Prompter', async () => {
    const vectors = [
      'console.log("no");',
      'export const tty = process.stdin.isTTY;',
      'export const w = process.stdout.write;',
      'export const e = process.stderr;',
      'import { createInterface } from "node:readline"; void createInterface;',
      'import { createInterface } from "readline/promises"; void createInterface;',
      'import { stdout } from "node:process"; stdout.write("x");',
      'import { stdin } from "process"; void stdin;',
      'import { Console } from "node:console"; void Console;',
      'globalThis.console.log("x");',
      'globalThis.process.stdout.write("x");',
      'const p = process; p.stdout.write("x");',
      'const { stdout } = process; stdout.write("x");',
      'const g = globalThis; g.process.stdout.write("x");',
      'export async function f() { const rl = await import("node:readline/promises"); return rl; }',
      'export async function f() { const p = await import("node:process"); return p; }',
      'export async function f() { const c = await import("console"); return c; }',
      'process.exit(1);',
      'export function f() { process.exit(0); }',
      'process.exitCode = 1;',
      'export function f() { process.exitCode = 1; }',
    ];
    for (const code of vectors) {
      expect(await flagged(code), code).not.toEqual([]);
      expect(await flagged(code, 'src/lib/probe.ts'), code).not.toEqual([]);
      expect(await flagged(code, 'src/future/hook.ts'), code).not.toEqual([]);
    }
  });

  it('the one implementation of the channel and the bin entry are exempt, and process.env stays available', async () => {
    expect(await flagged('import { stdin, stdout } from "node:process"; stdout.write(String(stdin.isTTY));', 'src/lib/prompt.ts')).toEqual([]);
    expect(await flagged('process.stderr.write("x"); process.exitCode = 1;', 'src/index.ts')).toEqual([]);
    expect(await flagged('export const home = process.env.HOME; export const pid = process.pid;', 'src/lib/ok.ts')).toEqual([]);
  });
});

describe('terminalPrompter behaviour', () => {
  /** A fake terminal: answers are typed one at a time, each after its prompt has been written, like a human. */
  const channel = (answers: string[], interactive = true) => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    const queue = [...answers];
    const type = () => { const next = queue.shift(); if (next === undefined) input.end(); else setTimeout(() => input.write(`${next}\n`), 2); };
    output.on('data', (chunk: Buffer) => { written += chunk.toString(); if (/(: |> |\] )$/.test(chunk.toString())) type(); });
    const io = terminalPrompter({ input: Object.assign(input, { isTTY: interactive }), output, interactive });
    return { io, out: () => written, end: () => input.end() };
  };

  it('refuses to ask on a non-interactive channel instead of hanging', async () => {
    const { io } = channel(['yes'], false);
    expect(io.interactive).toBe(false);
    await expect(io.text('Name')).rejects.toThrow(PromptClosedError);
    await expect(io.confirm('Sure?')).rejects.toThrow(/interactive terminal/);
    await expect(io.select('Pick', ['a'])).rejects.toThrow(PromptClosedError);
  });

  it('input ending before an answer settles as PromptClosedError, never as a hang or a silent success', async () => {
    const { io } = channel([]);
    await expect(io.text('Name')).rejects.toThrow(/Input ended before "Name:"/);
  });

  it('a question pending when the output breaks (the reader went away) fails closed instead of waiting for an answer nobody was shown, and so does every later one', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk: Buffer) => { written += chunk.toString(); });
    let breakOutput: () => void = () => undefined;
    const outputClosed = new Promise<void>((resolve) => { breakOutput = resolve; });
    const io = terminalPrompter({ input: Object.assign(input, { isTTY: true }), output, interactive: true, outputClosed });
    const pending = io.confirm('Delete 3 quarantined item(s)?');
    breakOutput();
    await expect(pending).rejects.toThrow('Output closed before "Delete 3 quarantined item(s)? [y/N]" could be asked');
    await expect(io.text('Name')).rejects.toThrow('Output closed before "Name:" could be asked');
    // The pre-ask guard and the race throw the same error with the same message, so only "the dead
    // output was never written to" tells them apart: this line is what pins the pre-check.
    expect(written).not.toContain('Name:');
  });

  it('an outputClosed that REJECTS is settlement too: the question fails closed as PromptClosedError, and the rejection never escapes unhandled', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let breakOutput: (error: Error) => void = () => undefined;
    const outputClosed = new Promise<void>((_, reject) => { breakOutput = reject; });
    const io = terminalPrompter({ input: Object.assign(input, { isTTY: true }), output, interactive: true, outputClosed });
    const pending = io.confirm('Delete 3 quarantined item(s)?');
    breakOutput(new Error('EPIPE: broken pipe, write'));
    await expect(pending).rejects.toThrow(PromptClosedError);
    await expect(io.text('Name')).rejects.toThrow(/Output closed before "Name:"/);
  });

  it('confirm is y/N: only y or yes (any case) is true', async () => {
    const answers = ['y', 'YES', 'n', '', 'ye', 'yup'];
    const { io } = channel(answers);
    const results = [];
    for (let index = 0; index < answers.length; index++) results.push(await io.confirm('Sure?'));
    expect(results).toEqual([true, true, false, false, false, false]);
  });

  it('text takes the default on a blank answer and trims', async () => {
    const { io, out } = channel(['', '  Ryan  ']);
    expect(await io.text('Name', 'Default')).toBe('Default');
    expect(await io.text('Name')).toBe('Ryan');
    expect(out()).toContain('Name [Default]: ');
  });

  it('leaves no live reader on the input after a question settles, resolved or rejected', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const counts = () => ({ data: input.listenerCount('data'), keypress: input.listenerCount('keypress'), end: input.listenerCount('end') });
    const io = terminalPrompter({ input: Object.assign(input, { isTTY: true }), output, interactive: true });
    // Node's readline attaches one permanent keypress decoder ('data' listener) to a stream on first
    // use and never removes it; it is inert once the interface closes. Measure after that warm-up.
    const warm = io.text('Warm');
    input.write('up\n');
    expect(await warm).toBe('up');
    const baseline = counts();
    const pending = io.text('Name');
    expect(counts().keypress).toBe(baseline.keypress + 1);
    input.write('Ryan\n');
    expect(await pending).toBe('Ryan');
    expect(counts()).toEqual(baseline);
    expect(input.isPaused()).toBe(true);
    const rejected = io.confirm('Again?');
    input.end();
    await expect(rejected).rejects.toThrow(PromptClosedError);
    expect(counts()).toEqual(baseline);
  });

  it('select accepts a number or the exact choice, re-asks bad input, and gives up after three tries', async () => {
    const { io, out } = channel(['2', 'zeta', '0', 'x', '9']);
    expect(await io.select('Pick', ['alpha', 'beta'])).toBe('beta');
    expect(await io.select('Pick', ['zeta', 'eta'])).toBe('zeta');
    await expect(io.select('Pick', ['alpha', 'beta'])).rejects.toThrow('No valid choice after 3 attempts');
    expect(out().match(/Enter a number from 1 to 2\./g)).toHaveLength(3);
  });

  it('select accepts Enter as the supplied default without reordering choices', async () => {
    const { io, out } = channel(['']);
    expect(await io.select('Install to', ['Global', 'Checkout'], 'Checkout')).toBe('Checkout');
    expect(out()).toContain('1. Global');
    expect(out()).toContain('2. Checkout');
  });

  it('prints identity detail once immediately before its confirm question', async () => {
    const { io, out } = channel(['y']);
    const pending = io.confirm('Use this identity?', { detail: ['Identity: @me — Me <me@x.test> (GitHub: octocat)'] });
    // Readline adds cursor-control bytes and echoes the answer; assert the exact prompt before typing.
    expect(stripVTControlCharacters(out())).toBe('Identity: @me — Me <me@x.test> (GitHub: octocat)\nUse this identity? [y/N] ');
    expect(await pending).toBe(true);
    expect(stripVTControlCharacters(out())).toBe('Identity: @me — Me <me@x.test> (GitHub: octocat)\nUse this identity? [y/N] y\r\n');
    const previous = channel(['y']);
    previous.io.print('Identity: @me — Me <me@x.test> (GitHub: octocat)');
    expect(await previous.io.confirm('Use this identity?')).toBe(true);
    expect(out()).toBe(previous.out()); // Byte-identical to the preceding-print path, including readline controls.

  });

  it('keeps a 24-line uninstall disclosure byte-identical to prints before confirm', async () => {
    const detail = Array.from({ length: 24 }, (_, i) => `  Inventory ${i}: <path> & kept`);
    const next = channel(['y']), previous = channel(['y']);
    for (const line of detail) previous.io.print(line);
    expect(await previous.io.confirm('Remove terum-skills from this machine?')).toBe(true);
    expect(await next.io.confirm('Remove terum-skills from this machine?', { detail })).toBe(true);
    expect(next.out()).toBe(previous.out());
    const nonInteractive = channel([], false);
    await expect(nonInteractive.io.confirm('Remove terum-skills from this machine?', { detail })).rejects.toThrow(PromptClosedError);
    expect(nonInteractive.out()).toBe(detail.join('\n') + '\n');
  });

  it('prints text and select detail once, including across select retries', async () => {
    const { io, out } = channel(['name', 'bad', '1']);
    expect(await io.text('Name', '', { detail: ['Text context'] })).toBe('name');
    expect(await io.select('Pick', ['a'], undefined, { detail: ['Select context'] })).toBe('a');
    expect(out().match(/Text context\n/g)).toHaveLength(1);
    expect(out().match(/Select context\n/g)).toHaveLength(1);
  });

  it('print writes one line to the output stream', () => {
    const { io, out } = channel([]);
    io.print('hello');
    expect(out()).toBe('hello\n');
  });
});
