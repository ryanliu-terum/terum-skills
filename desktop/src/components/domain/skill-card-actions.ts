import type { SkillCard } from '../../backend/types';

/** One row of the card's ⋯ menu. `to` is a router path; a disabled row carries the reason it
 *  cannot run instead, so the menu keeps a fixed shape and the card says why (Ryan, 2026-09-09). */
export interface CardAction { key:'open'|'run-eval'|'move'|'place'|'publish'; label:string; to:string|null; reason:string|null }

/** Every way into the detail page goes through here, so a folder that belongs to no team is
 *  addressed by path and a team skill by name. Never read `project` for this — it carries the root
 *  a folder lives in ('Global' or a checkout's basename), which does not distinguish the two. */
export function detailPath(skill:Pick<SkillCard,'teamed'|'path'|'name'>):string {
 return !skill.teamed&&skill.path?'/skill/local?path='+encodeURIComponent(skill.path):'/skill/'+encodeURIComponent(skill.name);
}
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
 if(runEvalInApp)actions.push({key:'run-eval',label:'Run eval',to:skill.path?at('tab=evals','dialog=run-eval'):null,reason:skill.path?null:'Install it first — evals run against the copy on your machine.'});
 actions.push(moveAction(skill,at),placeAction(skill,at),publishAction(skill,at));
 return actions;
}

type At = (...params:string[])=>string;
/** Move re-places the installed copy between Global and a project checkout (Ryan, 2026-09-09:
 *  machine placement, not the team's project taxonomy). Only a Terum placement can be moved. */
function moveAction(skill:SkillCard,at:At):CardAction {
 const reason=skill.placed?null
  :skill.onDiskOnly?'This copy sits on your machine but Terum did not place it, so there is no placement to move.'
  :'Install it before moving it.';
 return {key:'move',label:'Move to…',to:reason?null:at('dialog=move'),reason};
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
 const reason=skill.path?null:'This skill is not on this machine, so there is nothing to publish.';
 return {key:'publish',label:'Publish to team…',to:reason?null:at('dialog=publish'),reason};
}
