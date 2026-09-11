import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { MachineRemovalProvider } from '../../app/MachineRemovalProvider';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import type { AppUpdateStatus, Result } from '../../backend/types';

const backend=createMockBackend();
const status:AppUpdateStatus={appVersion:'0.1.10',supported:true,cliVersion:'0.1.10',latest:'0.1.12',latestAt:null,probe:'cached',probeError:null,staged:null,installed:[],lastApply:null,newer:true,ppid:42};
let client:QueryClient;
function Cache(){const value=useQueryClient();useEffect(()=>{client=value;},[value]);return null;}
function open(route='#/settings/updates'){location.hash=route;return render(<Providers><Cache/><BackendContext value={backend}><MachineRemovalProvider><App/></MachineRemovalProvider></BackendContext></Providers>);}
function group(){return screen.getByText('The app',{exact:true}).closest('section')!;}
async function configure(mode:'full'|'notice'='full',patch:Partial<AppUpdateStatus>={}){
 vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),appUpdate:true});vi.spyOn(backend,'features').mockResolvedValue({...await backend.features(),appUpdate:mode==='full'});
 vi.spyOn(backend,'capabilities').mockResolvedValue({...await backend.capabilities(),appVersion:'0.1.10'});
 backend.prefs.set('updates:app:policy','ask');
 return vi.spyOn(backend.appUpdate,'check').mockResolvedValue({ok:true,value:{...status,...patch}});
}
beforeEach(()=>{localStorage.clear();useUiStore.getState().setTheme('dark');});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});
it('renders the drawn literal untouched when the surface is off',async()=>{
 open();expect(await screen.findByText('0.1.0 (build 12) · no update channel yet.')).toBeInTheDocument();expect(within(group()).queryByRole('button')).toBeNull();expect(within(group()).queryByRole('combobox')).toBeNull();
});
const cases:{name:string;patch:Partial<AppUpdateStatus>;desc:string;button?:string;ok?:boolean}[]=[
 {name:'unsupported',patch:{supported:false},desc:'0.1.10 · there is no desktop build for this machine.'},
 {name:'apply failed',patch:{lastApply:{version:'0.1.12',phase:'failed',at:'2026-09-10T00:00:00Z',error:'boom'}},desc:'0.1.10 · installing 0.1.12 did not finish.',button:'Try again'},
 {name:'probe skipped',patch:{probe:'skipped',latest:null,newer:false},desc:'0.1.10 · release advertisements are not checked on this machine.'},
 {name:'probe failed',patch:{probe:'failed',newer:false},desc:'0.1.10 · could not reach github.com to check for a newer app.',button:'Check again'},
 {name:'up to date',patch:{newer:false},desc:'0.1.10 · up to date',ok:true},
 {name:'downloaded',patch:{staged:'0.1.12'},desc:'0.1.10 · 0.1.12 downloaded and verified.',button:'Install now'},
 {name:'newer available',patch:{},desc:'0.1.10 · 0.1.12 available.',button:'Download'},
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
 open();await waitFor(()=>expect(group()).toHaveTextContent(desc));expect(within(group()).getByText(control)).toBeVisible();expect(check).not.toHaveBeenCalled();expect(within(group()).queryByRole('combobox')).toBeNull();
 if(control==='Show update command'){fireEvent.click(within(group()).getByRole('button',{name:control}));expect(await screen.findByRole('dialog')).toHaveTextContent('Update command');}
});
it('offers Download and stages the advertised version',async()=>{
 const check=await configure();const stage=vi.spyOn(backend.appUpdate,'stage').mockImplementation(version=>createRun(async()=>({ok:true,value:{version,staged:true,notPublished:false,alreadyStaged:false}})));
 open();fireEvent.click(await screen.findByRole('button',{name:'Download'}));await waitFor(()=>expect(stage).toHaveBeenCalledExactlyOnceWith('0.1.12'));
 expect(await screen.findByRole('button',{name:'Install now'})).toBeVisible();expect(await screen.findByRole('button',{name:'Update ready · 0.1.12'})).toBeVisible();expect(check).toHaveBeenCalledOnce();
});
it('always asks before relaunching, and calls apply then quit in that order',async()=>{
 await configure('full',{staged:'0.1.12'});const order:string[]=[];const apply=vi.spyOn(backend.appUpdate,'apply').mockImplementation(async()=>{await Promise.resolve();order.push('apply');return {ok:true,value:undefined};});const quit=vi.spyOn(backend,'quit').mockImplementation(async()=>{order.push('quit');});
 open();fireEvent.click(await screen.findByRole('button',{name:'Install now'}));const dialog=await screen.findByRole('dialog');expect(dialog).toHaveTextContent('Install 0.1.12 and relaunch now?');
 expect(dialog).toHaveTextContent('Terum Skills 0.1.12 is downloaded and verified. Relaunching closes this window; anything the app is running — an eval, a sync — is stopped when it closes.');expect(apply).not.toHaveBeenCalled();expect(quit).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Relaunch'}));await waitFor(()=>expect(order).toEqual(['apply','quit']));expect(quit).toHaveBeenCalledOnce();expect(apply).toHaveBeenCalledExactlyOnceWith('0.1.12','manual');
});
it('cancelling the relaunch dialog calls neither apply nor quit',async()=>{
 await configure('full',{staged:'0.1.12'});const apply=vi.spyOn(backend.appUpdate,'apply'),quit=vi.spyOn(backend,'quit');open();fireEvent.click(await screen.findByRole('button',{name:'Install now'}));fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Later'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(apply).not.toHaveBeenCalled();expect(quit).not.toHaveBeenCalled();
});
it('keeps the dialog open and shows the error when apply fails',async()=>{
 await configure('full',{staged:'0.1.12'});vi.spyOn(backend.appUpdate,'apply').mockResolvedValue({ok:false,error:'Nothing is staged for 0.1.12; download it first.'});const quit=vi.spyOn(backend,'quit');open();fireEvent.click(await screen.findByRole('button',{name:'Install now'}));const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Relaunch'}));
 expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nothing is staged for 0.1.12; download it first.');expect(dialog).toBeInTheDocument();expect(quit).not.toHaveBeenCalled();
});
it('does not check on window focus',async()=>{
 const check=await configure();open();await screen.findByRole('button',{name:'Download'});fireEvent(window,new Event('focus'));await act(async()=>{});expect(check).toHaveBeenCalledExactlyOnceWith();
});
it('never calls appUpdate.check in notice mode',async()=>{
 const check=await configure('notice');open();await screen.findByText('Terum Skills app');expect(check).not.toHaveBeenCalled();
});
it('persists all three policies and explains each choice before selection',async()=>{
 await configure('full',{newer:false});const set=vi.spyOn(backend.prefs,'set');open();const select=await screen.findByRole('combobox',{name:'Install updates'});expect(select).toHaveTextContent('Ask me');
 const descriptions=['Ask me — show Install now, never install by itself','When I quit — install the downloaded update after the app closes','Overnight — install and relaunch between 01:00 and 05:00 while the app is open and idle'];
 for(const text of descriptions)expect(within(group()).getByText(text)).toBeVisible();
 for(const [label,policy] of [['When I quit','on-close'],['Overnight','overnight'],['Ask me','ask']] as const){
  fireEvent.click(select);const option=await screen.findByRole('option',{name:label});fireEvent.pointerDown(option,{pointerType:'mouse'});fireEvent.click(option);
  expect(set).toHaveBeenCalledWith('updates:app:policy',policy);expect(select).toHaveTextContent(label!);for(const text of descriptions)expect(within(group()).getByText(text)).toBeVisible();
 }
 set.mockImplementation(()=>{throw new Error('Preferences are read-only.');});fireEvent.click(select);const overnight=await screen.findByRole('option',{name:'Overnight'});fireEvent.pointerDown(overnight,{pointerType:'mouse'});fireEvent.click(overnight);expect(await within(group()).findByRole('alert')).toHaveTextContent('Preferences are read-only.');expect(select).toHaveTextContent('Ask me');
});
it('streams download output and Cancel reaches the active Run',async()=>{
 await configure();const run=createRun(async ctx=>{ctx.print('Fetching the verified release…');await ctx.sleep(60_000);return {ok:true as const,value:{version:'0.1.12',staged:true,notPublished:false,alreadyStaged:false}};});const cancel=vi.spyOn(run,'cancel');vi.spyOn(backend.appUpdate,'stage').mockReturnValue(run);
 open();fireEvent.click(await screen.findByRole('button',{name:'Download'}));expect(await screen.findByRole('button',{name:'Downloading…'})).toBeDisabled();expect(group()).toHaveTextContent('0.1.10 · downloading 0.1.12…');expect(group()).toHaveTextContent('Fetching the verified release…');fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(cancel).toHaveBeenCalledOnce());
});
it.each([true,false])('renders a stage outcome with notPublished=%s',async notPublished=>{
 await configure();vi.spyOn(backend.appUpdate,'stage').mockImplementation(()=>createRun(async()=>notPublished?{ok:true,value:{version:'0.1.12',staged:false,notPublished:true,alreadyStaged:false}}:{ok:false,error:'checksum failed'}));open();fireEvent.click(await screen.findByRole('button',{name:'Download'}));
 await waitFor(()=>expect(group()).toHaveTextContent(notPublished?'0.1.10 · 0.1.12 is announced but its files are not published yet.':'0.1.10 · 0.1.12 could not be downloaded.'));
 if(notPublished)expect(within(group()).queryByRole('button')).toBeNull();else{expect(within(group()).getByRole('alert')).toHaveTextContent('checksum failed');expect(within(group()).getByRole('button',{name:'Try again'})).toBeVisible();}
});

