import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../../backend';
import { createMockBackend } from '../../../backend/mock';
import { App } from '../../../app/App';

afterEach(() => { cleanup(); location.hash=''; localStorage.clear(); vi.restoreAllMocks(); });

// A folder that is on this machine but was never placed by Terum: the one state whose rail carries
// "Manage with Terum…". It used to be a button wired to a single publish confirm, so Move, Rename,
// Delete and Run eval were reachable only by walking back to the library card (Ryan, 2026-09-14).
const PATH='~/.claude/skills/deploy-check';
async function open(search=''){
 const backend=createMockBackend();
 const detail=await backend.localSkill({path:PATH});
 if(!detail.ok)throw new Error(detail.error);
 vi.spyOn(backend,'localSkill').mockResolvedValue({ok:true,value:{...detail.value,installed:'placed',placed:false,onDiskOnly:true,unidentifiedLocal:null,flags:[],path:PATH}});
 location.hash='#/skill/local?path='+encodeURIComponent(PATH)+search;
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 return backend;
}

it('opens the card’s full action menu from the rail, minus the Open that leads back here',async()=>{
 await open();
 fireEvent.click(await screen.findByRole('button',{name:'Manage with Terum…'}));
 const rows=await screen.findAllByRole('menuitem');
 expect(rows.map(row=>row.textContent)).toEqual(['Run eval','Move to…','Rename…','Delete…','Publish to team…']);
 expect(screen.queryByRole('menuitem',{name:'Open'})).toBeNull();
});

it('merges a row’s dialog onto the params the page already carries',async()=>{
 await open('&tab=quality');
 fireEvent.click(await screen.findByRole('button',{name:'Manage with Terum…'}));
 fireEvent.click(await screen.findByRole('menuitem',{name:'Move to…'}));
 // Compared as params, not as a string: re-serializing normalises the escaping of `~` in the path.
 await waitFor(()=>expect(location.hash.split('?')[0]).toBe('#/skill/local'));
 expect([...new URLSearchParams(location.hash.split('?')[1])]).toEqual([['path',PATH],['tab','quality'],['dialog','file-move']]);
 expect(await screen.findByRole('dialog')).toBeVisible();
});

it('still reaches publish, the one thing the old button did',async()=>{
 await open();
 fireEvent.click(await screen.findByRole('button',{name:'Manage with Terum…'}));
 fireEvent.click(await screen.findByRole('menuitem',{name:'Publish to team…'}));
 expect(await screen.findByRole('dialog',{name:'Publish deploy-check to the team?'})).toBeVisible();
});
