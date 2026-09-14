import { useState } from 'react';
import { useEvalRun, type EvalRunState } from '../../app/eval-run-context';
import type { EvalManyArgs } from '../../backend/types';
import { Button } from '../ui/Button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '../ui/Dialog';
import { CollapsibleCommand } from './Primitives';
import { WorkflowDialog, WorkflowField } from './WorkflowControls';
import { BULK_EVAL_MODES, evalManyCommand, evalManyCommandSummary, evalManyLabel, evalManyStatus, type BulkEvalMode } from './bulk-eval';

/**
 * Several skills at once — the wizard's Now / In batches / Overnight question, asked past setup. Hosted from the URL
 * (`?dialog=bulk-eval&ref=a&ref=b`, `&pending=1` for every shared skill without a receipt) so a Library selection, the
 * Settings ▸ Evals row and a pasted link all land on the same board. It starts the run through the app-wide eval host
 * and hands over to BulkEvalRunDialog; it never streams anything itself.
 */
export function BulkEvalDialog({refs,pending,team,onClose}:{refs:string[];pending:boolean;team?:string|undefined;onClose:()=>void}){
 const evalRun=useEvalRun();
 const [mode,setMode]=useState<BulkEvalMode>('now'),[batch,setBatch]=useState('4'),[error,setError]=useState<string|null>(null);
 const size=Number(batch),validBatch=batch.trim()!==''&&Number.isSafeInteger(size)&&size>=1;
 const nothing=refs.length===0&&!pending;
 const args:EvalManyArgs={refs,mode,...(mode==='batches'?{batch:size}:{}),...(pending?{pending:true}:{}),...(team?{team}:{})};
 function start(){try{if(!evalRun.startMany)throw new Error('This app cannot start evals.');evalRun.startMany(args);onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
 const title=pending?'Evaluate pending skills?':`Evaluate ${refs.length} skill${refs.length===1?'':'s'}?`;
 // The same honest cost sentence as the single-skill dialog: each eval spends the person's own Claude account.
 const body=nothing?'Nothing to evaluate: choose skills in the Library first.':`${pending?`Every shared skill with no receipt for its current version — what setup offered${refs.length?`, plus ${refs.join(', ')}`:''}`:refs.join(', ')}. Each eval uses your Claude account and can take a while.`;
 return <Dialog open onOpenChange={value=>{if(!value)onClose();}}><DialogPopup><DialogTitle>{title}</DialogTitle><DialogDescription>{body}</DialogDescription>
  {nothing?null:<>
   <div role="radiogroup" aria-label="When to run">{BULK_EVAL_MODES.map(option=><label key={option.mode} className="prompt-option"><input type="radio" name="bulk-eval-mode" aria-label={option.label} checked={mode===option.mode} onChange={()=>setMode(option.mode)}/><span>{option.label}<span className="prompt-option-description">{option.description}</span></span></label>)}</div>
   {mode==='batches'?<label style={{display:'flex',alignItems:'center',gap:8}}>Batch size<WorkflowField aria-label="Batch size" type="number" min={1} step={1} value={batch} onChange={event=>setBatch(event.target.value)} style={{width:72}}/>{validBatch?null:<span role="alert">A batch is a whole number of at least 1.</span>}</label>:null}
   <CollapsibleCommand command={evalManyCommand(args)} summary={evalManyCommandSummary(args)}/>
  </>}
  {error?<div role="alert">{error}</div>:null}
  <div className="skill-dialog-actions"><Button onClick={onClose}>{nothing?'Close':'Cancel'}</Button>{nothing?null:<Button kind="primary" disabled={mode==='batches'&&!validBatch} onClick={start}>{mode==='overnight'?'Queue for overnight':'Run evals'}</Button>}</div>
 </DialogPopup></Dialog>;
}

/** The streaming board for a several-skills run: the CLI's lines, its progress, and one summary line at the end. Escape keeps the run going; only Stop cancels it. */
export function BulkEvalRunDialog({current,onClose,onStop}:{current:EvalRunState&{many:EvalManyArgs};onClose:()=>void;onStop:()=>void}){
 const args=current.many,busy=current.state==='running',queueing=args.mode==='overnight'||args.mode==='later';
 const title=`${queueing?'Queueing':'Evaluating'} ${evalManyLabel(args)}`;
 const body=args.mode==='now'?'All at once, four at a time. Receipts stay on this machine until you share them.':args.mode==='batches'?`${args.batch} at a time; a question comes before each further batch, and declining queues the rest for later.`:args.mode==='overnight'?'Queued for the app to run between 01:00 and 05:00 while it is open and idle.':'Queued for a later drain.';
 // UI policy §5: never a bare "Running…" for long — before the CLI has said anything the run is starting; once it prints, it is running; once it counts, the count.
 const status=busy?(current.progress?`${current.progress.done} of ${current.progress.total} evaluated`:current.lines.length?'Running…':'Starting…'):current.state==='stopped'?'Stopped':current.result?evalManyStatus(current.result,args):'Finished';
 return <WorkflowDialog title={title} body={body} command={evalManyCommand(args)} commandSummary={evalManyCommandSummary(args)} primary={null} close={onClose} submit={()=>{}} busy={busy} onStop={onStop} dismissKeepsRunning lines={current.lines} status={status} closeLabel="Close"/>;
}
