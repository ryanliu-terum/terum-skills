import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { MachineRemovalProvider } from '../../app/MachineRemovalProvider';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import type { AppUpdateStatus } from '../../backend/types';

const backend=createMockBackend();
const status:AppUpdateStatus={appVersion:'0.1.10',supported:true,cliVersion:'0.1.10',latest:'0.1.12',latestAt:null,probe:'cached',probeError:null,staged:null,installed:[],lastApply:null,newer:true,ppid:42};
function open(){location.hash='#/settings/updates';return render(<Providers><BackendContext value={backend}><MachineRemovalProvider><App/></MachineRemovalProvider></BackendContext></Providers>);}
function group(){return screen.getByText('The app',{exact:true}).closest('section')!;}
async function configure(mode:'full'|'notice'='full',patch:Partial<AppUpdateStatus>={}){
 vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),appUpdate:true});vi.spyOn(backend,'features').mockResolvedValue({...await backend.features(),appUpdate:mode==='full'});
 vi.spyOn(backend,'capabilities').mockResolvedValue({...await backend.capabilities(),appVersion:'0.1.10'});
 backend.prefs.set('updates:app:auto',false);
 return vi.spyOn(backend.appUpdate,'check').mockResolvedValue({ok:true,value:{...status,...patch}});
}
beforeEach(()=>{localStorage.clear();useUiStore.getState().setTheme('dark');});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});
it('renders the drawn literal untouched when the surface is off',async()=>{
 open();expect(await screen.findByText('0.1.0 (build 12) · no update channel yet.')).toBeInTheDocument();expect(within(group()).queryByRole('button')).toBeNull();expect(within(group()).queryByRole('switch')).toBeNull();
});
const cases:{name:string;patch:Partial<AppUpdateStatus>;desc:string;button?:string;ok?:boolean}[]=[
 {name:'unsupported',patch:{supported:false},desc:'0.1.10 · there is no desktop build for this machine.'},
 {name:'apply failed',patch:{lastApply:{version:'0.1.12',phase:'failed',at:'2026-09-10T00:00:00Z',error:'boom'}},desc:'0.1.10 · installing 0.1.12 did not finish.',button:'Try again'},
 {name:'probe skipped',patch:{probe:'skipped',latest:null,newer:false},desc:'0.1.10 · release advertisements are not checked on this machine.'},
 {name:'probe failed',patch:{probe:'failed',newer:false},desc:'0.1.10 · could not reach github.com to check for a newer app.',button:'Check again'},
 {name:'up to date',patch:{newer:false},desc:'0.1.10 · up to date',ok:true},
 {name:'downloaded',patch:{staged:'0.1.12'},desc:'0.1.10 · 0.1.12 downloaded and verified.',button:'Relaunch now'},
 {name:'newer available',patch:{},desc:'0.1.10 · 0.1.12 available.',button:'Download 0.1.12'},
];
it.each(cases)('renders full mode $name',async({patch,desc,button,ok})=>{
 await configure('full',patch);open();await waitFor(()=>expect(group()).toHaveTextContent(desc));
 if(button)expect(within(group()).getByRole('button',{name:button})).toBeVisible();else expect(within(group()).queryByRole('button')).toBeNull();if(ok)expect(within(group()).getByText('Up to date')).toBeVisible();
});
it('renders full mode checking',async()=>{
 const check=await configure();check.mockReturnValue(new Promise(()=>{}));open();expect(await screen.findByText('0.1.10 · checking…')).toBeVisible();expect(within(group()).queryByRole('button')).toBeNull();
});
it('renders full mode check failed and rechecks explicitly with force',async()=>{
 const check=await configure();check.mockResolvedValue({ok:false,error:'offline'});open();await waitFor(()=>expect(group()).toHaveTextContent('0.1.10 · the update check did not run.'));expect(within(group()).getByRole('alert')).toHaveTextContent('offline');
 check.mockResolvedValue({ok:true,value:{...status,newer:false}});fireEvent.click(within(group()).getByRole('button',{name:'Check again'}));await waitFor(()=>expect(check).toHaveBeenCalledWith({force:true}));await waitFor(()=>expect(group()).toHaveTextContent('0.1.10 · up to date'));
});
it.each([
 ['0.1.12','0.1.10 · 0.1.12 available · update terum-skills to install it from here','Show update command'],
 ['0.1.10','0.1.10 · up to date','Up to date'],
 [null,'0.1.10 · no newer app is advertised on this machine.','—'],
] as const)('renders notice mode advertisement %s',async(latest,desc,control)=>{
 const check=await configure('notice'),report=await backend.update();if(!report.ok)throw new Error(report.error);vi.spyOn(backend,'update').mockResolvedValue({ok:true,value:{...report.value,latest}});
 open();await waitFor(()=>expect(group()).toHaveTextContent(desc));expect(within(group()).getByText(control)).toBeVisible();expect(check).not.toHaveBeenCalled();expect(within(group()).queryByRole('switch')).toBeNull();
 if(control==='Show update command'){fireEvent.click(within(group()).getByRole('button',{name:control}));expect(await screen.findByRole('dialog')).toHaveTextContent('Update command');}
});
it('offers Download and stages the advertised version',async()=>{
 await configure();const stage=vi.spyOn(backend.appUpdate,'stage').mockImplementation(version=>createRun(async()=>({ok:true,value:{version,staged:true,notPublished:false,alreadyStaged:false}})));
 open();fireEvent.click(await screen.findByRole('button',{name:'Download 0.1.12'}));await waitFor(()=>expect(stage).toHaveBeenCalledExactlyOnceWith('0.1.12'));
});
it('always asks before relaunching, and calls apply then quit in that order',async()=>{
 await configure('full',{staged:'0.1.12'});const order:string[]=[];const apply=vi.spyOn(backend.appUpdate,'apply').mockImplementation(async()=>{await Promise.resolve();order.push('apply');return {ok:true,value:undefined};});const quit=vi.spyOn(backend,'quit').mockImplementation(async()=>{order.push('quit');});
 open();fireEvent.click(await screen.findByRole('button',{name:'Relaunch now'}));const dialog=await screen.findByRole('dialog');expect(dialog).toHaveTextContent('Relaunch to finish updating');
 expect(dialog).toHaveTextContent('Terum Skills 0.1.12 is downloaded and verified. Relaunching closes this window; anything the app is running — an eval, a sync — is stopped when it closes.');expect(apply).not.toHaveBeenCalled();expect(quit).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Relaunch'}));await waitFor(()=>expect(order).toEqual(['apply','quit']));expect(quit).toHaveBeenCalledOnce();expect(apply).toHaveBeenCalledExactlyOnceWith('0.1.12');
});
it('cancelling the relaunch dialog calls neither apply nor quit',async()=>{
 await configure('full',{staged:'0.1.12'});const apply=vi.spyOn(backend.appUpdate,'apply'),quit=vi.spyOn(backend,'quit');open();fireEvent.click(await screen.findByRole('button',{name:'Relaunch now'}));fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Later'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(apply).not.toHaveBeenCalled();expect(quit).not.toHaveBeenCalled();
});
it('keeps the dialog open and shows the error when apply fails',async()=>{
 await configure('full',{staged:'0.1.12'});vi.spyOn(backend.appUpdate,'apply').mockResolvedValue({ok:false,error:'Nothing is staged for 0.1.12; download it first.'});const quit=vi.spyOn(backend,'quit');open();fireEvent.click(await screen.findByRole('button',{name:'Relaunch now'}));const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Relaunch'}));
 expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nothing is staged for 0.1.12; download it first.');expect(dialog).toBeInTheDocument();expect(quit).not.toHaveBeenCalled();
});
it('does not check on window focus',async()=>{
 const check=await configure();open();await screen.findByRole('button',{name:'Download 0.1.12'});fireEvent(window,new Event('focus'));await act(async()=>{});expect(check).toHaveBeenCalledExactlyOnceWith();
});
it('never calls appUpdate.check in notice mode',async()=>{
 const check=await configure('notice');open();await screen.findByText('Terum Skills app');expect(check).not.toHaveBeenCalled();
});
it('writes the auto-download preference and reverts the switch when the write throws',async()=>{
 await configure('full',{newer:false});backend.prefs.set('updates:app:auto',true);const set=vi.spyOn(backend.prefs,'set');open();const toggle=await screen.findByRole('switch',{name:'Download updates automatically'});expect(toggle).toHaveAttribute('aria-checked','true');
 fireEvent.click(toggle);expect(set).toHaveBeenCalledWith('updates:app:auto',false);expect(toggle).toHaveAttribute('aria-checked','false');
 set.mockImplementation(()=>{throw new Error('Preferences are read-only.');});fireEvent.click(toggle);expect(await within(group()).findByRole('alert')).toHaveTextContent('Preferences are read-only.');expect(toggle).toHaveAttribute('aria-checked','false');
});
it('streams download output and Cancel reaches the active Run',async()=>{
 await configure();const run=createRun(async ctx=>{ctx.print('Fetching the verified release…');await ctx.sleep(60_000);return {ok:true as const,value:{version:'0.1.12',staged:true,notPublished:false,alreadyStaged:false}};});const cancel=vi.spyOn(run,'cancel');vi.spyOn(backend.appUpdate,'stage').mockReturnValue(run);
 open();fireEvent.click(await screen.findByRole('button',{name:'Download 0.1.12'}));expect(await screen.findByRole('button',{name:'Downloading…'})).toBeDisabled();expect(group()).toHaveTextContent('0.1.10 · downloading 0.1.12…');expect(group()).toHaveTextContent('Fetching the verified release…');fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(cancel).toHaveBeenCalledOnce());
});
it.each([true,false])('renders a stage outcome with notPublished=%s',async notPublished=>{
 await configure();vi.spyOn(backend.appUpdate,'stage').mockImplementation(()=>createRun(async()=>notPublished?{ok:true,value:{version:'0.1.12',staged:false,notPublished:true,alreadyStaged:false}}:{ok:false,error:'checksum failed'}));open();fireEvent.click(await screen.findByRole('button',{name:'Download 0.1.12'}));
 await waitFor(()=>expect(group()).toHaveTextContent(notPublished?'0.1.10 · 0.1.12 is announced but its files are not published yet.':'0.1.10 · 0.1.12 could not be downloaded.'));
 if(notPublished)expect(within(group()).queryByRole('button')).toBeNull();else{expect(within(group()).getByRole('alert')).toHaveTextContent('checksum failed');expect(within(group()).getByRole('button',{name:'Try again'})).toBeVisible();}
});
