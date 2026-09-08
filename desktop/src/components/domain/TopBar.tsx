import { useState } from 'react';
import { useBackend } from '../../backend';
import type { Capabilities } from '../../backend/types';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { TerumMark } from './TerumMark';
import { TrafficLights } from './TrafficLights';
export function TopBar({mode}:{mode:Capabilities['windowChrome']}){
 const backend=useBackend(),[error,setError]=useState<string|null>(null);
 function act(action:'toggle-maximize'|'start-drag'){if(mode==='cosmetic')return;void backend.windowAction(action).then(result=>{if(!result.ok)setError(result.error);},reason=>setError(String(reason)));}
 const drag={ 'data-tauri-drag-region':true, onMouseDown:(event:React.MouseEvent<HTMLElement>)=>{if(event.target!==event.currentTarget||event.button!==0)return;event.stopPropagation();if(event.detail===1)act('start-drag');}, onMouseUp:(event:React.MouseEvent<HTMLElement>)=>{if(event.target===event.currentTarget)event.stopPropagation();}, onDoubleClick:(event:React.MouseEvent<HTMLElement>)=>{if(event.target===event.currentTarget){event.stopPropagation();act('toggle-maximize');}} };
 return <header className="topbar" {...drag}><div className="topbar-left" {...drag}>
 {mode==='cosmetic'?<TrafficLights/>:mode==='mac-overlay'?<div style={{width:52,flexShrink:0}} {...drag}/>:null}
 <div className="mark-slot"><TerumMark/></div><button className="icon-button" aria-label="Back" onClick={()=>history.back()}><Icon name="chevron-left"/></button><button className="icon-button" aria-label="Forward" onClick={()=>history.forward()}><Icon name="chevron-right"/></button>
 </div><div className="search-slot" {...drag}><a className="shell-link search-box" href="#/search"><Icon name="search"/><span style={{flexGrow:1,whiteSpace:'nowrap'}}>Search skills, people, projects</span><Kbd>⌘K</Kbd></a></div>
 <div className="topbar-right" {...drag}><a className="shell-link icon-button bell-button" aria-label="Inbox" href="#/inbox"><Icon name="bell"/></a>{error?<span role="alert">{error}</span>:null}</div></header>;
}
