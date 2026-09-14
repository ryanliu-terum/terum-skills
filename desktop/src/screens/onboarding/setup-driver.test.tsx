import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { BackendContext, existingSetupSession, SETUP_STEP_TO_BOARD } from '../../backend';
import { SETUP_STEP_KEYS } from '../../backend/types';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
const launch={target:'https://github.com/terum/team-skills.git',writtenAt:'2026-09-08T12:00:00Z'};
afterEach(()=>{cleanup();localStorage.clear();location.hash='';vi.restoreAllMocks();});
function backend(){const b=createMockBackend();vi.spyOn(b,'launchContext').mockResolvedValue(launch);vi.spyOn(b,'refreshLaunch').mockResolvedValue(launch);return b;}
function open(b:ReturnType<typeof backend>,route='#/'){location.hash=route;return render(<StrictMode><Providers><BackendContext value={b}><App/></BackendContext></Providers></StrictMode>);}
it('maps every reached CLI step to one of the six drawn tour steps',()=>{
 expect(Object.keys(SETUP_STEP_TO_BOARD)).toEqual(SETUP_STEP_KEYS);
 // Cross-mirror overlays spec §4.6: the `existing` step has its own board, `Your skills` (oracle owed — FIDELITY.md).
 expect(new Set(Object.values(SETUP_STEP_TO_BOARD))).toEqual(new Set(['Welcome','Style','Team','Feedback','Done','Your skills']));
});
it('routes a fresh target to Boot, waits for the human, renders prints/progress, and consumes a typed decline once',async()=>{
 const b=backend(),answered=vi.fn(),set=vi.spyOn(b.prefs,'set');
 const setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print('GitHub CLI is installed but logged out. Run gh auth login in a terminal.');ctx.progress(2,4,'Fetching team');
  answered(await ctx.ask('confirm','Join this team?'));
  return {ok:false,error:'Join was declined.',cancelled:true,value:{team:'',role:'joiner',steps:{welcome:'printed',app:'skipped',github:'done'}}};
 }));
 const view=open(b);const dialog=await screen.findByRole('dialog');
 expect(location.hash).toBe('#/onboarding/boot');expect(setup).toHaveBeenCalledTimes(1);expect(setup).toHaveBeenCalledWith({target:launch.target});
 expect(answered).not.toHaveBeenCalled();expect(b.prefs.get('launch:consumedWrittenAt','')).toBe('');
 expect(screen.getByLabelText('Setup output')).toHaveTextContent('GitHub CLI is installed but logged out.');
 expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','2');expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax','4');
 fireEvent.click(within(dialog).getByRole('button',{name:'No'}));
 await waitFor(()=>expect(answered).toHaveBeenCalledWith(false));await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 expect(existingSetupSession(b,launch)?.snapshot()).toMatchObject({outcome:'cancelled',result:{ok:false,error:'Join was declined.',cancelled:true}});
 expect(set.mock.calls.filter(([key])=>key==='launch:consumedWrittenAt')).toEqual([['launch:consumedWrittenAt',launch.writtenAt]]);
 view.unmount();open(b);await waitFor(()=>expect(location.hash).toBe('#/library/global'));expect(setup).toHaveBeenCalledTimes(1);
});
it('uses five result-driven rows without inventing a progress counter',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print('Repository: https://github.com/terum/team-skills.git');return {ok:true,value:{team:'team',role:'joiner',steps:{github:'done',team:'done',hook:'skipped',wrapper:'skipped',done:'printed'}}};
 }));
 const view=open(b);await screen.findByRole('heading',{name:'Setup finished'});expect(view.container.querySelectorAll('.onboarding-progress-row')).toHaveLength(5);
 expect(screen.queryByLabelText('Onboarding progress')).toBeNull();expect(screen.getByRole('progressbar',{name:'Setup progress'})).not.toHaveAttribute('aria-valuenow');expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuemax');
 expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
});
it('opens the Your skills board after frame setup prints the existing-skill summary',async()=>{
 const b=backend(),list=vi.spyOn(b.reconcile,'list');
 vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print('Checking your library against the team…');
  ctx.print("1 of your skills match the team's exactly; 1 share a name with a team skill but differ.");
  return {ok:true,value:{team:'team',role:'joiner',steps:{projects:'skipped',existing:'printed',evals:'skipped'}}};
 }));
 open(b);
 expect(await screen.findByRole('dialog',{name:'Your skills'})).toBeInTheDocument();
 expect(SETUP_STEP_TO_BOARD.existing).toBe('Your skills');
 expect(list).toHaveBeenCalled();
 // The dialog is modal over the onboarding screen; dismissing it must actually close it (the list query keeps its cached data).
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Your skills'})).toBeNull());
});
it('consumes an ordinary setup failure and renders the CLI line as an error',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:false,error:'Could not read the team.'})));
 open(b);expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the team.');expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
});
it('boots a zero-team machine from an unconsumed target-less context',async()=>{
 const b=backend(),base=await b.status(),ctx={writtenAt:launch.writtenAt};
 if(!base.ok)throw new Error('Expected mock status');
 vi.spyOn(b,'status').mockResolvedValue({ok:true,value:{...base.value,teams:[]}});
 vi.mocked(b.launchContext).mockResolvedValue(ctx);vi.mocked(b.refreshLaunch).mockResolvedValue(ctx);
 const setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:true,value:{role:'creator',team:'team',steps:{}}})));
 open(b);await screen.findByRole('heading',{name:'Setup finished'});
 expect(location.hash).toBe('#/onboarding/boot');expect(setup).toHaveBeenCalledExactlyOnceWith({});
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
 if(intent){await screen.findByRole('heading',{name:'Setup finished'});expect(setup).toHaveBeenCalledExactlyOnceWith({});}
 else expect(setup).not.toHaveBeenCalled();
});
it('requires an explicit select choice and renders a consumed join hand-off',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  const choice=await ctx.ask('select','Create a team or join one?',{choices:['Create a new team','Join an existing team']});
  expect(choice).toBe('Join an existing team');ctx.print('Ask the team owner to invite you.');
  return {ok:true,value:{role:'joiner',team:'',steps:{team:'printed'}}};
 }));
 open(b);const dialog=await screen.findByRole('dialog'),select=within(dialog).getByRole('radio',{name:'Join an existing team'});
 expect(select).not.toBeChecked();expect(within(dialog).getAllByRole('radio')).toHaveLength(2);
 expect(within(dialog).getByRole('button',{name:'Continue'})).toBeDisabled();
 fireEvent.click(select);fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));
 // The hand-off no longer asserts the person was never invited: an accepted invitation leaves nothing
 // pending, so the screen asks for the repository it still needs instead of sending them to their owner.
 await screen.findByRole('heading',{name:'Join an existing team'});
 expect(screen.queryByText('Setup finished')).toBeNull();
 expect(screen.getByLabelText('Team repository')).toBeInTheDocument();
 expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
 expect(screen.getByRole('button',{name:'Join'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Back to the Library'})).toBeInTheDocument();
});
it('select Cancel is a typed cancellation consumed before navigation',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  await ctx.ask('select','Create a team or join one?',{choices:['Create','Join']});return {ok:true,value:{role:'creator',team:'team',steps:{}}};
 }));
 open(b);fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 expect(existingSetupSession(b,launch)?.snapshot()).toMatchObject({outcome:'cancelled',result:{ok:false,cancelled:true}});
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
 await waitFor(()=>expect(b.setup).toHaveBeenCalledTimes(1));
 fireEvent.click(await screen.findByRole('button',{name:'Stop'}));await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 expect(cancel).toHaveBeenCalled();expect(existingSetupSession(b,launch)?.snapshot()).toMatchObject({outcome:'cancelled',result:{ok:false,cancelled:true}});
 expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
});

