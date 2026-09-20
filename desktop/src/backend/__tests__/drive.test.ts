import { expect,it,vi } from 'vitest';
import { createRun } from '../mock/run';
import { driveRun } from '../drive';
import { PromptCancelledError } from '../types';
it('answers a pre-answered ask and resolves done',async()=>{const run=createRun(async ctx=>({ok:true,value:await ctx.ask('confirm','Approve?')}));const unexpected=vi.fn();expect(await driveRun(run,{'Approve?':true},unexpected)).toEqual({ok:true,value:true});expect(unexpected).not.toHaveBeenCalled();});
it('hands unknown questions to the prompt provider',async()=>{const run=createRun(async ctx=>({ok:true,value:await ctx.ask('text','Which path?')}));const unexpected=vi.fn().mockResolvedValue('skills/new');expect(await driveRun(run,{},unexpected)).toEqual({ok:true,value:'skills/new'});expect(unexpected).toHaveBeenCalledWith(expect.objectContaining({kind:'text',question:'Which path?'}),{signal:expect.any(AbortSignal)});});
it('cancels the run if the prompt provider rejects',async()=>{const run=createRun(async ctx=>({ok:true,value:await ctx.ask('text','Path?')}));expect(await driveRun(run,{},()=>Promise.reject(new Error('Cancelled.')))).toEqual({ok:false,error:'Cancelled.'});expect((await run.done).ok).toBe(false);});
it('does not conceal backend failures',async()=>{const run=createRun(async()=>({ok:false,error:'Cannot install.'}));expect(await driveRun(run,{},vi.fn())).toEqual({ok:false,error:'Cannot install.'});});

it.each(['confirm','text','select'] as const)('forwards %s detail and observes the full ask before answering',async kind=>{
 const question={kind,question:'Decide',detail:['Context','Tools'],...(kind==='select'?{choices:['a']}:kind==='text'?{default:'a'}:{})};
 const run=createRun(async ctx=>({ok:true,value:await ctx.ask(kind,question.question,question)}));
 const events:string[]=[];
 const onAsk=vi.fn(()=>{events.push('ask');});
 const unexpected=vi.fn(async()=>{events.push('answer');return kind==='confirm'?true:'a';});
 expect(await driveRun(run,{},unexpected,undefined,undefined,onAsk)).toEqual({ok:true,value:kind==='confirm'?true:'a'});
 expect(onAsk).toHaveBeenCalledExactlyOnceWith(question);
 // The question arrives with the run's signal (a question never outlives its run).
 expect(unexpected).toHaveBeenCalledExactlyOnceWith(question,{signal:expect.any(AbortSignal)});
 expect(events).toEqual(['ask','answer']);
});

// A question never outlives its run (2026-09-14 review): Stop during "Continue with the next batch?" used to leave the
// driver awaiting an answer forever (so the next eval was refused as "already running") and the dead question on screen.
it('withdraws a pending question when the run is cancelled and returns the run\'s own result',async()=>{
 const run=createRun(async ctx=>({ok:true,value:await ctx.ask('confirm','Continue with the next 1?')}));
 let signal:AbortSignal|undefined;
 const unexpected=vi.fn((_q:unknown,options?:{signal?:AbortSignal})=>new Promise<string|boolean>((_resolve,reject)=>{signal=options?.signal;signal?.addEventListener('abort',()=>reject(new PromptCancelledError('The run ended before this question was answered.')));}));
 const driven=driveRun(run,{},unexpected);
 await vi.waitFor(()=>expect(unexpected).toHaveBeenCalledOnce());
 expect(signal?.aborted).toBe(false);
 await run.cancel();
 const result=await driven;
 expect(signal?.aborted).toBe(true);
 expect(result.ok).toBe(false);
 expect(result).toEqual(await run.done);
});
it('a question the run finishes past is withdrawn too, and the finished result stands',async()=>{
 // The CLI asks, then completes without waiting for the answer (a crash or a timeout on its side).
 const run=createRun(async ctx=>{ctx.ask('confirm','Still there?').catch(()=>{ /* the run ends first; the mock rejects its own open ask, which is the point */ });await ctx.sleep(1);return {ok:false,error:'The agent exited.'};});
 const aborted:boolean[]=[];
 const unexpected=vi.fn((_q:unknown,options?:{signal?:AbortSignal})=>new Promise<string|boolean>((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>{aborted.push(true);reject(new PromptCancelledError('ended'));});}));
 expect(await driveRun(run,{},unexpected)).toEqual({ok:false,error:'The agent exited.'});
 expect(aborted).toEqual([true]);
});

// A form ask travels whole (protocol 2): the fields and errors reach the prompt provider as the question, and the answer is one object or null.
it('hands a form ask to the prompt provider with its fields and answers the run with the object it returns',async()=>{
 const fields=[{id:'team',kind:'text' as const,label:'Team name',required:true},{id:'hook',kind:'checkbox' as const,label:'Hook',default:true}];
 type FormAsk=(kind:'form',question:string,opts:object)=>Promise<unknown>;
 const run=createRun(async ctx=>({ok:true,value:await (ctx.ask as unknown as FormAsk)('form','Create your team',{fields,submit:'Create team',errors:{team:'taken'}})}));
 const unexpected=vi.fn().mockResolvedValue({team:'alpha',hook:false});
 const onAsk=vi.fn();
 expect(await driveRun(run,{},unexpected,undefined,undefined,onAsk)).toEqual({ok:true,value:{team:'alpha',hook:false}});
 expect(onAsk).toHaveBeenCalledExactlyOnceWith({kind:'form',question:'Create your team',fields,submit:'Create team',errors:{team:'taken'}});
 expect(unexpected).toHaveBeenCalledExactlyOnceWith({kind:'form',question:'Create your team',fields,submit:'Create team',errors:{team:'taken'}},{signal:expect.any(AbortSignal)});
 const skipped=createRun(async ctx=>({ok:true,value:await (ctx.ask as unknown as FormAsk)('form','Invite teammates',{fields,skippable:true})}));
 expect(await driveRun(skipped,{'Invite teammates':null},vi.fn())).toEqual({ok:true,value:null});
});
