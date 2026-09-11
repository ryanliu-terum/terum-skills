import { QueryClientContext } from '@tanstack/react-query';
import { useCallback, useContext, useState, useSyncExternalStore } from 'react';
import { useEvalRun } from '../../app/eval-run-context';
import { Button } from '../ui/Button';
import { useBackend, usePreference } from '../../backend';
import type { AppUpdateStatus, Result, Surfaces, Capabilities } from '../../backend/types';
import { stagedAppUpdate } from '../../lib/app-update';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { TerumMark } from './TerumMark';
import { TrafficLights } from './TrafficLights';
export function TopBar({mode,inboxAvailable=true,sidebarCollapsed=false,onShowSidebar}:{mode:Capabilities['windowChrome'];inboxAvailable?:boolean;sidebarCollapsed?:boolean;onShowSidebar?:()=>void}){
 const backend=useBackend(),[error,setError]=useState<string|null>(null);
 const {current,show,stop}=useEvalRun();
 // The bar is also usable before a query cache exists. Read only: Shell and the launch hook own these observations.
 const client=useContext(QueryClientContext);
 const subscribe=useCallback((notify:()=>void)=>client?.getQueryCache().subscribe(notify)??(()=>{}),[client]);
 const surfaces=useSyncExternalStore(subscribe,()=>client?.getQueryData<Surfaces>(['surfaces']));
 const update=useSyncExternalStore(subscribe,()=>client?.getQueryState<Result<AppUpdateStatus>>(['app-update']));
 const status=update?.data?.ok?update.data.value:null;
 const available=surfaces?.appUpdate&&update?.fetchStatus!=='fetching'&&status?.supported&&status.newer&&status.latest;
 const badge=usePreference('inbox:badge',true);
 function act(action:'toggle-maximize'|'start-drag'){if(mode==='cosmetic')return;void backend.windowAction(action).then(result=>{if(!result.ok)setError(result.error);},reason=>setError(String(reason)));}
 const drag={ 'data-tauri-drag-region':true, onMouseDown:(event:React.MouseEvent<HTMLElement>)=>{if(event.target!==event.currentTarget||event.button!==0)return;event.stopPropagation();if(event.detail===1)act('start-drag');}, onMouseUp:(event:React.MouseEvent<HTMLElement>)=>{if(event.target===event.currentTarget)event.stopPropagation();}, onDoubleClick:(event:React.MouseEvent<HTMLElement>)=>{if(event.target===event.currentTarget){event.stopPropagation();act('toggle-maximize');}} };
 return <header className="topbar" {...drag}><div className="topbar-left" {...drag}>
 {mode==='cosmetic'?<TrafficLights/>:mode==='mac-overlay'?<div style={{width:52,flexShrink:0}} {...drag}/>:null}
 <div className="mark-slot"><TerumMark/></div><button className="icon-button" aria-label="Back" onClick={()=>history.back()}><Icon name="chevron-left"/></button><button className="icon-button" aria-label="Forward" onClick={()=>history.forward()}><Icon name="chevron-right"/></button>{sidebarCollapsed?<button type="button" className="icon-button" aria-label="Show sidebar" aria-expanded={false} onClick={onShowSidebar} style={{width:20,height:20,color:'var(--tk-text4)'}}><Icon name="panel-left" size={14}/></button>:null}
 </div><div className="search-slot" {...drag}><a className="shell-link search-box" href="#/search"><Icon name="search"/><span style={{flexGrow:1,whiteSpace:'nowrap'}}>Search skills, people, projects</span><Kbd>⌘K</Kbd></a></div>
 <div className="topbar-right" {...drag}>{available?<button className="eval-chip update-chip" onClick={()=>{location.hash='/settings/updates?focus=app';}}><span style={{display:"inline-flex",verticalAlign:"middle"}}><Icon name="arrow-down-to-line" size={12}/></span> {stagedAppUpdate(status)!==null?'Update ready':'Update available'} · {status.latest}</button>:null}{current?.state==='running'?<><button className="eval-chip" onClick={show}>Eval running · {current.name}</button><Button kind="danger" height={24} onClick={()=>void stop()}>Stop</Button></>:null}{inboxAvailable?<a data-badge={badge||undefined} className="shell-link icon-button bell-button" aria-label="Inbox" href="#/inbox"><Icon name="bell"/></a>:null}{error?<span role="alert">{error}</span>:null}</div></header>;
}
