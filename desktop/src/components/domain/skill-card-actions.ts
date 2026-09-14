import type { SkillCard } from '../../backend/types';

/** One row of the card's ⋯ menu. `to` is a router path; a disabled row carries the reason it
 *  cannot run instead, so the menu keeps a fixed shape and the card says why (Ryan, 2026-09-09). */
export interface CardAction { key:'open'|'run-eval'|'move'|'place'|'publish'|'rename'|'delete'; label:string; to:string|null; reason:string|null }

/** Every way into the detail page goes through here, so a folder that belongs to no team is
 *  addressed by path and a team skill by name. Never read `project` for this — it carries the root
 *  a folder lives in ('Global' or a checkout's basename), which does not distinguish the two. */
export function detailPath(skill:Pick<SkillCard,'teamed'|'path'|'name'>):string {
 return !skill.teamed&&skill.path?'/skill/local?path='+encodeURIComponent(skill.path):'/skill/'+encodeURIComponent(skill.name);
}
/** The ref every write verb sends for a card or a detail: the folder's path when the team has never seen it
 *  (the CLI accepts a path ref since #193), the team skill's name otherwise. `publish`, `eval` and both bulk
 *  dialogs share this one rule, so no two of them can ever address the same folder differently. */
export function localRef(skill:Pick<SkillCard,'teamed'|'path'|'name'>):string { return !skill.teamed&&skill.path?skill.path:skill.name; }
function withParams(base:string,params:string[]):string {
 const query=params.filter(Boolean).join('&');
 return query?base+(base.includes('?')?'&':'?')+query:base;
}

/** Every state-changing action a card offers, in menu order. `origin` is the origin the detail page
 *  reads back — `root=marketplace`, or `root=<checkout repo root>` from a project Library — or '' from the Global library. */
export function cardActions(skill:SkillCard,{origin='',runEvalInApp=false}:{origin?:string;runEvalInApp?:boolean}={}):CardAction[] {
 const base=detailPath(skill),ridesOrigin=skill.teamed||!skill.path,at=(...params:string[])=>withParams(base,[...params,ridesOrigin?origin:'']);
 const actions:CardAction[]=[{key:'open',label:'Open',to:at(),reason:null}];
 // §11.4: evals run against the copy on this machine, so the row stays and says why when there is none.
 const evalReason=localActionReason(skill,'eval');
 if(runEvalInApp)actions.push({key:'run-eval',label:'Run eval',to:evalReason?null:at('tab=evals','dialog=run-eval'),reason:evalReason});
 if(!skill.teamed){
  actions.push(moveAction(skill,at),{key:'rename',label:'Rename…',to:at('dialog=file-rename'),reason:null},{key:'delete',label:'Delete…',to:at('dialog=file-delete'),reason:null});
 }else actions.push(placeAction(skill,at));
 actions.push(publishAction(skill,at));
 return actions;
}

type At = (...params:string[])=>string;
/** D18: move the local bytes, including edits, through the skillFile seam. */
function moveAction(skill:SkillCard,at:At):CardAction {
 return {key:'move',label:'Move to…',to:at('dialog=file-move'),reason:null};
}
/** One state-dependent row: the card menu is the only place install and uninstall live. */
function placeAction(skill:SkillCard,at:At):CardAction {
 if(skill.placed)return {key:'place',label:'Uninstall…',to:at('dialog=remove'),reason:null};
 if(skill.onDiskOnly)return {key:'place',label:'Install…',to:null,reason:'A copy already sits on this machine that Terum did not place. Connect it to manage it here.'};
 // The people file records this user installing it but nothing is on this machine (#129's tri-state,
 // ryanliu 2026-09-09). The card's footer button and the marketplace overlay carried that sentence
 // before this branch removed both, so the menu row states it instead of offering a bare Install.
 if(skill.installed==='recorded')return {key:'place',label:'Reinstall…',to:at('dialog=install'),reason:'Installed · not on this machine.'};
 return {key:'place',label:'Install…',to:at('dialog=install'),reason:null};
}
/** §11.4: the gate is the local folder alone. A skill the team already holds IS publishable — that is
 *  how its next version ships (§5.1 step 9 mints highest+1; identical bytes mint nothing). The
 *  endorsement-era `teamState` branches went with §12. */
function publishAction(skill:SkillCard,at:At):CardAction {
 const reason=localActionReason(skill,'publish');
 return {key:'publish',label:'Publish to team…',to:reason?null:at('dialog=publish'),reason};
}

/** Shared path/inspection gate for the menu, detail buttons and pasted dialog URLs. */
export function localActionReason(skill:Pick<SkillCard,'path'|'teamed'|'flags'|'flagText'>,action:'eval'|'publish'):string|null {
 return !skill.path?(action==='eval'?'Install it first — evals run against the copy on your machine.':'This skill is not on this machine, so there is nothing to publish.'):!skill.teamed&&skill.flags.includes('broken')?skill.flagText.broken??'This folder is not a usable skill.':null;
}
