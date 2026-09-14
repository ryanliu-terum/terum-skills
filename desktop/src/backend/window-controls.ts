/**
 * Where the OS draws its window controls over the web content when the chrome is `mac-overlay`, so the top bar and
 * the onboarding bar can leave exactly that much room before the mark (design canvas: an 8px gap after the lights).
 *
 * macOS 26 (Tahoe) redrew the controls: 14pt buttons at a 23pt pitch, where macOS 11–15 drew 12pt at 20pt. Measured
 * on 26.6.2 through `NSWindow.standardWindowButton` (2026-09-14). The design canvas and the cosmetic `TrafficLights`
 * still draw the older geometry; that parity is a separate ruling (FIDELITY.md, 2026-09-14).
 */

/** `trafficLightPosition.x` in `src-tauri/tauri.conf.json`: the close button's left edge. `.topbar-left` and `.onboarding-bar` pad by the same 16px, so the cosmetic lights land where the native ones do. */
export const WINDOW_CONTROLS_X = 16;

const GEOMETRY = { legacy: { button: 12, pitch: 20 }, tahoe: { button: 14, pitch: 23 } } as const;

/** Right edge, in CSS px from the window's left edge, of the three macOS controls on this release; the older geometry when the release is unknown, which is what the bar assumed before this existed. */
export function macWindowControlsEnd(version: string | null): number {
  const major = Number.parseInt(version ?? '', 10);
  const { button, pitch } = Number.isFinite(major) && major >= 26 ? GEOMETRY.tahoe : GEOMETRY.legacy;
  return WINDOW_CONTROLS_X + 2 * pitch + button;
}
