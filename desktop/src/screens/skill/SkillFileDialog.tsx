import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import type { SkillDetail, SkillFileResult } from '../../backend/types';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { ErrorLine } from '../../components/domain/Primitives';

/** The three D6 dialogs share the CLI's typed-name confirmation and workflow owner. */
export function SkillFileDialog({kind,skill,onClose,onDone}:{kind:'move'|'rename'|'delete';skill:SkillDetail;onClose:()=>void;onDone:(value:SkillFileResult)=>void}) {
 const backend=useBackend(),workflow=useWorkflow(),[typed,setTyped]=useState(''),[to,setTo]=useState(''),[result,setResult]=useState<SkillFileResult|null>(null);
 const roots=useQuery({queryKey:['library','file-destinations'],enabled:kind==='move',queryFn:()=>backend.library({scope:{kind:'global'}})});
 // Destination data is the local registry carried by the Library roots; no team catalogue is consulted.
 const title=kind==='delete'?'Delete':kind==='rename'?'Rename':'Move';
 const description=kind==='rename'?'The folder name is the invocation name. If published, the remote stays keyed by the old name: your next publish creates a new skill at Version 1.'
  :kind==='move'?'Moves these local files. A folder already at the destination is kept in that root’s .claude/old-skills folder.'
  :skill.placed?'This skill was installed from the team — deleting it also removes it from your installs. An unmodified copy is removed outright; reinstall to restore it. An edited copy is moved to quarantine until prune.'
  :'This folder is moved to quarantine. You can move it back until prune removes it.';
 async function submit(){if(!skill.path)return;const path=skill.path;const outcome=await workflow.run(()=>kind==='move'?backend.skillFile.move({path,to}):kind==='rename'?backend.skillFile.rename({path,to}):backend.skillFile.delete({path}),{[`Type ${skill.name} to ${kind} this folder`]:typed});if(outcome?.ok)setResult(outcome.value);}
 const destinations=roots.data?.ok?roots.data.value.roots:[];
 return <Dialog open onOpenChange={open=>{if(!open&&!workflow.busy)onClose();}}><DialogPopup><DialogTitle>{title} {skill.name}</DialogTitle><DialogDescription>{description}</DialogDescription>{result?<><div role="status">{result.notices.map((line,i)=><p key={i}>{line}</p>)}</div><Button onClick={()=>onDone(result)}>Done</Button></>:<>
 {kind==='rename'?<label>New name<input aria-label="New name" value={to} onChange={e=>setTo(e.target.value)}/></label>:null}
 {kind==='move'?<><label>Move to<select aria-label="Move to" value={to} onChange={e=>setTo(e.target.value)}><option value="">Choose destination</option>{destinations.map(root=><option key={root.id} value={root.kind==='global'?'global':root.root}>{root.label}</option>)}</select></label>{roots.data?.ok===false?<ErrorLine>{roots.data.error}</ErrorLine>:null}</>:null}
 <label>Type {skill.name} to confirm<input aria-label="Skill name to confirm" value={typed} onChange={e=>setTyped(e.target.value)}/></label>
 {workflow.error?<ErrorLine>{workflow.error}</ErrorLine>:null}{workflow.lines.map((line,i)=><p key={i}>{line}</p>)}
 <div className="skill-dialog-actions"><Button disabled={workflow.busy} onClick={onClose}>Cancel</Button><Button kind={kind==='delete'?'danger':'primary'} disabled={workflow.busy||typed!==skill.name||(kind!=='delete'&&!to)} onClick={()=>void submit()}>{title}</Button></div></>}</DialogPopup></Dialog>;
}
