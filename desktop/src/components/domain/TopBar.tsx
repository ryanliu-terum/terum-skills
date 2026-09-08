import type { Capabilities } from '../../backend/types';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { TerumMark } from './TerumMark';
import { TrafficLights } from './TrafficLights';
export function TopBar({mode}:{mode:Capabilities['windowChrome']}){
 return <header className="topbar"><div className="topbar-left">
 {mode==='cosmetic'?<TrafficLights/>:mode==='mac-overlay'?<div style={{width:78,flexShrink:0}}/>:null}
 <div className="mark-slot"><TerumMark/></div><button className="icon-button" aria-label="Back" onClick={()=>history.back()}><Icon name="chevron-left"/></button><button className="icon-button" aria-label="Forward" onClick={()=>history.forward()}><Icon name="chevron-right"/></button>
 </div><div className="search-slot"><a className="shell-link search-box" href="#/search"><Icon name="search"/><span style={{flexGrow:1,whiteSpace:'nowrap'}}>Search skills, people, projects</span><Kbd>⌘K</Kbd></a></div>
 <div className="topbar-right"><a className="shell-link icon-button bell-button" aria-label="Inbox" href="#/inbox"><Icon name="bell"/></a>{mode==='drawn-controls'?<div className="window-controls" aria-hidden="true"><span>−</span><span>□</span><span>×</span></div>:null}</div></header>;
}
