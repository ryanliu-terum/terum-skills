import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { applyTheme, useUiStore } from './store';
import { Providers } from './providers';
import { pickBackend } from '../backend';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();document.documentElement.style.removeProperty('--tk-chrome');});
it('stamps dark synchronously',()=>{applyTheme('dark');expect(document.documentElement.dataset.theme).toBe('dark');});
it('stamps light synchronously',()=>{applyTheme('light');expect(document.documentElement.dataset.theme).toBe('light');});
it('uses the system preference and follows its live changes',async()=>{
 let change=()=>{};const media={matches:true,addEventListener:vi.fn((_type,listener:()=>void)=>{change=listener;}),removeEventListener:vi.fn()};vi.stubGlobal('matchMedia',()=>media);
 useUiStore.getState().setTheme('system');const view=render(createElement(Providers));
 expect(document.documentElement.dataset.theme).toBe('light');media.matches=false;change();expect(document.documentElement.dataset.theme).toBe('dark');view.unmount();expect(media.removeEventListener).toHaveBeenCalled();
});
it('sets the native background from the active chrome token through Backend',async()=>{
 const background=vi.spyOn(pickBackend(),'setWindowBackground');document.documentElement.style.setProperty('--tk-chrome','#0f1011');useUiStore.getState().setTheme('dark');render(createElement(Providers));
 await waitFor(()=>expect(background).toHaveBeenCalledWith('#0f1011'));
});
it('keeps the stamp usable when browser storage is unreadable',()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('denied');});applyTheme('light');expect(document.documentElement.dataset.theme).toBe('light');
});
