/**
 * One cell → its text, for both text backends (§4.1's wording is the contract; `pretty` adds colour
 * and truncation on top). `nextCommand` is the one place a Next step is phrased for a host (§6.2).
 */
import { invocation, type RawFragment } from '../invocation.js';
import type { Cell, NextItem, RenderContext, Tone } from './board.js';
import { liftText, roundHalfEven } from './policies.js';
import { relativeDate, singleLine, tildePath } from './text.js';

export interface RenderedCell { text: string; tone?: Tone; mono?: boolean; align: 'left' | 'right' }

const STATUS_GLYPH: Record<Tone, string> = { ok: '✓', bad: '✗', warn: '⚠', pending: '◔', info: '●', muted: '—' };
const VERDICT_TONE = { PASS: 'ok', NEUTRAL: 'info', FAIL: 'bad' } as const;
const VERDICT_GLYPH = { PASS: '✓', NEUTRAL: '●', FAIL: '✗' } as const;

export function renderCell(cell: Cell, ctx: RenderContext): RenderedCell {
  switch (cell.kind) {
    case 'text': return { text: singleLine(cell.text), align: cell.align ?? 'left' };
    case 'count': return { text: cell.n === null ? '—' : String(cell.n), align: 'right' };
    case 'status': return { text: `${STATUS_GLYPH[cell.tone]} ${cell.text}`, tone: cell.tone, align: 'left' };
    case 'date': return { text: relativeDate(cell.iso, ctx.now), align: 'left' };
    case 'path': return { text: tildePath(cell.path, ctx.home), mono: true, align: 'left' };
    case 'code': return { text: cell.text, mono: true, align: 'left' };
    case 'strip': return { text: cell.text, mono: true, align: 'left' };
    case 'bar': return { text: barText(cell.fraction, cell.label), mono: true, align: 'left' };
    case 'verdict': {
      if (cell.invalid) return { text: '⚠ invalid receipt', tone: 'warn', align: 'left' };
      if (cell.verdict === null) return cell.stale ? { text: '⚠ stale — edited since the eval', tone: 'warn', align: 'left' } : { text: '— not evaluated', tone: 'muted', align: 'left' };
      let text = `${VERDICT_GLYPH[cell.verdict]} ${cell.verdict} ${liftText(cell.lift)}`;
      if (cell.partial) text += ` (${cell.partial.scored ?? '—'}/${cell.partial.expected ?? '—'} scored)`;
      if (cell.stale) text += ' ⚠ stale';
      if (cell.from !== null) text += ` (${cell.from})`;
      return { text, tone: cell.partial ? 'muted' : VERDICT_TONE[cell.verdict], align: 'left' };
    }
  }
}

/** Ten cells, the fraction rounded half-even; `——————————` for nothing to draw. */
export function barText(fraction: number | null, label: string): string {
  const filled = fraction === null ? null : roundHalfEven(Math.min(1, Math.max(0, fraction)) * 10);
  const cells = filled === null ? '—'.repeat(10) : `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
  return label === '' ? cells : `${cells} ${label}`;
}

const SAFE_ARG = /^[A-Za-z0-9_./~:@+=-]+$/;
/** A chat-host argument: bare when it is plain, JSON-quoted otherwise (a slash command is not a shell). */
export function quoteArg(arg: string): string { return SAFE_ARG.test(arg) ? arg : JSON.stringify(arg); }
/** A terminal argument: bare when it is plain (a RawFragment `invocation()` leaves unquoted), single-quoted otherwise (a plain string `invocation()` shell-quotes). Shared by `nextCommand` and the bin's `--rows all` footer command. */
export function shellArg(arg: string): string | RawFragment { return SAFE_ARG.test(arg) ? { raw: arg } : arg; }

export function nextCommand(item: NextItem, ctx: RenderContext): string {
  if ('raw' in item) return item.raw;
  // Terminal: `invocation()` owns shell quoting — plain arguments stay bare (RawFragment), the rest are POSIX-quoted by it.
  if (ctx.host === 'terminal') return invocation(ctx.form, item.verb, ...item.args.map(shellArg));
  const sigil = ctx.host === 'claude' ? '/' : '$';
  const tail = item.args.length === 0 ? '' : ` ${item.args.map(quoteArg).join(' ')}`;
  return item.skill === undefined ? `${sigil}terum-skills ${item.verb}${tail}` : `${sigil}${item.skill}${tail}`;
}
