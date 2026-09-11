import { afterEach, expect, it, vi } from 'vitest';
import { nativePrefs, type PreferenceFile } from '../prefs';
import { browserPrefs, PREF_PREFIX } from '../../prefs';
afterEach(() => { localStorage.clear(); });
function disk(initial?: Record<string, unknown>) {
 let saved = initial;
 const file: PreferenceFile = { get: async <T>() => structuredClone(saved) as T | undefined, set: vi.fn(async (_key, value) => { saved = structuredClone(value) as Record<string, unknown>; }), save: vi.fn(async () => {}) };
 return { file, read: () => saved };
}
it.each([['native', false, 'ask'], ['native', true, 'on-close'], ['browser', false, 'ask'], ['browser', true, 'on-close']] as const)('%s migrates auto=%s once to %s', async (kind, auto, policy) => {
 const d = disk({ 'updates:app:auto': auto }); localStorage.setItem(PREF_PREFIX + 'updates:app:auto', JSON.stringify(auto));
 const prefs = kind === 'native' ? nativePrefs(async () => d.file) : browserPrefs(); await prefs.ready;
 expect(prefs.get('updates:app:policy', 'on-close')).toBe(policy);
 prefs.set('updates:app:policy', 'overnight'); await prefs.flush?.();
 localStorage.setItem(PREF_PREFIX + 'updates:app:auto', 'false');
 const next = kind === 'native' ? nativePrefs(async () => d.file) : browserPrefs(); await next.ready;
 expect(next.get('updates:app:policy', 'on-close')).toBe('overnight');
 if (kind === 'native') expect(d.read()).not.toHaveProperty('updates:app:auto');
});
it('imports a browser opt-out into the native file and preserves an explicit policy', async () => {
 localStorage.setItem(PREF_PREFIX + 'updates:app:auto', 'false');
 const d = disk(), prefs = nativePrefs(async () => d.file); await prefs.ready; expect(prefs.get('updates:app:policy', 'on-close')).toBe('ask');
 const existing = disk({ 'updates:app:auto': false, 'updates:app:policy': 'overnight' }); const next = nativePrefs(async () => existing.file); await next.ready; expect(next.get('updates:app:policy', 'on-close')).toBe('overnight');
});
it.each([undefined, 'wrong', 7, null])('defaults malformed or missing policy %s to on-close', async value => {
 const d = disk({ 'updates:app:policy': value }), prefs = nativePrefs(async () => d.file); await prefs.ready;
 expect(prefs.get('updates:app:policy', 'on-close')).toBe('on-close');
});
it('reports failed migration persistence', async () => {
 const d = disk({ 'updates:app:auto': false }); d.file.save = async () => { throw new Error('disk full'); };
 const prefs = nativePrefs(async () => d.file); await prefs.ready; expect(prefs.get('updates:app:policy', 'on-close')).toBe('ask'); await expect(prefs.flush?.()).rejects.toThrow('disk full');
});

it('browser migration parses JSON once and subsequent reads do not write',()=>{
 localStorage.setItem(PREF_PREFIX+'updates:app:auto',' false ');const set=vi.spyOn(Storage.prototype,'setItem');
 try {const prefs=browserPrefs();expect(prefs.get('updates:app:policy','on-close')).toBe('ask');expect(prefs.get('updates:app:policy','on-close')).toBe('ask');expect(set).toHaveBeenCalledOnce();}
 finally {set.mockRestore();}
});

it('browser migration keeps an opt-out when storage is read-only',()=>{
 localStorage.setItem(PREF_PREFIX+'updates:app:auto','false');const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('read only');});
 try {expect(browserPrefs().get('updates:app:policy','on-close')).toBe('ask');expect(localStorage.getItem(PREF_PREFIX+'updates:app:auto')).toBe('false');}
 finally {set.mockRestore();}
});

it('browser hydration does not persist an unchosen default or write during reads',()=>{
 const set=vi.spyOn(Storage.prototype,'setItem');try{const prefs=browserPrefs();for(let i=0;i<3;i++)expect(prefs.get('updates:app:policy','on-close')).toBe('on-close');expect(set).not.toHaveBeenCalled();}finally{set.mockRestore();}
});
it('browser migration is completed at construction before any snapshot is read',()=>{
 localStorage.setItem(PREF_PREFIX+'updates:app:auto','false');const prefs=browserPrefs();
 expect(localStorage.getItem(PREF_PREFIX+'updates:app:policy')).toBe('"ask"');expect(localStorage.getItem(PREF_PREFIX+'updates:app:auto')).toBeNull();
 const set=vi.spyOn(Storage.prototype,'setItem');try{expect(prefs.get('updates:app:policy','on-close')).toBe('ask');expect(set).not.toHaveBeenCalled();}finally{set.mockRestore();}
});
