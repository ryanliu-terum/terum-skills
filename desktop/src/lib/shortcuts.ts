import type { Capabilities } from '../backend/types';
/** Keyboard shortcuts bound by the app shell. */
export const SHORTCUTS: [string, string][] = [['Search', '⌘K'], ['Settings', '⌘,'], ['Sync now', '⌘R'], ['Back · forward', '⌘[ · ⌘]']];
/**
 * Which modifier the shell's shortcuts answer to, read from the seam's `windowChrome` rather than from
 * any platform probe (AGENTS invariant 1). `mac-overlay` is macOS, where ⌘ is the only modifier and
 * Ctrl+K belongs to the text field. `native` is Linux/Windows, which have no ⌘ at all — Ctrl is the
 * modifier there, and accepting ⌘ too costs nothing because no key produces it. `cosmetic` is the
 * browser mock, which runs on every OS during dev and the gates, so it accepts both. An answer the seam
 * has not given yet (undefined, while `capabilities()` is in flight) keeps ⌘ alone: that is what the app
 * bound before this change, so a key pressed in the first frames behaves the way it always has.
 */
export function ctrlIsShortcutModifier(chrome: Capabilities['windowChrome'] | undefined): boolean {
  return chrome === 'native' || chrome === 'cosmetic';
}
/** The label for the search shortcut, on the top bar and in the search page's own field. `⌘K` is the mock's
 * and macOS's spelling; Windows and Linux spell a chord with `+` (`Ctrl+K`), so the chip reads the way those
 * platforms' own menus do. */
export function searchShortcutLabel(chrome: Capabilities['windowChrome'] | undefined): string {
  return chrome === 'native' ? 'Ctrl+K' : '⌘K';
}
