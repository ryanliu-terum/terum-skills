import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { Providers } from './providers';
import { BackendContext } from '../backend';
import type { LaunchContext, Result, SetupResult } from '../backend/types';
import { createMockBackend } from '../backend/mock';
import { createRun } from '../backend/mock/run';
afterEach(()=>{cleanup();localStorage.clear();location.hash='';vi.restoreAllMocks();});
function harness(initial:LaunchContext|null=null){
 const backend=createMockBackend(),listeners=new Set<()=>void>();let current=initial;
 vi.spyOn(backend,'launchContext').mockImplementation(async()=>current);
 vi.spyOn(backend,'refreshLaunch').mockImplementation(async()=>current);
 vi.spyOn(backend,'onLaunchRequest').mockImplementation(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};});
 const setup=vi.spyOn(backend,'setup').mockImplementation(()=>createRun(async()=>({ok:true,value:{role:'joiner',team:'joined',steps:{}}})));
 function open(route='#/library/global'){location.hash=route;render(<StrictMode><Providers><BackendContext value={backend}><App/></BackendContext></Providers></StrictMode>);}
 async function reopen(ctx:LaunchContext){await act(async()=>{current=ctx;for(const listener of listeners)listener();});}
 return {backend,setup,open,reopen};
}
it('delivers a new target from Library once, deduplicates events, and ignores consumed requests',async()=>{
 const h=harness();h.open();await screen.findByText('15 skills');
 const ctx={writtenAt:'B',target:'org/team'};await h.reopen(ctx);
 await screen.findByRole('heading',{name:'Setup finished'});
 expect(location.hash).toBe('#/onboarding/boot');expect(h.setup).toHaveBeenCalledExactlyOnceWith({target:'org/team',offerConnect:true});
 await h.reopen(ctx);expect(h.setup).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Open the Library'}));await screen.findByText('15 skills');
 h.backend.prefs.set('launch:consumedWrittenAt','consumed');await h.reopen({writtenAt:'consumed',target:'other/team'});
 expect(location.hash).toBe('#/library/global');expect(h.setup).toHaveBeenCalledTimes(1);
});
it('holds B while A is active, then remounts Boot for B after A settles',async()=>{
 const h=harness({writtenAt:'A',target:'org/a'});let finish!: (result:Result<SetupResult>)=>void;
 h.setup.mockImplementationOnce(()=>createRun(()=>new Promise(resolve=>{finish=resolve;})));
 h.open('#/');await screen.findByRole('button',{name:'Stop'});await waitFor(()=>expect(h.setup).toHaveBeenCalledTimes(1));
 await h.reopen({writtenAt:'B',target:'org/b'});
 expect(h.setup).toHaveBeenCalledTimes(1);expect(screen.getByText('org/a')).toBeInTheDocument();
 expect(h.backend.prefs.get('launch:consumedWrittenAt','')).toBe('');
 await act(async()=>{finish({ok:false,error:'A failed.'});});
 await screen.findByRole('heading',{name:'Setup finished'});
 expect(h.setup.mock.calls).toEqual([[{target:'org/a',offerConnect:true}],[{target:'org/b',offerConnect:true}]]);
 expect(screen.getByText('org/b')).toBeInTheDocument();expect(h.backend.prefs.get('launch:consumedWrittenAt','')).toBe('B');
});