it.each(['on-close','overnight','manual'] as const)('shows the successful marker reason %s',async reason=>{
 await configure('full',{newer:false,reason,lastApply:{version:'0.1.10',phase:'launched',at:'2026-09-10T00:00:00Z',error:null}});open();
 expect(await screen.findByText(`Updated to 0.1.10${reason==='on-close'?' when you quit':reason==='overnight'?' overnight':''}`)).toBeVisible();
});
it('focuses the app row only when the chip requests it and consumes the request',async()=>{
 await configure();open('#/settings/appearance');fireEvent.click(await screen.findByRole('button',{name:'Update available · 0.1.12'}));
 await screen.findByRole('button',{name:'Download'});await waitFor(()=>expect(document.getElementById('app-update-row')).toHaveFocus());
 await waitFor(()=>expect(location.hash).toBe('#/settings/updates'));
});
it('plain navigation to Updates does not steal focus',async()=>{
 await configure();const button=document.createElement('button');document.body.append(button);button.focus();
 try{open();await screen.findByRole('button',{name:'Download'});expect(button).toHaveFocus();}finally{button.remove();}
});

it('keeps the completed-update notice when another version is already advertised',async()=>{
 await configure('full',{reason:'overnight',lastApply:{version:'0.1.10',phase:'launched',at:'2026-09-10T00:00:00Z',error:null}});open();
 await waitFor(()=>expect(group()).toHaveTextContent('Updated to 0.1.10 overnight.'));expect(within(group()).getByRole('button',{name:'Download'})).toBeVisible();
});

