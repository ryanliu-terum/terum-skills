import { afterEach, expect, it, vi } from 'vitest';
import { nativePrefs, type PreferenceFile } from '../prefs';
import { browserPrefs, PREF_PREFIX, UI_KEY } from '../../prefs';
afterEach(()=>localStorage.clear());
function disk(initial?:Record<string,unknown>){
 let saved=initial;
 const file:PreferenceFile={get:async<T>()=>structuredClone(saved) as T|undefined,set:vi.fn(async(_key,value)=>{saved=structuredClone(value) as Record<string,unknown>;}),save:vi.fn(async()=>{})};
 return {file,read:()=>saved};
}
it('round trips chrome keys through the native file and never persists team truth',async()=>{
 const d=disk({}),prefs=nativePrefs(async()=>d.file);await prefs.ready;
 prefs.set('inbox:badge',false);prefs.set('inbox:seen',['event-1']);prefs.set('appearance:counts',false);await prefs.flush?.();
 const next=nativePrefs(async()=>d.file);await next.ready;
 expect(next.get('inbox:badge',true)).toBe(false);expect(next.get('inbox:seen',[])).toEqual(['event-1']);expect(next.get('appearance:counts',true)).toBe(false);
 expect(()=>prefs.set('acted:event-1',true)).toThrow('CLI');expect(()=>prefs.set('identity:email','example@example.com')).toThrow('CLI');
 expect(d.read()).not.toHaveProperty('acted:event-1');
});
it('unreadable files use drawn defaults and report failed durability',async()=>{
 const prefs=nativePrefs(async()=>{throw new Error('unreadable');});await prefs.ready;
 expect(prefs.get('inbox:badge',true)).toBe(true);expect(prefs.get('inbox:seen',[])).toEqual([]);expect(prefs.get('appearance:start','Library ▸ Global')).toBe('Library ▸ Global');
 prefs.set('inbox:badge',false);await expect(prefs.flush?.()).rejects.toThrow('unreadable');
});
it('migrates existing chrome keys once without importing repo actions',async()=>{
 localStorage.setItem(UI_KEY,JSON.stringify({state:{theme:'light',railOpen:false},version:0}));
 localStorage.setItem(PREF_PREFIX+'inbox:kind:eval','false');localStorage.setItem(PREF_PREFIX+'inbox:seen','["one"]');localStorage.setItem(PREF_PREFIX+'acted:one','true');
 const d=disk(),prefs=nativePrefs(async()=>d.file);await prefs.ready;
 expect(prefs.get('ui',{})).toEqual({state:{theme:'light',railOpen:false},version:0});expect(prefs.get('inbox:kind:eval',true)).toBe(false);
 expect(d.read()).not.toHaveProperty('acted:one');
 localStorage.setItem(PREF_PREFIX+'inbox:kind:eval','true');const next=nativePrefs(async()=>d.file);await next.ready;expect(next.get('inbox:kind:eval',true)).toBe(false);
});
it('validates malformed stored values against drawn defaults',async()=>{
 const d=disk({'inbox:seen':'wrong','inbox:badge':17}),prefs=nativePrefs(async()=>d.file);await prefs.ready;
 expect(prefs.get('inbox:seen',[])).toEqual([]);expect(prefs.get('inbox:badge',true)).toBe(true);
});
it('uses the same browser chrome keys across sessions',()=>{
 const prefs=browserPrefs();prefs.set('appearance:machine',false);prefs.set('inbox:kind:review',false);
 const next=browserPrefs();expect(next.get('appearance:machine',true)).toBe(false);expect(next.get('inbox:kind:review',true)).toBe(false);
});