it.each([false,true])('manual Start setup works regardless of consumption (file=%s)',async hasFile=>{
 const b=backend(),ctx=hasFile?launch:null;
 vi.mocked(b.launchContext).mockResolvedValue(ctx);vi.mocked(b.refreshLaunch).mockResolvedValue(ctx);
 b.prefs.set('launch:consumedWrittenAt',launch.writtenAt);
 const set=vi.spyOn(b.prefs,'set'),setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:true,value:{role:'creator',team:'team',steps:{}}})));
 open(b,'#/onboarding/boot?start=1');await screen.findByRole('heading',{name:'Setup finished'});
 expect(setup).toHaveBeenCalledExactlyOnceWith({...hasFile?{target:launch.target}:{}});
 if(!hasFile)expect(set.mock.calls.filter(([key])=>key==='launch:consumedWrittenAt')).toEqual([]);
});
// The case the test above never reached: it opens on a fresh backend, so no PRIOR session exists. With a
// cancelled one for the same writtenAt, the navigate-on-cancelled effect used to fire with the outcome read
// before retry() flipped it back to running, and the whole wizard then ran unseen behind the Library.
it('restarting a cancelled session shows the run instead of bouncing to the Library',async()=>{
 const b=backend();let attempt=0;
 vi.spyOn(b,'setup').mockImplementation(()=>{attempt++;return attempt===1?createRun<import('../../backend/types').SetupResult>(async()=>new Promise(()=>{})):createRun(async()=>({ok:true,value:{role:'creator',team:'team',steps:{github:'done'}}}));});
 const first=open(b);
 fireEvent.click(await screen.findByRole('button',{name:'Stop'}));
 await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 expect(existingSetupSession(b,launch)?.snapshot().outcome).toBe('cancelled');
 first.unmount();
 open(b,'#/onboarding/boot?start=1');
 await screen.findByRole('heading',{name:'Setup finished'});
 expect(location.hash).toBe('#/onboarding/boot?start=1');
 expect(attempt).toBe(2);
});
// Stop on a restarted screen is a live state, not the dead branch it looked like: it stays put and offers
// Retry, because the guard above is what keeps the screen mounted.
it('Stop on a restarted screen stays put and offers Retry',async()=>{
 const b=backend();
 vi.spyOn(b,'setup').mockImplementation(()=>createRun<import('../../backend/types').SetupResult>(async()=>new Promise(()=>{})));
 const first=open(b);
 fireEvent.click(await screen.findByRole('button',{name:'Stop'}));
 await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 first.unmount();
 open(b,'#/onboarding/boot?start=1');
 fireEvent.click(await screen.findByRole('button',{name:'Stop'}));
 expect(await screen.findByRole('heading',{name:'Setup cancelled'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();
 expect(location.hash).toBe('#/onboarding/boot?start=1');
});
it('Back leaves an unconsumed failure on Library until an explicit retry or new request',async()=>{
 const b=backend(),setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:false,error:'Not ready.'})));
 open(b);await screen.findByRole('heading',{name:"Couldn't finish setup"});
 fireEvent.click(screen.getByRole('button',{name:'Back'}));await screen.findByText('15 skills');
 expect(location.hash).toBe('#/library/global');expect(setup).toHaveBeenCalledTimes(1);
});

