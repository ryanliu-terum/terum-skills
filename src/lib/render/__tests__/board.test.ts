import { describe, expect, it } from 'vitest';
import { bar, board, code, count, date, kv, path, status, strip, table, text, textBlock, verdict } from '../board.js';

describe('board model constructors are null-safe', () => {
  it('turns nothing into a dash and keeps values', () => {
    expect(text(null)).toEqual({ kind: 'text', text: '—' }); expect(text('')).toEqual({ kind: 'text', text: '—' }); expect(text(3)).toEqual({ kind: 'text', text: '3' });
    expect(count(undefined)).toEqual({ kind: 'count', n: null }); expect(count(Number.NaN)).toEqual({ kind: 'count', n: null }); expect(count(7)).toEqual({ kind: 'count', n: 7 });
    expect(date(42)).toEqual({ kind: 'date', iso: null }); expect(date('2026-01-01')).toEqual({ kind: 'date', iso: '2026-01-01' });
    expect(path(undefined)).toEqual({ kind: 'text', text: '—' }); expect(path('/x')).toEqual({ kind: 'path', path: '/x' });
    expect(code('')).toEqual({ kind: 'text', text: '—' }); expect(strip(null)).toEqual({ kind: 'text', text: '—' }); expect(strip('WL')).toEqual({ kind: 'strip', text: 'WL' });
    expect(bar(1.7, 'x')).toEqual({ kind: 'bar', fraction: 1, label: 'x' }); expect(bar(null, null)).toEqual({ kind: 'bar', fraction: null, label: '' });
    expect(status('ok', null)).toEqual({ kind: 'status', tone: 'ok', text: '—' });
    expect(verdict({ verdict: 'bogus' })).toEqual({ kind: 'verdict', verdict: null, lift: null, partial: null, stale: false, from: null, invalid: false });
    expect(verdict({ verdict: 'PASS', lift: 33, partial: [4, 6], stale: true, from: 'v2', invalid: false })).toEqual({ kind: 'verdict', verdict: 'PASS', lift: 33, partial: [4, 6], stale: true, from: 'v2', invalid: false });
  });
  it('builds a board with empty lists and a table with a capped row set', () => {
    expect(board('T')).toEqual({ title: 'T', resolved: [], sections: [], notes: [], next: [] });
    const rows = Array.from({ length: 4 }, (_, i) => ({ a: text(i) }));
    expect(table([{ key: 'a', label: 'A', priority: 1 }], rows, { cap: 3, title: 'Rows' })).toEqual({ kind: 'table', title: 'Rows', columns: [{ key: 'a', label: 'A', priority: 1 }], rows: rows.slice(0, 3), more: { count: 1 } });
    expect(table([{ key: 'a', label: 'A', priority: 1 }], rows)).toEqual({ kind: 'table', columns: [{ key: 'a', label: 'A', priority: 1 }], rows });
    expect(kv([['k', text('v')]], 'K')).toEqual({ kind: 'kv', title: 'K', rows: [['k', { kind: 'text', text: 'v' }]] });
    expect(textBlock(['a'], { fenced: 'md' })).toEqual({ kind: 'text', lines: ['a'], fenced: 'md' });
  });
});
