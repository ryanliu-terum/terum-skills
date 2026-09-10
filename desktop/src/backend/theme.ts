import type { Theme } from './types';
export function applyTheme(theme: Theme, cache = true): 'dark' | 'light' {
 const resolved = theme === 'system' ? (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
 document.documentElement.dataset.theme = resolved;
 // A pre-paint cache only; the preference itself is in PrefStore.
 try { if (cache) localStorage.setItem('terum-theme', resolved); } catch { /* Theme remains usable without browser storage. */ }
 return resolved;
}
