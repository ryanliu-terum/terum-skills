import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useBackend } from '../../backend';
import type { Result, Settings, SetupResult, StatusResult } from '../../backend/types';
import { WorkflowDialog, WorkflowField } from '../../components/domain/WorkflowControls';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Dialog, DialogTitle } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { TerminalHint } from '../../components/domain/Primitives';
import { WorkflowPopup } from '../../components/domain/WorkflowPopup';
import { settingsRows } from './settings-data';
export function SettingsDialogs({section,data:d,status}:{section:string;data:Settings;status:StatusResult}){
  const backend=useBackend(),action=useWorkflow(),[search,setSearch]=useSearchParams(),team=search.has('team')?status.teams.find(team=>team.key===search.get('team')):status.teams.length===1?status.teams[0]:undefined;
  const rows=settingsRows.parse(d);
  const name=search.get('dialog');
  const [joinOpened,setJoinOpened]=useState(false);
  const showJoin=section==='teams'&&name==='join'&&(joinOpened||status.teams.length===0);
  // Gate opening only; status refetches must preserve the mounted completion view.
  if(name!=='join'&&joinOpened)setJoinOpened(false);
  else if(showJoin&&!joinOpened)setJoinOpened(true);
  function close(){setSearch(p=>{p.delete('dialog');return p;});}
  if(section==='teams'&&name==='leave'&&team)return <WorkflowDialog title={`Leave ${team.name} on this machine?`} body="This is the machine leaving the team, not you." primary="Leave" danger command={`npx -y terum-skills@latest team leave ${team.key}`} close={close} busy={action.busy} error={action.error} submit={()=>void action.run(()=>backend.team({kind:'leave',name:team.key}),{},close)}>{[
    "Its placed skills on this machine leave ~/.claude/skills and the project checkouts — a copy you edited by hand is moved to quarantine instead of deleted, and a folder that is also a skill's authoring source is left where it is",
    `The clone at ${team.clone} and this team's entry in config.json — a clone holding uncommitted or unpushed work is moved to quarantine instead`,
    'Its connected skill records and any pending operations on this machine',
    ...(status.teams.length===1?['This is your last team here, so the session-start hook is removed from ~/.claude/settings.json; if that file cannot be written the leave still finishes and says so']:[]),
    "Consent you gave for skills' tool permissions may need to be given again for a new team",
    `Your people file in the team repo stays: you remain a member (an admin archives that with team remove ${team.handle}), and setup brings this machine back`,
  ].map(line=><div className="settings-bullet settings-leave-bullet" key={line}><span>·</span><span>{line}</span></div>)}{action.lines.map((line,index)=><div key={index}>{line}</div>)}</WorkflowDialog>;
  if(section==='machine'&&name==='prune')return <WorkflowDialog title={`Delete ${d.QUARANTINE.length} quarantined folder${d.QUARANTINE.length===1?'':'s'}?`} body="Prune deletes only inside ~/.terum/skills/quarantine, and only what is listed here. Nothing else on this machine is touched." primary="Delete" danger command="npx -y terum-skills@latest sync --prune" close={close} busy={action.busy} error={action.error} submit={()=>void action.run(()=>backend.sync({prune:true}),{[`Delete ${d.QUARANTINE.length} quarantined item(s)?`]:true},close)}><div className="prune-list">{rows.QUARANTINE.map(([when,name,,size])=><div key={when+name}><span>quarantine/{when}/{name}</span><span>{size}</span></div>)}</div></WorkflowDialog>;
  if(section==='advanced'&&name==='status')return <StatusDialog close={close}/>;
  if(showJoin)return <JoinDialog close={close} action={action}/>;
  return action.notice?<div role="status">{action.notice}</div>:null;
}

function StatusDialog({close}:{close:()=>void}){
  const backend=useBackend(),action=useWorkflow();
  const start=useRef(()=>action.run(()=>backend.diagnostics()));
  useEffect(()=>{
    // Defer until the committed mount so StrictMode's effect replay cannot start two jobs.
    let mounted=true;
    void Promise.resolve().then(()=>{if(mounted)void start.current();});
    return ()=>{mounted=false;};
  },[]);
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><WorkflowPopup><DialogTitle>Status</DialogTitle>
    {action.lines.map((line,index)=><div key={index}>{line}</div>)}
    <div role="status">{action.busy?'Reading status…':'Done.'}</div>
    {action.error&&<div role="alert">{action.error}</div>}
    <Button onClick={close}>Close</Button>
  </WorkflowPopup></Dialog>;
}

function JoinDialog({close,action}:{close:()=>void;action:ReturnType<typeof useWorkflow>}){
  const backend=useBackend(),queries=useQueryClient();
  const [target,setTarget]=useState(''),[error,setError]=useState<string|null>(null);
  const [settled,setSettled]=useState<Result<SetupResult>|null>(null);
  async function join(){
    if(!target.trim()){setError('Enter the team as <org>/<repo> or a remote URL.');return;}
    setError(null);setSettled(null);
    try {
      await action.run(()=>{
        const operation=backend.setup({target:target.trim()});
        void operation.done.then(setSettled);
        return operation;
      });
    } finally {
      await Promise.all([queries.invalidateQueries({queryKey:['status']}),queries.invalidateQueries({queryKey:['settings']})]);
    }
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)close();}}><WorkflowPopup><DialogTitle>Join a team</DialogTitle>
    <WorkflowField aria-label="Team repository" placeholder="<org>/<repo> or remote URL" value={target} disabled={action.busy} onChange={event=>setTarget(event.target.value)}/>
    <TerminalHint command={`npx -y terum-skills@latest setup ${target.trim()||'<org>/<repo>'}`}/>
    {action.lines.map((line,index)=><div key={index}>{line}</div>)}
    {(settled?.ok||action.notice)&&<div role="status">{settled?.ok?`Joined ${settled.value.team}`:action.notice}</div>}
    {(error||action.error)&&<div role="alert">{error??action.error}</div>}
    <Button disabled={action.busy} onClick={close}>Close</Button>
    <Button kind="primary" disabled={action.busy} onClick={()=>void join()}>Join</Button>
  </WorkflowPopup></Dialog>;
}
