import { useContext, useRef, useState, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { driveRun, PrintContext, PromptContext, useBackend } from '../backend';
import { evalQueueFor, type EvalQueueItem } from '../backend/eval-queue';
import type { Result, Run } from '../backend/types';
import { affects } from './invalidation';
import { EvalRunContext, type EvalRunApi, type EvalRunState, type EvalRunValue } from './eval-run-context';

/** App lifetime, independent of routes. Only explicit Stop or native quit cancels an eval. */
export function EvalRunProvider({children}:PropsWithChildren){
 const backend=useBackend(),ask=useContext(PromptContext),print=useContext(PrintContext),client=useQueryClient();
 const [current,setCurrent]=useState<EvalRunState|null>(null),[dialogOpen,setDialogOpen]=useState(false);
 const live=useRef<EvalRunState|null>(null),inFlight=useRef(false);
 function update(next:EvalRunState|null){live.current=next;setCurrent(next);}
 function assertAvailable(){if(inFlight.current)throw new Error(`An eval is already running for ${live.current?.ref??'another skill'}`);}
 async function track<T extends EvalRunValue>(run:Run<T>,args:{ref:string;name:string;team?:string;queue?:boolean}):Promise<Result<T>> {
  inFlight.current=true;
  update({...args,team:args.team,run,lines:[],startedAt:Date.now(),state:'running'});setDialogOpen(true);
  let result:Result<T>;
  try { result=await driveRun(run,{},ask,line=>{const active=live.current;if(active?.run===run)update({...active,lines:[...active.lines,line]});print(line);},frame=>{const active=live.current;if(active?.run===run)update({...active,progress:frame});}); }
  catch(error){result={ok:false,error:error instanceof Error?error.message:String(error)};}
  inFlight.current=false;
  const active=live.current;
  if(active?.run===run){
   if(active.state==='stopped')result={ok:false,error:'Evaluation stopped.',cancelled:true};
   update({...active,result,state:active.state==='stopped'||(!result.ok&&result.cancelled)?'stopped':result.ok?'done':'failed'});
  }
  if(result.ok||result.value!==undefined)void client.invalidateQueries({predicate:q=>affects('clone',q.queryKey)});
  return result;
 }
 const start:EvalRunApi['start']=args=>{
  assertAvailable();
  const run=backend.eval({ref:args.ref,...(args.team===undefined?{}:{team:args.team})});
  void track(run,args);
 };
 async function startQueued(item:EvalQueueItem){
  assertAvailable();
  const service=evalQueueFor(backend);
  if(!service)throw new Error('This backend has no eval queue.');
  return track(service.drain(),{ref:item.skill,name:item.skill,team:item.team,queue:true});
 }
 async function stop(){const active=live.current;if(!active||active.state!=='running')return;update({...active,state:'stopped'});try{await active.run.cancel();}catch(error){if(live.current?.run===active.run)update({...live.current,result:{ok:false,error:String(error)}});}}
 function dismiss(){setDialogOpen(false);if(live.current?.state!=='running')update(null);}
 return <EvalRunContext value={{current,dialogOpen,start,startQueued,isRunning:()=>inFlight.current,stop,dismiss,show:()=>setDialogOpen(true)}}>{children}</EvalRunContext>;
}
