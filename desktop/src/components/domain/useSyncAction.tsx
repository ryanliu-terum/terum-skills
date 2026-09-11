import { useRef, useState } from 'react';
import type { SyncResult } from '../../backend/types';
import { useBackend } from '../../backend';
import { Dialog, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { WorkflowPopup } from './WorkflowPopup';
import { useWorkflow } from './useWorkflow';
/** Manual sync fetches team clones; background refreshes use the same fetch-only path. */
export function useSyncAction() {
 const backend=useBackend(),action=useWorkflow();
 const [open,setOpen]=useState(false),[finished,setFinished]=useState(false);
 const [outcome,setOutcome]=useState<SyncResult|null>(null);
 const opening=useRef(false);
 function start(){setFinished(false);setOutcome(null);return action.run(()=>{const job=backend.sync({});void job.done.then(result=>setOutcome(result.value??null));return job;},{},()=>setFinished(true));}
 async function show(){
  if(opening.current||action.busy)return;
  opening.current=true;setOpen(true);setFinished(false);
  try {
   await start();
  } finally {opening.current=false;}
 }
 const popup=open?<Dialog open onOpenChange={value=>{if(!action.busy)setOpen(value);}}><WorkflowPopup><DialogTitle>Sync now</DialogTitle>
  <div>Sync fetches each team clone and leaves your local Library unchanged.</div>
  <div role="status">{action.busy?'Sync is running.':action.notice??(finished?'Sync finished.':'Ready to sync.')}</div>
  {outcome&&<>{outcome.notices.map((notice,index)=><div key={index}>{notice}</div>)}{outcome.teams.filter(team=>team.state!=='refreshed').map((team,index)=><div key={index}>{team.team}: {team.state}{team.detail?' · '+team.detail:''}</div>)}</>}
  {action.lines.map((line,index)=><div key={index}>{line}</div>)}
  {action.error&&<div role="alert">{action.error}</div>}
  <Button disabled={action.busy} onClick={()=>setOpen(false)}>Close</Button>
  <Button disabled={action.busy} onClick={()=>void start()}>{finished?'Sync again':'Sync now'}</Button>
 </WorkflowPopup></Dialog>:null;
 return {open:()=>{void show();},popup};
}
