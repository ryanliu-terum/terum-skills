import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { pickBackend } from '../../backend';
import { createRun } from '../../backend/mock/run';
beforeEach(()=>{localStorage.clear();useUiStore.setState({railOpen:true,overviewHidden:false,theme:'dark'});});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});
it('shows on-disk presence on cards without Install, Remove or a switch',async()=>{
 location.hash='#/library/global?__mock=on-disk-only';render(<Providers><App/></Providers>);
 const card=await screen.findByTestId('skill-card-deploy-check');
 expect(within(card).getByText('Installed · on this machine')).toBeInTheDocument();
 expect(within(card).queryByRole('button',{name:'Install'})).toBeNull();expect(within(card).queryByRole('switch')).toBeNull();
 fireEvent.click(within(card).getByRole('button',{name:'More actions for deploy-check'}));
 expect(screen.queryByRole('menuitem',{name:'Remove'})).toBeNull();
});
it.each([true,false])('manages a present copy using its exact path and closes after consent=%s',async accepted=>{
 const backend=pickBackend();
 const connect=vi.spyOn(backend,'connect').mockImplementation(()=>createRun(async ctx=>{
  const yes=await ctx.ask('confirm','Record this connected source?');
  return yes?{ok:true,value:{id:'id',name:'deploy-check',adopted:true}}:{ok:false,error:'Connect was declined.',cancelled:true};
 }));
 location.hash='#/skill/deploy-check?__mock=on-disk-only';render(<Providers><App/></Providers>);
 expect(await screen.findByText('Installed · on this machine')).toBeInTheDocument();
 expect(screen.getByText(/This copy is yours, not placed by Terum. Connected: no/)).toHaveTextContent('~/.claude/skills/deploy-check');
 expect(screen.queryByRole('button',{name:'Remove from Global'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Manage with Terum…'}));
 const dialog=await screen.findByRole('dialog');expect(dialog).toHaveTextContent('nothing is edited or pushed');
 fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));
 const consent=await screen.findByRole('dialog',{name:'Record this connected source?'});
 fireEvent.click(within(consent).getByRole('button',{name:accepted?'Yes':'No'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(connect).toHaveBeenCalledWith({path:'~/.claude/skills/deploy-check'});
 expect(screen.queryByRole('alert')).toBeNull();
});