it.each([false,true])('refuses a foreign target before setup and offers Team settings (flush fails=%s)',async flushFails=>{
 const b=backend(),ctx={...launch,target:'github.com/other/repo'},base=await b.status();
 if(!base.ok||!base.value.teams[0])throw new Error('Expected mock team');
 const name=base.value.teams[0].name;
 vi.mocked(b.launchContext).mockResolvedValue(ctx);vi.mocked(b.refreshLaunch).mockResolvedValue(ctx);
 if(flushFails)b.prefs.flush=async()=>{throw new Error('Preferences could not be saved.');};
 const setup=vi.spyOn(b,'setup');open(b);
 await screen.findByRole('heading',{name:'Setup not started'});
 if(flushFails)expect(screen.getByText('Preferences could not be saved.')).toBeInTheDocument();
 expect(screen.getByRole('status')).toHaveTextContent(`This machine is on team ${name}. To join github.com/other/repo, leave ${name} first (Settings ▸ Team).`);
 if(flushFails)expect(screen.getByRole('alert')).toHaveTextContent('Preferences could not be saved.');
 else expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByRole('progressbar')).not.toHaveAttribute('data-failed');
 expect(setup).not.toHaveBeenCalled();expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(ctx.writtenAt);
 expect(existingSetupSession(b,ctx)?.snapshot().outcome).toBe('refused');
 expect(screen.queryByRole('button',{name:'Back'})).toBeNull();expect(location.hash).toBe('#/onboarding/boot');
 fireEvent.click(screen.getByRole('button',{name:'Open Settings ▸ Team'}));await waitFor(()=>expect(location.hash).toBe('#/settings/teams'));
});
it('lets the CLI decide when target pre-flight status fails',async()=>{
 const b=backend();vi.spyOn(b,'status').mockResolvedValue({ok:false,error:'Status unavailable.'});
 const setup=vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:true,value:{role:'joiner',team:'team',steps:{}}})));
 open(b);await screen.findByRole('heading',{name:'Setup finished'});
 expect(setup).toHaveBeenCalledExactlyOnceWith({target:launch.target});
});
it('consumes a CLI refusal and keeps its outcome distinct from failure',async()=>{
 const b=backend();vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:false,error:'CLI refused this setup.',refused:true})));
 open(b);await screen.findByRole('heading',{name:'Setup not started'});
 expect(screen.getByRole('status')).toHaveTextContent('CLI refused this setup.');expect(screen.queryByRole('alert')).toBeNull();
 expect(existingSetupSession(b,launch)?.snapshot().outcome).toBe('refused');expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);
});
it('waits for cancellation consumption to flush before navigating',async()=>{
 const b=backend();let flush!:()=>void;
 b.prefs.flush=vi.fn(()=>new Promise<void>(resolve=>{flush=resolve;}));
 vi.spyOn(b,'setup').mockImplementation(()=>createRun(async()=>({ok:false,error:'Declined.',cancelled:true})));
 open(b);await waitFor(()=>expect(b.prefs.flush).toHaveBeenCalledTimes(1));
 expect(b.prefs.get('launch:consumedWrittenAt','')).toBe(launch.writtenAt);expect(location.hash).toBe('#/onboarding/boot');
 flush();await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 expect(existingSetupSession(b,launch)?.snapshot().outcome).toBe('cancelled');
});

