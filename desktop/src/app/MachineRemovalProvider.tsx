import { useContext, useRef, useState, type PropsWithChildren } from 'react';
import { driveRun, PromptContext, useBackend } from '../backend';
import type { MachineUninstallResult, Result, Run } from '../backend/types';
import { useEvalRun } from './eval-run-context';
import { MachineRemovalContext, type RemovalState } from './machine-removal-context';

/** Owns removal across route changes and the loss of the CLI's launch state. */
export function MachineRemovalProvider({children}:PropsWithChildren){
 const backend=useBackend(),fallbackAsk=useContext(PromptContext),evalRun=useEvalRun();
 const [current,setCurrent]=useState<RemovalState|null>(null),[notice,setNotice]=useState<string|null>(null);
 const live=useRef<RemovalState|null>(null),activeRun=useRef<Run<MachineUninstallResult>|null>(null);
 const pending=useRef<((value:boolean)=>void)|null>(null);
 function update(next:RemovalState|null){live.current=next;setCurrent(next);}
 function start(){
  if(live.current&&['reading','asking','removing'].includes(live.current.phase))return;
  setNotice(null);
  if(evalRun.current?.state==='running'){update({phase:'refused',detail:[],lines:[]});return;}
  update({phase:'reading',detail:[],lines:[]});
  let run:Run<MachineUninstallResult>;
  try{run=backend.uninstallMachine({});}catch(error){update({phase:'failed',detail:[],lines:[],result:{ok:false,error:error instanceof Error?error.message:String(error)}});return;}
  activeRun.current=run;
  let asked=false;
  function settle(result:Result<MachineUninstallResult>){
   if(activeRun.current!==run||!live.current)return;
   activeRun.current=null;pending.current=null;
   if(!result.ok&&result.cancelled){update({...live.current,phase:'cancelled',result});setNotice('Uninstall was cancelled.');update(null);}
   else update({...live.current,phase:result.ok?'done':'failed',result});
  }
  void driveRun(run,{},question=>{
   if(activeRun.current!==run)return Promise.resolve(false);
   if(asked||question.kind!=='confirm'){asked=true;return fallbackAsk(question);}
   asked=true;
   update({...live.current!,phase:'asking',question:question.question,detail:[...(question.detail??[])]});
   return new Promise<boolean>(resolve=>{pending.current=resolve;});
  },line=>{if(activeRun.current===run&&live.current)update({...live.current,lines:[...live.current.lines,line]});}).then(settle,error=>settle({ok:false,error:error instanceof Error?error.message:String(error)}));
 }
 function answer(value:boolean){
  const resolve=pending.current;if(!resolve||!live.current)return;
  pending.current=null;
  if(value)update({...live.current,phase:'removing'});
  resolve(value);
 }
 function dismiss(){
  if(live.current?.phase==='removing')return;
  const run=activeRun.current;
  if(live.current?.phase==='reading'&&run){activeRun.current=null;void run.cancel().catch(()=>{});}
  if(live.current?.phase==='asking'){answer(false);return;}
  update(null);
 }
 return <MachineRemovalContext value={{current,notice,start,answer,dismiss}}>{children}</MachineRemovalContext>;
}
