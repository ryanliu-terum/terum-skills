/** §4.1: GitHub-flavoured Markdown, no escape sequence, no HTML — what Claude Code and Codex render. */
import type { Board, Failure, RenderContext, Section, Table } from './board.js';
import { barText, nextCommand, renderCell, type RenderedCell } from './cells.js';
import { singleLine } from './text.js';

export function renderMd(board: Board, ctx: RenderContext): string {
  const out: string[] = [`## ${board.title}`];
  for (const line of board.resolved) out.push(`_${line}_`);
  if (board.headline !== undefined) out.push(`**${board.headline}**`);
  for (const section of board.sections) out.push('', ...renderSection(section, ctx));
  if (board.failure) {
    const [first, ...rest] = board.failure.error.split(/\r?\n/);
    out.push('', `> ❌ ${first ?? ''}${failureSuffix(board.failure)}`, ...rest.map((line) => `> ${line}`));
  }
  if (board.notes.length) out.push('', '**Notes**', ...board.notes.map((note) => `- ${note}`));
  if (board.next.length) out.push('', `**Next:** ${board.next.map((item) => `\`${nextCommand(item, ctx)}\``).join(' · ')}`);
  return out.join('\n');
}

export function failureSuffix(failure: Failure): string {
  return failure.refused ? ' (refused)' : failure.declined ? ' (declined)' : failure.partial ? ' (partial result above)' : '';
}

const escape = (text: string): string => singleLine(text).replaceAll('|', '\\|');
const inline = (cell: RenderedCell): string => (cell.mono ? `\`${escape(cell.text)}\`` : escape(cell.text));

/** A fence one backtick longer than any run inside the body, so a body that quotes a fence still renders. */
function fence(lines: readonly string[]): string {
  const longest = Math.max(2, ...lines.flatMap((line) => [...line.matchAll(/`+/g)].map((run) => run[0].length)));
  return '`'.repeat(longest + 1);
}

function renderSection(section: Section, ctx: RenderContext): string[] {
  const out: string[] = section.title === undefined ? [] : [`### ${section.title}`, ''];
  switch (section.kind) {
    case 'table': out.push(...renderTable(section, ctx)); break;
    case 'kv': for (const [label, cell] of section.rows) out.push(`- **${label}:** ${inline(renderCell(cell, ctx))}`); break;
    case 'text': {
      if (section.fenced === undefined) out.push(...section.lines);
      else { const mark = fence(section.lines); out.push(`${mark}${section.fenced === 'md' ? 'md' : ''}`, ...section.lines, mark); }
      break;
    }
    case 'bars': out.push('| Label | Bar |', '|---|---|', ...section.rows.map((row) => `| ${escape(row.label)} | ${barText(row.fraction, row.value)} |`)); break;
  }
  return out;
}

function renderTable(table: Table, ctx: RenderContext): string[] {
  if (table.rows.length === 0) return ['_none_'];
  const cells = table.rows.map((row) => table.columns.map((column) => renderCell(row[column.key] ?? { kind: 'text', text: '—' }, ctx)));
  const right = table.columns.map((column, index) => column.align === 'right' || cells.every((row) => row[index]!.align === 'right'));
  const out = [
    `| ${table.columns.map((column) => escape(column.label)).join(' | ')} |`,
    `|${right.map((isRight) => (isRight ? '---:' : '---')).join('|')}|`,
    ...cells.map((row) => `| ${row.map(inline).join(' | ')} |`),
  ];
  if (table.more) out.push('', `_… and ${table.more.count} more — run \`${ctx.rowsAllCommand}\`_`);
  return out;
}
