import { useEffect, useState } from 'react';
import { useCapabilities } from '../../backend';
import type { SkillDetail } from '../../backend/types';
import { useEvalRun } from '../../app/eval-run-context';
import { WorkflowDialog } from '../../components/domain/WorkflowControls';
import { TerminalHint } from '../../components/domain/Primitives';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';

export function RunEvalDialog({skill:s,open,onClose}:{skill:SkillDetail;open:boolean;onClose:()=>void}){
 const capabilities=useCapabilities(),evalRun=useEvalRun();
 const [error,setError]=useState<string|null>(null);
 const active=evalRun.current&&evalRun.current.name===s.name&&(evalRun.current.team??null)===s.team?evalRun.current:null;
 const done=active?.state==='done';
 const dismiss=evalRun.dismiss;
 useEffect(()=>{if(done){dismiss();onClose();}},[done,dismiss,onClose]);
 const visible=open||(evalRun.dialogOpen&&active!==null);
 if(!visible||done||!capabilities)return null;
 function close(){if(active)evalRun.dismiss();onClose();}
 // The CLI's `eval` verb takes the skill, never the URL segment: on the by-path route that segment
 // is the literal word `local`, which must never be passed to the CLI as the skill name.
 function start(){try{evalRun.start({ref:s.name,name:s.name,...(s.team?{team:s.team}:{})});onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
 const title=`Run an eval on ${s.name}?`;
 // Both the pre-run dialog and the running one say the same honest thing when there is no estimate:
 // an eval spends the human's own Claude account.
 const estimate=s.evalEstimateText||'No previous run to estimate from. This uses your Claude account and can take a while.';
 // §11.4: an eval runs against the copy on THIS machine, so with no local folder the CLI refuses
 // outright — `No local skill folder named <ref> in your library; install it from the marketplace
 // first`. Offering the run anyway spends a click on a guaranteed failure. The gate lives HERE, at
 // the one choke point every entry path reaches — the card ⋯ row, the Evals-tab button, the
 // EvalsEmpty primary and a pasted `?dialog=run-eval` — so B3 is safe standing alone, before B4 and
 // B5 add their disabled menu rows on the surfaces they own.
 const missing=s.path===null;
 if(!active)return <Dialog open onOpenChange={value=>{if(!value)close();}}><DialogPopup><DialogTitle>{title}</DialogTitle><DialogDescription>{missing?'Install it first — evals run against the copy on your machine.':estimate}</DialogDescription>{missing?null:<TerminalHint command={s.evalCommand}/>}{error?<div role="alert">{error}</div>:null}<div className="skill-dialog-actions"><Button onClick={close}>{missing?'Close':'Cancel'}</Button>{missing?null:<Button kind="primary" onClick={start}>Run eval</Button>}</div></DialogPopup></Dialog>;
 const busy=active?.state==='running',finished=active!==null&&!busy,retryable=finished&&(active?.state==='stopped'||(active?.result?.ok===false&&active.result.value===undefined));
 // §6.3: an eval reads the copy on THIS machine, whatever state it is in — that is the whole point
 // of binding a run to its content digest rather than to a version the repo has not seen yet.
 // A run can outlive its folder — the copy is uninstalled while the eval streams — so the null arm
 // states that rather than asserting a copy that is no longer there.
 const versionLine=s.path===null?'This skill is no longer on this machine.':`Evaluates the copy on this machine at ${s.pathLabel}.`;
 const status=busy?'Running…':active?.state==='stopped'?'Stopped':active?.result?.ok===false?active.result.error:undefined;
 return <WorkflowDialog title={title} body={versionLine} primary={finished?(retryable?'Run eval again':null):'Run eval'} command={s.evalCommand} close={close} submit={start} busy={busy} error={error} onStop={()=>void evalRun.stop()} dismissKeepsRunning lines={active?.lines??[]} status={status} closeLabel={finished?'Close':'Cancel'}>
 <p>{estimate}</p>
 </WorkflowDialog>;
}
