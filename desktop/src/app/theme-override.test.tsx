import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Providers } from './providers';
import { App } from './App';
import { useUiStore } from './store';
import { pickBackend } from '../backend';

afterEach(()=>{cleanup();location.hash='';localStorage.clear();useUiStore.getState().setTheme('dark');});
it('renders a light URL without persisting it and restores the stored theme when removed',async()=>{
 useUiStore.getState().setTheme('dark');location.hash='#/library/global?theme=light';
 render(<Providers><App/></Providers>);
 await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('light'));
 expect(useUiStore.getState().theme).toBe('dark');
 expect(pickBackend().prefs.get('ui',{})).toMatchObject({state:{theme:'dark'}});
 expect(localStorage.getItem('terum-theme')).toBe('dark');
 fireEvent.click(await screen.findByRole('link',{name:/^Global/}));
 await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('dark'));
 expect(pickBackend().prefs.get('ui',{})).toMatchObject({state:{theme:'dark'}});
});
it('ignores invalid URL themes',async()=>{
 useUiStore.getState().setTheme('light');location.hash='#/library/global?theme=invalid';render(<Providers><App/></Providers>);
 await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('light'));
 expect(pickBackend().prefs.get('ui',{})).toMatchObject({state:{theme:'light'}});
});

it('keeps the URL theme active across stored preference changes',async()=>{
 useUiStore.getState().setTheme('light');location.hash='#/library/global?theme=light';render(<Providers><App/></Providers>);
 await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('light'));
 await act(async()=>{useUiStore.getState().setTheme('dark');});
 expect(document.documentElement.dataset.theme).toBe('light');expect(pickBackend().prefs.get('ui',{})).toMatchObject({state:{theme:'dark'}});
 fireEvent.click(await screen.findByRole('link',{name:/^Global/}));
 await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('dark'));
});
