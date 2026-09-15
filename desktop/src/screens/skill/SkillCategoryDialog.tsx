import { useState } from 'react';
import { useBackend } from '../../backend';
import type { SkillDetail, SkillFileResult } from '../../backend/types';
import type { useWorkflow } from '../../components/domain/useWorkflow';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { WorkflowField } from '../../components/domain/WorkflowControls';
import { ErrorLine, SectionLabel, Small, TerminalHint } from '../../components/domain/Primitives';

/** The Change-category confirmation. It drives `skill category <path> --to <name>`, which rewrites
 *  `metadata.terum-category` in this folder's SKILL.md and stops: nothing is published and nothing
 *  reaches the team, because a published category lives inside an immutable version and only a new
 *  one can change what the marketplace shows. The CLI says so in its notices, with the publish command,
 *  and they are shown here verbatim rather than restated.
 *
 *  The team's categories are a `datalist`, never a `select`: `team.json` `categories` is advice (the
 *  CLI warns on an off-list name and writes it anyway), so the field must accept a name the list does
 *  not hold. Both refusals — an empty name, and the one the file already declares — stay the CLI's to
 *  make; only the obvious no-op is disabled here, so its message is never the one a user has to guess.
 *  The workflow is the PAGE's (SkillScreen), as for the file dialogs, so an outcome outlives the dialog. */
export function SkillCategoryDialog({skill,categories,workflow,onClose,onDone}:{skill:SkillDetail;categories:readonly string[]|null;workflow:ReturnType<typeof useWorkflow>;onClose:()=>void;onDone:(value:SkillFileResult)=>void}) {
 const backend=useBackend(),current=skill.category==='—'?'':skill.category;
 const [to,setTo]=useState(current),[result,setResult]=useState<SkillFileResult|null>(null);
 const path=skill.path,wanted=to.trim();
 async function submit(){if(path===null)return;const outcome=await workflow.run(()=>backend.skillFile.category({path,to:wanted}));if(outcome?.ok)setResult(outcome.value);}
 // Escape and an outside click arrive as a plain close; while the run is in flight the close is cancelled,
 // and once it has landed any dismissal hands the outcome on so the page refetches the folder.
 return <Dialog open onOpenChange={(open,details)=>{if(open)return;if(workflow.busy){details.cancel();return;}if(result){onDone(result);return;}onClose();}}><DialogPopup><DialogTitle>Category for {skill.name}</DialogTitle><DialogDescription>Rewrites metadata.terum-category in this folder&rsquo;s SKILL.md and nothing else. Publishing is a separate step: the team keeps showing the category its newest version carries, because a published version&rsquo;s files never change.</DialogDescription>
 {result?<><div role="status">{result.notices.map((line,i)=><p key={i}>{line}</p>)}</div><Button onClick={()=>onDone(result)}>Done</Button></>:<>
 <div className="board-column" style={{gap:6}}><SectionLabel>Category</SectionLabel>
  <WorkflowField aria-label="Category" list="skill-category-options" placeholder={current||'misc'} value={to} onChange={event=>setTo(event.target.value)} style={{width:260}}/>
  <datalist id="skill-category-options">{(categories??[]).map(name=><option key={name} value={name}/>)}</datalist>
  <Small>{categories?.length?`Your team lists ${categories.join(', ')} — suggestions, not a fixed set. Any other name is written as typed and gets the same warning publish gives.`:'Any name is accepted; it becomes this skill’s bucket when the team browses.'}</Small></div>
 {workflow.error?<ErrorLine>{workflow.error}</ErrorLine>:null}{workflow.lines.map((line,i)=><p key={i}>{line}</p>)}
 <TerminalHint command={`npx -y terum-skills@latest skill category ${path??skill.name} --to ${wanted||'<name>'}`}/>
 <div className="skill-dialog-actions"><Button disabled={workflow.busy} onClick={onClose}>Cancel</Button><Button kind="primary" disabled={workflow.busy||path===null||!wanted||wanted===current} onClick={()=>void submit()}>Change category</Button></div></>}</DialogPopup></Dialog>;
}
