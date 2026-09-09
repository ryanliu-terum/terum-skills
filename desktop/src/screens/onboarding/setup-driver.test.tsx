import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { BackendContext, SETUP_STEP_TO_BOARD } from '../../backend';
import { SETUP_STEP_KEYS } from '../../backend/types';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
const launch={target:'/fixture/team.git',writtenAt:'2026-09-08T12:00:00Z'};
afterEach(()=>{cleanup();localStorage.clear();location.hash='';vi.restoreAllMocks();});
function backend(){const b=createMockBackend();vi.spyOn(b,'launchTarget').mockResolvedValue(launch);return b;}
function open(b:ReturnType<typeof backend>,route='#/'){location.hash=route;return render(<StrictMode><Providers><BackendContext value={b}><App/></BackendContext></Providers></StrictMode>);}
it('maps every reached CLI step to one of the six drawn tour steps',()=>{
 expect(Object.keys(SETUP_STEP_TO_BOARD)).toEqual(SETUP_STEP_KEYS);
 expect(new Set(Object.values(SETUP_STEP_TO_BOARD))).toEqual(new Set(['Welcome','Style','Team','Basics','Feedback','Done']));
});
it('routes a fresh target to Boot, waits for the human, renders prints/progress, and consumes a typed decline once',async()=>{
 const b=backend(),answered=vi.fn(),set=vi.spyOn(b.prefs,'set');
 const setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print('GitHub CLI is installed but logged out. Run gh auth login in a terminal.');ctx.progress(2,4,'Fetching team');
  answered(await ctx.ask('confirm','Join this team?'));
  return {ok:false,error:'Join was declined.',cancelled:true,value:{team:'',role:'joiner',steps:{welcome:'printed',app:'skipped',github:'done'}}};
 }));
 const view=open(b);const dialog=await screen.findByRole('dialog');
 expect(location.hash).toBe('#/onboarding/boot');expect(setup).toHaveBeenCalledTimes(1);expect(setup).toHaveBeenCalledWith({target:launch.target,offerConnect:true});
 expect(answered).not.toHaveBeenCalled();expect(b.prefs.get('launch:consumedWrittenAt','')).toBe('');
 expect(screen.getByLabelText('Setup output')).toHaveTextContent('GitHub CLI is installed but logged out.');
 expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','2');expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax','4');
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(answered).toHaveBeenCalledWith(false));await screen.findByText('Join was declined.');
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('progressbar')).not.toHaveAttribute('data-failed');
 expect(set.mock.calls.filter(([key])=>key==='launch:consumedWrittenAt')).toEqual([['launch:consumedWrittenAt',launch.writtenAt]]);
 view.unmount();open(b);await waitFor(()=>expect(location.hash).toBe('#/library/global'));expect(setup).toHaveBeenCalledTimes(1);
});
it('uses four result-driven rows without inventing a progress counter',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print('Repository: /fixture/team.git');return {ok:true,value:{team:'team',role:'joiner',steps:{github:'done',team:'done',actions:'skipped',hook:'skipped',wrapper:'skipped',done:'printed'}}};
 }));
 const view=open(b);await screen.findByRole('heading',{name:'Setup finished'});expect(view.container.querySelectorAll('.onboarding-progress-row')).toHaveLength(4);
 expect(screen.queryByLabelText('Onboarding progress')).toBeNull();expect(screen.getByRole('progressbar',{name:'Setup progress'})).not.toHaveAttribute('aria-valuenow');expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuemax');
 expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
});
it('keeps an ordinary setup failure unconsumed and renders the CLI line as an error',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:false,error:'Could not read the team.'})));
 open(b);expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the team.');expect(b.prefs.get('launch:consumedWrittenAt','')).toBe('');
});
it('lands a zero-team machine without a target on Library, with no wizard',async()=>{
 const b=createMockBackend();const setup=vi.spyOn(b,'setup');vi.spyOn(b,'status').mockResolvedValue({ok:false,error:'No teams configured.'});
 open(b);await waitFor(()=>expect(location.hash).toBe('#/library/global'));expect(setup).not.toHaveBeenCalled();expect(screen.queryByText('Setting up your workspace')).toBeNull();
});
