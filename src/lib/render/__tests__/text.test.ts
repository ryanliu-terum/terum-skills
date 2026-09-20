import { describe, expect, it } from 'vitest';
import { padVisible, relativeDate, singleLine, stripAnsi, tildePath, truncate, visibleWidth } from '../text.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');

describe('render/text', () => {
  it('measures code points with ANSI stripped', () => {
    expect(visibleWidth('\x1b[32m✓ PASS\x1b[0m')).toBe(6);
    expect(visibleWidth('naïve')).toBe(5);
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold');
  });
  it('truncates to max code points with a trailing ellipsis and leaves a fitting string alone', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abcd', 4)).toBe('abcd');
    expect(truncate('abcdef', 1)).toBe('…');
    expect(truncate('ééééé', 3)).toBe('éé…');
  });
  it('pads by visible width on either side', () => {
    expect(padVisible('\x1b[31mab\x1b[0m', 4)).toBe('\x1b[31mab\x1b[0m  ');
    expect(padVisible('12', 4, 'right')).toBe('  12');
    expect(padVisible('toolong', 4)).toBe('toolong');
  });
  it('collapses newlines into one line', () => {
    expect(singleLine('a\nb\r\nc ')).toBe('a b c');
  });
  it('renders dates relative within 30 days and as ISO dates otherwise', () => {
    expect(relativeDate('2026-09-13T09:00:00Z', NOW)).toBe('today');
    expect(relativeDate('2026-09-11T12:00:00Z', NOW)).toBe('2d ago');
    expect(relativeDate('2026-08-14T12:00:00Z', NOW)).toBe('2026-08-14');
    expect(relativeDate('2026-09-20T12:00:00Z', NOW)).toBe('2026-09-20');
    expect(relativeDate(null, NOW)).toBe('—');
    expect(relativeDate('—', NOW)).toBe('—');
    expect(relativeDate('not a date', NOW)).toBe('—');
  });
  it('shortens paths under home to ~/ and leaves others alone', () => {
    expect(tildePath('/home/u/.claude/skills/x', '/home/u')).toBe('~/.claude/skills/x');
    expect(tildePath('/home/u', '/home/u/')).toBe('~');
    expect(tildePath('/opt/x', '/home/u')).toBe('/opt/x');
    expect(tildePath('/home/user2/x', '/home/u')).toBe('/home/user2/x');
  });
});
