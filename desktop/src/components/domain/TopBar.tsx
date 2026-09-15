import { QueryClientContext } from '@tanstack/react-query';
import { useCallback, useContext, useState, useSyncExternalStore } from 'react';
import { useEvalRun } from '../../app/eval-run-context';
import { evalChip } from '../../app/eval-run-status';
import type { EvalChip } from '../../app/eval-run-status';
import { usePublishRun } from '../../app/publish-run-context';
import { publishChip } from '../../app/publish-run-status';
import { Button } from '../ui/Button';
import { useBackend, usePreference } from '../../backend';
import type { AppUpdateStatus, Result, Surfaces, Capabilities } from '../../backend/types';
import { stagedAppUpdate } from '../../lib/app-update';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { searchShortcutLabel } from '../../lib/shortcuts';
import { TerumMark } from './TerumMark';
import { WindowControls } from './WindowControls';
export function TopBar({mode,controlsEnd=null,inboxAvailable=true,sidebarCollapsed=false,onShowSidebar}:{mode:Capabilities['windowChrome'];controlsEnd?:Capabilities['windowControlsEnd'];inboxAvailable?:boolean;sidebarCollapsed?:boolean;onShowSidebar?:()=>void}){
 const backend=useBackend(),[error,setError]=useState<string|null>(null);
 const {current,show,stop,clear}=useEvalRun(),chip=evalChip(current),publishRun=usePublishRun(),publishing=publishChip(publishRun.current);
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
 <WindowControls mode={mode} controlsEnd={controlsEnd} {...drag}/>
 <div className="mark-slot"><TerumMark/></div><button className="icon-button" aria-label="Back" onClick={()=>history.back()}><Icon name="chevron-left"/></button><button className="icon-button" aria-label="Forward" onClick={()=>history.forward()}><Icon name="chevron-right"/></button>{sidebarCollapsed?<button type="button" className="icon-button" aria-label="Show sidebar" aria-expanded={false} onClick={onShowSidebar} style={{width:20,height:20,color:'var(--tk-text4)'}}><Icon name="panel-left" size={14}/></button>:null}
 </div><div className="search-slot" {...drag}><a className="shell-link search-box" href="#/search"><Icon name="search"/><span style={{flexGrow:1,whiteSpace:'nowrap'}}>Search skills, people, projects</span><Kbd>{searchShortcutLabel(mode)}</Kbd></a></div>
 <div className="topbar-right" {...drag}>{available?<button className="eval-chip update-chip" onClick={()=>{location.hash='/settings/updates?focus=app';}}><span style={{display:"inline-flex",verticalAlign:"middle"}}><Icon name="arrow-down-to-line" size={12}/></span> {stagedAppUpdate(status)!==null?'Update ready':'Update available'} · {status.latest}</button>:null}{chip?<StatusChip chip={chip} stopLabel="Stop" stopTitle="Stop eval" dismissLabel="Dismiss eval status" onShow={show} onStop={()=>void stop()} onClear={clear}/>:null}{publishing?<StatusChip chip={publishing} stopLabel="Stop publish" stopTitle="Stop publish" dismissLabel="Dismiss publish status" onShow={publishRun.show} onStop={()=>void publishRun.stop()} onClear={publishRun.clear}/>:null}{inboxAvailable?<a data-badge={badge||undefined} className="shell-link icon-button bell-button" aria-label="Inbox" href="#/inbox"><Icon name="bell"/></a>:null}{error?<span role="alert">{error}</span>:null}</div></header>;
}
/** One run chip in the top bar (UI policy §5): the eval and the publish run draw the same way — the dot and the square
    Stop while running, the ✕ that forgets a settled run afterwards. `chip.subject` is the part CSS may shorten. */
function StatusChip({chip,stopLabel,stopTitle,dismissLabel,onShow,onStop,onClear}:{chip:EvalChip;/** Eval keeps the bare "Stop" its tests and users know; publish says which run it stops, since both may run at once (D3b). */stopLabel:string;stopTitle:string;dismissLabel:string;onShow:()=>void;onStop:()=>void;onClear:()=>void}){
 return <><button className="eval-chip" data-tone={chip.tone} aria-label={chip.label} title={chip.title} onClick={onShow}>{chip.running?<span className="eval-dot" aria-hidden="true"/>:null}<span className="eval-chip-state">{chip.state}</span>{chip.subject===null?null:<span className="eval-chip-subject">{'\u00a0· '+chip.subject}</span>}</button>{chip.running?<Button kind="danger" height={24} iconOnly aria-label={stopLabel} title={stopTitle} onClick={onStop}><span className="stop-glyph" aria-hidden="true"/></Button>:<button className="icon-button" aria-label={dismissLabel} onClick={onClear} style={{width:20,height:20}}><Icon name="x" size={12}/></button>}</>;
}
