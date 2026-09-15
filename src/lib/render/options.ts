/**
 * D1: the global output flags, read and removed from the argv prefix before the first `--` exactly
 * as `--frames` is handled in src/index.ts, so commander never sees them and no verb needs to
 * declare them. A leaf: the terminal facts (TTY, columns, rows, colour) arrive as an argument,
 * because only src/index.ts may read process.stdout.
 */
export const FORMATS = ['plain', 'md', 'pretty', 'json', 'auto'] as const;
export const HOSTS = ['claude', 'codex', 'terminal'] as const;
export type RenderFormatOption = (typeof FORMATS)[number];
export type Host = (typeof HOSTS)[number];

export interface RenderOptions {
  format: 'plain' | 'md' | 'pretty' | 'json';
  /** Whether `--format` was typed at all — the refusals (`--frames`, `serve`, `sync --hook`) key on this. */
  formatGiven: boolean;
  host: Host;
  rows: number | 'all';
  width: number;
  color: boolean;
}
export interface TerminalFacts { isTTY: boolean; columns?: number | undefined; rows?: number | undefined; colorCapable: boolean }
export type ParsedRenderOptions = { ok: true; argv: string[]; options: RenderOptions } | { ok: false; error: string };

const FORMAT_ERROR = `--format must be one of ${FORMATS.join(', ')}.`;
const HOST_ERROR = `--host must be one of ${HOSTS.join(', ')}.`;
const ROWS_ERROR = '--rows must be a positive integer or all.';
const WIDTH_ERROR = '--width must be an integer of at least 40.';
const NEEDS_FORMAT = '--rows, --width, --host and --no-color need --format.';

/** Codex is tested first: a Codex shell started inside Claude Code carries both markers and Codex is the inner host (spec §6.2). */
export function detectHost(env: NodeJS.ProcessEnv): Host {
  if (env.CODEX_SESSION_ID !== undefined || env.CODEX_THREAD_ID !== undefined) return 'codex';
  if (env.CLAUDECODE !== undefined) return 'claude';
  return 'terminal';
}

export function parseRenderOptions(argv: readonly string[], env: NodeJS.ProcessEnv, terminal: TerminalFacts): ParsedRenderOptions {
  const separator = argv.indexOf('--');
  const prefixEnd = separator === -1 ? argv.length : separator;
  const kept: string[] = [];
  let format: RenderFormatOption | undefined;
  let host: Host | undefined;
  let rows: number | 'all' | undefined;
  let width: number | undefined;
  let noColor = false;
  let formatGiven = false, othersGiven = false;
  const take = (name: string, index: number): { value: string | undefined; next: number } => {
    const token = argv[index]!;
    if (token.startsWith(`${name}=`)) return { value: token.slice(name.length + 1), next: index + 1 };
    const value = argv[index + 1];
    return value === undefined || index + 1 >= prefixEnd ? { value: undefined, next: index + 1 } : { value, next: index + 2 };
  };
  for (let index = 0; index < prefixEnd;) {
    const token = argv[index]!;
    if (token === '--format' || token.startsWith('--format=')) {
      formatGiven = true;
      const { value, next } = take('--format', index);
      if (value === undefined || !(FORMATS as readonly string[]).includes(value)) return { ok: false, error: FORMAT_ERROR };
      format = value as RenderFormatOption; index = next; continue;
    }
    if (token === '--host' || token.startsWith('--host=')) {
      othersGiven = true;
      const { value, next } = take('--host', index);
      if (value === undefined || !(HOSTS as readonly string[]).includes(value)) return { ok: false, error: HOST_ERROR };
      host = value as Host; index = next; continue;
    }
    if (token === '--rows' || token.startsWith('--rows=')) {
      othersGiven = true;
      const { value, next } = take('--rows', index);
      if (value === 'all') rows = 'all';
      else if (value !== undefined && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))) rows = Number(value);
      else return { ok: false, error: ROWS_ERROR };
      index = next; continue;
    }
    if (token === '--width' || token.startsWith('--width=')) {
      othersGiven = true;
      const { value, next } = take('--width', index);
      if (value === undefined || !/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 40) return { ok: false, error: WIDTH_ERROR };
      width = Number(value); index = next; continue;
    }
    if (token === '--no-color') { othersGiven = true; noColor = true; index += 1; continue; }
    kept.push(token); index += 1;
  }
  if (!formatGiven && othersGiven) return { ok: false, error: NEEDS_FORMAT };
  const resolved: RenderOptions['format'] = format === undefined ? 'plain' : format === 'auto' ? (terminal.isTTY ? 'pretty' : 'md') : format;
  let cap: number | 'all' = rows ?? 25;
  // §4.2: on a TTY a pretty board fits one screen; `--rows all` lifts it.
  if (resolved === 'pretty' && terminal.isTTY && typeof terminal.rows === 'number' && cap !== 'all') cap = Math.min(cap, Math.max(5, terminal.rows - 12));
  const options: RenderOptions = {
    format: resolved, formatGiven,
    host: host ?? detectHost(env),
    rows: cap,
    width: width ?? (typeof terminal.columns === 'number' && terminal.columns >= 40 ? terminal.columns : 100),
    color: !noColor && (terminal.colorCapable || env.FORCE_COLOR !== undefined),
  };
  return { ok: true, argv: [...kept, ...argv.slice(prefixEnd)], options };
}

export const OUTPUT_HELP = [
  '',
  'Output:',
  '  --format <plain|md|pretty|json|auto>  render the result as a board: md for Claude Code and Codex, pretty for a',
  '                                        terminal, json for scripts; auto is pretty on a TTY and md otherwise',
  '                                        (default: plain, the output above)',
  '  --host <claude|codex|terminal>        how the board\'s Next line phrases commands (autodetected)',
  '  --rows <n|all>                        rows per table before the "… and N more" footer (default: 25)',
  '  --width <n>                           width of a pretty board (default: the terminal width, else 100; at least 40)',
  '  --no-color                            no ANSI colour in a pretty board',
].join('\n');
