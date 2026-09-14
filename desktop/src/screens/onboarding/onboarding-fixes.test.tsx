import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import { scriptedPrompter } from '../../backend/prompter';
import { useOnboardingStore } from './onboarding-store';

const launch={target:'https://github.com/terum/team-skills.git',writtenAt:'2026-09-08T12:00:00Z'};
function driven(){const b=createMockBackend();vi.spyOn(b,'launchContext').mockResolvedValue(launch);vi.spyOn(b,'refreshLaunch').mockResolvedValue(launch);return b;}
function open(b:ReturnType<typeof createMockBackend>,route='#/'){location.hash=route;return render(<Providers><BackendContext value={b}><App/></BackendContext></Providers>);}
const rows=(view:{container:HTMLElement})=>[...view.container.querySelectorAll('.onboarding-progress-row')];
const stateOf=(view:{container:HTMLElement},label:string)=>rows(view).find(row=>row.textContent?.includes(label))?.getAttribute('data-state');

beforeEach(()=>{localStorage.clear();useUiStore.setState({theme:'dark'});useUiStore.getState().setTheme('dark');useOnboardingStore.getState().setSkipped([]);});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});

// A blank answer takes the offered default, the way the terminal prompter does — otherwise setup resolves
// the empty string against its cwd and registers the wrong folder as a project.
it('resolves a blank or whitespace text answer to the offered default',async()=>{
 const p=scriptedPrompter({},async()=>'   ');
 expect(await p.text('Which folder?','/home/ada/work')).toBe('/home/ada/work');
 expect(await scriptedPrompter({},async()=>'')['text']('Which folder?','/home/ada/work')).toBe('/home/ada/work');
 expect(await scriptedPrompter({},async()=>'/typed')['text']('Which folder?','/home/ada/work')).toBe('/typed');
});
it('keeps a blank answer blank when the offered default is itself blank (invite skips)',async()=>{
 expect(await scriptedPrompter({},async()=>'').text('Invite teammates','')).toBe('');
});

// Only the finished run carries `steps`, so steps the wizard has already passed must be read from the
// active step; otherwise a five-minute setup draws every completed row as not-started.
it('marks passed steps done while the run is still going',async()=>{
 const b=driven();let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
 vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print('GitHub: gh is logged in.');
  ctx.print('Team acme is already configured on this machine.');
  ctx.print("Terum will track the skills in that project's .claude folder.");
  ctx.print('Evaluating 3 skills, 4 at a time…');
  await pending;
  return {ok:true,value:{role:'creator',team:'t',steps:{github:'done',team:'done',projects:'done',evals:'done',hook:'skipped',wrapper:'skipped'}}};
 }));
 const view=open(b);
 await waitFor(()=>expect(screen.getByLabelText('Setup output')).toHaveTextContent('Evaluating 3 skills'));
 expect(Object.fromEntries(['Checking GitHub access','Configuring the team','Adding a project to your library',
  'Evaluating shared skills','Offering the session hook and Claude Code skill'].map(label=>[label,stateOf(view,label)])))
  .toEqual({'Checking GitHub access':'done','Configuring the team':'done','Adding a project to your library':'done',
   'Evaluating shared skills':'current','Offering the session hook and Claude Code skill':'pending'});
 await act(async()=>{finish();await Promise.resolve();});
 await screen.findByRole('heading',{name:'Setup finished'});
 expect(new Set(rows(view).map(row=>row.getAttribute('data-state')))).toEqual(new Set(['done']));
});
it('leaves a step the wizard has not reached pending', async()=>{
 const b=driven();
 vi.spyOn(b,'setup').mockImplementation(()=>createRun(async ctx=>{ctx.print('GitHub: gh is logged in.');await new Promise(()=>{});return {ok:true,value:{role:'creator',team:'t',steps:{}}};}));
 const view=open(b);
 await waitFor(()=>expect(stateOf(view,'Checking GitHub access')).toBe('current'));
 expect(stateOf(view,'Configuring the team')).toBe('pending');
});

// `pick` is the record of what was chosen; dropping it on navigation reset the cards to System while the
// app stayed on the chosen theme.
it('keeps the chosen style selected after leaving and re-entering the step',async()=>{
 open(createMockBackend(),'#/onboarding/style');
 fireEvent.click(await screen.findByRole('radio',{name:'Light'}));
 await waitFor(()=>expect(useUiStore.getState().theme).toBe('light'));
 fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 await screen.findByRole('heading',{name:'The basics'});
 fireEvent.keyDown(document.body,{key:'Escape'});
 await screen.findByRole('heading',{name:'Choose your style'});
 expect(screen.getByRole('radio',{name:'Light'})).toHaveAttribute('aria-checked','true');
 expect(screen.getByRole('radio',{name:'System'})).toHaveAttribute('aria-checked','false');
});
it('honours a dark theme override the way it honours light',async()=>{
 open(createMockBackend(),'#/onboarding/style?theme=dark');
 expect(await screen.findByRole('radio',{name:'Dark'})).toHaveAttribute('aria-checked','true');
});

// An unreadable status is not a failed sync: it leaves `identity` undefined, which every use site renders around.
it('does not render the sync-failure board when only the status read fails',async()=>{
 const b=createMockBackend();
 vi.spyOn(b,'status').mockResolvedValue({ok:false,error:'Could not read status.'});
 open(b,'#/onboarding/welcome');
 expect(await screen.findByRole('heading',{name:/./})).not.toHaveTextContent("Couldn't sync");
 expect(screen.queryByRole('button',{name:'Continue offline'})).toBeNull();
});
