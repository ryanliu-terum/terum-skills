import { useRef, useState } from 'react';
import type { SyncResult, SyncTeam, TeamResult } from '../../backend/types';
import { useBackend } from '../../backend';
import { Dialog, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { WorkflowPopup } from './WorkflowPopup';
import { MissingTeam } from './MissingTeam';
import { useWorkflow } from './useWorkflow';
/** Manual sync fetches team clones; background refreshes use the same fetch-only path. */
export function useSyncAction() {
 const backend=useBackend(),action=useWorkflow();
 const [open,setOpen]=useState(false),[finished,setFinished]=useState(false);
 const [outcome,setOutcome]=useState<SyncResult|null>(null);
 const [moved,setMoved]=useState<TeamResult|null>(null);
 const opening=useRef(false);
 function start(){setFinished(false);setOutcome(null);return action.run(()=>{const job=backend.sync({});void job.done.then(result=>setOutcome(result.value??null));return job;},{},()=>setFinished(true));}
 /**
  * The self-driving half of a moved team: one click runs `team move` (the CLI's leave + join + re-place), then syncs
  * again. Sequenced after the move settles, not from its success callback: the workflow lock is still held there, and
  * a nested run would be dropped.
  */
 async function move(team:SyncTeam,ownerRepo:string){setMoved(null);const result=await action.run(()=>backend.team({kind:'move',team:team.team,remote:ownerRepo}),{});if(result?.ok){setMoved(result.value);await start();}}
 async function show(){
  if(opening.current||action.busy)return;
  opening.current=true;setOpen(true);setFinished(false);setMoved(null);
  try {
   await start();
  } finally {opening.current=false;}
 }
 const popup=open?<Dialog open onOpenChange={value=>{if(!action.busy)setOpen(value);}}><WorkflowPopup><DialogTitle>Sync now</DialogTitle>
  <div>Sync fetches each team clone and leaves your local Library unchanged.</div>
  <div role="status">{action.busy?'Sync is running.':action.notice??(finished?'Sync finished.':'Ready to sync.')}</div>
  {moved&&<div role="status">Moved to {moved.name}: {moved.restored?.length??0} skill(s) placed again{moved.missing?.length?`, ${moved.missing.length} not shared there (${moved.missing.join(', ')})`:''}{moved.failed?.length?`, ${moved.failed.length} could not be placed`:''}.</div>}
  {outcome&&<>{outcome.notices.map((notice,index)=><div key={index}>{notice}</div>)}{outcome.teams.filter(team=>team.state!=='refreshed').map((team,index)=>team.missing?<MissingTeam key={index} team={team} busy={action.busy} onMove={ownerRepo=>{void move(team,ownerRepo);}}/>:<div key={index}>{team.team}: {team.state}{team.detail?' · '+team.detail:''}</div>)}</>}
  {action.lines.map((line,index)=><div key={index}>{line}</div>)}
  {action.error&&<div role="alert">{action.error}</div>}
  <Button disabled={action.busy} onClick={()=>setOpen(false)}>Close</Button>
  <Button disabled={action.busy} onClick={()=>void start()}>{finished?'Sync again':'Sync now'}</Button>
 </WorkflowPopup></Dialog>:null;
 return {open:()=>{void show();},popup};
}