it('uses identity ask detail for the dialog and the active team cue without transcript output',async()=>{
 const b=backend(),detail=['Identity: @seed — Seed <seed@example.com> (GitHub: seed)'];
 vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  await ctx.ask('confirm','Use this identity?',{detail});return {ok:true,value:{role:'joiner',team:'team',steps:{team:'done'}}};
 }));
 open(b);const dialog=await screen.findByRole('dialog');
 expect(dialog).toHaveTextContent(detail[0]!);
 expect(screen.getByText('Configuring the team').parentElement).toHaveAttribute('data-state','current');
 expect(screen.getByLabelText('Setup output')).not.toHaveTextContent('Identity:');
 fireEvent.click(within(dialog).getByRole('button',{name:'Yes'}));await screen.findByRole('heading',{name:'Setup finished'});
});

// A progress frame whose label names a drawn row folds into that row rather than adding a seventh.
// `projects` is the row to test it with: the "n of m" counter is deliberately evals-only (SetupBoot:27),
// so a non-evals known row proves the fold without the counter coming along.
it('folds a known progress label into its row instead of adding a seventh',async()=>{
 const b=backend();let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
 vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  // The step's own opening line, which printedSetupStep maps to `projects` — that is what makes the row current.
  ctx.print("Terum will track the skills in that project's .claude folder.");ctx.progress(12,12,'projects');await pending;
  return {ok:true,value:{team:'t',role:'creator',steps:{projects:'done'}}};
 }));
 const view=open(b);await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Adding a project to your library'));
 expect(view.container.querySelectorAll('.onboarding-progress-row')).toHaveLength(5);
 expect([...view.container.querySelectorAll('.onboarding-progress-row')].find(row=>row.textContent?.includes('Adding a project to your library'))).toHaveAttribute('data-state','current');
 expect(screen.getByRole('status')).not.toHaveTextContent(/^projects$/);expect(view.container.querySelector('.onboarding-progress-row[data-state="current"]>span:last-child')).not.toHaveTextContent('12 of 12');
 await act(async()=>finish());await screen.findByRole('heading',{name:'Setup finished'});
});
it('still shows an unknown progress label as its own row',async()=>{
 const b=backend();let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
 vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{ctx.progress(1,2,'placing');await pending;return {ok:true,value:{team:'t',role:'creator',steps:{}}};}));
 const view=open(b);await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('placing'));
 const rows=view.container.querySelectorAll('.onboarding-progress-row');expect(rows).toHaveLength(6);expect(rows[5]).toHaveTextContent('placing');
 await act(async()=>finish());await screen.findByRole('heading',{name:'Setup finished'});
});

it('shows eval progress and settle colors, clears progress at a check-in, and completes queued work',async()=>{
 const b=backend();let advance!:()=>void;const gate=new Promise<void>(resolve=>{advance=resolve;});
 vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print('Evaluating 2 skills, 4 at a time…');ctx.print('✓ deploy-check');ctx.progress(1,2,'evals');await gate;
  ctx.print('✗ release-notes: Hygiene failed for release-notes');ctx.progress(2,2,'evals');await ctx.ask('confirm','Continue with the next 2? (2 of 4 done, 2 left)');
  ctx.print('Queued 2 evals for later. Run them with `npx -y terum-skills@latest eval --drain`.');return {ok:true,value:{team:'t',role:'creator',steps:{evals:'queued'}}};
 }));
 open(b);const row=await screen.findByText('Evaluating shared skills');await waitFor(()=>expect(row.parentElement).toHaveTextContent('1 of 2'));
 expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','1');expect(screen.getByText('✓ deploy-check')).toHaveClass('setup-output-ok');
 await act(async()=>advance());const dialog=await screen.findByRole('dialog');expect(row.parentElement).not.toHaveTextContent('2 of 2');expect(screen.getByText('✗ release-notes: Hygiene failed for release-notes')).toHaveClass('setup-output-bad');
 fireEvent.click(within(dialog).getByRole('button',{name:'No'}));await screen.findByRole('heading',{name:'Setup finished'});expect(row.parentElement).toHaveAttribute('data-state','done');expect(row.parentElement).toHaveTextContent('Queued');
});
