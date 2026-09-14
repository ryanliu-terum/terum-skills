import { describe, expect, it } from 'vitest';
import { detectHost, OUTPUT_HELP, parseRenderOptions } from '../options.js';

const tty = { isTTY: true, columns: 120, rows: 40, colorCapable: true };
const pipe = { isTTY: false, colorCapable: false };
const argv = (...rest: string[]) => ['node', 'terum-skills', ...rest];

describe('the --format pre-parser (D1)', () => {
  it('leaves argv alone and reports plain when no flag is given', () => {
    expect(parseRenderOptions(argv('status'), {}, pipe)).toEqual({ ok: true, argv: argv('status'), options: { format: 'plain', formatGiven: false, host: 'terminal', rows: 25, width: 100, color: false } });
  });
  it('strips every flag wherever it sits, in both spellings, and honours the -- boundary', () => {
    const parsed = parseRenderOptions(argv('--rows', '5', 'ls', '--format=md', '--local', '--host', 'codex', '--width=80', '--no-color', '--', '--format', 'json'), {}, tty);
    expect(parsed).toEqual({ ok: true, argv: argv('ls', '--local', '--', '--format', 'json'), options: { format: 'md', formatGiven: true, host: 'codex', rows: 5, width: 80, color: false } });
  });
  it('resolves auto to pretty on a TTY and md otherwise, and folds the screen height into rows on a TTY', () => {
    expect(parseRenderOptions(argv('--format', 'auto', 'ls'), {}, tty)).toMatchObject({ ok: true, options: { format: 'pretty', rows: 25, width: 120, color: true } });
    expect(parseRenderOptions(argv('--format', 'auto', 'ls'), {}, pipe)).toMatchObject({ ok: true, options: { format: 'md', rows: 25, width: 100, color: false } });
    expect(parseRenderOptions(argv('--format', 'pretty', 'ls'), {}, { ...tty, rows: 20 })).toMatchObject({ ok: true, options: { rows: 8 } });
    expect(parseRenderOptions(argv('--format', 'pretty', '--rows', 'all', 'ls'), {}, { ...tty, rows: 20 })).toMatchObject({ ok: true, options: { rows: 'all' } });
    expect(parseRenderOptions(argv('--format', 'pretty', 'ls'), {}, { ...tty, rows: 10 })).toMatchObject({ ok: true, options: { rows: 5 } });
  });
  it('colours pretty output on a capable terminal or with FORCE_COLOR, never with --no-color', () => {
    expect(parseRenderOptions(argv('--format', 'pretty'), { FORCE_COLOR: '1' }, pipe)).toMatchObject({ ok: true, options: { color: true } });
    expect(parseRenderOptions(argv('--format', 'pretty', '--no-color'), { FORCE_COLOR: '1' }, tty)).toMatchObject({ ok: true, options: { color: false } });
    expect(parseRenderOptions(argv('--format', 'md'), {}, tty)).toMatchObject({ ok: true, options: { color: true } });
  });
  it('uses the terminal width when it is at least 40, else 100', () => {
    expect(parseRenderOptions(argv('--format', 'pretty'), {}, { ...tty, columns: 30 })).toMatchObject({ ok: true, options: { width: 100 } });
    expect(parseRenderOptions(argv('--format', 'pretty'), {}, { ...tty, columns: undefined })).toMatchObject({ ok: true, options: { width: 100 } });
  });
  it.each([
    [['--format', 'yaml'], '--format must be one of plain, md, pretty, json, auto.'],
    [['--format'], '--format must be one of plain, md, pretty, json, auto.'],
    [['--format=', 'ls'], '--format must be one of plain, md, pretty, json, auto.'],
    [['--format', 'md', '--host', 'vim'], '--host must be one of claude, codex, terminal.'],
    [['--format', 'md', '--rows', '0'], '--rows must be a positive integer or all.'],
    [['--format', 'md', '--rows', 'ten'], '--rows must be a positive integer or all.'],
    [['--format', 'md', '--width', '39'], '--width must be an integer of at least 40.'],
    [['--format', 'md', '--width=abc'], '--width must be an integer of at least 40.'],
    [['--rows', '5', 'ls'], '--rows, --width, --host and --no-color need --format.'],
    [['--no-color', 'ls'], '--rows, --width, --host and --no-color need --format.'],
  ])('refuses %j with one line', (rest, error) => {
    expect(parseRenderOptions(argv(...rest), {}, tty)).toEqual({ ok: false, error });
  });
  it('detects the host from the environment, Codex first', () => {
    expect(detectHost({ CODEX_SESSION_ID: 'x', CLAUDECODE: '1' })).toBe('codex');
    expect(detectHost({ CODEX_THREAD_ID: 'x' })).toBe('codex');
    expect(detectHost({ CLAUDECODE: '1' })).toBe('claude');
    expect(detectHost({})).toBe('terminal');
    expect(parseRenderOptions(argv('--format', 'md'), { CLAUDECODE: '1' }, pipe)).toMatchObject({ ok: true, options: { host: 'claude' } });
  });
  it('documents the flags in one help paragraph', () => {
    for (const flag of ['--format <plain|md|pretty|json|auto>', '--host <claude|codex|terminal>', '--rows <n|all>', '--width <n>', '--no-color']) expect(OUTPUT_HELP).toContain(flag);
    expect(OUTPUT_HELP.startsWith('\nOutput:')).toBe(true);
  });
});