it('the default on-close policy downloads in the background without Cancel, then offers Install now',async()=>{
 await configure();localStorage.removeItem('terum-skills-app:pref:updates:app:policy');
 let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});
 const stage=vi.spyOn(backend.appUpdate,'stage').mockImplementation(version=>createRun(async()=>{await done;return {ok:true,value:{version,staged:true,notPublished:false,alreadyStaged:false}};}));
 open();expect(await screen.findByRole('button',{name:'Downloading…'})).toBeDisabled();
 expect(within(group()).queryByRole('button',{name:'Cancel'})).toBeNull();expect(screen.getByRole('combobox',{name:'Install updates'})).toHaveTextContent('When I quit');
 expect(stage).toHaveBeenCalledExactlyOnceWith('0.1.12');await act(async()=>finish());expect(await screen.findByRole('button',{name:'Install now'})).toBeVisible();
});
it('a malformed in-session policy renders the same default as the launch hook',async()=>{
 await configure('full',{newer:false});backend.prefs.set('updates:app:policy','bogus');open();expect(await screen.findByRole('combobox',{name:'Install updates'})).toHaveTextContent('When I quit');
});
it('an installed release is not presented as ready to install',async()=>{
 await configure('full',{staged:'0.1.12',installed:['0.1.12']});open();expect(await screen.findByRole('button',{name:'Download'})).toBeVisible();expect(screen.queryByRole('button',{name:'Install now'})).toBeNull();
});
it('a failed explicit recheck cannot overwrite a good observation or remove its chip',async()=>{
 const check=await configure();check.mockResolvedValue({ok:false,error:'initial offline'});open();const retry=await screen.findByRole('button',{name:'Check again'});
 let finish!:(value:Result<AppUpdateStatus>)=>void;check.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(retry);
 const observed={ok:true as const,value:{...status,staged:'0.1.12'}};
 act(()=>client.setQueryData(['app-update'],observed));await screen.findByRole('button',{name:'Update ready · 0.1.12'});
 await act(async()=>finish({ok:false,error:'offline again'}));expect(client.getQueryData(['app-update'])).toEqual(observed);
 expect(screen.getByRole('button',{name:'Update ready · 0.1.12'})).toBeVisible();expect(within(group()).getByRole('alert')).toHaveTextContent('offline again');
});
it.each(['waiting','installing'] as const)('shows an unfinished %s marker instead of silently losing the handoff',async phase=>{
 await configure('full',{lastApply:{version:'0.1.12',phase,at:'2026-09-10T00:00:00Z',error:null}});open();
 await screen.findByText('The app',{exact:true});expect(await within(group()).findByRole('alert')).toHaveTextContent('The installer did not report completion. Try again.');
 expect(within(group()).getByRole('button',{name:'Try again'})).toBeVisible();
});
