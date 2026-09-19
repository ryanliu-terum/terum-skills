import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../../backend';
import { createMockBackend } from '../../../backend/mock';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { renderShareCard } from '../../../components/domain/skill-share/render';

vi.mock('../../../components/domain/skill-share/render',()=>({renderShareCard:vi.fn()}));
const png=new Blob(['test'],{type:'image/png'});
beforeEach(()=>{
 localStorage.clear();useUiStore.setState({railOpen:true});
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=>'blob:preview'),revokeObjectURL:vi.fn()}));
 vi.mocked(renderShareCard).mockResolvedValue(png);
});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllGlobals();});

async function open(local:boolean,railClosed:boolean){
 const backend=createMockBackend(),detail=await backend.skill({ref:'deploy-check'});
 if(!detail.ok)throw new Error(detail.error);
 const path='/projects/selected/.claude/skills/deploy-check';
 const selected={...detail.value,teamed:!local,path,skillRef:local?'local:'+path:'selected-team/deploy-check',desc:'Description from the selected source'};
 const read=vi.spyOn(backend,'skill').mockResolvedValue({ok:true,value:selected});
 const localRead=vi.spyOn(backend,'localSkill').mockResolvedValue({ok:true,value:selected});
 location.hash='#/skill/'+(local?'local?path='+encodeURIComponent(path):'selected-team%2Fdeploy-check?root='+encodeURIComponent('/projects/selected'))+(railClosed?'&rail=closed':'');
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 const trigger=await screen.findByRole('button',{name:'Share deploy-check'});
 return {backend,read,localRead,path,trigger};
}

it.each([[false,false],[false,true],[true,false],[true,true]])('shares the selected source (local=%s, rail closed=%s) from an icon-only detail action',async(local,railClosed)=>{
 const {backend,read,localRead,path,trigger}=await open(local,railClosed);
 const save=vi.spyOn(backend,'saveImage').mockResolvedValue({ok:true,value:undefined});
 expect(trigger.textContent).toBe('');expect(trigger).toHaveAttribute('title','Share benchmark image');
 expect(trigger.closest('.detail-actions')).not.toBeNull();
 read.mockClear();localRead.mockClear();fireEvent.click(trigger);
 await screen.findByAltText('Benchmark image for deploy-check');
 if(local){expect(localRead).toHaveBeenCalledWith({path},{signal:expect.any(AbortSignal)});expect(read).not.toHaveBeenCalled();}
 else {expect(read).toHaveBeenCalledWith({ref:'selected-team/deploy-check',at:{kind:'checkout',root:'/projects/selected'}},{signal:expect.any(AbortSignal)});expect(localRead).not.toHaveBeenCalled();}
 expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({description:'Description from the selected source'}),{format:'light'});
 fireEvent.click(screen.getByRole('button',{name:'Save PNG'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(png,'deploy-check-benchmark.png'));
});

it('shows a source read failure, blocks export, and retries without leaving the detail page',async()=>{
 const {backend,localRead,trigger}=await open(true,false),save=vi.spyOn(backend,'saveImage');
 localRead.mockResolvedValueOnce({ok:false,error:'This folder could not be read'});
 fireEvent.click(trigger);
 expect(await screen.findByText('This folder could not be read')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Save PNG'})).toBeNull();expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));
 await screen.findByAltText('Benchmark image for deploy-check');
 expect(location.hash).toContain('/skill/local?path=');
});
