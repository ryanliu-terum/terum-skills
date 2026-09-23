import { useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { driveRun, PromptContext, useBackend } from '../../backend';
import type { SkillDetail } from '../../backend/types';
import { useEvalRun } from '../../app/eval-run-context';
import { localRef } from '../../components/domain/skill-card-actions';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';

/**
 * IE6: two skills, one neutrally-derived brief, three arms — with no verdict and no winner.
 *
 * The brief is the whole neutrality guarantee and a human signs it. The CLI asks on a TTY; a
 * spawned CLI has none, so the gate is split in two here: derive, put the text in front of the
 * person, and only then run with `--brief`. Approving IS the signature — the same act as the
 * CLI's y/N — so this dialog will not run anything until the brief has been shown and approved.
 */
export function HeadToHeadDialog({skill:s,onClose}:{skill:SkillDetail;onClose:()=>void}){
 const backend=useBackend(),evalRun=useEvalRun(),ask=useContext(PromptContext);
 const [rival,setRival]=useState<string>('');
 const [brief,setBrief]=useState<{brief:string;briefPath:string}|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const ref=localRef(s);

 // Every other local skill is a candidate rival. The CLI refuses a rival that resolves to the
 // same folder, but offering it here would only waste the click.
 const library=useQuery({queryKey:['library','head-to-head',s.team],queryFn:()=>backend.library({scope:{kind:'global'},...(s.team?{team:s.team}:{})})});
 const others=library.data?.ok?library.data.value.skills.map(entry=>entry.name).filter(name=>name!==s.name).sort():[];

 async function derive(){
  if(!backend.deriveBrief){setError('This app cannot derive a brief; update terum-skills.');return;}
  setBusy(true);setError(null);
  try{
   // A Run only advances while its frames are consumed; awaiting `done` alone never settles.
   const result=await driveRun(backend.deriveBrief({ref,vs:rival,...(s.team?{team:s.team}:{})}),{},ask);
   if(result.ok)setBrief(result.value); else setError(result.error);
  }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  finally{setBusy(false);}
 }

 function run(){
  if(!brief)return;
  try{evalRun.start({ref,name:s.name,...(s.team?{team:s.team}:{}),vs:rival,brief:brief.briefPath});onClose();}
  catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
 }

 const unavailable=backend.deriveBrief===undefined;
 return <Dialog open onOpenChange={value=>{if(!value)onClose();}}><DialogPopup>
  <DialogTitle>Compare {s.name} with another skill</DialogTitle>
  <DialogDescription>
   {unavailable
    ? 'This app cannot run a head-to-head; update terum-skills to a version that supports it.'
    : brief
     ? 'Both skills run against these cases. Read the brief and check it is fair to both — nothing runs until you approve it.'
     : 'Both skills are scored on one shared task brief, written so it names neither of them. There is no winner and no verdict: you get each skill’s score side by side.'}
  </DialogDescription>

  {unavailable?null:brief?
   <>
    <blockquote className="head-to-head-brief">{brief.brief}</blockquote>
    <p className="head-to-head-path">To change it, edit <code>{brief.briefPath}</code> and start again.</p>
   </>
   :
   <label className="head-to-head-pick">Compare against
    <select value={rival} onChange={event=>setRival(event.target.value)} disabled={busy||others.length===0}>
     <option value="">Choose a skill…</option>
     {others.map(name=><option key={name} value={name}>{name}</option>)}
    </select>
   </label>}

  {error?<div role="alert">{error}</div>:null}
  <div className="skill-dialog-actions">
   <Button onClick={onClose}>{brief?'Cancel':'Close'}</Button>
   {unavailable?null:brief
    ? <Button kind="primary" onClick={run}>Approve and run</Button>
    : <Button kind="primary" onClick={()=>void derive()} disabled={rival===''||busy}>{busy?'Deriving a brief…':'Derive the brief'}</Button>}
  </div>
 </DialogPopup></Dialog>;
}
