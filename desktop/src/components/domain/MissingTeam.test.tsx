import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { Run, SyncResult, TeamResult } from '../../backend/types';

afterEach(()=>{cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});

/** A finished run with a fixed value: what the mock backend's sync would return had the CLI reported a missing team. */
function finished<T>(value:T):Run<T>{return {frames:(async function*(){})(),answer(){},cancel:async()=>undefined,done:Promise.resolve({ok:true as const,value})};}
const missing:SyncResult={notices:[],changed:false,teams:[{team:'terum-shared-skills',state:'unreachable',detail:'remote: Repository not found.',missing:true,summary:"terum-shared-skills's repository ryanliu-terum/terum-shared-skills no longer exists on GitHub. A replacement from the same owner is available: ryanliu-terum/shared-skills (you were invited to it on 2026-09-13).",successors:[{ownerRepo:'ryanliu-terum/shared-skills',source:'invitation',teamName:null,at:'2026-09-13T22:25:29Z'}]}]};

it('offers a moved team as one button in the Sync dialog, runs team move with --yes semantics, and syncs again',async()=>{
 const backend=createMockBackend();
 const results=[missing,{notices:[],changed:true,teams:[{team:'shared-skills',state:'refreshed'}]}];
 const sync=vi.spyOn(backend,'sync').mockImplementation(()=>finished(results.shift()??results[0]!));
 const moved:TeamResult={name:'shared-skills',kind:'move',restored:['decision-walk','handoff'],missing:['old-only'],failed:[]};
 const team=vi.spyOn(backend,'team').mockImplementation(()=>finished(moved));
 location.hash='#/settings/sync';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 fireEvent.click(await screen.findByRole('button',{name:'Sync now'}));
 const dialog=await screen.findByRole('dialog');
 await waitFor(()=>expect(sync).toHaveBeenCalledTimes(1));
 const group=await within(dialog).findByRole('group',{name:'terum-shared-skills repository not found'});
 expect(group).toHaveTextContent('no longer exists on GitHub');
 expect(group).toHaveTextContent('Invitation pending · 2026-09-13');
 // The raw git text is there for whoever wants it, folded away.
 expect(within(group).getByText('What git said')).toBeTruthy();
 fireEvent.click(within(group).getByRole('button',{name:'Move this machine to ryanliu-terum/shared-skills'}));
 await waitFor(()=>expect(team).toHaveBeenCalledWith({kind:'move',team:'terum-shared-skills',remote:'ryanliu-terum/shared-skills'}));
 await waitFor(()=>expect(sync).toHaveBeenCalledTimes(2));
 expect(await within(dialog).findByText('Moved to shared-skills: 2 skill(s) placed again, 1 not shared there (old-only).')).toBeTruthy();
 expect(within(dialog).queryByRole('group',{name:/repository not found/})).toBeNull();
});

it('shows why nothing could be looked up when a missing team has no replacement, without a button',async()=>{
 const backend=createMockBackend();
 vi.spyOn(backend,'sync').mockImplementation(()=>finished<SyncResult>({notices:[],changed:false,teams:[{team:'t',state:'unreachable',missing:true,summary:"t's repository o/r no longer exists on GitHub. gh is logged out.",lookup:'gh is logged out, so no replacement could be looked up on GitHub; run `gh auth login`, then sync again.',successors:[]}]}));
 location.hash='#/settings/sync';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 fireEvent.click(await screen.findByRole('button',{name:'Sync now'}));
 const group=await screen.findByRole('group',{name:'t repository not found'});
 expect(group).toHaveTextContent('gh is logged out, so no replacement could be looked up');
 expect(within(group).queryByRole('button')).toBeNull();
});
