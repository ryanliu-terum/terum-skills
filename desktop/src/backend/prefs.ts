import { z } from 'zod';
import type { PrefStore } from './types';
export const PREF_PREFIX = 'terum-skills-app:pref:';
export const UI_KEY = 'terum-skills-app:ui';
// The native record admits only chrome. The browser mock also simulates its existing action state.
export function isChromePreference(key: string): boolean {
 return ['ui','appearance:start','appearance:counts','appearance:machine','inbox:badge','inbox:seen','launch:consumedWrittenAt','onboardingSkipped'].includes(key) || /^inbox:kind:(share|update|alert|eval|review|author|team)$/.test(key);
}
export function preferenceValue<T>(value: unknown, fallback: T): T {
 return value !== undefined && (value === null) === (fallback === null) && typeof value === typeof fallback && Array.isArray(value) === Array.isArray(fallback) ? structuredClone(value) as T : fallback;
}
export function jsonPreference(value: unknown): unknown { return z.json().parse(value); }
export function legacyPreferences(storage: Storage): Record<string, unknown> {
 const record: Record<string, unknown> = {};
 for (let i = 0; i < storage.length; i++) {
  const key = storage.key(i);
  if (!key?.startsWith(PREF_PREFIX)) continue;
  const name = key.slice(PREF_PREFIX.length);
  if (!isChromePreference(name)) continue;
  try { record[name] = JSON.parse(storage.getItem(key) ?? 'null'); } catch { /* Malformed entries use their drawn default. */ }
 }
 try { const ui = storage.getItem(UI_KEY); if (ui) record.ui = JSON.parse(ui); else { const theme = storage.getItem('terum-theme'); if (theme === 'dark' || theme === 'light') record.ui = { state: { theme }, version: 0 }; } } catch { /* Drawn defaults. */ }
 return record;
}
export function browserPrefs(): PrefStore {
 const listeners = new Set<() => void>();
 return {
  get<T>(key: string, fallback: T): T {
   try { return preferenceValue(JSON.parse(localStorage.getItem(key === 'ui' ? UI_KEY : PREF_PREFIX + key) ?? 'null'), fallback); }
   catch { return fallback; }
  },
  set(key, value) {
   const json = jsonPreference(value);
   localStorage.setItem(key === 'ui' ? UI_KEY : PREF_PREFIX + key, JSON.stringify(json));
   for (const notify of listeners) notify();
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
 };
}
