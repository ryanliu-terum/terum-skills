import { useLocation,useSearchParams,useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { LibraryScope, Root } from '../../backend/types';
import type { ReactNode } from 'react';
import { useBackend } from '../../backend';
import { useUiStore } from '../../app/store';
import { useUrlState } from '../../app/url-state';
import { Shell } from '../../components/domain/Shell';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { Analytics,AnalyticsDivider,AnalyticsSkeleton } from '../../components/domain/Analytics';
import { SkillCard,SkillCardSkeleton } from '../../components/domain/SkillCard';
import { CenteredState,ErrorLine,SearchRow,TerminalHint,ViewHeader } from '../../components/domain/Primitives';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Button } from '../../components/ui/Button';
import { Dialog,DialogTitle } from '../../components/ui/Dialog';
import { WorkflowPopup } from '../../components/domain/WorkflowPopup';
import type { ConnectOutcome } from '../../backend/types';
import './library.css';
/** The header's "which folder is this, and does it have a GitHub home" line (Ryan, 2026-09-09). Global is a folder with no repository. */
function rootMeta(root:Root|undefined):ReactNode{
 if(root===undefined)return undefined;
 if(root.kind==='global')return <span>{root.root}</span>;
 const remote=root.remote??null;
 const connected=remote!==null&&remote.slug!==null;
 return <><span>{root.root}</span><span aria-hidden="true">·</span><span {...(remote!==null&&remote.slug===null?{title:'origin is '+remote.url}:{})}>{connected?'GitHub: '+remote.slug:'GitHub: not connected'}</span></>;
}
/** The finished-run status line: an undefined/empty outcome is a legitimate "nothing to connect", not a failure. */
function connectSummary(outcome:ConnectOutcome|'nothing'):string{
 if(outcome==='nothing')return 'Nothing was connected.';
 if(!('kind' in outcome))return `Connected ${outcome.name}.`;
 const parts=[`Connected ${outcome.shared.length} ${outcome.shared.length===1?'skill':'skills'}.`];
 if(outcome.declined.length)parts.push(`Declined ${outcome.declined.length}.`);
 if(outcome.refused.length)parts.push(`Refused ${outcome.refused.length}.`);
 return parts.join(' ');
}
export function LibraryScreen(){const location=useLocation(),state=useUrlState(),backend=useBackend(),action=useWorkflow(),navigate=useNavigate(),[search,setSearch]=useSearchParams(),[actionError,setActionError]=useState<string|null>(null),[connectOpen,setConnectOpen]=useState(false),[connected,setConnected]=useState<ConnectOutcome|'nothing'|null>(null);const root=search.get('root')??'',scope:LibraryScope=location.pathname==='/library/checkout'?{kind:'checkout',root}:{kind:'global'},missing=scope.kind==='checkout'&&!root;
 const query=useQuery({queryKey:['library',scope.kind==='global'?'global':scope.root,state.mock],enabled:!missing,queryFn:({signal})=>backend.library({scope},{signal})});const data=query.data?.ok?query.data.value:undefined,title=data?.root.label??(scope.kind==='global'?'Global':root.split(/[\\/]/).filter(Boolean).at(-1)??''),selected=scope.kind==='global'?'Global':data?.root.id??root,error=actionError??(query.data?.ok===false?query.data.error:query.isError?query.error.message:null),loading=query.isPending&&!error&&!missing,empty=data?.skills.length===0,filtered=data?.skills.filter(s=>(s.name+' '+s.desc).toLowerCase().includes((state.q??'').toLowerCase()))??[];
 function param(key:string,value:string|null){const next=new URLSearchParams(search);if(value)next.set(key,value);else next.delete(key);setSearch(next);}
 async function connect(){
  if(action.busy)return;
  setConnected(null);setConnectOpen(true);
  await action.run(()=>backend.connect({}),{},value=>setConnected(value===undefined||('kind' in value&&!value.shared.length&&!value.declined.length&&!value.refused.length)?'nothing':value));
 }
 const connectPopup=connectOpen?<Dialog open onOpenChange={value=>{if(!action.busy)setConnectOpen(value);}}><WorkflowPopup><DialogTitle>Connect</DialogTitle>
  <div role="status">{action.busy?'Connect is running.':action.notice??(connected?connectSummary(connected):'Connect runs only when you ask.')}</div>
  {action.lines.map((line,index)=><div key={index}>{line}</div>)}
  {action.error&&<div role="alert">{action.error}</div>}
  <Button disabled={action.busy} onClick={()=>setConnectOpen(false)}>Close</Button>
 </WorkflowPopup></Dialog>:null;
 return <Shell counts={loading||error?null:undefined} selected={selected}><ScreenFrame ready={missing||!query.isPending||state.mock==='loading'}><ViewHeader title={title} {...(data&&!error?{subtitle:data.title,meta:rootMeta(data.root)}:{})} {...(!error?{overview:state.overviewHidden?'show' as const:'hide' as const,onOverview:()=>{useUiStore.getState().setOverviewHidden(!state.overviewHidden);param('overview',state.overviewHidden?null:'0');}}:{})}><Button icon="plus" disabled={action.busy} onClick={()=>void connect()}>Connect</Button></ViewHeader>{connectPopup}{data&&!error&&data.team.kind==='unreadable'?<ErrorLine>Team unreadable: {data.team.message} · cards show local state only</ErrorLine>:null}{missing?<CenteredState alert icon="alert" title="Couldn't read your library" body="Select a checkout from your Library."><ErrorLine>No checkout selected.</ErrorLine></CenteredState>:(query.data?.ok===false&&query.data.reason==='no-team'||data&&data.skills.length===0&&data.team.kind==='none')?<CenteredState icon="box" title="No team on this machine" body="Create a team or join the one you were invited to. Setup runs here in the app." primary="Start setup" secondary="Copy terminal command" onPrimary={()=>navigate('/onboarding/boot?start=1')} onSecondary={()=>void action.perform(()=>backend.copyToClipboard('npx -y terum-skills@latest setup'))}><TerminalHint command="npx -y terum-skills@latest setup" prefix="From the terminal"/>{action.error&&<ErrorLine>{action.error}</ErrorLine>}</CenteredState>:error?<CenteredState alert icon="alert" title="Couldn't read your library" body="terum-skills could not read ~/.terum/skills. Check the folder still exists and is readable, then try again." primary="Try again" secondary="Show in Finder" onPrimary={()=>{setActionError(null);void query.refetch();}} onSecondary={()=>void backend.revealPath('~/.terum/skills').then(result=>{if(!result.ok)setActionError(result.error);},e=>setActionError(e instanceof Error?e.message:'Could not open folder.'))}><ErrorLine>{error}</ErrorLine></CenteredState>:<>{!state.overviewHidden?<>{loading?<AnalyticsSkeleton/>:data?<Analytics overview={data.overview} zero={empty} {...(data.provenance===null?{provenance:''}:{})}/>:null}<AnalyticsDivider/></>:null}<SearchRow query={state.q??''} placeholder={loading||empty?'Search skills':'Search '+(data?.title??'skills')} onChange={q=>param('q',q||null)}/>{loading?<div className="library-grid" aria-label="Loading skills">{Array.from({length:9},(_,i)=><SkillCardSkeleton key={i}/>)}</div>:empty?<CenteredState icon="box" title={scope.kind==='global'?'No skills in your global library':`No skills in ${title}`}  body="Create your first skill, or install one your team has already shared." primary="Connect" secondary="Open marketplace" onPrimary={()=>void connect()} onSecondary={()=>navigate('/marketplace')}><TerminalHint command="npx -y terum-skills@latest install &lt;ref&gt;" prefix="From the terminal"/></CenteredState>:!filtered.length?<CenteredState icon="search" title={`No skills match “${state.q??''}”`} body="Try a shorter query, or search your team's marketplace for it." primary="Clear search" secondary="Search marketplace" onPrimary={()=>param('q',null)} onSecondary={()=>navigate('/marketplace?q='+encodeURIComponent(state.q??''))}/>:<div className="library-grid">{filtered.map(skill=><SkillCard key={skill.path??skill.name} skill={skill}/>)}</div>}</>}</ScreenFrame></Shell>;
}
