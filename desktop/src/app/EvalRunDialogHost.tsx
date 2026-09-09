import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router';
import { useBackend } from '../backend';
import type { Result, SkillDetail } from '../backend/types';
import { useEvalRun } from './eval-run-context';
import { RunEvalDialog } from '../screens/skill/RunEvalDialog';
export function EvalRunDialogHost(){
 const {current}=useEvalRun(),backend=useBackend(),client=useQueryClient(),location=useLocation(),[params,setParams]=useSearchParams();
 const [snapshot,setSnapshot]=useState<{ref:string;team:string|undefined;skill:SkillDetail}|null>(null);
 const query=useQuery({queryKey:['skill','eval-run',current?.ref,current?.team],enabled:current!==null,
  initialData:()=>client.getQueriesData<Result<SkillDetail>>({queryKey:['skill']}).map(([,data])=>data).find(data=>data?.ok&&data.value.name===current?.name&&(data.value.team??undefined)===current?.team),
  queryFn:({signal})=>backend.skill({ref:current!.ref,...(current?.team?{team:current.team}:{})},{signal})});
 // Keep the run's dialog usable even if a post-run inventory refresh fails.
 if(current&&query.data?.ok&&snapshot?.skill!==query.data.value)setSnapshot({ref:current.ref,team:current.team,skill:query.data.value});
 const skill=query.data?.ok?query.data.value:snapshot?.ref===current?.ref&&snapshot?.team===current?.team?snapshot?.skill:null;
 const fromUrl=current!==null&&location.pathname==='/skill/'+encodeURIComponent(current.ref)&&params.get('dialog')==='run-eval';
 function closeUrl(){if(fromUrl)setParams(p=>{p.delete('dialog');return p;},{replace:true});}
 return current&&skill?<RunEvalDialog key={current.startedAt} skill={skill} open={fromUrl} onClose={closeUrl}/>:null;
}
