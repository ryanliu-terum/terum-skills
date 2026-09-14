/**
 * D3: the ExecuteSink of a board run. The Prompter collects prints and refuses questions exactly as a
 * non-TTY terminal does (PromptClosedError 'not-interactive'), so every verb's classification holds;
 * `result()` renders once and writes once. stderr and the exit code are the caller's, untouched.
 */
import type { ExecuteSink } from '../execute.js';
import type { ResultOutcome } from '../frames.js';
import type { InvocationForm } from '../invocation.js';
import { PromptClosedError, type ProgressUpdate, type Prompter } from '../prompt.js';
import { RESOLVED_PREFIX } from '../resolve-ref.js';
import type { RenderContext } from './board.js';
import { renderJson } from './json.js';
import { renderMd } from './md.js';
import type { RenderOptions } from './options.js';
import { renderPretty } from './pretty.js';
import { renderBoard } from './registry.js';

export interface BoardSinkInput {
  options: RenderOptions;
  form?: InvocationForm | undefined;
  home: string;
  now(): number;
  /** The verb's argv after the bin, flags stripped: `['ls', 'skill', 'x']`. */
  argv: readonly string[];
  /** The same as a re-runnable command line, for the `--rows all` footer. */
  command: string;
  write(text: string): void;
  stderr(line: string): void;
  setExitCode(code: number): void;
  /** A one-line progress sink (stderr on a TTY); absent means progress is dropped. */
  progress?: ((line: string) => void) | undefined;
  afterVerb?: (() => Promise<void>) | undefined;
}

export function createBoardSink(input: BoardSinkInput): ExecuteSink & { lines: string[] } {
  const lines: string[] = [];
  const refuse = (question: string): never => { throw new PromptClosedError(question, 'not-interactive'); };
  const progress = input.progress;
  const io: Prompter = {
    interactive: false,
    channel: 'terminal',
    print: (line) => { lines.push(...line.split(/\r?\n/)); },
    confirm: async (question) => refuse(question),
    text: async (question) => refuse(question),
    select: async (question) => refuse(question),
    ...(progress === undefined ? {} : { progress: (update: ProgressUpdate) => { progress(`${update.step}${update.current === undefined ? '' : ` ${update.current}${update.total === undefined ? '' : `/${update.total}`}`}`); } }),
  };
  const result = (outcome: ResultOutcome): void => {
    if (input.options.format === 'plain') return; // never built for plain (D2); defensive
    input.progress?.(''); // clear the one-line progress before the board lands
    if (input.options.format === 'json') { input.write(`${renderJson(outcome, lines)}\n`); return; }
    const resolved = lines.filter((line) => line.startsWith(RESOLVED_PREFIX));
    const rest = lines.filter((line) => !line.startsWith(RESOLVED_PREFIX));
    const ctx: RenderContext = { format: input.options.format, host: input.options.host, rows: input.options.rows, width: input.options.width, color: input.options.color, form: input.form, home: input.home, now: input.now(), argv: input.argv, command: input.command };
    const board = renderBoard(outcome, rest, resolved, ctx);
    input.write(`${input.options.format === 'pretty' ? renderPretty(board, ctx) : renderMd(board, ctx)}\n`);
  };
  return { io, lines, result, stderr: input.stderr, setExitCode: input.setExitCode, ...(input.form === undefined ? {} : { form: input.form }), ...(input.afterVerb === undefined ? {} : { afterVerb: input.afterVerb }) };
}
