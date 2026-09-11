import { z } from 'zod';
import type { PrefStore } from './types';
export const PREF_PREFIX = 'terum-skills-app:pref:';
export const UI_KEY = 'terum-skills-app:ui';
// The native record admits only chrome. The browser mock also simulates its existing action state.
// The eval defaults are app-owned chrome too: the CLI keeps no defaults of its own, so Settings ▸ Evals
// stores them here and the adapter passes them as flags on every eval run.
export function isChromePreference(key: string): boolean {
 return ['ui','appearance:start','appearance:counts','appearance:machine','inbox:badge','inbox:seen','launch:consumedWrittenAt','onboardingSkipped','eval:k','eval:model','eval:judge','eval:commit','updates:app:policy','updates:app:lastShown'].includes(key) || /^inbox:kind:(share|update|alert|eval|review|author|team)$/.test(key);
}
export type AppUpdatePolicy = 'ask' | 'on-close' | 'overnight';
export function appUpdatePolicy(value: unknown): AppUpdatePolicy {
 return value === 'ask' || value === 'overnight' ? value : 'on-close';
}
/** Existing policy wins; consume the boolean only once, even in an already-hydrated native file. */
export function migrateAppUpdatePolicy(record: Record<string, unknown>): Record<string, unknown> {
 const migrated = { ...record };
 if (!('updates:app:policy' in migrated) && !('updates:app:auto' in migrated)) return migrated;
 if (migrated['updates:app:policy'] === undefined) migrated['updates:app:policy'] = migrated['updates:app:auto'] === false ? 'ask' : 'on-close';
 else migrated['updates:app:policy'] = appUpdatePolicy(migrated['updates:app:policy']);
 delete migrated['updates:app:auto'];
 return migrated;
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
  if (!isChromePreference(name) && name !== 'updates:app:auto') continue;
  try { record[name] = JSON.parse(storage.getItem(key) ?? 'null'); } catch { /* Malformed entries use their drawn default. */ }
 }
 try { const ui = storage.getItem(UI_KEY); if (ui) record.ui = JSON.parse(ui); else { const theme = storage.getItem('terum-theme'); if (theme === 'dark' || theme === 'light') record.ui = { state: { theme }, version: 0 }; } } catch { /* Drawn defaults. */ }
 return migrateAppUpdatePolicy(record);
}
export function browserPrefs(): PrefStore {
 const listeners = new Set<() => void>();
 let unsavedPolicy: unknown;
 try {
  const key = 'updates:app:policy';
  const current = localStorage.getItem(PREF_PREFIX + key), legacy = localStorage.getItem(PREF_PREFIX + 'updates:app:auto');
  if (current !== null || legacy !== null) {
   const record: Record<string, unknown> = {};
   if (current !== null) { try { record[key] = JSON.parse(current); } catch { record[key] = 'on-close'; } }
   else { try { record['updates:app:auto'] = JSON.parse(legacy ?? 'null'); } catch { record['updates:app:auto'] = true; } }
   unsavedPolicy = migrateAppUpdatePolicy(record)[key];
   const encoded = JSON.stringify(unsavedPolicy);
   if (current !== encoded) localStorage.setItem(PREF_PREFIX + key, encoded);
   if (legacy !== null) localStorage.removeItem(PREF_PREFIX + 'updates:app:auto');
   unsavedPolicy = undefined;
  }
 } catch { /* Keep the hydrated choice in memory if storage cannot persist it. */ }

 return {
  get<T>(key: string, fallback: T): T {
   try {
    if (key === 'updates:app:policy' && unsavedPolicy !== undefined) return preferenceValue(unsavedPolicy, fallback);
    return preferenceValue(JSON.parse(localStorage.getItem(key === 'ui' ? UI_KEY : PREF_PREFIX + key) ?? 'null'), fallback); }
   catch { return fallback; }
  },
  set(key, value) {
   const json = jsonPreference(value);
   localStorage.setItem(key === 'ui' ? UI_KEY : PREF_PREFIX + key, JSON.stringify(json));
   if (key === 'updates:app:policy') unsavedPolicy = undefined;
   for (const notify of listeners) notify();
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
 };
}
