import { useSearchParams } from 'react-router';
import { useBackend } from '../../backend';
import type { Settings, StatusResult } from '../../backend/types';
import { WorkflowDialog } from '../../components/domain/WorkflowControls';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { settingsRows } from './settings-data';
export function SettingsDialogs({section,data:d,status}:{section:string;data:Settings;status:StatusResult}){
  const backend=useBackend(),action=useWorkflow(),[search,setSearch]=useSearchParams(),team=status.teams[0];
  const rows=settingsRows.parse(d);
  const name=search.get('dialog');
  const globalCount=status.counts.Global;
  const parsedGlobalCount=globalCount!==undefined&&/^\d+$/.test(globalCount)?Number(globalCount):NaN;
  const validCounts=Number.isSafeInteger(parsedGlobalCount)&&Number.isSafeInteger(d.PLACEMENTS_N)&&parsedGlobalCount<=d.PLACEMENTS_N;
  const checkoutCount=validCounts?d.PLACEMENTS_N-parsedGlobalCount:'—';
  function close(){setSearch(p=>{p.delete('dialog');return p;});}
  if(section==='teams'&&name==='leave'&&team)return <WorkflowDialog title={`Leave ${team.name} on this machine?`} body="This is the machine leaving the team, not you." primary="Leave" danger command={`npx -y terum-skills@latest team leave ${team.key}`} close={close} busy={action.busy} error={action.error} submit={()=>void action.run(()=>backend.team({kind:'leave'}),{[`Leave ${team.name}? This removes ${d.PLACEMENTS_N} placed skill(s) from this machine.`]:true},close)}>{[
    `Its placed skills leave ~/.claude/skills and the project checkouts on this machine (${validCounts?globalCount:'—'} global, ${checkoutCount} in checkouts)`,
    `The clone at ${team.clone} and this team's entry in config.json`,
    'Your people file in the team repo stays: you remain a member, and setup brings this machine back',
  ].map(line=><div className="settings-bullet settings-leave-bullet" key={line}><span>·</span><span>{line}</span></div>)}</WorkflowDialog>;
  if(section==='machine'&&name==='prune')return <WorkflowDialog title={`Delete ${d.QUARANTINE.length} quarantined folder${d.QUARANTINE.length===1?'':'s'}?`} body="Prune deletes only inside ~/.terum/skills/quarantine, and only what is listed here. Nothing else on this machine is touched." primary="Delete" danger command="npx -y terum-skills@latest sync --prune" close={close} busy={action.busy} error={action.error} submit={()=>void action.run(()=>backend.sync({prune:true}),{[`Delete ${d.QUARANTINE.length} quarantined item(s)?`]:true},close)}><div className="prune-list">{rows.QUARANTINE.map(([when,name,,size])=><div key={when+name}><span>quarantine/{when}/{name}</span><span>{size}</span></div>)}</div></WorkflowDialog>;
  return null;
}
