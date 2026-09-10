import type { SkillCard } from '../../backend/types';

/** One row of the card's ⋯ menu. `to` is a router path; a disabled row carries the reason it
 *  cannot run instead, so the menu keeps a fixed shape and the card says why (Ryan, 2026-09-09). */
export interface CardAction { key:'open'|'run-eval'|'move'|'place'|'publish'; label:string; to:string|null; reason:string|null }

/** The detail route for a card: a local folder is addressed by path, a team skill by name. */
export function detailPath(skill:Pick<SkillCard,'project'|'path'|'name'>):string {
 return skill.project==='local'&&skill.path?'/skill/local?path='+encodeURIComponent(skill.path):'/skill/'+encodeURIComponent(skill.name);
}
function withParams(base:string,params:string[]):string {
 const query=params.filter(Boolean).join('&');
 return query?base+(base.includes('?')?'&':'?')+query:base;
}

/** Every state-changing action a card offers, in menu order. `origin` is the `root=marketplace`
 *  crumb the detail page reads back, or '' from the library. */
export function cardActions(skill:SkillCard,{origin='',runEvalInApp=false}:{origin?:string;runEvalInApp?:boolean}={}):CardAction[] {
 const base=detailPath(skill),at=(...params:string[])=>withParams(base,[...params,origin]);
 const actions:CardAction[]=[{key:'open',label:'Open',to:at(),reason:null}];
 if(runEvalInApp)actions.push({key:'run-eval',label:'Run eval',to:at('tab=evals','dialog=run-eval'),reason:null});
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
 return {key:'place',label:'Install…',to:at('dialog=install'),reason:null};
}
/** Publish endorses the skill into team.json; it throws on anything the team repo does not hold,
 *  so those states are disabled with the reason rather than hidden. */
function publishAction(skill:SkillCard,at:At):CardAction {
 const reason=skill.teamState==='shared'?null
  :skill.teamState==='endorsed'?'Already published to the team.'
  :skill.teamState==='unshared'?'Not shared with the team yet. Sync auto-shares global skills; a project checkout is shared with connect.'
  :'Terum could not read this team, so it cannot tell whether this skill is published.';
 return {key:'publish',label:'Publish to team…',to:reason?null:at('dialog=publish'),reason};
}
