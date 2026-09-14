import type { StatusResult } from '../../backend/types';
import { Icon } from '../ui/Icon';
/**
 * Identity avatar + the app's only visible door to Settings. The two text lines (gh login and the
 * machine name / clone-state sentence) were removed: at the sidebar's width the clone sentence
 * clipped to "From the local clone; GitHub …" with no tooltip behind it, and the machine name it
 * displaced is already stated in Settings ▸ Identity. Clone state keeps its home in Settings ▸ Teams.
 */
export function Footer({me,settings=false}:{me?:StatusResult['me']|undefined;settings?:boolean}){
 const identity=<div className="avatar">{me?.initials||'\u2014'}</div>;
 return <footer className="footer">{me?.handle?<a href={'#/marketplace/people/'+encodeURIComponent(me.handle)} aria-label="Your profile" className="shell-link footer-identity">{identity}</a>:<div className="footer-identity">{identity}</div>}<a href="#/settings/account" aria-label="Settings" className="shell-link icon-button" style={{background:settings?'var(--tk-bg4)':'transparent',color:settings?'var(--tk-text1)':'var(--tk-text3)'}}><Icon name="settings"/></a></footer>;
}
