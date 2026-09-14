import { describe, expect, it } from 'vitest';
import { bars, board, count, kv, path, status, strip, table, text, textBlock, verdict, type RenderContext } from '../board.js';
import { renderPretty } from '../pretty.js';
import { stripAnsi } from '../text.js';

const ctx: RenderContext = { format: 'pretty', host: 'terminal', rows: 25, width: 100, color: false, form: 'bare', home: '/home/u', now: Date.parse('2026-09-13T12:00:00Z'), argv: ['ls'], command: 'terum-skills ls --format pretty', rowsAllCommand: 'terum-skills ls --format pretty --rows all' };
const columns = [
  { key: 'skill', label: 'Skill', priority: 1 as const },
  { key: 'desc', label: 'Desc', priority: 2 as const, max: 20 },
  { key: 'author', label: 'Author', priority: 3 as const },
  { key: 'installs', label: 'Installs', priority: 1 as const, align: 'right' as const },
];
const rows = [
  { skill: text('deploy-check'), desc: text('A very long description that will be truncated'), author: text('Mira Chen'), installs: count(2) },
  { skill: text('tdd'), desc: text('Short.'), author: text('Seed'), installs: count(null) },
];

describe('pretty backend', () => {
  it('draws a box table with right-aligned numbers and truncated cells', () => {
    const out = renderPretty(board('Marketplace', { sections: [table(columns, rows, { title: 'Skills' })] }), ctx);
    expect(out).toBe([
      'Marketplace',
      '',
      'Skills',
      '╭──────────────┬──────────────────────┬───────────┬──────────╮',
      '│ Skill        │ Desc                 │ Author    │ Installs │',
      '├──────────────┼──────────────────────┼───────────┼──────────┤',
      '│ deploy-check │ A very long descrip… │ Mira Chen │        2 │',
      '│ tdd          │ Short.               │ Seed      │        — │',
      '╰──────────────┴──────────────────────┴───────────┴──────────╯',
    ].join('\n'));
  });
  it('drops priority-3 then priority-2 columns to fit the width, never priority 1, and says which', () => {
    // Desc capped at 40 makes the full table 82 columns wide: 70 drops Author (priority 3), 62 also drops Desc (priority 2); both stay box tables (≥ 60).
    const wide = columns.map((column) => (column.key === 'desc' ? { ...column, max: 40 } : column));
    const narrow = renderPretty(board('M', { sections: [table(wide, rows)] }), { ...ctx, width: 62 });
    expect(narrow).toContain('│ Skill        │ Installs │');
    expect(narrow).not.toContain('│ Author');
    expect(narrow).toContain('(columns not shown at this width: Desc, Author)');
    const mid = renderPretty(board('M', { sections: [table(wide, rows)] }), { ...ctx, width: 70 });
    expect(mid).toContain('│ Skill        │ Desc                                     │ Installs │');
    expect(mid).toContain('(columns not shown at this width: Author)');
  });
  it('degrades to a key/value list per row below 60 columns', () => {
    const out = renderPretty(board('M', { sections: [table(columns, rows)] }), { ...ctx, width: 40 });
    expect(out).toBe(['M', '', '  Skill:    deploy-check', '  Desc:     A very long descrip…', '  Author:   Mira Chen', '  Installs: 2', '', '  Skill:    tdd', '  Desc:     Short.', '  Author:   Seed', '  Installs: —'].join('\n'));
  });
  it('keeps the row-cap footer when a table degrades below 60 columns', () => {
    const out = renderPretty(board('M', { sections: [table(columns, rows, { cap: 1 })] }), { ...ctx, width: 59 });
    expect(out.split('\n').at(-1)).toBe('… and 1 more — run terum-skills ls --format pretty --rows all');
  });
  it('renders kv, text, bars, notes, next, failure and the more footer', () => {
    const out = renderPretty(board('T', {
      headline: 'h', resolved: ['Resolved: x from the working directory'],
      sections: [kv([['role', text('Platform')], ['path', path('/home/u/p')]], 'Identity'), textBlock(['# Body'], { fenced: 'md' }), bars([{ label: 'candidate', fraction: 0.5, value: '$1' }]), table(columns.slice(0, 1), [rows[0]!, rows[1]!], { cap: 1 })],
      notes: ['n1'], next: [{ label: 'Eval', skill: 'eval', verb: 'eval', args: ['tdd'] }], failure: { error: 'boom\nline 2', refused: true },
    }), ctx);
    expect(out).toBe([
      'T', 'Resolved: x from the working directory', 'h', '',
      'Identity', '  role: Platform', '  path: ~/p', '',
      '  # Body', '',
      '  candidate █████░░░░░ $1', '',
      '╭──────────────╮', '│ Skill        │', '├──────────────┤', '│ deploy-check │', '╰──────────────╯', '… and 1 more — run terum-skills ls --format pretty --rows all', '',
      '✗ boom (refused)', '  line 2', '',
      'Notes', '  • n1', '',
      'Next: terum-skills eval tdd',
    ].join('\n'));
  });
  it('colours tones, strips and commands only when ctx.color is on, and the visible text is identical', () => {
    const b = board('T', { sections: [table([{ key: 's', label: 'S', priority: 1 as const }, { key: 'v', label: 'V', priority: 1 as const }, { key: 'r', label: 'R', priority: 1 as const }], [{ s: status('ok', 'git'), v: verdict({ verdict: 'FAIL', lift: -50 }), r: strip('WLT') }])], next: [{ label: 'x', verb: 'sync', args: [] }] });
    const plain = renderPretty(b, ctx);
    const coloured = renderPretty(b, { ...ctx, color: true });
    expect(plain).not.toMatch(/\x1b/);
    expect(stripAnsi(coloured)).toBe(plain);
    expect(coloured).toContain('\x1b[32m✓ git\x1b[0m'); expect(coloured).toContain('\x1b[31m✗ FAIL −50%\x1b[0m');
    expect(coloured).toContain('\x1b[32mW\x1b[0m\x1b[31mL\x1b[0m\x1b[2mT\x1b[0m'); expect(coloured).toContain('\x1b[36mterum-skills sync\x1b[0m'); expect(coloured).toContain('\x1b[1mT\x1b[0m');
  });
  it('renders resolved lines dim outside italic, with the ANSI nesting order pinned', () => {
    expect(renderPretty(board('T', { resolved: ['Resolved: x from the working directory'] }), { ...ctx, color: true })).toBe(
      '\x1b[1mT\x1b[0m\n\x1b[2m\x1b[3mResolved: x from the working directory\x1b[0m\x1b[0m',
    );
  });
});
