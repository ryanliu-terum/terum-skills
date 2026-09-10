import { expect,it,vi } from 'vitest';
import type { Result } from '../../types';
import { prepareRun } from '../prepare-run';
import { cliRun } from '../run';
import { fakeBridge,STATE } from './fake-bridge';

it('cancels before preflight without starting any process',async()=>{
  const prepare=vi.fn(async()=>({ok:true as const,value:'global'}));
  const start=vi.fn(()=>{throw new Error('Must not start.');});
  const job=prepareRun(prepare,start);
  await job.cancel();
  expect(await job.done).toEqual({ok:false,error:'Cancelled.',cancelled:true});
  expect(prepare).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});
it('aborts a pending preflight and never starts the mutation',async()=>{
  let started!:()=>void;
  const pending=new Promise<void>(resolve=>{started=resolve;});
  const start=vi.fn(()=>{throw new Error('Must not start.');});
  const job=prepareRun(signal=>new Promise<Result<string>>(resolve=>{
    signal.addEventListener('abort',()=>resolve({ok:false,error:'Read cancelled.'}),{once:true});
    started();
  }),start);
  await pending;
  await job.cancel();
  expect(await job.done).toEqual({ok:false,error:'Cancelled.',cancelled:true});
  expect(start).not.toHaveBeenCalled();
});
it('returns preflight exceptions through both result and frames',async()=>{
  const start=vi.fn(()=>{throw new Error('Must not start.');});
  const job=prepareRun(async()=>{throw new Error('Cannot read destinations.');},start);
  expect(await job.done).toEqual({ok:false,error:'Cannot read destinations.'});
  const frames=[];for await(const frame of job.frames) frames.push(frame);
  expect(frames).toEqual([{t:'result',ok:false,error:'Cannot read destinations.'}]);
  expect(start).not.toHaveBeenCalled();
});
it('forwards prompts, answers and cancellation to the active CLI run',async()=>{
  const f=fakeBridge((_args,emit)=>{
    emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,version:'0.1.7',verbs:[],features:{}})});
    emit({kind:'stdout',line:JSON.stringify({t:'ask',id:'grant',kind:'confirm',question:'Approve tools?'})});
  });
  const job=prepareRun(async()=>({ok:true as const,value:'global'}),into=>cliRun(f.bridge,Promise.resolve(STATE),['install','--into',into,'--','tdd'],{map:value=>value}));
  const iterator=job.frames[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({t:'ask',id:'grant',question:'Approve tools?'});
  job.answer('grant',true);
  await job.cancel();
  expect(f.writes).toContain(JSON.stringify({t:'answer',id:'grant',value:true}));
  expect(f.kills).toHaveLength(1);
  expect(await job.done).toMatchObject({ok:false,error:'Cancelled.'});
  expect((await iterator.next()).value).toMatchObject({t:'result',ok:false});
  expect((await iterator.next()).done).toBe(true);
});
