import { expect, it, vi } from 'vitest';
import { runEvalBatch } from '../batch.js';
import { ScriptedPrompter } from '../../__tests__/fixtures.js';
import { success, failure } from '../../result.js';
import type { EvalResult } from '../../../commands/eval.js';
const items=Array.from({length:8},(_,i)=>({id:String(i),name:`skill-${i}`,version:'a'.repeat(40)}));
const result=():EvalResult=>({team:'t',id:'id',name:'n',runDir:'r',ccVersion:'c',executionStatus:'complete'});
it('keeps four in flight, survives thrown and returned failures, and emits one progress frame per settle',async()=>{
 const io=new ScriptedPrompter();const progress=vi.fn();let active=0,peak=0;const gates:(()=>void)[]=[];
 const running=runEvalBatch({items,parallel:4,io:{...io,print:io.print.bind(io),confirm:io.confirm.bind(io),text:io.text.bind(io),select:io.select.bind(io),progress},run:async item=>{peak=Math.max(peak,++active);await new Promise<void>(resolve=>gates.push(resolve));active--;if(item.id==='1')throw new Error('rate limit');return item.id==='2'?failure('bad'):success(result());}});
 expect(gates).toHaveLength(4);for(const gate of gates.splice(0))gate();await vi.waitFor(()=>expect(gates).toHaveLength(4));for(const gate of gates)gate();
 const outcome=await running;expect(peak).toBe(4);expect(outcome).toMatchObject({ok:6,failed:2});expect(outcome.outcomes[1]).toEqual(failure('rate limit'));
 expect(progress.mock.calls.map(([frame])=>frame)).toEqual(Array.from({length:8},(_,i)=>({step:'evals',current:i+1,total:8})));
});
it('flushes concurrent print buffers as contiguous blocks and drops inner progress',async()=>{
 const io=new ScriptedPrompter();const progress=vi.fn();const outer=Object.assign(io,{progress});
 await runEvalBatch({items:items.slice(0,2),parallel:2,io:outer,run:async(item,captured)=>{captured.print(`${item.name} first`);await Promise.resolve();captured.progress?.({step:'inner'});captured.print(`${item.name} last`);return success(result());}});
 for(const item of items.slice(0,2)){const start=io.lines.indexOf(`── ${item.name} ──`);expect(io.lines.slice(start,start+4)).toEqual([`── ${item.name} ──`,`${item.name} first`,`${item.name} last`,`✓ ${item.name}`]);}
 expect(progress).toHaveBeenCalledTimes(2);
});
it('flushes context before a question and serializes all three question kinds',async()=>{
 const io=new ScriptedPrompter([],[],true);const asks:string[]=[];const answers:(()=>void)[]=[];
 io.confirm=async question=>{asks.push(question);await new Promise<void>(resolve=>answers.push(resolve));return true;};
 io.text=async question=>{asks.push(question);await new Promise<void>(resolve=>answers.push(resolve));return 'text';};
 io.select=async question=>{asks.push(question);await new Promise<void>(resolve=>answers.push(resolve));return 'choice';};
 const running=runEvalBatch({items:items.slice(0,3),parallel:3,io,run:async(item,captured)=>{expect(captured.interactive).toBe(true);captured.print(item.name);if(item.id==='0')await captured.confirm('first');else if(item.id==='1')await captured.text('second');else await captured.select('third',['choice']);return success(result());}});
 await vi.waitFor(()=>expect(asks).toEqual(['first']));expect(io.lines.slice(-2)).toEqual(['── skill-0 ──','skill-0']);answers.shift()!();
 await vi.waitFor(()=>expect(asks).toEqual(['first','second']));answers.shift()!();await vi.waitFor(()=>expect(asks).toEqual(['first','second','third']));answers.shift()!();expect((await running).ok).toBe(3);
});
it('keeps starting queued evals while completed siblings wait behind an unanswered question',async()=>{
 const io=Object.assign(new ScriptedPrompter([],[],true),{channel:'frames' as const});let answer!:()=>void;const asked=vi.fn();const started:string[]=[];
 io.confirm=async()=>{asked();await new Promise<void>(resolve=>{answer=resolve;});return true;};
 const running=runEvalBatch({items,parallel:4,io,run:async(item,captured)=>{expect(captured.channel).toBe('frames');started.push(item.id);if(item.id==='0'){captured.print('Commit context');await captured.confirm('Commit?');}return success(result());}});
 await vi.waitFor(()=>expect(asked).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(started).toHaveLength(8));expect(io.lines).toEqual(['── skill-0 ──','Commit context']);answer();expect((await running).ok).toBe(8);
});
it('preserves multiline failure remediation and never lets an observer change a committed success',async()=>{
 const io=new ScriptedPrompter();const observed=vi.fn(()=>{throw new Error('observer unavailable');});
 const outcome=await runEvalBatch({items:items.slice(0,2),parallel:2,io,onSettled:observed,run:async item=>item.id==='0'?success(result()):failure('Push refused\nRun gh auth login\nThen retry the push')});
 expect(outcome.ok).toBe(1);expect(outcome.outcomes[0]).toEqual(success(result()));expect(observed).toHaveBeenCalledTimes(2);
 const start=io.lines.indexOf('── skill-1 ──');expect(io.lines.slice(start,start+5)).toEqual(['── skill-1 ──','Completion observer failed: observer unavailable','Run gh auth login','Then retry the push','✗ skill-1: Push refused']);
});
