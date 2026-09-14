import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import type { SkillDetail, SkillFileResult } from '../../backend/types';
import type { useWorkflow } from '../../components/domain/useWorkflow';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { ErrorLine } from '../../components/domain/Primitives';
import { fileDestinations } from './file-destinations';

/** `delete` alone carries the CLI's typed-name confirmation (Ryan, 2026-09-14): move, copy and rename
 *  are undone by a second run of the same verb and overwrite nothing, so the typed name was friction.
 *  The CLI stopped asking for those three in the same change (src/commands/skill.ts) — this dialog never
 *  answers a question it does not draw (Ryan, 2026-09-09). The workflow is the PAGE's (SkillScreen), the
 *  way SettingsDialogs owns its dialogs' workflow: a cancelled or refused result lands in
 *  `workflow.notice` and closes the dialog, so a dialog-owned workflow unmounted with the notice unread
 *  (hybrid review r1, high) — the page outlives the dialog and renders it. */
export function SkillFileDialog({kind,skill,workflow,onClose,onDone}:{kind:'move'|'copy'|'rename'|'delete';skill:SkillDetail;workflow:ReturnType<typeof useWorkflow>;onClose:()=>void;onDone:(value:SkillFileResult)=>void}) {
 const backend=useBackend(),[typed,setTyped]=useState(''),[to,setTo]=useState(''),[result,setResult]=useState<SkillFileResult|null>(null);
 const picking=kind==='move'||kind==='copy';
 const roots=useQuery({queryKey:['library','file-destinations'],enabled:picking,queryFn:()=>backend.library({scope:{kind:'global'}})});
 // Destination data is the local registry carried by the Library roots; no team catalogue is consulted.
 const destinations=fileDestinations(roots.data?.ok?roots.data.value.roots:[],skill.owningRoot);
 // The picker opens on a real destination — there is no "choose one" row to select past (Ryan, 2026-09-14).
 // `to` stays empty until the user picks, so the default follows the list while it is still loading.
 const chosen=picking?(to||destinations[0]?.value||''):to;
 const nowhere=picking&&roots.data?.ok===true&&destinations.length===0;
 const title=kind==='delete'?'Delete':kind==='rename'?'Rename':kind==='copy'?'Copy':'Move';
 const description=kind==='rename'?'The folder name is the invocation name. If published, the remote stays keyed by the old name: your next publish creates a new skill at Version 1.'
  :kind==='move'?'Moves these local files. A folder already at the destination is kept in that root’s .claude/old-skills folder.'
  :kind==='copy'?'Copies these local files into the other root and leaves this folder where it is. Both folders carry the same skill, so the app still shows one skill in two roots; a folder already at the destination is kept in that root’s .claude/old-skills folder.'
  :skill.placed?'This skill was installed from the team — deleting it also removes it from your installs. An unmodified copy is removed outright; reinstall to restore it. An edited copy is moved to quarantine until prune.'
  :'This folder is moved to quarantine. You can move it back until prune removes it.';
 async function submit(){if(!skill.path)return;const path=skill.path;const outcome=await workflow.run(()=>kind==='move'?backend.skillFile.move({path,to:chosen}):kind==='copy'?backend.skillFile.copy({path,to:chosen}):kind==='rename'?backend.skillFile.rename({path,to}):backend.skillFile.delete({path}),kind==='delete'?{[`Type ${skill.name} to delete this folder`]:typed}:{});if(outcome?.ok)setResult(outcome.value);}
 // Escape and an outside click arrive as a plain close. Once the operation has succeeded the dialog's only
 // job is to hand the outcome on, so any dismissal is Done — otherwise the page stayed on ?path=<old> and
 // reported the moved folder as not in the Library (hybrid review r1, high). While busy the close is cancelled.
 return <Dialog open onOpenChange={(open,details)=>{if(open)return;if(result){onDone(result);return;}if(workflow.busy){details.cancel();return;}onClose();}}><DialogPopup><DialogTitle>{title} {skill.name}</DialogTitle><DialogDescription>{description}</DialogDescription>{result?<><div role="status">{result.notices.map((line,i)=><p key={i}>{line}</p>)}</div><Button onClick={()=>onDone(result)}>Done</Button></>:<>
 {kind==='rename'?<label>New name<input aria-label="New name" value={to} onChange={e=>setTo(e.target.value)}/></label>:null}
 {picking&&destinations.length?<label>{title} to<select aria-label={title+' to'} value={chosen} onChange={e=>setTo(e.target.value)}>{destinations.map(root=><option key={root.id} value={root.value}>{root.label}</option>)}</select></label>:null}
 {nowhere?<p>{skill.owningRoot?.label??'This root'} is the only Library root on this machine, so there is nowhere to {kind} this folder. Add a project in Settings ▸ This machine and it becomes a destination.</p>:null}
 {roots.data?.ok===false?<ErrorLine>{roots.data.error}</ErrorLine>:null}
 {kind==='delete'?<label>Type {skill.name} to confirm<input aria-label="Skill name to confirm" value={typed} onChange={e=>setTyped(e.target.value)}/></label>:null}
 {workflow.error?<ErrorLine>{workflow.error}</ErrorLine>:null}{workflow.lines.map((line,i)=><p key={i}>{line}</p>)}
 <div className="skill-dialog-actions"><Button disabled={workflow.busy} onClick={onClose}>Cancel</Button><Button kind={kind==='delete'?'danger':'primary'} disabled={workflow.busy||(kind==='delete'?typed!==skill.name:kind==='rename'?!to:!chosen)} onClick={()=>void submit()}>{title}</Button></div></>}</DialogPopup></Dialog>;
}
