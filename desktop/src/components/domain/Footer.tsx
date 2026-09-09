import { usePreference, cloneStateCopy } from '../../backend';
import type { TeamStatus, StatusResult } from '../../backend/types';
import { Icon } from '../ui/Icon';
export function Footer({machine,me,settings=false,team}:{team?:TeamStatus|undefined;machine:StatusResult['machine']|undefined;me?:StatusResult['me']|undefined;settings?:boolean}){
 const showMachine=usePreference('appearance:machine',true);const copy=team?.cloneState?cloneStateCopy(team.cloneState,team.clone??'—',team.remote??'—',team.readable??true):undefined;
 return <footer className="footer"><div className="avatar">{me?.initials||'—'}</div><div className="footer-lines"><span className="footer-login">{me?.footerLabel||'—'}</span><span className="footer-machine" title={machine?.os||copy}>{showMachine?(copy??(machine?.name||'—')):''}</span></div><a href="#/settings/account" aria-label="Settings" className="shell-link icon-button" style={{background:settings?'var(--tk-bg4)':'transparent',color:settings?'var(--tk-text1)':'var(--tk-text3)'}}><Icon name="settings"/></a></footer>;
}
