import { useEffect, useState } from 'react';
import { useBackend, useCapabilities } from '../../backend';
import type { SkillDetail } from '../../backend/types';
import { useEvalRun } from '../../app/eval-run-context';
import { WorkflowDialog } from '../../components/domain/WorkflowControls';
import { TerminalHint } from '../../components/domain/Primitives';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';

export function RunEvalDialog({skill:s,open,onClose}:{skill:SkillDetail;open:boolean;onClose:()=>void}){
 const capabilities=useCapabilities(),evalRun=useEvalRun(),backend=useBackend();
 // The checkbox starts from Settings ▸ Evals ▸ Commit receipts; each run may still override it here.
 const [commit,setCommit]=useState(()=>backend.prefs.get('eval:commit',true)),[error,setError]=useState<string|null>(null);
 const active=evalRun.current&&evalRun.current.name===s.name&&(evalRun.current.team??null)===s.team?evalRun.current:null;
 const done=active?.state==='done';
 const dismiss=evalRun.dismiss;
 useEffect(()=>{if(done){dismiss();onClose();}},[done,dismiss,onClose]);
 const visible=open||(evalRun.dialogOpen&&active!==null);
 if(!visible||done||!capabilities)return null;
 function close(){if(active)evalRun.dismiss();onClose();}
 // The CLI's `eval` verb takes the skill, never the URL segment: on the by-path route that segment
 // is the literal word `local`, which spawned ['eval','--commit','--','local'] and always failed.
 function start(){try{evalRun.start({ref:s.name,name:s.name,...(s.team?{team:s.team}:{}),commit});onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
 const title=`Run an eval on ${s.name}?`;
 // Preserve the locked board's exact wrappers and action geometry before a mock run.
 if(!capabilities?.evalCommitChoice&&!active)return <Dialog open onOpenChange={value=>{if(!value)close();}}><DialogPopup><DialogTitle>{title}</DialogTitle><DialogDescription>{s.evalEstimateText+' The receipt is committed to the team repo when it completes.'}</DialogDescription><TerminalHint command={s.evalCommand}/>{error?<div role="alert">{error}</div>:null}<div className="skill-dialog-actions"><Button onClick={close}>Cancel</Button><Button kind="primary" onClick={start}>Run eval</Button></div></DialogPopup></Dialog>;
 const busy=active?.state==='running',finished=active!==null&&!busy;
 const version=s.versions?.teamCurrent;
 const versionLine=`Evaluates the team's current version${version?' '+version.slice(0,8):''} from the team repo${version&&s.versions?.placed&&s.versions.placed!==version?', not your installed '+s.versions.placed.slice(0,8):''}.`;
 const status=busy?'Running…':active?.state==='stopped'?'Stopped':active?.result?.ok===false?active.result.value?.commit?.ok===false?`Evaluated locally; committing the receipt failed: ${active.result.value.commit.error}`:active.result.error:undefined;
 return <WorkflowDialog title={title} body={versionLine} primary={finished?null:'Run eval'} command={`${s.evalCommand}${(active?.commit??commit)?' --commit':''}`} close={close} submit={start} busy={busy} error={error} onStop={()=>void evalRun.stop()} dismissKeepsRunning lines={active?.lines??[]} status={status} closeLabel={finished?'Close':'Cancel'}>
 <p>{s.evalEstimateText||'No previous run to estimate from. This uses your Claude account and can take a while.'}</p>{capabilities?.evalCommitChoice?<Checkbox label="Commit the receipt to the team" checked={active?.commit??commit} onCheckedChange={setCommit} disabled={active!==null}/>:null}
 </WorkflowDialog>;
}
