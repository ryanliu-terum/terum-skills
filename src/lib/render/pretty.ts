/**
 * §4.2: box-drawn tables in setup's `box()` style, tones as colour through `paint()` (never
 * `colorCapable()` — the sink decided colour once), columns dropped by priority when a table exceeds
 * `ctx.width`, a key/value list per row below 60 columns.
 */
import { paint, type StyleKind } from '../banner.js';
import type { Board, Column, RenderContext, Section, Table, Tone } from './board.js';
import { barText, nextCommand, renderCell, type RenderedCell } from './cells.js';
import { failureSuffix } from './md.js';
import { padVisible, truncate, visibleWidth } from './text.js';

const TONE_STYLE: Record<Tone, StyleKind> = { ok: 'green', bad: 'red', warn: 'yellow', pending: 'yellow', muted: 'dim', info: 'cyan' };
const MIN_COLUMN = 6;
type Paint = (kind: StyleKind, text: string) => string;
const clip = (cell: RenderedCell, column: Column): string => (column.max === undefined ? cell.text : truncate(cell.text, column.max));

export function renderPretty(board: Board, ctx: RenderContext): string {
  const c: Paint = (kind, text) => paint(kind, text, ctx.color);
  const out: string[] = [c('bold', board.title)];
  for (const line of board.resolved) out.push(c('dim', c('italic', line)));
  if (board.headline !== undefined) out.push(board.headline);
  for (const section of board.sections) out.push('', ...renderSection(section, ctx, c));
  if (board.failure) {
    const [first, ...rest] = board.failure.error.split(/\r?\n/);
    out.push('', c('red', `✗ ${first ?? ''}${failureSuffix(board.failure)}`), ...rest.map((line) => c('red', `  ${line}`)));
  }
  if (board.notes.length) out.push('', c('bold', 'Notes'), ...board.notes.map((note) => `  • ${note}`));
  if (board.next.length) out.push('', `${c('bold', 'Next:')} ${board.next.map((item) => c('cyan', nextCommand(item, ctx))).join(' · ')}`);
  return out.join('\n');
}

function colour(text: string, cell: RenderedCell, c: Paint): string {
  if (cell.tone !== undefined) return c(TONE_STYLE[cell.tone], text);
  if (cell.text === text && /^[WLT-]+$/.test(text) && cell.mono) return [...text].map((letter) => c(letter === 'W' ? 'green' : letter === 'L' ? 'red' : 'dim', letter)).join('');
  return text;
}

function renderSection(section: Section, ctx: RenderContext, c: Paint): string[] {
  const out: string[] = section.title === undefined ? [] : [c('bold', section.title)];
  switch (section.kind) {
    case 'table': out.push(...renderTable(section, ctx, c)); break;
    case 'kv': {
      const width = Math.max(0, ...section.rows.map(([label]) => visibleWidth(label) + 1));
      for (const [label, cell] of section.rows) { const rendered = renderCell(cell, ctx); out.push(`  ${padVisible(`${label}:`, width)} ${colour(rendered.text, rendered, c)}`); }
      break;
    }
    case 'text': out.push(...section.lines.map((line) => `  ${line}`)); break;
    case 'bars': {
      const width = Math.max(0, ...section.rows.map((row) => visibleWidth(row.label)));
      for (const row of section.rows) out.push(`  ${padVisible(row.label, width)} ${barText(row.fraction, row.value)}`);
      break;
    }
  }
  return out;
}

function renderTable(table: Table, ctx: RenderContext, c: Paint): string[] {
  if (table.rows.length === 0) return ['  none'];
  const rendered = table.rows.map((row) => table.columns.map((column) => renderCell(row[column.key] ?? { kind: 'text', text: '—' }, ctx)));
  let out: string[];
  let dropped: string[] = [];
  if (ctx.width < 60) {
    out = keyValueRows(table.columns, rendered, c);
  } else {
    const widths = table.columns.map((column, index) => Math.max(visibleWidth(column.label), ...rendered.map((row) => visibleWidth(clip(row[index]!, column)))));
    let keep = table.columns.map((_, index) => index);
    const total = (): number => keep.reduce((sum, index) => sum + widths[index]! + 3, 1);
    for (const priority of [3, 2] as const) {
      while (total() > ctx.width) {
        const drop = [...keep].reverse().find((index) => table.columns[index]!.priority === priority);
        if (drop === undefined) break;
        keep = keep.filter((index) => index !== drop);
      }
    }
    // Only priority-1 columns left and still too wide: narrow the widest until it fits or nothing can give.
    while (total() > ctx.width) {
      const widest = keep.reduce((a, b) => (widths[a]! >= widths[b]! ? a : b));
      if (widths[widest]! <= MIN_COLUMN) break;
      widths[widest] = widths[widest]! - 1;
    }
    const rule = (left: string, mid: string, right: string): string => `${left}${keep.map((index) => '─'.repeat(widths[index]! + 2)).join(mid)}${right}`;
    const line = (cells: string[]): string => `│ ${cells.join(' │ ')} │`;
    out = [
      rule('╭', '┬', '╮'),
      line(keep.map((index) => c('bold', padVisible(table.columns[index]!.label, widths[index]!, table.columns[index]!.align ?? 'left')))),
      rule('├', '┼', '┤'),
    ];
    for (const row of rendered) {
      out.push(line(keep.map((index) => {
        const cell = row[index]!; const width = widths[index]!;
        return padVisible(colour(truncate(clip(cell, table.columns[index]!), width), cell, c), width, cell.align);
      })));
    }
    out.push(rule('╰', '┴', '╯'));
    dropped = table.columns.filter((_, index) => !keep.includes(index)).map((column) => column.label);
  }
  if (table.more) out.push(c('dim', `… and ${table.more.count} more — run ${ctx.rowsAllCommand}`));
  if (dropped.length) out.push(c('dim', `(columns not shown at this width: ${dropped.join(', ')})`));
  return out;
}

function keyValueRows(columns: readonly Column[], rendered: readonly RenderedCell[][], c: Paint): string[] {
  const width = Math.max(0, ...columns.map((column) => visibleWidth(column.label) + 1));
  const out: string[] = [];
  for (const [rowIndex, row] of rendered.entries()) {
    if (rowIndex > 0) out.push('');
    for (const [index, column] of columns.entries()) {
      const cell = row[index]!;
      out.push(`  ${padVisible(`${column.label}:`, width)} ${colour(clip(cell, column), cell, c)}`);
    }
  }
  return out;
}
