import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BackendContext } from '../backend';
import { createMockBackend } from '../backend/mock';
import { createRun } from '../backend/mock/run';
import type { AppUpdateStatus, Result } from '../backend/types';
import { useAppUpdateCheck } from './useAppUpdateCheck';

const status:AppUpdateStatus={appVersion:'0.1.10',supported:true,cliVersion:'0.1.10',latest:'0.1.12',latestAt:null,probe:'cached',probeError:null,staged:null,installed:[],lastApply:null,newer:true,ppid:42};
const clients:QueryClient[]=[];
afterEach(()=>{cleanup();for(const client of clients)client.clear();clients.length=0;localStorage.clear();vi.restoreAllMocks();});
function Probe(){useAppUpdateCheck();return <span>App remains usable</span>;}
async function setup(patch:Partial<AppUpdateStatus>={}){
 const backend=createMockBackend();vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),appUpdate:true});vi.spyOn(backend,'features').mockResolvedValue({...await backend.features(),appUpdate:true});
 const check=vi.spyOn(backend.appUpdate,'check').mockResolvedValue({ok:true,value:{...status,...patch}}),stage=vi.spyOn(backend.appUpdate,'stage').mockImplementation(version=>createRun(async()=>({ok:true,value:{version,staged:true,notPublished:false,alreadyStaged:false}})));
 const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:true}}});clients.push(client);
 const open=()=>render(<StrictMode><QueryClientProvider client={client}><BackendContext value={backend}><Probe/></BackendContext></QueryClientProvider></StrictMode>);
 return {backend,client,check,stage,open};
}
it('checks once on mount and never again on focus',async()=>{
 const h=await setup();h.open();await waitFor(()=>expect(h.stage).toHaveBeenCalledTimes(1));
 for(let i=0;i<3;i++)fireEvent(window,new Event('focus'));await act(async()=>{});expect(h.check).toHaveBeenCalledTimes(1);
});
it.each(['surface','feature'] as const)('never checks when the %s is off',async mode=>{
 const h=await setup();if(mode==='surface')vi.mocked(h.backend.surfaces).mockResolvedValue({...await h.backend.surfaces(),appUpdate:false});else vi.mocked(h.backend.features).mockResolvedValue({...await h.backend.features(),appUpdate:false});
 h.open();await act(async()=>{});expect(h.check).not.toHaveBeenCalled();expect(h.stage).not.toHaveBeenCalled();
});
it('auto-stages the advertised version under the default on-close policy',async()=>{
 const h=await setup();h.open();await waitFor(()=>expect(h.stage).toHaveBeenCalledExactlyOnceWith('0.1.12'));await waitFor(()=>expect(h.client.getQueryData(['app-update'])).toMatchObject({ok:true,value:{staged:'0.1.12'}}));
});
it.each(['ask-policy','not-newer','already-staged'] as const)('does not stage for %s',async mode=>{
 const h=await setup(mode==='not-newer'?{newer:false}:mode==='already-staged'?{staged:'0.1.12'}:{});if(mode==='ask-policy')h.backend.prefs.set('updates:app:policy','ask');
 h.open();await waitFor(()=>expect(h.check).toHaveBeenCalledOnce());await act(async()=>{});expect(h.stage).not.toHaveBeenCalled();
});
it.each(['check','stage'] as const)('swallows a failing %s',async mode=>{
 const h=await setup();if(mode==='check')h.check.mockRejectedValue(new Error('offline'));else h.stage.mockImplementation(()=>({...createRun(async()=>({ok:false as const,error:'disk full'})),done:Promise.reject(new Error('disk full'))}));
 h.open();await waitFor(()=>expect(mode==='check'?h.check:h.stage).toHaveBeenCalled());await act(async()=>{});expect(screen.getByText('App remains usable')).toBeInTheDocument();
});
it('does nothing after unmount',async()=>{
 const h=await setup();let resolve!:(result:Result<AppUpdateStatus>)=>void;h.check.mockReturnValue(new Promise(done=>{resolve=done;}));
 const view=h.open();await waitFor(()=>expect(h.check).toHaveBeenCalledOnce());view.unmount();await act(async()=>{resolve({ok:true,value:status});});expect(h.stage).not.toHaveBeenCalled();
});
it('keeps not-yet-published releases unstaged and never applies automatically',async()=>{
 const h=await setup(),apply=vi.spyOn(h.backend.appUpdate,'apply');h.stage.mockImplementation(version=>createRun(async()=>({ok:true,value:{version,staged:false,notPublished:true,alreadyStaged:false}})));
 h.open();await waitFor(()=>expect(h.stage).toHaveBeenCalledOnce());await act(async()=>{});expect(h.client.getQueryData(['app-update'])).toMatchObject({ok:true,value:{staged:null}});expect(apply).not.toHaveBeenCalled();expect(h.client.getQueryData(['app-update-policy-outcome'])).toBeUndefined();fireEvent(window,new Event('focus'));await act(async()=>{});expect(h.stage).toHaveBeenCalledOnce();
});
