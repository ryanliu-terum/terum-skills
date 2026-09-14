import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { createTauriBackend } from '../index';
import { shareSettingsReplay, type LocalValue, type StatusValue as WireStatus } from './share-settings-fixture';
import { ICON_PATHS } from '../../../components/ui/icon-paths';
import { StatusValue } from '../../../screens/settings/SettingsParts';

afterEach(()=>{cleanup();location.hash='';localStorage.clear();});
function open(route:string,change?:Parameters<typeof shareSettingsReplay>[0]) {
 useUiStore.setState({railOpen:true,overviewHidden:false});location.hash=route;
 const f=shareSettingsReplay(change),backend=createTauriBackend(f.bridge);
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 return backend;
}
it('renders members without unknown invitations, roles or Last seen',async()=>{
 open('#/share');expect(await screen.findByText('3 members')).toBeVisible();
 const row=screen.getByTestId('member-row-0');expect(within(row).getByText('mira')).toBeVisible();
 expect(row.querySelector('.member-identity')?.textContent).toBe('Mira Chenmira');
 expect(screen.getByText('Last seen')).not.toBeVisible();
 expect(within(row).getAllByRole('cell',{hidden:true}).at(-1)).not.toBeVisible();
});
it('renders unknown hook and quarantine without switches or prune buttons',async()=>{
 open('#/settings/sync');expect(await screen.findByText('Managed by setup')).toBeVisible();
 expect(screen.queryByRole('switch')).toBeNull();expect(screen.queryByRole('button',{name:'Prune…'})).toBeNull();
 expect(screen.getByText('Quarantine contents are not reported by this terum-skills version.')).toBeVisible();
});
it('renders tracked placements and refuses a prune URL when quarantine is unread',async()=>{
 open('#/settings/machine?dialog=prune');expect(await screen.findByText('tracking')).toBeVisible();
 expect(screen.getByText('Quarantine contents are not reported by this terum-skills version.')).toBeVisible();
 expect(screen.getByText('No tool approvals recorded.')).toBeVisible();expect(screen.queryByRole('dialog')).toBeNull();
});
// The re-recorded `update` ran offline against the fixture's local remote: running 0.14.0, no release observed.
it('renders the installed version and the recorded unknown release observation',async()=>{
 open('#/settings/updates');expect(await screen.findByText('0.14.0 installed · latest unknown')).toBeVisible();
 expect(screen.getByText(/1 placement on this machine/)).toBeVisible();
});
it('does not advertise a release before checking',async()=>{
 open('#/settings/about');expect(await screen.findByText('terum-skills CLI')).toBeVisible();
 expect(screen.queryByText(/available/)).toBeNull();expect(screen.getByRole('button',{name:'Check'})).toBeVisible();
});
it('names the CLI default k and offers no unknown-k choice',async()=>{
 open('#/settings/evals');expect(await screen.findByText('terum-skills runs k = 1 unless a run passes --k, and the app passes none from here yet; k = 3 or more for a receipt you intend to gate on.')).toBeVisible();
 expect(screen.queryByRole('option',{name:'—'})).toBeNull();expect(screen.queryByText(/k = —/)).toBeNull();
 expect(screen.getByText('The app passes no eval flags; terum-skills uses its own defaults.')).toBeVisible();
});
it('renders generic settings errors without diagnosing invalid JSON',async()=>{
 open('#/settings/account',(frame,name)=>{if(frame.t==='result'&&name==='status'){Object.assign(frame,{ok:false,error:'Permission denied.',exitCode:1});delete frame.value;}});
 expect(await screen.findByText("terum-skills could not read your settings, so this page shows nothing rather than stale values. The message below is the CLI's own.")).toBeVisible();
 expect(screen.queryByText(/not valid JSON/)).toBeNull();
});
it('draws an empty placement collection',async()=>{
 const change=(frame:Record<string,unknown>,name:string)=>{if(frame.t==='result'&&name==='status'){const value=frame.value as WireStatus;value.ledger.placements=[];}};
 open('#/settings/machine',change);expect(await screen.findByText('Nothing placed on this machine yet.')).toBeVisible();
});
it('draws unknown status with a muted alert icon',()=>{
 const {container}=render(<StatusValue kind="unknown">—</StatusValue>);
 expect(screen.getByText('—')).toBeVisible();
 expect(container.querySelector('svg')).toHaveStyle({color:'var(--tk-text3)'});
 expect(container.querySelector('svg')?.innerHTML).toBe(ICON_PATHS.alert);
});
it.each([
 ['newer','0.1.8','0.14.0 installed · 0.1.8 available'],
 ['older','0.1.6','0.14.0 installed · newer than the advertised 0.1.6'],
 ['unknown',null,'0.14.0 installed · latest unknown'],
 ['newer',null,'0.14.0 installed · latest unknown'],
])('renders the %s update observation from its values',async(observation,latest,summary)=>{
 open('#/settings/updates',(frame,name)=>{if(frame.t==='result'&&name==='update')Object.assign(frame.value as Record<string,unknown>,{observation,latest});});
 expect(await screen.findByText(summary!)).toBeVisible();
});
it('keeps release description and advice in the update dialog',async()=>{
 open('#/settings/updates?dialog=update');
 const dialog=await screen.findByRole('dialog');
 expect(within(dialog).getByText('Release advertisements are not checked on this machine.')).toBeVisible();
 expect(dialog).toHaveTextContent('Running from a source checkout.');
});

it('counts tracked and pinned placements separately when the complete ledger is reported',async()=>{
 open('#/settings/updates',(frame,name)=>{
  if(frame.t!=='result')return;
  if(name==='status'){
   const value=frame.value as WireStatus;
   value.ledger.placements.push({...value.ledger.placements[0]!,path:'/Users/teddy/.claude/skills/pinned'});
  }
  if(name==='ls-local'){
   const value=frame.value as LocalValue;
   value.local[0]!.rows.push({...value.local[0]!.rows[0]!,name:'pinned',path:'/Users/teddy/.claude/skills/pinned',tracked:false});
  }
 });
 // The Tracked row's copy describes the fetch-only sync (a fetch only tells; install places), so the count is read after that sentence.
 expect(await screen.findByText(/running install again is what places it\. 1 placement on this machine/)).toBeVisible();
 expect(screen.getByText(/Installed at a version.*1 on this machine/)).toBeVisible();
});
