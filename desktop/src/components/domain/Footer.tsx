import type { StatusResult } from '../../backend/types';
import { Icon } from '../ui/Icon';
export function Footer({machine,me,settings=false}:{machine:StatusResult['machine']|undefined;me?:StatusResult['me']|undefined;settings?:boolean}){
 return <footer className="footer"><div className="avatar">{me?.initials||'—'}</div><div className="footer-lines"><span className="footer-login">{me?.footerLabel||'—'}</span><span className="footer-machine">{machine?.name||'—'}</span></div><a href="#/settings/account" aria-label="Settings" className="shell-link icon-button" style={{background:settings?'var(--tk-bg4)':'transparent',color:settings?'var(--tk-text1)':'var(--tk-text3)'}}><Icon name="settings"/></a></footer>;
}
