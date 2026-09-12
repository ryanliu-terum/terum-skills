import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../../backend';
import { createTauriBackend } from '../../../backend/tauri';
import { detailReplay } from '../../../backend/tauri/__tests__/skill-detail-replay';
import { App } from '../../../app/App';

afterEach(() => { cleanup(); location.hash=''; localStorage.clear(); vi.restoreAllMocks(); });
function open(dialog = false) {
 const replay=detailReplay((name,value)=>{
  if(name==='ls')Object.assign((value.skills as Record<string,unknown>[])[0]!,{latest:'v10',latestVersion:'v10',versionCount:10});
  if(name==='status')for(const placement of (value.ledger as {placements:Record<string,unknown>[]}).placements)placement.version='v2';
  if(name==='ls-local')for(const section of value.local as {rows:{placement:Record<string,unknown>|null}[]}[])for(const row of section.rows)if(row.placement)row.placement.version='v2';
 });
 const backend=createTauriBackend(replay.bridge);
 location.hash='#/skill/deploy-check?root=marketplace'+(dialog?'&dialog=install':'');
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 return backend;
}
it('allows reinstalling an already placed stale copy and describes the latest version being installed', async()=>{
 const backend=open(true), install=vi.spyOn(backend,'install');
 const dialog=await screen.findByRole('dialog');
 expect(dialog).toHaveTextContent("Copies the team's current version (Version 10)");
 expect(dialog).not.toHaveTextContent('Sync keeps it up to date');
 fireEvent.click(within(dialog).getByRole('button',{name:'Install'}));
 await waitFor(()=>expect(install).toHaveBeenCalledWith({ref:'deploy-check',scope:'Global',team:'acme'}));
});
it('links to the latest version folder on main, independently of the placed version and eval report',async()=>{
 const backend=open(), openUrl=vi.spyOn(backend,'openUrl').mockResolvedValue({ok:true,value:undefined});
 fireEvent.click(await screen.findByRole('link',{name:'acme/team'}));
 expect(openUrl).toHaveBeenCalledWith('https://github.com/acme/team/tree/main/skills/deploy-check/v10');
});
