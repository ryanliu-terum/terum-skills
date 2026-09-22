import { useBackend, useFeatures, usePreference } from '../../backend';
import type { ReactNode } from 'react';
import type { Root, StatusResult, Surfaces } from '../../backend/types';
import type { IconName } from '../ui/icon-paths';
import { Icon } from '../ui/Icon';
import { useNavigate } from 'react-router';
import { useContextMenu, useCopy, useHostReveal } from './context-menu';
import type { ContextMenuBuilder, ContextMenuItem } from './context-menu';
const MANAGE_ROWS=(navigate:(to:string)=>void):ContextMenuItem[]=>[{key:'sep',kind:'separator'},{key:'manage',label:'Manage projects…',icon:'settings',onSelect:()=>navigate('/settings/machine')}];
import { Footer } from './Footer';
import { useAddLibraryProject } from './useAddLibraryProject';
import { useRenameLibraryProject } from './useRenameLibraryProject';
import { projectTree } from '../../lib/project-tree';
import './Sidebar.css';
function SectionHeader({label,trailing}:{label:string;trailing?:ReactNode}){return <div className="section-header"><div><span>{label}</span><Icon name="chevron-down" size={12} color="var(--tk-text4)" stroke="2"/></div>{trailing}</div>;}
/**
 * A row with an `href` is a link, and an expandable one carries a small chevron button so the label
 * still navigates. A row with no `href` is its own toggle: the whole row switches the section and the
 * chevron is only a marker, because a nested button inside a button is not valid markup.
 */
