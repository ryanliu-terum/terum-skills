import { expect,it,vi } from 'vitest';
import { createRun } from '../mock/run';
import { driveRun } from '../drive';
it('answers a pre-answered ask and resolves done',async()=>{const run=createRun(async ctx=>({ok:true,value:await ctx.ask('confirm','Approve?')}));const unexpected=vi.fn();expect(await driveRun(run,{'Approve?':true},unexpected)).toEqual({ok:true,value:true});expect(unexpected).not.toHaveBeenCalled();});
it('hands unknown questions to the prompt provider',async()=>{const run=createRun(async ctx=>({ok:true,value:await ctx.ask('text','Which path?')}));const unexpected=vi.fn().mockResolvedValue('skills/new');expect(await driveRun(run,{},unexpected)).toEqual({ok:true,value:'skills/new'});expect(unexpected).toHaveBeenCalledWith(expect.objectContaining({kind:'text',question:'Which path?'}));});
it('cancels the run if the prompt provider rejects',async()=>{const run=createRun(async ctx=>({ok:true,value:await ctx.ask('text','Path?')}));expect(await driveRun(run,{},()=>Promise.reject(new Error('Cancelled.')))).toEqual({ok:false,error:'Cancelled.'});expect((await run.done).ok).toBe(false);});
it('does not conceal backend failures',async()=>{const run=createRun(async()=>({ok:false,error:'Cannot install.'}));expect(await driveRun(run,{},vi.fn())).toEqual({ok:false,error:'Cannot install.'});});
