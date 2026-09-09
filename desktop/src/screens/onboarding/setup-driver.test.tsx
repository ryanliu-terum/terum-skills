import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { BackendContext, existingSetupSession, SETUP_STEP_TO_BOARD } from '../../backend';
import { SETUP_STEP_KEYS } from '../../backend/types';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
const launch={target:'/fixture/team.git',writtenAt:'2026-09-08T12:00:00Z'};
afterEach(()=>{cleanup();localStorage.clear();location.hash='';vi.restoreAllMocks();});
function backend(){const b=createMockBackend();vi.spyOn(b,'launchContext').mockResolvedValue(launch);vi.spyOn(b,'refreshLaunch').mockResolvedValue(launch);return b;}
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
it('boots a zero-team machine from an unconsumed target-less context',async()=>{
 const b=backend(),base=await b.status(),ctx={writtenAt:launch.writtenAt};
 if(!base.ok)throw new Error('Expected mock status');
 vi.spyOn(b,'status').mockResolvedValue({ok:true,value:{...base.value,teams:[]}});
 vi.mocked(b.launchContext).mockResolvedValue(ctx);vi.mocked(b.refreshLaunch).mockResolvedValue(ctx);
 const setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:true,value:{role:'creator',team:'team',steps:{}}})));
 open(b);await screen.findByRole('heading',{name:'Setup finished'});
 expect(location.hash).toBe('#/onboarding/boot');expect(setup).toHaveBeenCalledExactlyOnceWith({offerConnect:true});
});
it('lands on Library when target-less status fails, even with a zero-team partial value',async()=>{
 const b=backend(),base=await b.status(),ctx={writtenAt:launch.writtenAt};
 vi.mocked(b.launchContext).mockResolvedValue(ctx);vi.mocked(b.refreshLaunch).mockResolvedValue(ctx);
 vi.spyOn(b,'status').mockResolvedValue({ok:false,error:'Could not read status.',...(base.ok?{value:{...base.value,teams:[]}}:{})});
 const setup=vi.spyOn(b,'setup');open(b);
 await waitFor(()=>expect(location.hash).toBe('#/library/global'));expect(setup).not.toHaveBeenCalled();
});
it.each([false,true])('configured machine boots only with setup intent (%s)',async intent=>{
 const b=backend(),ctx={writtenAt:launch.writtenAt,...(intent?{intent:'setup' as const}:{})},base=await b.status();
 if(!base.ok||!base.value.teams[0])throw new Error('Expected a configured mock team');
 vi.spyOn(b,'status').mockResolvedValue({ok:true,value:{...base.value,teams:[base.value.teams[0]]}});
 vi.mocked(b.launchContext).mockResolvedValue(ctx);vi.mocked(b.refreshLaunch).mockResolvedValue(ctx);
 const setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:true,value:{role:'creator',team:'team',steps:{}}})));
 open(b);await waitFor(()=>expect(location.hash).toBe(intent?'#/onboarding/boot':'#/library/global'));
 if(intent){await screen.findByRole('heading',{name:'Setup finished'});expect(setup).toHaveBeenCalledExactlyOnceWith({offerConnect:true});}
 else expect(setup).not.toHaveBeenCalled();
});
it('requires an explicit select choice and renders a consumed join hand-off',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  const choice=await ctx.ask('select','Create a team or join one?',{choices:['Create a new team','Join an existing team']});
  expect(choice).toBe('Join an existing team');ctx.print('Ask the team owner to invite you.');
  return {ok:true,value:{role:'joiner',team:'',steps:{team:'printed'}}};
 }));
 open(b);const dialog=await screen.findByRole('dialog'),select=within(dialog).getByRole('combobox');
 expect(select).toHaveValue('');expect(within(dialog).getByRole('option',{name:'Choose…'})).toBeDisabled();
 expect(within(dialog).getByRole('button',{name:'Continue'})).toBeDisabled();
 fireEvent.change(select,{target:{value:'Join an existing team'}});fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));
 await screen.findByRole('heading',{name:'Ask your team owner to invite you'});
 expect(screen.queryByText('Setup finished')).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();
 expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
 expect(screen.getByRole('button',{name:'Back to the Library'})).toBeInTheDocument();
});
it('select Cancel is a typed cancellation with Retry and no failure styling',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  await ctx.ask('select','Create a team or join one?',{choices:['Create','Join']});return {ok:true,value:{role:'creator',team:'team',steps:{}}};
 }));
 open(b);fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Cancel'}));
 await screen.findByRole('heading',{name:'Setup cancelled'});
 expect(existingSetupSession(b,launch)?.snapshot().result).toMatchObject({ok:false,cancelled:true});
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('progressbar')).not.toHaveAttribute('data-failed');
 expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();
 expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
});
it('Retry starts a second attempt after a failure',async()=>{
 const b=backend(),setup=vi.spyOn(b,'setup').mockImplementationOnce(()=>createRun(async()=>({ok:false,error:'Try again.'}))).mockImplementationOnce(()=>createRun(async()=>({ok:true,value:{role:'creator',team:'team',steps:{}}})));
 open(b);await screen.findByRole('heading',{name:"Couldn't finish setup"});
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByRole('heading',{name:'Setup finished'});
 expect(setup).toHaveBeenCalledTimes(2);expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
});
it('Stop cancels the run and settles as cancelled',async()=>{
 const b=backend(),run=createRun<import('../../backend/types').SetupResult>(async()=>new Promise(()=>{})),cancel=vi.spyOn(run,'cancel');
 vi.spyOn(b,'setup').mockReturnValue(run);open(b);
 fireEvent.click(await screen.findByRole('button',{name:'Stop'}));await screen.findByRole('heading',{name:'Setup cancelled'});
 expect(cancel).toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();
 expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
});

it.each([false,true])('manual Start setup works regardless of consumption (file=%s)',async hasFile=>{
 const b=backend(),ctx=hasFile?launch:null;
 vi.mocked(b.launchContext).mockResolvedValue(ctx);vi.mocked(b.refreshLaunch).mockResolvedValue(ctx);
 b.prefs.set('launch:consumedWrittenAt',launch.writtenAt);
 const set=vi.spyOn(b.prefs,'set'),setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:true,value:{role:'creator',team:'team',steps:{}}})));
 open(b,'#/onboarding/boot?start=1');await screen.findByRole('heading',{name:'Setup finished'});
 expect(setup).toHaveBeenCalledExactlyOnceWith({...hasFile?{target:launch.target}:{},offerConnect:true});
 if(!hasFile)expect(set.mock.calls.filter(([key])=>key==='launch:consumedWrittenAt')).toEqual([]);
});
it('Back leaves an unconsumed failure on Library until an explicit retry or new request',async()=>{
 const b=backend(),setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:false,error:'Not ready.'})));
 open(b);await screen.findByRole('heading',{name:"Couldn't finish setup"});
 fireEvent.click(screen.getByRole('button',{name:'Back'}));await screen.findByText('15 skills');
 expect(location.hash).toBe('#/library/global');expect(setup).toHaveBeenCalledTimes(1);
});
