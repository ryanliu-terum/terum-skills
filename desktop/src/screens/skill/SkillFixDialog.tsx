import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useBackend } from '../../backend';
import type { Result, SkillDetail, SkillFileResult, ValidateResult } from '../../backend/types';
import type { useWorkflow } from '../../components/domain/useWorkflow';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { ErrorLine, SectionLabel, Small, TerminalHint } from '../../components/domain/Primitives';
import { plural } from '../marketplace/market-data';

/** Whether the team already holds this skill. A publish after the fix is then a REpublish — the team's copy
 *  carries the same faults, so the box starts checked. For a folder the team has never seen, publishing
 *  would share it for the first time, a larger step than the repair, so the box is offered unchecked. */
function teamHoldsSkill(s:Pick<SkillDetail,'teamed'|'knownToTeam'|'teamState'>):boolean{return s.teamed||s.knownToTeam||s.teamState==='endorsed'||s.teamState==='shared';}

/** The Fix confirmation. Before anything is written it shows the exact changes `skill fix` will make — the
 *  sentences `validate` returns as `repairs`, from the same planner the verb runs — and offers to publish
 *  the repaired folder in the same gesture. The workflow is the PAGE's (SkillScreen), as for the file
 *  dialogs, so an outcome outlives the dialog. A validation the Quality tab already holds is reused;
 *  the broken-flag button arrives without one and the dialog asks the CLI itself. */
export function SkillFixDialog({skill,workflow,validation,publishing,progressLabel,onClose,onDone,publishOptions}:{skill:SkillDetail;workflow:ReturnType<typeof useWorkflow>;validation:Result<ValidateResult>|null;publishing:boolean;progressLabel:string|null;onClose:()=>void;onDone:(value:SkillFileResult,republish:boolean)=>void;/** The page's publish options (target, category), drawn while republish is ticked so the fix dialog asks what the publish dialog asks. */publishOptions?:ReactNode}) {
 const backend=useBackend(),held=teamHoldsSkill(skill);
 const [plan,setPlan]=useState<Result<ValidateResult>|null>(validation?.value?validation:null),[republish,setRepublish]=useState(held),[result,setResult]=useState<SkillFileResult|null>(null);
 const path=skill.path;
 useEffect(()=>{if(plan!==null||path===null)return;let live=true;backend.validate({ref:path,...(skill.team?{team:skill.team}:{})}).then(value=>{if(live)setPlan(value);},reason=>{if(live)setPlan({ok:false,error:reason instanceof Error?reason.message:String(reason)});});return()=>{live=false;};},[backend,plan,path,skill.team]);
 const repairs=plan?.value?.repairs??[],repairable=plan?.value?.repairable??repairs.length,findings=plan?.value?.findings??null;
 // Nothing to apply when the planner counted zero; when it could not be asked, the verb itself reports.
 const nothing=plan?.value!==undefined&&repairable===0;
 const running=workflow.busy||publishing;
 async function submit(){if(path===null)return;const outcome=await workflow.run(()=>backend.skillFile.fix({path}));if(outcome?.ok){setResult(outcome.value);if(republish)onDone(outcome.value,true);}}
 // Escape and an outside click arrive as a plain close. While the fix or the publish runs the close is
 // cancelled; once the fix has landed, any dismissal hands the outcome on so the page refreshes. With
 // republish ticked the outcome is handed on the moment the fix lands, and the page's publish closes
 // the dialog when it finishes; the notices stay readable above its progress line meanwhile.
 return <Dialog open onOpenChange={(open,details)=>{if(open)return;if(running){details.cancel();return;}if(result){onDone(result,false);return;}onClose();}}><DialogPopup><DialogTitle>Fix {skill.name}</DialogTitle><DialogDescription>Applies the repairs with one right answer — YAML's own grammar, the folder name, the team's license policy, invisible characters, a file mode. The text you wrote is unchanged. A fault that needs your judgement is listed afterwards, never guessed at.</DialogDescription>
 {result?<><div role="status">{result.notices.map((line,i)=><p key={i}>{line}</p>)}</div>{publishing?<div role="status" className="skill-dialog-progress">{progressLabel??`Publishing ${skill.name} to the team…`}</div>:<Button onClick={()=>onDone(result,false)}>Done</Button>}</>:<>
 <div className="board-column" style={{gap:6}}><SectionLabel>{plan===null?'Checking':nothing?'Nothing to fix':'Will change'}</SectionLabel>
  {plan===null?<div role="status"><Small>Asking terum-skills what fix would change…</Small></div>
  :repairs.length?<ul className="fix-plan" aria-label="Repairs">{repairs.map((line,i)=><li key={i}>{line}</li>)}</ul>
  :nothing?<Small>Nothing here is a fault fix covers; the findings need you.</Small>
  :plan.value?<Small>Fix will make {plural(repairable,'change')}. This terum-skills version does not list them in advance.</Small>
  :<Small>The list could not be read; fix reports what it changed when it finishes.</Small>}
  {plan!==null&&!plan.ok&&plan.value===undefined?<ErrorLine>{plan.error}</ErrorLine>:null}
  {findings!==null&&findings>0&&!nothing?<Small>{plural(findings,'finding')} reported · anything fix does not cover stays listed for you afterwards.</Small>:null}</div>
 <div className="board-column" style={{gap:2}}><Checkbox checked={republish} disabled={running||nothing} onCheckedChange={value=>setRepublish(value)} label={held?'Republish to the team after fixing':'Publish to the team after fixing'}/><Small>{held?"The team's copy carries the same faults; publishing mints the next version with the fix.":'The team does not hold this skill yet; publishing would share it for the first time.'}</Small></div>
 {republish&&publishOptions?publishOptions:null}
 {workflow.error?<ErrorLine>{workflow.error}</ErrorLine>:null}{workflow.lines.map((line,i)=><p key={i}>{line}</p>)}
 <TerminalHint command={`npx -y terum-skills@latest skill fix ${path??skill.name}`}/>
 <div className="skill-dialog-actions"><Button disabled={running} onClick={onClose}>Cancel</Button><Button kind="primary" disabled={running||nothing||path===null} onClick={()=>void submit()}>{republish?held?'Fix and republish':'Fix and publish':'Fix'}</Button></div></>}</DialogPopup></Dialog>;
}
