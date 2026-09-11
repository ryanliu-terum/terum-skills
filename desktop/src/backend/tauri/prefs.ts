import { appConfigDir, join } from '@tauri-apps/api/path';
import { load } from '@tauri-apps/plugin-store';
import type { PrefStore } from '../types';
import { isChromePreference, jsonPreference, legacyPreferences, migrateAppUpdatePolicy, preferenceValue } from '../prefs';
export interface PreferenceFile { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void>; save(): Promise<void> }
async function openPreferences(): Promise<PreferenceFile> {
 return load(await join(await appConfigDir(), 'preferences.json'), { autoSave: false, defaults: {} });
}
/** Synchronous PrefStore reads a hydrated cache; writes serialize to the app config store. */
export function nativePrefs(open: () => Promise<PreferenceFile> = openPreferences, legacy: () => Storage = () => localStorage): PrefStore {
 let values: Record<string, unknown> = {}, file: PreferenceFile | null = null, failure: unknown = null;
 const dirty = new Set<string>(), listeners = new Set<() => void>();
 const notify = () => { for (const listener of listeners) listener(); };
 const ready = (async () => {
  try {
   file = await open();
   const saved = await file.get<Record<string, unknown>>('preferences');
   if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved))) throw new Error('Unreadable preferences record.');
   let loaded = saved ?? {};
   if (saved === undefined) {
    try { loaded = legacyPreferences(legacy()); } catch { /* Unavailable legacy storage uses drawn defaults. */ }
   }
   const migrated = migrateAppUpdatePolicy(loaded);
   // Preserve an existing opt-out in memory even when its migration cannot be saved.
   values = { ...Object.fromEntries(Object.entries(migrated).filter(([key]) => isChromePreference(key))), ...Object.fromEntries([...dirty].map(key => [key, values[key]])) };
   if (saved === undefined || JSON.stringify(migrated) !== JSON.stringify(loaded)) { await file.set('preferences', values); await file.save(); }
  } catch (error) { failure = error; file = null; }
  notify();
 })();
 let pending = ready;
 return {
  ready,
  get: (key, fallback) => preferenceValue(values[key], fallback),
  set(key, value) {
   if (!isChromePreference(key)) throw new Error('This setting is owned by the CLI, not app preferences.');
   values[key] = jsonPreference(value); dirty.add(key); notify();
   const snapshot = structuredClone(values);
   pending = pending.then(async () => {
    if (!file) throw failure ?? new Error('Preferences could not be saved.');
    // Include hydrated keys when a write raced the initial read.
    await file.set('preferences', { ...values, ...snapshot }); await file.save();
   });
   void pending.catch(error => { failure = error; });
  },
  async flush() { await pending; if (failure) throw failure; },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
 };
}
