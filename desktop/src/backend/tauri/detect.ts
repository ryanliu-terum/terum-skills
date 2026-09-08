/** True inside the Tauri shell. No @tauri-apps import: this is the one probe src/backend/index.ts may call. */
export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
