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
import type { AppUpdateStaged, AppUpdateStatus, Result } from '../../backend/types';

const backend=createMockBackend();
const status:AppUpdateStatus={appVersion:'0.1.10',supported:true,cliVersion:'0.1.10',latest:'0.1.12',latestAt:'2026-09-14T21:00:00Z',probe:'ok',probeError:null,staged:null,installed:[],lastApply:null,newer:true,ppid:42,platform:'win32-x64'};
const ok=(patch:Partial<AppUpdateStatus>={}):Result<AppUpdateStatus>=>({ok:true,value:{...status,...patch}});
const stagedValue=(patch:Partial<AppUpdateStaged>={}):Result<AppUpdateStaged>=>({ok:true,value:{version:'0.1.12',staged:true,notPublished:false,alreadyStaged:false,...patch}});
let client:QueryClient;
function Cache(){const value=useQueryClient();useEffect(()=>{client=value;},[value]);return null;}
function open(){location.hash='#/settings/updates';return render(<Providers><Cache/><BackendContext value={backend}><MachineRemovalProvider><App/></MachineRemovalProvider></BackendContext></Providers>);}
function group(){return screen.getByText('The app',{exact:true}).closest('section')!;}
const button=()=>screen.findByRole('button',{name:'Update and relaunch…'});
async function configure(mode:'full'|'notice'='full',patch:Partial<AppUpdateStatus>={}){
 vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),appUpdate:true});vi.spyOn(backend,'features').mockResolvedValue({...await backend.features(),appUpdate:mode==='full'});
 vi.spyOn(backend,'capabilities').mockResolvedValue({...await backend.capabilities(),appVersion:'0.1.10'});
 backend.prefs.set('updates:app:policy','ask');
 return vi.spyOn(backend.appUpdate,'check').mockResolvedValue(ok(patch));
}
beforeEach(()=>{localStorage.clear();useUiStore.getState().setTheme('dark');});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});

it('draws the row only where the app can install itself: full mode, not the notice, not the drawn literal',async()=>{
 open();await screen.findByText('0.1.0 (build 12) · no update channel yet.');expect(screen.queryByText('Update and relaunch')).toBeNull();cleanup();
 await configure('notice');open();await screen.findByText('Terum Skills app');expect(screen.queryByText('Update and relaunch')).toBeNull();cleanup();
 await configure('full',{newer:false});open();expect(await button()).toBeVisible();
 expect(group()).toHaveTextContent('Checks github.com now, downloads and verifies the newest build, then installs it and relaunches the app.');
});
it('hides the row when the cached check already says this machine has no desktop build',async()=>{
 await configure('full',{supported:false,platform:'wsl'});open();await waitFor(()=>expect(group()).toHaveTextContent('there is no desktop build for this machine.'));
 expect(screen.queryByRole('button',{name:'Update and relaunch…'})).toBeNull();
});
it('forces a fresh probe and, when nothing is newer, says so without downloading or relaunching',async()=>{
 const check=await configure('full',{latest:'0.1.10',newer:false});const stage=vi.spyOn(backend.appUpdate,'stage'),apply=vi.spyOn(backend.appUpdate,'apply'),quit=vi.spyOn(backend,'quit');
 open();fireEvent.click(await button());await waitFor(()=>expect(check).toHaveBeenCalledWith({force:true}));
 await waitFor(()=>expect(group()).toHaveTextContent('Checked just now · 0.1.10 is the newest build (win32-x64).'));
 expect(stage).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();expect(quit).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();expect(await button()).toBeEnabled();
});
it('never turns a failed probe into "up to date"',async()=>{
 const check=await configure('full',{newer:false});check.mockResolvedValueOnce(ok({newer:false})).mockResolvedValue(ok({newer:false,probe:'failed',probeError:'dial tcp: connection refused'}));
 open();fireEvent.click(await button());const alert=await within(group()).findByRole('alert');
 expect(alert).toHaveTextContent('Could not reach github.com to check for a newer app. dial tcp: connection refused');expect(group()).not.toHaveTextContent('Checked just now');
});
it('downloads the advertised build, asks before relaunching, then applies and quits in that order',async()=>{
 await configure();const stage=vi.spyOn(backend.appUpdate,'stage').mockImplementation(version=>createRun(async()=>stagedValue({version})));
 const order:string[]=[];const apply=vi.spyOn(backend.appUpdate,'apply').mockImplementation(async()=>{await Promise.resolve();order.push('apply');return {ok:true,value:undefined};});const quit=vi.spyOn(backend,'quit').mockImplementation(async()=>{order.push('quit');});
 open();fireEvent.click(await button());await waitFor(()=>expect(stage).toHaveBeenCalledExactlyOnceWith('0.1.12'));
 const dialog=await screen.findByRole('dialog');expect(dialog).toHaveTextContent('Install 0.1.12 and relaunch now?');expect(apply).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Relaunch'}));await waitFor(()=>expect(order).toEqual(['apply','quit']));expect(apply).toHaveBeenCalledExactlyOnceWith('0.1.12','manual');expect(quit).toHaveBeenCalledOnce();
});
it('skips the download when the newest build is already downloaded and verified',async()=>{
 await configure('full',{staged:'0.1.12'});const stage=vi.spyOn(backend.appUpdate,'stage');
 open();fireEvent.click(await button());expect(await screen.findByRole('dialog')).toHaveTextContent('Install 0.1.12 and relaunch now?');expect(stage).not.toHaveBeenCalled();
});
it('Later keeps the download and leaves Install now on the status row',async()=>{
 await configure();vi.spyOn(backend.appUpdate,'stage').mockImplementation(version=>createRun(async()=>stagedValue({version})));const apply=vi.spyOn(backend.appUpdate,'apply'),quit=vi.spyOn(backend,'quit');
 open();fireEvent.click(await button());const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Later'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(within(group()).getByRole('button',{name:'Install now'})).toBeVisible();expect(apply).not.toHaveBeenCalled();expect(quit).not.toHaveBeenCalled();
});
it('reports a failed download in place and offers the action again',async()=>{
 await configure();vi.spyOn(backend.appUpdate,'stage').mockImplementation(()=>createRun(async()=>({ok:false,error:'The downloaded desktop app did not match its published checksum, so it was discarded.'})));
 open();fireEvent.click(await button());expect(await within(group()).findByRole('alert')).toHaveTextContent('did not match its published checksum');
 expect(screen.queryByRole('dialog')).toBeNull();expect(await button()).toBeEnabled();
});
it('reports an announced release whose files are not published yet',async()=>{
 await configure();vi.spyOn(backend.appUpdate,'stage').mockImplementation(()=>createRun(async()=>stagedValue({staged:false,notPublished:true})));
 open();fireEvent.click(await button());await waitFor(()=>expect(group()).toHaveTextContent('0.1.12 is announced but its files are not published yet. Try again in a few minutes.'));
 expect(screen.queryByRole('dialog')).toBeNull();expect(within(group()).queryByRole('alert')).toBeNull();
});
it('reports a failed check and downloads nothing',async()=>{
 const check=await configure('full',{newer:false});check.mockResolvedValueOnce(ok({newer:false})).mockResolvedValue({ok:false,error:'The release state could not be read.'});const stage=vi.spyOn(backend.appUpdate,'stage');
 open();fireEvent.click(await button());expect(await within(group()).findByRole('alert')).toHaveTextContent('The release state could not be read.');expect(stage).not.toHaveBeenCalled();expect(await button()).toBeEnabled();
});
it('says when the newest build is installed but this window still runs the old one',async()=>{
 const check=await configure('full',{newer:false});check.mockResolvedValueOnce(ok({newer:false})).mockResolvedValue(ok({staged:'0.1.12',installed:['0.1.12']}));const stage=vi.spyOn(backend.appUpdate,'stage');
 open();fireEvent.click(await button());await waitFor(()=>expect(group()).toHaveTextContent('0.1.12 is already installed on this machine. Quit and reopen the app to run it.'));expect(stage).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});
