import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BackendContext } from '../../index';
import { browserPrefs } from '../../prefs';
import { createTauriBackend } from '../index';
import { fakeBridge, STATE } from './fake-bridge';
import { App } from '../../../app/App';
import { Providers } from '../../../app/providers';
const directory=resolve('../.planning/codex-runs/m7-S7r/frames');
const recorded=(name:string)=>readFileSync(resolve(directory,name+'.jsonl'),'utf8').trim().split('\n');
afterEach(()=>{cleanup();localStorage.clear();location.hash='';});
it('replays the real setup recording through launch routing, the ask dialog, and the partial result',async()=>{
 const lines=recorded('setup'),askIndex=lines.findIndex(line=>(JSON.parse(line) as {t:string}).t==='ask');
 const target='/fixture/team.git';
 const fake=fakeBridge((args,emit)=>{
  const selected=args[0]==='setup'?lines.slice(0,askIndex+1):recorded(args[0]==='ls'?'ls-local':'status');
  for(const line of selected)emit({kind:'stdout',line});
 },{...STATE,target});
 const original=fake.bridge.write;
 fake.bridge.write=async(id,line)=>{await original(id,line);for(const tail of lines.slice(askIndex+1))fake.emit({kind:'stdout',line:tail});};
 const backend={...createTauriBackend(fake.bridge),prefs:browserPrefs()};
 location.hash='#/';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 const dialog=await screen.findByRole('dialog');expect(dialog).toHaveTextContent('Use this identity?');expect(fake.writes).toEqual([]);
 expect(location.hash).toBe('#/onboarding/boot');expect(fake.spawns.filter(spawn=>spawn.args[0]==='setup').map(spawn=>spawn.args)).toEqual([['setup','--',target]]);
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
 // This CLI recording is an ordinary stdin-ended failure, not a typed decline. Never infer consent semantics from English.
 expect(await screen.findByRole('alert')).toHaveTextContent('Input ended before "Use this identity?" was answered.');
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe('');expect(screen.getByText('Checking GitHub access').parentElement).toHaveAttribute('data-state','done');
});
it('replays the real offline setup join: the human answers each ask, the card settles finished, the target is consumed once',async()=>{
 // Recorded from the rebuilt CLI against the fixture (fixture.sh): identity confirmed, the invitation left blank, the hook and skill offers declined.
 const lines=recorded('setup-join'),segments:string[][]=[[]];
 for(const line of lines){segments[segments.length-1]!.push(line);if((JSON.parse(line) as {t:string}).t==='ask')segments.push([]);}
 const target='/fixture/team.git';let next=1;
 const fake=fakeBridge((args,emit)=>{const selected=args[0]==='setup'?segments[0]!:recorded(args[0]==='ls'?'ls-local':'status');for(const line of selected)emit({kind:'stdout',line});},{...STATE,target});
 const original=fake.bridge.write;
 fake.bridge.write=async(id,line)=>{await original(id,line);for(const tail of segments[next++]??[])fake.emit({kind:'stdout',line:tail});};
 const backend={...createTauriBackend(fake.bridge),prefs:browserPrefs()};
 location.hash='#/';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 for(const [question,button] of [['Use this identity?','Confirm'],['session-start hook','Cancel'],['/terum-skills Claude Code skill','Cancel']] as const){
  const dialog=await screen.findByRole('dialog');expect(dialog).toHaveTextContent(question);
  fireEvent.click(within(dialog).getByRole('button',{name:button}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 }
 expect(fake.writes.map(write=>(JSON.parse(write) as {value:unknown}).value)).toEqual([true,false,false]);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Setup finished.'));
 expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByText('Configuring the team').parentElement).toHaveAttribute('data-state','done');
 expect(screen.getByText('Offering the session hook and Claude Code skill').parentElement).toHaveTextContent('Skipped');
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe(STATE.writtenAt);
 expect(fake.spawns.filter(spawn=>spawn.args[0]==='setup')).toHaveLength(1);
});
it.each(['#/inbox','#/inbox/missing','#/onboarding/welcome'])('hides an unserved real surface at %s',async route=>{
 const fake=fakeBridge((args,emit)=>{for(const line of recorded(args[0]==='ls'?'ls-local':'status'))emit({kind:'stdout',line});});
 const backend={...createTauriBackend(fake.bridge),prefs:browserPrefs()};
 expect((await backend.surfaces()).inbox).toBe(false);expect((await backend.inbox()).ok).toBe(false);
 location.hash=route;render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 await waitFor(()=>expect(location.hash).toBe('#/library/global'));
 expect(screen.queryByRole('link',{name:'Inbox'})).toBeNull();expect(screen.queryByLabelText('Inbox items')).toBeNull();expect(screen.queryByLabelText('Inbox report')).toBeNull();
});
it('counts ledger placements by scope rather than local inventory rows',async()=>{
 const fake=fakeBridge((args,emit)=>{
  for(const line of recorded(args[0]==='ls'?'ls-local':'status')){
   const frame=JSON.parse(line) as {t:string;value?:{ledger:{placements:unknown[]}}};
   if(args[0]==='status'&&frame.t==='result'&&frame.value)frame.value.ledger.placements.push({path:'/project/.claude/skills/a',id:'a',team:'acme',version:null,scope:{kind:'project',project:'docs'},placed_at:'2026-09-06T00:00:00Z'});
   emit({kind:'stdout',line:JSON.stringify(frame)});
  }
 });
 const backend=createTauriBackend(fake.bridge),status=await backend.status(),settings=await backend.settings();
 expect(status.value?.counts).toEqual({Global:'1',docs:'1'});expect(status.value?.ledger?.placements).toHaveLength(2);
 expect(settings.value?.PLACEMENTS_N).toBe(2);expect(settings.value?.PINNED_N).toBe(1);expect(settings.value?.PLACEMENTS[1]?.[3]).toBeNull();
});

const firstRunDirectory=resolve('../.planning/codex-runs/first-run-in-app/frames');
const firstRunRecording=(name:string)=>readFileSync(resolve(firstRunDirectory,name+'.jsonl'),'utf8').trim().split('\n');
function firstRunReplay(name:string,state:typeof STATE,configured=false){
 const lines=firstRunRecording(name),segments:string[][]=[[]];
 for(const line of lines){segments[segments.length-1]!.push(line);if((JSON.parse(line) as {t:string}).t==='ask')segments.push([]);}
 let next=1;
 const fake=fakeBridge((args,emit)=>{
  const selected=args[0]==='setup'?segments[0]!:args[0]==='ls'?recorded('ls-local'):configured?recorded('status'):firstRunRecording('status-zero');
  for(const line of selected)emit({kind:'stdout',line});
 },state);
 const original=fake.bridge.write;
 fake.bridge.write=async(id,line)=>{await original(id,line);for(const tail of segments[next++]??[])fake.emit({kind:'stdout',line:tail});};
 const backend={...createTauriBackend(fake.bridge),prefs:browserPrefs()};
 location.hash='#/';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 return {fake,backend};
}
it('replays zero-team startup and the no-default Create fork, preserving the recorded ordinary failure',async()=>{
 const {fake,backend}=firstRunReplay('setup-create-fork',{...STATE});
 const dialog=await screen.findByRole('dialog',{name:'Create a team or join one?'});
 expect(location.hash).toBe('#/onboarding/boot');
 expect(within(dialog).getByRole('combobox')).toHaveValue('');expect(within(dialog).getByRole('button',{name:'Continue'})).toBeDisabled();
 fireEvent.change(within(dialog).getByRole('combobox'),{target:{value:'Create a new team'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));
 const team=await screen.findByRole('dialog',{name:'Team name'});
 // Advance to the recorded stdin-ended tail, which is an ordinary failure at this CLI revision.
 fireEvent.click(within(team).getByRole('button',{name:'Continue'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Input ended before "Team name" was answered.');
 expect(screen.getByRole('heading',{name:"Couldn't finish setup"})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe('');
 expect(fake.spawns.filter(spawn=>spawn.args[0]==='setup').map(spawn=>spawn.args)).toEqual([['setup']]);
});
it('replays the target-less Join hand-off and consumes the successful request',async()=>{
 const {fake,backend}=firstRunReplay('setup-join-handoff',{...STATE,intent:'setup'});
 const dialog=await screen.findByRole('dialog',{name:'Create a team or join one?'});
 fireEvent.change(within(dialog).getByRole('combobox'),{target:{value:'Join an existing team'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));
 await screen.findByRole('heading',{name:'Ask your team owner to invite you'});
 const output=screen.getByLabelText('Setup output');expect(output.children).toHaveLength(5);
 for(const line of ['Ask the team owner to invite you, then run the command they send you.','It may look like:','npx -y terum-skills@latest setup <org>/<repo>',"If you already have access, use that setup command with your team's repository.",'No changes were made.'])expect(output).toHaveTextContent(line);
 expect(screen.queryByText('Setup finished')).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe(STATE.writtenAt);
 expect(fake.spawns.filter(spawn=>spawn.args[0]==='setup').map(spawn=>spawn.args)).toEqual([['setup']]);
});
it('replays configured-machine resume because setup intent wins over the existing team',async()=>{
 const {fake,backend}=firstRunReplay('setup-resume',{...STATE,intent:'setup'},true);
 const invite=await screen.findByRole('dialog');expect(invite).toHaveTextContent('Invite teammates');
 expect(location.hash).toBe('#/onboarding/boot');fireEvent.click(within(invite).getByRole('button',{name:'Continue'}));
 const hook=await screen.findByRole('dialog',{name:/Install the Claude Code session-start hook/});fireEvent.click(within(hook).getByRole('button',{name:'Cancel'}));
 const skill=await screen.findByRole('dialog',{name:/Install the \/terum-skills Claude Code skill/});fireEvent.click(within(skill).getByRole('button',{name:'Cancel'}));
 await screen.findByRole('heading',{name:'Setup finished'});
 expect(fake.writes.map(line=>(JSON.parse(line) as {value:unknown}).value)).toEqual(['',false,false]);
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe(STATE.writtenAt);
});
