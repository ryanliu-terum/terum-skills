import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as backendModule from '../backend';
import { createMockBackend } from '../backend/mock';
import type { MachineUninstallResult } from '../backend/types';
import { createRun } from '../backend/mock/run';
import { MachineRemovalHost } from './MachineRemovalHost';
import { App } from './App';
import { Providers } from './providers';
import { useMachineRemoval, type MachineRemovalApi } from './machine-removal-context';

afterEach(()=>{cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});

it('keeps completion above the shell after Settings loses CLI state and navigation changes',async()=>{
 const backend=createMockBackend();vi.spyOn(backendModule,'pickBackend').mockReturnValue(backend);
 let queries!:QueryClient;
 function QueryAccess(){queries=useQueryClient();return null;}
 location.hash='#/settings/advanced?dialog=remove';
 render(<Providers><QueryAccess/><App/></Providers>);
 // The Remove button only exists once `?dialog=remove` has driven removal.start() -> uninstallMachine()
 // -> ask('confirm'), a chain of effects after App's first paint. The default 1000 ms findBy budget
 // races that chain and lost about one run in three. findBy polls, so a wider budget costs nothing
 // when the dialog is already up.
 fireEvent.click(await screen.findByRole('button',{name:'Remove'},{timeout:5000}));
 const region=await screen.findByRole('region',{name:'terum-skills was removed from this machine'});
 const settings=vi.spyOn(backend,'settings').mockResolvedValue({ok:false,error:'The desktop app could not find where terum-skills is installed…'});
 await act(async()=>{await queries.invalidateQueries({queryKey:['settings']});});
 expect(settings).toHaveBeenCalled();expect(region).toBeInTheDocument();
 await act(async()=>{location.hash='#/library/global';});
 await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 expect(screen.getByRole('region',{name:'terum-skills was removed from this machine'})).toBe(region);
 expect(within(region).getByRole('button',{name:'Quit'})).toBeEnabled();expect(screen.queryByRole('dialog')).toBeNull();
});

it('cancels reading without letting its later settlement replace a fresh run',async()=>{
 const backend=createMockBackend();vi.spyOn(backendModule,'pickBackend').mockReturnValue(backend);
 const reading=createRun<MachineUninstallResult>(async ctx=>{await ctx.sleep(60_000);return {ok:false,error:'stale'};});
 const cancel=vi.spyOn(reading,'cancel');const uninstall=vi.spyOn(backend,'uninstallMachine').mockReturnValueOnce(reading);
 let removal!:MachineRemovalApi;
 function RemovalAccess(){removal=useMachineRemoval();return null;}
 render(<Providers><RemovalAccess/><MachineRemovalHost/></Providers>);
 act(()=>removal.start());
 const dialog=await screen.findByRole('dialog',{name:'Remove terum-skills from this machine?'});
 expect(within(dialog).getByRole('status')).toHaveTextContent('Reading what this machine holds…');
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(cancel).toHaveBeenCalledOnce();
 act(()=>removal.start());
 await screen.findByRole('button',{name:'Remove'});expect(uninstall).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(removal.notice).toBe('Uninstall was cancelled.'));
 expect(removal.current).toBeNull();
});

it('prevents duplicate starts and hides cancellation once removal begins',async()=>{
 const backend=createMockBackend();vi.spyOn(backendModule,'pickBackend').mockReturnValue(backend);
 let finish!:()=>void;
 const run=createRun<MachineUninstallResult>(async ctx=>{
  await ctx.ask('confirm','Remove terum-skills from this machine?',{detail:['inventory']});
  ctx.print('Leaving a…');await new Promise<void>(resolve=>{finish=resolve;});return {ok:false,error:'partial failure'};
 });
 const uninstall=vi.spyOn(backend,'uninstallMachine').mockReturnValue(run),cancel=vi.spyOn(run,'cancel');
 let removal!:MachineRemovalApi;
 function RemovalAccess(){removal=useMachineRemoval();return null;}
 render(<Providers><RemovalAccess/><MachineRemovalHost/></Providers>);
 act(()=>{removal.start();removal.start();});
 await screen.findByRole('button',{name:'Remove'});
 act(()=>removal.start());expect(uninstall).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'Remove'}));
 const log=await screen.findByRole('log');expect(log).toHaveTextContent('Leaving a…');
 expect(screen.queryByRole('button',{name:'Cancel'})).toBeNull();expect(screen.queryByRole('button',{name:'Stop'})).toBeNull();
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(cancel).not.toHaveBeenCalled();
 await act(async()=>{finish();});await screen.findByRole('alert');
});
