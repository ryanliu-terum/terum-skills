import { useContext, useRef, useState, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { driveRun, PrintContext, PromptContext, useBackend } from '../backend';
import type { EvalResult, Result } from '../backend/types';
import { affects } from './invalidation';
import { EvalRunContext, type EvalRunApi, type EvalRunState } from './eval-run-context';

/** App lifetime, independent of routes. Only explicit Stop or native quit cancels an eval. */
export function EvalRunProvider({children}:PropsWithChildren){
 const backend=useBackend(),ask=useContext(PromptContext),print=useContext(PrintContext),client=useQueryClient();
 const [current,setCurrent]=useState<EvalRunState|null>(null),[dialogOpen,setDialogOpen]=useState(false);
 const live=useRef<EvalRunState|null>(null);
 function update(next:EvalRunState|null){live.current=next;setCurrent(next);}
 const start:EvalRunApi['start']=args=>{
  if(live.current?.state==='running')throw new Error(`An eval is already running for ${live.current.ref}`);
  const run=backend.eval({ref:args.ref,...(args.team===undefined?{}:{team:args.team}),commit:args.commit});
  update({...args,team:args.team,run,lines:[],startedAt:Date.now(),state:'running'});setDialogOpen(true);
  const settle=(result:Result<EvalResult>)=>{
   const active=live.current;
   if(active?.run===run)update({...active,result,state:active.state==='stopped'||(!result.ok&&result.cancelled)?'stopped':result.ok?'done':'failed'});
   if(result.ok||result.value!==undefined)void client.invalidateQueries({predicate:q=>affects('clone',q.queryKey)});
  };
  void driveRun(run,{},ask,line=>{const active=live.current;if(active?.run===run)update({...active,lines:[...active.lines,line]});print(line);}).then(settle,error=>settle({ok:false,error:error instanceof Error?error.message:String(error)}));
 };
 async function stop(){const active=live.current;if(!active||active.state!=='running')return;update({...active,state:'stopped'});try{await active.run.cancel();}catch(error){if(live.current?.run===active.run)update({...live.current,result:{ok:false,error:String(error)}});}}
 function dismiss(){setDialogOpen(false);if(live.current?.state!=='running')update(null);}
 return <EvalRunContext value={{current,dialogOpen,start,stop,dismiss,show:()=>setDialogOpen(true)}}>{children}</EvalRunContext>;
}
