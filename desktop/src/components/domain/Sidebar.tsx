import type { ReactNode } from 'react';
import type { StatusResult, Surfaces } from '../../backend/types';
import type { IconName } from '../ui/icon-paths';
import { Icon } from '../ui/Icon';
import { Footer } from './Footer';
function SectionHeader({label,trailing}:{label:string;trailing?:ReactNode}){return <div className="section-header"><div><span>{label}</span><Icon name="chevron-down" size={12} color="var(--tk-text4)" stroke="2"/></div>{trailing}</div>;}
function NavRow({label,icon,href,selected=false,nested=false,expandable=false,count}:{label:string;icon:IconName;href:string;selected?:boolean;nested?:boolean;expandable?:boolean;count?:string|undefined}){
 return <a href={href} className="shell-link nav-row" aria-current={selected?'page':undefined} style={{paddingLeft:nested?32:8,background:selected?'var(--tk-bg3)':'transparent',color:selected?'var(--tk-text1)':'var(--tk-text2)'}}><div className="nav-label"><Icon name={icon} color={selected?'var(--tk-text1)':'var(--tk-text3)'}/><span>{label}</span>{expandable?<Icon name="chevron-down" size={12} color="var(--tk-text4)" stroke="2"/>:null}</div>{count!==undefined?<span className="nav-count" style={{color:selected?'var(--tk-text2)':'var(--tk-text3)'}}>{count}</span>:null}</a>;
}
export function Sidebar({selected,counts,machine,surfaces}:{selected:string;counts:Record<string,string>|null;machine:StatusResult['machine']|undefined;surfaces?:Surfaces|undefined}){
 return <aside className="sidebar"><nav className="sidebar-inner" aria-label="Main navigation"><div className="nav-group"><SectionHeader label="Library" trailing={<div className="icon-button" style={{width:20,height:20,color:'var(--tk-text4)'}}><Icon name="panel-left" size={14}/></div>}/>
 <NavRow label="Global" icon="globe" href="#/library/global" selected={selected==='Global'} count={counts?.Global}/>{surfaces?.library!==false?<><NavRow label="Projects" icon="folder" href="#/marketplace/projects" expandable/>
 {['Terum','SSM','MRF'].map(name=><NavRow key={name} label={name} icon="box" href={'#/library/project/'+name.toLowerCase()} selected={selected.toLowerCase()===name.toLowerCase()} nested count={counts?.[name]}/>)}</>:null}
 {surfaces?.inbox!==false?<><NavRow label="Inbox" icon="inbox" href="#/inbox" expandable selected={selected==='Inbox'}/><NavRow label="Pushes" icon="arrow-down-to-line" href="#/inbox?tab=pushes" nested count={counts?.Pushes}/><NavRow label="Updates" icon="refresh" href="#/inbox?tab=updates" nested count={counts?.Updates}/><NavRow label="Alerts" icon="alert" href="#/inbox?tab=alerts" nested count={counts?.Alerts}/></>:null}
 </div>{surfaces?.catalog!==false||surfaces?.roster!==false?<div className="nav-group"><SectionHeader label="Team"/>{surfaces?.catalog!==false?<NavRow label="Marketplace" icon="store" href="#/marketplace" selected={selected==='Marketplace'}/>:null}{surfaces?.roster!==false?<NavRow label="Share" icon="users" href="#/share" selected={selected==='Share'}/>:null}</div>:null}</nav><Footer machine={machine} settings={selected==='Settings'}/></aside>;
}
