import { useCapabilities, cloneStateCopy } from '../../backend';
import type { TeamStatus, StatusResult } from '../../backend/types';
import { Icon } from '../ui/Icon';
export function Footer({machine,settings=false,team}:{team?:TeamStatus|undefined;machine:StatusResult['machine']|undefined;settings?:boolean}){
 const capabilities=useCapabilities();const copy=team?.cloneState?cloneStateCopy(team.cloneState,team.clone,team.remote,team.readable??true):undefined;
 return <footer className="footer"><div className="avatar">TZ</div><div className="footer-lines"><span className="footer-login">{machine?.gh_login??'—'}</span><span className="footer-machine" title={copy}>{copy??(capabilities?.machineRegistry?machine?.name??'—':'—')}</span></div><a href="#/settings/account" aria-label="Settings" className="shell-link icon-button" style={{background:settings?'var(--tk-bg4)':'transparent',color:settings?'var(--tk-text1)':'var(--tk-text3)'}}><Icon name="settings"/></a></footer>;
}
