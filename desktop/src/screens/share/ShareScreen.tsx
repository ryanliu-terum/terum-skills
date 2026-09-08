import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useBackend } from '../../backend';
import type { Member, Roster } from '../../backend/types';
import { useUrlState } from '../../app/url-state';
import { Shell } from '../../components/domain/Shell';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { Avatar, BoardSkeleton, CenteredState, ErrorLine, IconButton, TerminalHint } from '../../components/domain/Primitives';
import { WorkflowHeader } from '../../components/domain/WorkflowControls';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Icon } from '../../components/ui/Icon';
import { ShareInvite } from './ShareInvite';
import './share.css';

export function ShareScreen() {
  const state=useUrlState(), backend=useBackend(), navigate=useNavigate(), [search,setSearch]=useSearchParams(), action=useWorkflow();
  const query=useQuery({queryKey:['share',state.mock],queryFn:()=>backend.roster()});
  const invitation=useQuery({queryKey:['invite-data',state.mock],enabled:state.dialog==='invite',queryFn:async()=>{const [onboarding,catalog]=await Promise.all([backend.onboarding(),backend.catalog()]);if(!onboarding.ok)return onboarding;if(!catalog.ok)return catalog;return {ok:true as const,value:{onboarding:onboarding.value,catalog:catalog.value}};}});
  const data=query.data?.ok?query.data.value:undefined;
  const error=query.data?.ok===false?query.data.error:query.isError?query.error.message:null;
  const loading=!data&&!error;
  const empty=data?.members.length===1&&data.invited.length===0;
  function invite(){setSearch(p=>{p.set('dialog','invite');return p;});}
  function close(){setSearch(p=>{p.delete('dialog');return p;});}
  const q=(search.get('q')??'').toLowerCase();
  const matches=(row:{name:string;handle:string})=>`${row.name} ${row.handle}`.toLowerCase().includes(q);
  return <Shell selected="Share" counts={loading||error?null:empty?{Global:'30',Terum:'22',SSM:'15',MRF:'32',Pushes:'3',Updates:'3',Alerts:'8'}:undefined}><ScreenFrame ready={(!query.isPending||state.mock==='loading')&&(state.dialog!=='invite'||!invitation.isPending||state.mock==='loading')}>
    <WorkflowHeader title="Members" icon="users" subtitle={data?empty?'1 member':`${data.members.length} members · ${data.invited.length} invitation${data.invited.length===1?'':'s'}`:undefined}>{<Button icon="user-plus" state={state.dialog==='invite'?'pressed':'default'} onClick={invite}>Invite</Button>}</WorkflowHeader>
    {error?<CenteredState alert icon="alert" title="Couldn't read the roster" body="terum-skills could not read the people files in the team clone, so this page shows nothing rather than a stale roster. Sync again, or check the clone in Settings." primary="Sync now" secondary="Open settings" onPrimary={()=>void action.run(()=>backend.sync({}),{},()=>{void query.refetch();})} onSecondary={()=>navigate('/settings/teams')}><ErrorLine>{error}</ErrorLine></CenteredState>:<>
      <div className="share-tools">{loading?<BoardSkeleton width="100%" height={32} radius={8}/>:<div className="share-search"><Icon name="search" size={16}/><input aria-label="Find members" placeholder="Find members" value={search.get('q')??''} onChange={e=>setSearch(p=>{if(e.target.value)p.set('q',e.target.value);else p.delete('q');return p;})}/>{q&&<IconButton label="Clear member search" icon="x" size={20} iconSize={14} onClick={()=>setSearch(p=>{p.delete('q');return p;})}/>}</div>}</div>
      <div className={'share-table-wrap'+(empty?' is-empty':'')}><div role="table" aria-label="Members" className="share-table"><MembersHead/>{loading?Array.from({length:13},(_,i)=><MemberSkeleton key={i}/>):<>{data?.members.map((member,index)=>matches(member)?<MemberRow key={member.handle} member={member} index={index}/>:null)}{data?.invited.map(member=>matches(member)?<InvitedRow key={member.handle} member={member}/>:null)}</>}</div>{data&&!data.members.some(row=>matches(row))&&!data.invited.some(row=>matches(row))&&<p className="share-no-results">No members match your search.</p>}</div>
      {empty&&<CenteredState icon="users" title="Just you so far" body="Invite teammates by their GitHub login. GitHub emails each one; the join block runs the wizard, which accepts the pending invitation with gh signed in and otherwise asks them to accept it in the browser." primary="Invite" secondary="Copy join block" onPrimary={invite} onSecondary={()=>void action.perform(()=>backend.onboarding(),value=>{void backend.copyToClipboard(value.joinBlock).then(result=>{if(!result.ok)action.fail(result.error);},action.fail);})}><TerminalHint command="npx -y terum-skills@latest invite <github-login>..." prefix="From the terminal"/></CenteredState>}
    </>}{action.error&&<div role="alert" className="share-action-error">{action.error}</div>}
    {state.dialog==='invite'&&!loading&&<ShareInvite close={close} data={invitation.data?.ok?invitation.data.value:undefined} error={invitation.data?.ok===false?invitation.data.error:invitation.isError?invitation.error.message:null} retry={()=>{void invitation.refetch();}}/>}
  </ScreenFrame></Shell>;
}
function MembersHead(){return <div role="row" className="members-head"><div role="columnheader" className="member-name">Name<Icon name="chevron-down" size={12} stroke="2"/></div>{['Status','Joined','Teams','Last seen'].map(label=><div role="columnheader" key={label}>{label}</div>)}</div>;}
function MemberRow({member:m,index}:{member:Member;index:number}){
  const backend=useBackend(), action=useWorkflow();
  const saved=backend.prefs.get('role:'+m.handle,m.status), status=saved==='admin'||saved==='member'?saved:m.status;
  return <div role="row" className="member-row" data-testid={'member-row-'+index}>
    <div role="cell" className="member-name"><Avatar initials={m.initials} size={28}/><div className="member-identity"><span>{m.name}</span><span>{m.handle} · {m.role}</span></div></div>
    <div role="cell"><BaseMenu.Root><BaseMenu.Trigger aria-label={'Role for '+m.handle} className={'member-role '+status}>{status==='admin'?'Admin':'Member'}<Icon name="chevron-down" size={10} stroke="2.5"/></BaseMenu.Trigger><BaseMenu.Portal><BaseMenu.Positioner align="start" sideOffset={4}><BaseMenu.Popup className="floating-panel" style={{width:200}}>{['Admin','Member'].map(label=><BaseMenu.Item key={label} className="menu-item" onClick={()=>action.pref('role:'+m.handle,label.toLowerCase())}><span style={{width:14}}>{status===label.toLowerCase()&&<Icon name="check" size={14} stroke="2"/>}</span>{label}</BaseMenu.Item>)}<BaseMenu.Separator style={{height:1,margin:'3px 0',background:'var(--tk-border1)'}}/><BaseMenu.Item className="menu-item" style={{color:'var(--tk-bad)'}} onClick={()=>void action.run(()=>backend.team({kind:'remove',handle:m.handle}))}><span style={{width:14}}/>Remove from team</BaseMenu.Item></BaseMenu.Popup></BaseMenu.Positioner></BaseMenu.Portal></BaseMenu.Root>{action.error&&<span role="alert" className="member-error">{action.error}</span>}</div>
    <div role="cell">{m.joined}</div><div role="cell">{m.projects.map(project=><Chip key={project}>{project}</Chip>)}</div><div role="cell">{m.lastSeen}</div>
  </div>;
}
function InvitedRow({member:m}:{member:Roster['invited'][number]}){return <div role="row" className="member-row" data-testid="invited-row"><div role="cell" className="member-name"><Avatar initials={m.initials} size={28}/><div className="member-identity"><span>{m.name}</span><span>{m.handle} · {m.role} · invited {m.invited} by {m.by}</span></div></div><div role="cell">Invited</div><div role="cell">—</div><div role="cell">—</div><div role="cell">—</div></div>;}
function MemberSkeleton(){return <div className="member-row" data-testid="member-skeleton"><div className="member-name"><BoardSkeleton width={28} height={28} radius={14}/><div style={{flexGrow:1}}><div style={{height:18,display:'flex',alignItems:'center'}}><BoardSkeleton width="40%" height={12}/></div><div style={{height:16,marginTop:1,display:'flex',alignItems:'center'}}><BoardSkeleton width="28%" height={10}/></div></div></div><div><BoardSkeleton width={68} height={20}/></div><div><BoardSkeleton width={76} height={10}/></div><div><BoardSkeleton width={52} height={20}/><BoardSkeleton width={40} height={20}/></div><div><BoardSkeleton width={60} height={10}/></div></div>;}
