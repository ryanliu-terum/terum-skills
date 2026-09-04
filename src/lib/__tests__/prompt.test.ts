import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { ESLint } from 'eslint';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { NonInteractivePrompter, PromptClosedError, terminalPrompter } from '../prompt.js';

describe('Prompter boundary (§3, §12 "prompter")', () => {
  it('a verb handed the non-interactive Prompter cannot call confirm/text/select/secret — compile-time', () => {
    // `npm run typecheck` includes this file, so these assertions fail the typecheck gate, not just the suite.
    expectTypeOf<NonInteractivePrompter>().not.toHaveProperty('confirm');
    expectTypeOf<NonInteractivePrompter>().not.toHaveProperty('text');
    expectTypeOf<NonInteractivePrompter>().not.toHaveProperty('select');
    expectTypeOf<NonInteractivePrompter>().not.toHaveProperty('secret');
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
    await expect(io.secret('PAT')).rejects.toThrow(PromptClosedError);
    await expect(io.select('Pick', ['a'])).rejects.toThrow(PromptClosedError);
  });

  it('input ending before an answer settles as PromptClosedError, never as a hang or a silent success', async () => {
    const { io } = channel([]);
    await expect(io.text('Name')).rejects.toThrow(/Input ended before "Name:"/);
  });

  it('confirm is y/N: only y or yes (any case) is true', async () => {
    const answers = ['y', 'YES', 'n', '', 'ye', 'yup'];
    const { io } = channel(answers);
    const results = [];
    for (let index = 0; index < answers.length; index++) results.push(await io.confirm('Sure?'));
    expect(results).toEqual([true, true, false, false, false, false]);
  });

  it('text takes the default on a blank answer and trims; secret does not echo', async () => {
    const { io, out } = channel(['', '  Ryan  ', 'ghp_secret_value']);
    expect(await io.text('Name', 'Default')).toBe('Default');
    expect(await io.text('Name')).toBe('Ryan');
    expect(await io.secret('PAT')).toBe('ghp_secret_value');
    expect(out()).toContain('PAT: ');
    expect(out()).not.toContain('ghp_secret_value');
    expect(out()).toContain('Name [Default]: ');
  });

  it('select accepts a number or the exact choice, re-asks bad input, and gives up after three tries', async () => {
    const { io, out } = channel(['2', 'zeta', '0', 'x', '9']);
    expect(await io.select('Pick', ['alpha', 'beta'])).toBe('beta');
    expect(await io.select('Pick', ['zeta', 'eta'])).toBe('zeta');
    await expect(io.select('Pick', ['alpha', 'beta'])).rejects.toThrow('No valid choice after 3 attempts');
    expect(out().match(/Enter a number from 1 to 2\./g)).toHaveLength(3);
  });

  it('print writes one line to the output stream', () => {
    const { io, out } = channel([]);
    io.print('hello');
    expect(out()).toBe('hello\n');
  });
});