function NavRow({label,icon,href,selected=false,nested=false,depth=0,expandable=false,collapsed=false,onToggle,count,trailing,menu=null}:{label:string;icon:IconName;href?:string;selected?:boolean;nested?:boolean;/** Sub-projects: one indent step per level under the nested row's own. */depth?:number;expandable?:boolean;collapsed?:boolean;onToggle?:()=>void;count?:string|undefined;trailing?:ReactNode;menu?:ContextMenuBuilder|null}){
 const menuRef=useContextMenu(menu);
 const style={paddingLeft:nested?32+16*depth:8,background:selected?'var(--tk-bg3)':'transparent',color:selected?'var(--tk-text1)':'var(--tk-text2)'};
 const toggleLabel=(collapsed?'Expand ':'Collapse ')+label;
 const chevron=<span className="nav-chevron"><Icon name={collapsed?'chevron-right':'chevron-down'} size={12} color="var(--tk-text4)" stroke="2"/></span>;
 const inner=<><div className="nav-label"><Icon name={icon} color={selected?'var(--tk-text1)':'var(--tk-text3)'}/><span>{label}</span>{expandable?href!==undefined?<button type="button" className="icon-button" aria-label={toggleLabel} aria-expanded={!collapsed} style={{width:12,height:12,flexShrink:0}} onClick={event=>{event.preventDefault();event.stopPropagation();onToggle?.();}}>{chevron}</button>:chevron:null}</div>{count!==undefined?<span className="nav-count" style={{color:selected?'var(--tk-text2)':'var(--tk-text3)'}}>{count}</span>:null}{trailing}</>;
 if(href===undefined)return <button type="button" ref={menuRef} className="shell-link nav-row nav-row-button" aria-label={toggleLabel} aria-expanded={!collapsed} style={style} onClick={()=>onToggle?.()}>{inner}</button>;
 return <a href={href} ref={menuRef} className="shell-link nav-row" aria-current={selected?'page':undefined} style={style}>{inner}</a>;
}
export function Sidebar({selected,counts,me,surfaces,roots,collapsedSections=[],onToggleSection,onHide}:{collapsedSections?:readonly string[];onToggleSection?:(section:string)=>void;onHide?:()=>void;selected:string;counts:Record<string,string>|null;me?:StatusResult['me']|undefined;surfaces?:Surfaces|undefined;roots?:readonly Root[]|undefined}){
 const projectRoots=roots?.filter(r=>r.kind==='checkout')??[],globalRoot=roots?.find(r=>r.kind==='global');
 // Right-click on a Library folder row: reveal it, copy its path, or jump to the Projects list in Settings (2026-09-14).
 const backend=useBackend(),copy=useCopy(),navigate=useNavigate(),reveal=useHostReveal();
 const features=useFeatures(),projectRename=useRenameLibraryProject();
 // Rename… sits between the folder rows and Manage: it is the one action that changes the row itself, and only a CLI with `project rename` offers it.
 const folderMenu=(path:string,project:Root|null):ContextMenuItem[]=>[{key:'reveal',label:reveal,icon:'folder',onSelect:()=>void backend.revealPath(path)},{key:'copy',label:'Copy path',icon:'copy',onSelect:()=>void copy(path,'path')},...(project&&features?.projectRename?[{key:'rename',label:'Rename…',icon:'pencil' as const,onSelect:()=>projectRename.open(project)}]:[]),...(project?MANAGE_ROWS(navigate):[])];const showCounts=usePreference('appearance:counts',true);const displayedCounts=showCounts?counts:null;
 // One workflow instance for the whole sidebar (the app's per-surface convention): the next action
 // anywhere in the sidebar replaces a shown error instead of pinning it to its row forever, and a
 // route change remounts the Shell, dropping it. `errorAt` routes the one error to the row that owns it.
 const projectAdd=useAddLibraryProject();
 return <aside className="sidebar"><nav className="sidebar-inner" aria-label="Main navigation"><div className="nav-group"><SectionHeader label="Library" trailing={<button type="button" className="icon-button" aria-label="Hide sidebar" aria-expanded={true} onClick={onHide} style={{width:20,height:20,color:'var(--tk-text4)'}}><Icon name="panel-left" size={14}/></button>}/>
 <NavRow label="Global" icon="globe" href="#/library/global" selected={selected==='Global'} count={displayedCounts?.Global} menu={globalRoot?()=>folderMenu(globalRoot.root,null):null}/>{surfaces?.library!==false?<><NavRow label="Projects" icon="folder" expandable collapsed={collapsedSections.includes('projects')} onToggle={()=>onToggleSection?.('projects')}/>
 {!collapsedSections.includes('projects')&&<>{projectRoots.length?projectTree(projectRoots).map(({root,depth})=><ProjectRow key={root.id} root={root} depth={depth} selected={selected===root.id} showCount={displayedCounts!==null} menu={()=>folderMenu(root.root,root)}/>):<div className="nav-row nav-empty" style={{paddingLeft:32}}><div className="nav-label"><span style={{color:'var(--tk-text4)'}}>0 projects</span></div></div>}<AddProjectRow busy={projectAdd.busy} error={projectAdd.error} onChoose={()=>{void projectAdd.add();}}/></>}</>:null}
 {surfaces?.inbox===true?<><NavRow label="Inbox" icon="inbox" href="#/inbox" expandable collapsed={collapsedSections.includes('inbox')} onToggle={()=>onToggleSection?.('inbox')} selected={selected==='Inbox'}/>{!collapsedSections.includes('inbox')&&<><NavRow label="Pushes" icon="arrow-down-to-line" href="#/inbox?tab=pushes" nested count={displayedCounts?.Pushes}/><NavRow label="Updates" icon="refresh" href="#/inbox?tab=updates" nested count={displayedCounts?.Updates}/><NavRow label="Alerts" icon="alert" href="#/inbox?tab=alerts" nested count={displayedCounts?.Alerts}/></>}</>:null}
 </div>{surfaces?.catalog!==false||surfaces?.roster!==false?<div className="nav-group"><SectionHeader label="Team"/>{surfaces?.catalog!==false?<NavRow label="Marketplace" icon="store" href="#/marketplace" selected={selected==='Marketplace'}/>:null}{surfaces?.roster!==false?<NavRow label="Members" icon="users" href="#/share" selected={selected==='Members'}/>:null}</div>:null}</nav><Footer me={me} settings={selected==='Settings'}/>{projectAdd.dialog}{projectRename.dialog}</aside>;
}

/**
 * §7.2: every row here is a project the user added, so there is no per-row "+ Add" any more — the only
 * way a project reaches this list is the Add project button below it.
 */
function ProjectRow({root,depth,selected,showCount,menu}:{root:Root;depth:number;selected:boolean;showCount:boolean;menu:ContextMenuBuilder}) {
 return <NavRow label={root.label} icon="box" href={'#/library/checkout?root='+encodeURIComponent(root.id)} selected={selected} nested depth={depth} menu={menu} count={!showCount?undefined:root.rootState==='absent'||root.rootState==='unreadable'?'—':root.count}/>;
}

/**
 * D1 registration by an explicit Add: the native chooser names the folder, `project add` adds it.
 * A cancelled dialog is not an error, so it leaves the sidebar exactly as it was.
 */
function AddProjectRow({busy,error,onChoose}:{busy:boolean;error:string|null;onChoose:()=>void}) {
 const features=useFeatures();
 if(!features?.libraryProjects)return null; // an older CLI has no `project add`, and this is the only way in
 return <><button type="button" className="shell-link nav-row nav-add-project" style={{paddingLeft:32,background:'transparent',color:'var(--tk-text3)'}} disabled={busy} onClick={onChoose}><div className="nav-label"><Icon name="plus" color="var(--tk-text3)"/><span>Add project</span></div></button>{error?<div role="alert" className="nav-error">{error}</div>:null}</>;
}
