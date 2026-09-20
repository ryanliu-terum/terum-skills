import { describe, expect, it } from 'vitest';
import { PromptClosedError } from '../../prompt.js';
import { createBoardSink } from '../sink.js';
import type { RenderOptions } from '../options.js';

const options: RenderOptions = { format: 'md', formatGiven: true, host: 'claude', rows: 25, width: 100, color: false };
function make(overrides: Partial<Parameters<typeof createBoardSink>[0]> = {}) {
  const written: string[] = []; const errors: string[] = []; const codes: number[] = []; const progress: string[] = [];
  const sink = createBoardSink({ options, home: '/home/u', now: () => Date.parse('2026-09-13T12:00:00Z'), argv: ['publish', 'x'], command: 'npx -y terum-skills@latest publish x --format md', rowsAllCommand: 'npx -y terum-skills@latest publish x --format md --rows all', write: (text) => written.push(text), stderr: (line) => errors.push(line), setExitCode: (code) => codes.push(code), progress: (line) => progress.push(line), ...overrides });
  return { sink, written, errors, codes, progress };
}

describe('the board sink (D3)', () => {
  it('collects prints split on newlines, lifts Resolved: lines, and writes one Markdown document with a trailing newline', () => {
    const { sink, written } = make();
    sink.io.print('Resolved: "x" → xylophone (unique prefix)'); sink.io.print('a\nb'); sink.io.print('');
    sink.result!({ verb: 'publish', ok: true, value: { ok: 1 }, exitCode: 0 });
    expect(written).toEqual(['## publish\n_Resolved: "x" → xylophone (unique prefix)_\n\n```\na\nb\n```\n']);
    expect(sink.lines).toEqual(['Resolved: "x" → xylophone (unique prefix)', 'a', 'b', '']);
  });
  it('refuses every question as a non-TTY terminal would and exposes no interactivity', async () => {
    const { sink } = make();
    expect(sink.io.interactive).toBe(false); expect(sink.io.channel).toBe('terminal');
    for (const ask of [() => sink.io.confirm('Go?'), () => sink.io.text('Name'), () => sink.io.select('Pick', ['a'])]) {
      const error = await ask().then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(PromptClosedError); expect((error as PromptClosedError).message).toContain('this command needs an interactive terminal (stdin is not a TTY).');
    }
  });
  it('renders the json document with every printed line and the failure fields', () => {
    const { sink, written, errors, codes } = make({ options: { ...options, format: 'json' } });
    sink.io.print('Resolved: x from the working directory'); sink.io.print('one');
    sink.stderr('boom'); sink.setExitCode(1);
    sink.result!({ verb: 'publish', ok: false, error: 'boom', cancelled: true, value: { partial: true }, exitCode: 1 });
    expect(JSON.parse(written[0]!)).toEqual({ verb: 'publish', ok: false, exitCode: 1, error: 'boom', declined: true, value: { partial: true }, lines: ['Resolved: x from the working directory', 'one'] });
    expect(written[0]!.endsWith('\n')).toBe(true);
    expect(errors).toEqual(['boom']); expect(codes).toEqual([1]);
  });
  it('renders pretty with the board colour decision and forwards progress as one line', () => {
    const { sink, written, progress } = make({ options: { ...options, format: 'pretty', color: true } });
    sink.io.progress?.({ step: 'evals', current: 1, total: 2 }); sink.io.progress?.({ step: 'download' });
    sink.result!({ verb: 'publish', ok: true, exitCode: 0 });
    expect(progress).toEqual(['evals 1/2', 'download', '']); // the trailing '' clears the progress line before the board
    expect(written[0]).toBe('\x1b[1mpublish\x1b[0m\n');
    const silent = make({ options: { ...options, format: 'pretty' }, progress: undefined });
    expect(silent.sink.io.progress).toBeUndefined();
  });
});
