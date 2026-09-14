import type { Capabilities } from '../backend/types';

/**
 * The verb for "open this path in the OS file browser", by the host the seam reported. The design canvas
 * prints "Show in Finder" (macOS is the drawn platform) and the mock's `machine.os` is a macOS string, so the
 * boards keep their wording; Windows and Linux hosts get their own file browser's name instead of Apple's.
 * `os` is `StatusResult.machine.os`: the real adapter passes Rust's `std::env::consts::OS` ("windows",
 * "macos", "linux", …); the mock passes the design's display string ("macOS 15.6 · Apple silicon").
 */
export function revealLabel(os: string | null | undefined): string {
  const value = (os ?? '').trim().toLowerCase();
  if (value.startsWith('win')) return 'Show in Explorer';
  if (value.startsWith('mac') || value.startsWith('darwin') || value.startsWith('ios')) return 'Show in Finder';
  if (value === '') return 'Show in Finder';
  return 'Show in file manager';
}

/**
 * A drawn chord such as `⌘K` or `⌘[ · ⌘]` spelled for the host: macOS (and the browser mock, which draws the
 * boards) keep the ⌘ glyph; a `native` host has no ⌘ key, so the chord reads the way its own menus do
 * (`Ctrl+K`). Modifier order and the middle-dot separator survive untouched.
 */
export function chordLabel(chrome: Capabilities['windowChrome'] | undefined, chord: string): string {
  if (chrome !== 'native') return chord;
  return chord.replace(/⌘(\S)/g, 'Ctrl+$1');
}
