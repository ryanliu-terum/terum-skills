import { it, expect, vi, afterEach } from 'vitest';
import { createRun } from '../mock/run';
import type { Frame } from '../types';
afterEach(()=>vi.useRealTimers());
it('retains all frames in order even if consumption begins after done',async()=>{const run=createRun(async ctx=>{ctx.print('one');ctx.progress(1,2,'half');ctx.print('two');return {ok:true,value:42};});expect(await run.done).toEqual({ok:true,value:42});const frames:Frame[]=[];for await(const f of run.frames)frames.push(f);expect(frames).toEqual([{t:'print',line:'one'},{t:'progress',done:1,total:2,label:'half'},{t:'print',line:'two'},{t:'result',ok:true}]);});
it('answers asks by fresh id and refuses an invalid choice without losing the ask',async()=>{const run=createRun(async ctx=>({ok:true,value:await ctx.ask('select','Choose',{choices:['A','B']})}));const reader=run.frames[Symbol.asyncIterator]();const frame=(await reader.next()).value as Frame;expect(frame.t).toBe('ask');if(frame.t!=='ask')throw new Error('Expected ask');expect(()=>run.answer(frame.id,'C')).toThrow('Invalid answer');run.answer('stale','A');run.answer(frame.id,'B');expect(await run.done).toEqual({ok:true,value:'B'});expect((await reader.next()).value).toEqual({t:'result',ok:true});expect((await reader.next()).done).toBe(true);});
it('cancels pending asks, is idempotent, and terminates the queue',async()=>{const run=createRun(async ctx=>({ok:true,value:await ctx.ask('confirm','Continue?')}));const reader=run.frames[Symbol.asyncIterator]();await reader.next();await run.cancel();await run.cancel();expect(await run.done).toEqual({ok:false,error:'Cancelled.'});expect((await reader.next()).value).toEqual({t:'result',ok:false,error:'Cancelled.'});expect((await reader.next()).done).toBe(true);});
it('cancels sleeps immediately and clears their timers',async()=>{vi.useFakeTimers();const run=createRun(async ctx=>{await ctx.sleep(60_000);return {ok:true,value:1};});await Promise.resolve();await run.cancel();expect(await run.done).toEqual({ok:false,error:'Cancelled.'});expect(vi.getTimerCount()).toBe(0);});
it('turns thrown errors into results that never reject',async()=>{const run=createRun(async()=>{throw new Error('broken');});expect(await run.done).toEqual({ok:false,error:'broken'});});
it('validates progress and cancellation before script execution',async()=>{const run=createRun(async ctx=>{ctx.progress(2,1);return {ok:true,value:1};});expect(await run.done).toEqual({ok:false,error:'Invalid progress.'});const script=vi.fn();const cancelled=createRun(script);await cancelled.cancel();expect(script).not.toHaveBeenCalled();});

it('replays every frame for concurrent, mid-run and completed-run consumers',async()=>{
 let release!:()=>void;const paused=new Promise<void>(resolve=>{release=resolve;});
 const run=createRun(async ctx=>{ctx.print('first');await paused;ctx.progress(1,1);return {ok:true,value:42};});
 async function collect(){const frames:Frame[]=[];for await(const frame of run.frames)frames.push(frame);return frames;}
 const first=collect();const second=collect();await Promise.resolve();
 const late=collect();release();
 const expected=[{t:'print',line:'first'},{t:'progress',done:1,total:1},{t:'result',ok:true}];
 expect(await first).toEqual(expected);expect(await second).toEqual(expected);expect(await late).toEqual(expected);
 await run.done;expect(await collect()).toEqual(expected);
});
it('broadcasts cancellation to all consumers and replays it after completion',async()=>{
 const run=createRun(async ctx=>{ctx.print('start');await ctx.sleep(60_000);return {ok:true,value:1};});
 async function collect(){const frames:Frame[]=[];for await(const frame of run.frames)frames.push(frame);return frames;}
 const first=collect();const second=collect();await Promise.resolve();await run.cancel();
 const expected=[{t:'print',line:'start'},{t:'result',ok:false,error:'Cancelled.'}];
 expect(await first).toEqual(expected);expect(await second).toEqual(expected);expect(await collect()).toEqual(expected);
});
