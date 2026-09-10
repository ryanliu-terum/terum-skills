/** True inside the Tauri shell. No @tauri-apps import: the one probe src/backend/index.ts (and mock/scenario.ts, to refuse scenarios natively) may call. */
export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
