import { expect, it } from 'vitest';
import { chordLabel, revealLabel } from './platform-labels';

it('names the file browser by host', () => {
  expect(revealLabel('macos')).toBe('Show in Finder');
  expect(revealLabel('macOS 15.6 · Apple silicon')).toBe('Show in Finder');
  expect(revealLabel('windows')).toBe('Show in Explorer');
  expect(revealLabel('Windows 11 · ARM64')).toBe('Show in Explorer');
  expect(revealLabel('linux')).toBe('Show in file manager');
  expect(revealLabel('freebsd')).toBe('Show in file manager');
});
it('falls back to the drawn wording when the host is unknown', () => {
  expect(revealLabel(null)).toBe('Show in Finder');
  expect(revealLabel(undefined)).toBe('Show in Finder');
  expect(revealLabel('  ')).toBe('Show in Finder');
});
it('spells ⌘ chords with Ctrl on a native host only', () => {
  expect(chordLabel('native', '⌘K')).toBe('Ctrl+K');
  expect(chordLabel('native', '⌘,')).toBe('Ctrl+,');
  expect(chordLabel('native', '⌘[ · ⌘]')).toBe('Ctrl+[ · Ctrl+]');
  expect(chordLabel('mac-overlay', '⌘K')).toBe('⌘K');
  expect(chordLabel('cosmetic', '⌘R')).toBe('⌘R');
  expect(chordLabel(undefined, '⌘R')).toBe('⌘R');
});
it('leaves a chord without ⌘ alone', () => {
  expect(chordLabel('native', 'Esc')).toBe('Esc');
});
