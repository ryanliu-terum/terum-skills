import { useRef, useState } from 'react';
import { useBackend } from '../../backend';
import { Dialog, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { WorkflowPopup } from './WorkflowPopup';
import { useWorkflow } from './useWorkflow';
/** Opening and submitting are user actions; reads, focus and mount never start sync. */
export function useSyncAction() {
 const backend=useBackend(),action=useWorkflow();
 const [open,setOpen]=useState(false),[finished,setFinished]=useState(false);
 const opening=useRef(false);
 function start(){setFinished(false);return action.run(()=>backend.sync({}),{},()=>setFinished(true));}
 async function show(){
  if(opening.current||action.busy)return;
  opening.current=true;setOpen(true);setFinished(false);
  try {
   await start();
  } finally {opening.current=false;}
 }
 const popup=open?<Dialog open onOpenChange={value=>{if(!action.busy)setOpen(value);}}><WorkflowPopup><DialogTitle>Sync now</DialogTitle>
  <div role="status">{action.busy?'Sync is running.':action.notice??(finished?'Sync finished.':'Sync runs only when you ask.')}</div>
  {action.lines.map((line,index)=><div key={index}>{line}</div>)}
  {action.error&&<div role="alert">{action.error}</div>}
  <Button disabled={action.busy} onClick={()=>setOpen(false)}>Close</Button>
  <Button disabled={action.busy} onClick={()=>void start()}>{finished?'Sync again':'Sync now'}</Button>
 </WorkflowPopup></Dialog>:null;
 return {open:()=>{void show();},popup};
}