it('streams the download, offers Cancel, and never starts a second download under the automatic policy',async()=>{
 const check=await configure('full',{newer:false});localStorage.removeItem('terum-skills-app:pref:updates:app:policy');check.mockResolvedValueOnce(ok({newer:false})).mockResolvedValue(ok());
 const run=createRun(async ctx=>{ctx.print('Downloading Terum Skills 0.1.12 for win32-x64…');await ctx.sleep(60_000);return stagedValue();});const cancel=vi.spyOn(run,'cancel');const stage=vi.spyOn(backend.appUpdate,'stage').mockReturnValue(run);
 open();expect(await screen.findByRole('combobox',{name:'Install updates'})).toHaveTextContent('When I quit');fireEvent.click(await button());
 const downloading=await screen.findByRole('button',{name:'Downloading…'});expect(downloading).toBeDisabled();expect(group()).toHaveTextContent('Downloading Terum Skills 0.1.12 for win32-x64…');
 fireEvent.click(within(group()).getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(cancel).toHaveBeenCalledOnce());await act(async()=>{});expect(stage).toHaveBeenCalledExactlyOnceWith('0.1.12');
});
it('is unavailable while the automatic policy is already downloading',async()=>{
 await configure();localStorage.removeItem('terum-skills-app:pref:updates:app:policy');
 vi.spyOn(backend.appUpdate,'stage').mockImplementation(()=>createRun(async ctx=>{await ctx.sleep(60_000);return stagedValue();}));
 open();expect(await screen.findByRole('button',{name:'Downloading…'})).toBeDisabled();expect(await button()).toBeDisabled();
});
it('never starts a second download when the automatic policy began one while its own probe was in flight',async()=>{
 const check=await configure('full',{newer:false});localStorage.removeItem('terum-skills-app:pref:updates:app:policy');
 let finish!:(value:Result<AppUpdateStatus>)=>void;check.mockResolvedValueOnce(ok({newer:false})).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const stage=vi.spyOn(backend.appUpdate,'stage').mockImplementation(()=>createRun(async ctx=>{await ctx.sleep(60_000);return stagedValue();}));
 open();fireEvent.click(await button());await waitFor(()=>expect(check).toHaveBeenCalledWith({force:true}));
 // The hourly focus recheck lands first and the launch hook starts the policy's download.
 act(()=>client.setQueryData(['app-update'],ok()));await waitFor(()=>expect(stage).toHaveBeenCalledOnce());
 await act(async()=>finish(ok()));await waitFor(()=>expect(group()).toHaveTextContent('0.1.12 is downloading already; Install now appears above once it is verified.'));
 expect(stage).toHaveBeenCalledOnce();expect(screen.queryByRole('dialog')).toBeNull();
});
