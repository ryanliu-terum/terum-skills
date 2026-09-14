import type { SyncTeam } from '../../backend/types';
import { Button } from '../ui/Button';

/**
 * A team whose repository answered "not found". The CLI's summary says where it went; each replacement it found is one
 * button, so following the team is a click, not a leave-then-setup-then-install afternoon. No replacement: the summary
 * already says what to ask the owner for, and the raw git detail stays available below it.
 */
export function MissingTeam({team,busy,onMove}:{team:SyncTeam;busy:boolean;onMove:(ownerRepo:string)=>void}) {
 const successors=team.successors??[];
 return <div role="group" aria-label={`${team.team} repository not found`}>
  <div>{team.summary??`${team.team}: ${team.state}`}</div>
  {successors.map(entry=><div key={entry.ownerRepo} style={{display:'flex',alignItems:'center',gap:8,marginTop:6}}>
   <Button kind="primary" disabled={busy} onClick={()=>onMove(entry.ownerRepo)}>Move this machine to {entry.ownerRepo}</Button>
   <span style={{fontSize:12,opacity:.75}}>{entry.source==='invitation'?'Invitation pending':'You already have access'}{entry.teamName?` · team.json names it ${entry.teamName}`:''}{entry.at?` · ${entry.at.slice(0,10)}`:''}</span>
  </div>)}
  {team.lookup&&successors.length===0&&<div style={{fontSize:12,opacity:.75}}>{team.lookup}</div>}
  {team.detail&&<details style={{marginTop:6}}><summary style={{fontSize:12,cursor:'pointer'}}>What git said</summary><pre className="board-mono" style={{whiteSpace:'pre-wrap',fontSize:11}}>{team.detail}</pre></details>}
 </div>;
}
