import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { PublishRunProvider } from '../../app/PublishRunProvider';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { Backend } from '../../backend/Backend';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
beforeEach(()=>{localStorage.clear();useUiStore.setState({railOpen:true,overviewHidden:false,theme:'dark'});});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});
it('shows on-disk presence on cards without Install or Remove, and keeps the switch',async()=>{
 location.hash='#/library/global?__mock=on-disk-only';render(<Providers><App/></Providers>);
 const card=await screen.findByTestId('skill-card-deploy-check');
 // Cross-mirror overlays spec §5 M1.5 (ledger D5): the chip's words are gone from every card; a Library card carries
 // the version line instead and never the Marketplace's installed check.
 expect(within(card).queryByText('Installed · on this machine')).toBeNull();
 expect(within(card).queryByRole('img',{name:'Installed on this machine'})).toBeNull();
 expect(within(card).queryByRole('button',{name:'Install'})).toBeNull();
 // The switch is Claude Code's skillOverrides, which governs any folder under a skills root — whoever put it there.
 expect(within(card).getByRole('switch',{name:'Enable deploy-check'})).toHaveAttribute('aria-checked','true');
 fireEvent.click(within(card).getByRole('button',{name:'More actions for deploy-check'}));
 expect(screen.queryByRole('menuitem',{name:'Remove'})).toBeNull();
});
function openWith(route:string,backend:Backend){location.hash=route;return render(<Providers><BackendContext value={backend}><PublishRunProvider><App/></PublishRunProvider></BackendContext></Providers>);}
async function onDiskOnlyDetail(enabled:boolean){
 const backend=createMockBackend();const detail=await backend.skill({ref:'deploy-check'});if(!detail.ok)throw new Error(detail.error);
 vi.spyOn(backend,'skill').mockResolvedValue({...detail,value:{...detail.value,teamed:false,installed:'placed' as const,placed:false,onDiskOnly:true,path:'~/.claude/skills/deploy-check',pathLabel:'~/.claude/skills/deploy-check',enabled}});
 return backend;
}
it('draws the switch in the rail of an on-disk-only skill and reads it as loaded',async()=>{
 openWith('#/skill/deploy-check',await onDiskOnlyDetail(true));
 expect(await screen.findByRole('switch',{name:'Enable skill'})).toHaveAttribute('aria-checked','true');
 expect(screen.getByText('Installed · on this machine')).toBeInTheDocument();
});
it('reads an on-disk-only skill that is switched off as Disabled, not loaded',async()=>{
 openWith('#/skill/deploy-check',await onDiskOnlyDetail(false));
 expect(await screen.findByRole('switch',{name:'Enable skill'})).toHaveAttribute('aria-checked','false');
 expect(screen.getByText('Disabled')).toBeInTheDocument();
 expect(screen.getByText(/^Not loaded · This copy is yours, not placed by Terum · /)).toBeInTheDocument();
 expect(screen.queryByText('Installed · on this machine')).toBeNull();
});
