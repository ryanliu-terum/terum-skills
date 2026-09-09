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
