import { useBackend, useFeatures, usePreference } from '../../backend';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Root, StatusResult, Surfaces, TeamStatus } from '../../backend/types';
import type { IconName } from '../ui/icon-paths';
import { Icon } from '../ui/Icon';
import { Footer } from './Footer';
import { useWorkflow } from './useWorkflow';
import './Sidebar.css';
function SectionHeader({label,trailing}:{label:string;trailing?:ReactNode}){return <div className="section-header"><div><span>{label}</span><Icon name="chevron-down" size={12} color="var(--tk-text4)" stroke="2"/></div>{trailing}</div>;}
function NavRow({label,icon,href,selected=false,nested=false,expandable=false,collapsed=false,onToggle,count,trailing}:{label:string;icon:IconName;href:string;selected?:boolean;nested?:boolean;expandable?:boolean;collapsed?:boolean;onToggle?:()=>void;count?:string|undefined;trailing?:ReactNode}){
 return <a href={href} className="shell-link nav-row" aria-current={selected?'page':undefined} style={{paddingLeft:nested?32:8,background:selected?'var(--tk-bg3)':'transparent',color:selected?'var(--tk-text1)':'var(--tk-text2)'}}><div className="nav-label"><Icon name={icon} color={selected?'var(--tk-text1)':'var(--tk-text3)'}/><span>{label}</span>{expandable?<button type="button" className="icon-button" aria-label={(collapsed?'Expand ':'Collapse ')+label} aria-expanded={!collapsed} style={{width:12,height:12,flexShrink:0}} onClick={event=>{event.preventDefault();event.stopPropagation();onToggle?.();}}><Icon name={collapsed?'chevron-right':'chevron-down'} size={12} color="var(--tk-text4)" stroke="2"/></button>:null}</div>{count!==undefined?<span className="nav-count" style={{color:selected?'var(--tk-text2)':'var(--tk-text3)'}}>{count}</span>:null}{trailing}</a>;
}
export function Sidebar({selected,counts,machine,me,surfaces,team,roots,collapsedSections=[],onToggleSection,onHide}:{collapsedSections?:readonly string[];onToggleSection?:(section:string)=>void;onHide?:()=>void;team?:TeamStatus|undefined;selected:string;counts:Record<string,string>|null;machine:StatusResult['machine']|undefined;me?:StatusResult['me']|undefined;surfaces?:Surfaces|undefined;roots?:readonly Root[]|undefined}){
 const checkoutRoots=roots?.filter(r=>r.kind==='checkout')??[];const showCounts=usePreference('appearance:counts',true);const displayedCounts=showCounts?counts:null;
 // One workflow instance for the whole sidebar (the app's per-surface convention): the next action
 // anywhere in the sidebar replaces a shown error instead of pinning it to its row forever, and a
 // route change remounts the Shell, dropping it. `errorAt` routes the one error to the row that owns it.
 const backend=useBackend(),action=useWorkflow(),[errorAt,setErrorAt]=useState<string|null>(null);
 function addCheckout(id:string){setErrorAt(id);void action.run(()=>backend.checkouts.add(id));}
 async function addProject(){
  setErrorAt('add-project');
  action.clear();
  const picked=await backend.pickFolder();
  if(!picked.ok){action.fail(picked.error);return;}
  const path=picked.value;
  if(path===null)return;
  await action.run(()=>backend.checkouts.add(path));
 }
 return <aside className="sidebar"><nav className="sidebar-inner" aria-label="Main navigation"><div className="nav-group"><SectionHeader label="Library" trailing={<button type="button" className="icon-button" aria-label="Hide sidebar" aria-expanded={true} onClick={onHide} style={{width:20,height:20,color:'var(--tk-text4)'}}><Icon name="panel-left" size={14}/></button>}/>
 <NavRow label="Global" icon="globe" href="#/library/global" selected={selected==='Global'} count={displayedCounts?.Global}/>{surfaces?.library!==false?<><NavRow label="Projects" icon="folder" href="#/marketplace/projects" expandable collapsed={collapsedSections.includes('projects')} onToggle={()=>onToggleSection?.('projects')}/>
 {!collapsedSections.includes('projects')&&<>{checkoutRoots.length?checkoutRoots.map(root=><CheckoutRow key={root.id} root={root} selected={selected===root.id} showCount={displayedCounts!==null} busy={action.busy} error={errorAt===root.id?action.error:null} onAdd={()=>addCheckout(root.id)}/>):<div className="nav-row nav-empty" style={{paddingLeft:32}}><div className="nav-label"><span style={{color:'var(--tk-text4)'}}>0 projects</span></div></div>}<AddProjectRow busy={action.busy} error={errorAt==='add-project'?action.error:null} onChoose={()=>{void addProject();}}/></>}</>:null}
 {surfaces?.inbox===true?<><NavRow label="Inbox" icon="inbox" href="#/inbox" expandable collapsed={collapsedSections.includes('inbox')} onToggle={()=>onToggleSection?.('inbox')} selected={selected==='Inbox'}/>{!collapsedSections.includes('inbox')&&<><NavRow label="Pushes" icon="arrow-down-to-line" href="#/inbox?tab=pushes" nested count={displayedCounts?.Pushes}/><NavRow label="Updates" icon="refresh" href="#/inbox?tab=updates" nested count={displayedCounts?.Updates}/><NavRow label="Alerts" icon="alert" href="#/inbox?tab=alerts" nested count={displayedCounts?.Alerts}/></>}</>:null}
 </div>{surfaces?.catalog!==false||surfaces?.roster!==false?<div className="nav-group"><SectionHeader label="Team"/>{surfaces?.catalog!==false?<NavRow label="Marketplace" icon="store" href="#/marketplace" selected={selected==='Marketplace'}/>:null}{surfaces?.roster!==false?<NavRow label="Share" icon="users" href="#/share" selected={selected==='Share'}/>:null}</div>:null}</nav><Footer team={team} machine={machine} me={me} settings={selected==='Settings'}/></aside>;
}

function CheckoutRow({root,selected,showCount,busy,error,onAdd}:{root:Root;selected:boolean;showCount:boolean;busy:boolean;error:string|null;onAdd:()=>void}) {
 const features=useFeatures();
 return <><NavRow label={root.label} icon="box" href={'#/library/checkout?root='+encodeURIComponent(root.id)} selected={selected} nested count={!showCount?undefined:root.rootState==='absent'||root.rootState==='unreadable'?'—':root.count} trailing={root.detected&&!root.registered&&features?.checkouts?<button type="button" className="icon-button nav-add" aria-label={'Add '+root.label+' to your library'} disabled={busy} onClick={e=>{e.preventDefault();e.stopPropagation();onAdd();}}>+ Add</button>:null}/>{error?<div role="alert">{error}</div>:null}</>;
}

/**
 * D1 registration by an explicit Add: the native chooser names the folder, `checkout add` registers it.
 * A cancelled dialog is not an error, so it leaves the sidebar exactly as it was.
 */
function AddProjectRow({busy,error,onChoose}:{busy:boolean;error:string|null;onChoose:()=>void}) {
 const features=useFeatures();
 if(!features?.checkouts)return null; // an older CLI has no `checkout add`; the existing per-row + Add is hidden the same way
 return <><button type="button" className="shell-link nav-row nav-add-project" style={{paddingLeft:32,background:'transparent',color:'var(--tk-text3)'}} disabled={busy} onClick={onChoose}><div className="nav-label"><Icon name="plus" color="var(--tk-text3)"/><span>Add project</span></div></button>{error?<div role="alert" className="nav-error">{error}</div>:null}</>;
}
