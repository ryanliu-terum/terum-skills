import { WorkflowDialog } from '../components/domain/WorkflowControls';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router';
import { useBackend } from '../backend';
import type { Result, SkillDetail } from '../backend/types';
import { useEvalRun } from './eval-run-context';
import { RunEvalDialog } from '../screens/skill/RunEvalDialog';
export function EvalRunDialogHost(){
 const {current,dialogOpen,dismiss,stop}=useEvalRun(),backend=useBackend(),client=useQueryClient(),location=useLocation(),[params,setParams]=useSearchParams();
 const [snapshot,setSnapshot]=useState<{ref:string;team:string|undefined;skill:SkillDetail}|null>(null);
 const query=useQuery({queryKey:['skill','eval-run',current?.ref,current?.team],enabled:current!==null&&!current.queue,
  initialData:()=>client.getQueriesData<Result<SkillDetail>>({queryKey:['skill']}).map(([,data])=>data).find(data=>data?.ok&&data.value.name===current?.name&&(data.value.team??undefined)===current?.team),
  queryFn:({signal})=>backend.skill({ref:current!.ref,...(current?.team?{team:current.team}:{})},{signal})});
 // Keep the run's dialog usable even if a post-run inventory refresh fails.
 if(current&&query.data?.ok&&snapshot?.skill!==query.data.value)setSnapshot({ref:current.ref,team:current.team,skill:query.data.value});
 const skill=query.data?.ok?query.data.value:snapshot?.ref===current?.ref&&snapshot?.team===current?.team?snapshot?.skill:null;
 // The run's ref is the skill's name now, so a by-path detail page — whose pathname is the literal
 // /skill/local — is matched by its route rather than by the ref. No wider than before: the ref
 // used to BE 'local' there, which already matched any /skill/local page.
 const fromUrl=current!==null&&params.get('dialog')==='run-eval'&&(location.pathname==='/skill/'+encodeURIComponent(current.ref)||location.pathname==='/skill/local');
 function closeUrl(){if(fromUrl)setParams(p=>{p.delete('dialog');return p;},{replace:true});}
 if(current?.queue)return dialogOpen?<WorkflowDialog title={`Queued eval · ${current.name}`} body="Running queued evals four at a time. Receipts are committed to the team." command="npx -y terum-skills@latest eval --drain --parallel 4" primary={null} close={dismiss} submit={()=>{}} busy={current.state==='running'} onStop={()=>void stop()} dismissKeepsRunning lines={current.lines} status={current.state==='running'?(current.progress?`${current.progress.done} of ${current.progress.total} evaluated`:'Running…'):current.state==='stopped'?'Stopped':current.result?.ok===false?current.result.error:'Finished'} closeLabel="Close"/>:null;
 return current&&skill?<RunEvalDialog key={current.startedAt} skill={skill} open={fromUrl} onClose={closeUrl}/>:null;
}
