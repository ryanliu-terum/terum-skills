import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { Providers } from './providers';
import { BackendContext } from '../backend';
import { createMockBackend } from '../backend/mock';
function files(path:string):string[]{return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(path,entry.name)):[join(path,entry.name)]);}
afterEach(()=>{cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});
it('has no interval or timer-driven query refetch in production source',()=>{
 for(const path of files('src').filter(path=>/\.tsx?$/.test(path)&&!path.includes('.test.'))){
  const code=readFileSync(path,'utf8');expect(code,path).not.toMatch(/setInterval|refetchInterval/);
  expect(code,path).not.toMatch(/setTimeout[\s\S]{0,200}(?:refetch|invalidateQueries)/);
 }
});
it.each(['#/marketplace?__mock=error','#/share?__mock=error','#/settings/sync'])('sync on %s starts only from an explicit action and renders the workflow popup',async route=>{
 const backend=createMockBackend(),sync=vi.spyOn(backend,'sync');location.hash=route;render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 const button=await screen.findByRole('button',{name:'Sync now'});fireEvent(window,new Event('focus'));expect(sync).not.toHaveBeenCalled();
 fireEvent.click(button);expect(await screen.findByRole('dialog')).toHaveTextContent('Sync now');
 await waitFor(()=>expect(sync).toHaveBeenCalledTimes(1));expect(sync).toHaveBeenCalledWith({});
});
it('uses only the drawn shortcuts and never syncs from focus',async()=>{
 const backend=createMockBackend(),sync=vi.spyOn(backend,'sync');location.hash='#/library/global';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 await screen.findByRole('navigation');fireEvent.keyDown(document.body,{key:'k',metaKey:true});await waitFor(()=>expect(location.hash).toBe('#/search'));
 fireEvent.keyDown(document.body,{key:',',metaKey:true});await waitFor(()=>expect(location.hash).toBe('#/settings/account'));
 fireEvent.keyDown(document.body,{key:'r',metaKey:true});expect(await screen.findByRole('dialog')).toHaveTextContent('Sync now');await waitFor(()=>expect(sync).toHaveBeenCalledTimes(1));
});
