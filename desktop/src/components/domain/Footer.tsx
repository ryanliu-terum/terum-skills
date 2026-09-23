import type { StatusResult } from '../../backend/types';
import { Icon } from '../ui/Icon';
/**
 * Identity avatar, the name beside it, and the app's only visible door to Settings.
 *
 * One text line, not the canvas's two. `325bebf` removed both lines while arguing only the second:
 * that slot rendered `copy ?? machine?.name`, so a healthy clone put the clone-state sentence in the
 * machine-name slot, where it clipped to "From the local clone; GitHub …" with no tooltip behind it.
 * True of the clone sentence; never true of this line. `footerLabel` is a short handle (gh login, else
 * the team handle, else the default handle) and ellipsises cleanly at the sidebar's 240px, so it comes
 * back — the design canvas draws it on 79 of 99 boards (build.py:265-268).
 *
 * The second line stays out, and clone state keeps its single home in Settings ▸ Teams (RM-47's footer
 * consumer is gone for good). The machine name is the line that would go there, but the adapter reports
 * none — statusModel in tauri/index.ts hard-codes `machine.name:''`, which is also why Settings ▸ This
 * machine titles itself '—'. Drawing an empty 11px line under the name would push the name off centre
 * for nothing. FIDELITY.md carries the owed entry; the machine name is a CLI-contract change.
 */
export function Footer({me,settings=false}:{me?:StatusResult['me']|undefined;settings?:boolean}){
 const identity=<><div className="avatar">{me?.initials||'—'}</div><div className="footer-lines"><span className="footer-login">{me?.footerLabel||'—'}</span></div></>;
 return <footer className="footer">{me?.handle?<a href={'#/marketplace/people/'+encodeURIComponent(me.handle)} aria-label="Your profile" className="shell-link footer-identity">{identity}</a>:<div className="footer-identity">{identity}</div>}<a href="#/settings/account" aria-label="Settings" aria-current={settings?'page':undefined} className="shell-link icon-button"><Icon name="settings"/></a></footer>;
}
