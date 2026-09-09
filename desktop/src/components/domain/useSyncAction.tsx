import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import { useUrlState } from '../../app/url-state';
import { Dialog, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { WorkflowPopup } from './WorkflowPopup';
import { useWorkflow } from './useWorkflow';
/** Opening and submitting are user actions; reads, focus and mount never start sync. */
export function useSyncAction() {
 const backend=useBackend(),state=useUrlState(),action=useWorkflow();
 const [open,setOpen]=useState(false),[finished,setFinished]=useState(false),[team,setTeam]=useState('');
 const opening=useRef(false);
 const status=useQuery({queryKey:['status',state.mock],queryFn:({signal})=>backend.status(undefined,{signal}),enabled:open});
 const teams=status.data?.value?.teams??[];
 const selected=team||(teams.length===1?teams[0]?.key??'':'');
 function start(selected:string){setFinished(false);return action.run(()=>backend.sync(selected?{team:selected}:{}),{},()=>setFinished(true));}
 async function show(){
  if(opening.current||action.busy)return;
  opening.current=true;setOpen(true);setFinished(false);
  try {
   const result=await status.refetch();const teams=result.data?.value?.teams??[];
   if(teams.length<=1)await start(teams[0]?.key??'');
  } finally {opening.current=false;}
 }
 const popup=open?<Dialog open onOpenChange={value=>{if(!action.busy)setOpen(value);}}><WorkflowPopup><DialogTitle>Sync now</DialogTitle>
  {teams.length>1&&<select aria-label="Team to sync" value={selected} onChange={event=>setTeam(event.target.value)}><option value="">Choose a team</option>{teams.map(team=><option key={team.key} value={team.key}>{team.name}</option>)}</select>}
  <div role="status">{action.busy?'Sync is running.':action.notice??(finished?'Sync finished.':'Sync runs only when you ask.')}</div>
  {action.lines.map((line,index)=><div key={index}>{line}</div>)}
  {action.error&&<div role="alert">{action.error}</div>}
  <Button disabled={action.busy} onClick={()=>setOpen(false)}>Close</Button>
  <Button disabled={action.busy||status.isPending||(teams.length>1&&!selected)} onClick={()=>void start(selected)}>{finished?'Sync again':'Sync now'}</Button>
 </WorkflowPopup></Dialog>:null;
 return {open:()=>{void show();},popup};
}
