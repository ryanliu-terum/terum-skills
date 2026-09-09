import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams, useSearchParams, useNavigate, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useBackend, useLaunchContext, usePreference, existingSetupSession } from '../../backend';
import type { Onboarding, StatusResult, Theme } from '../../backend/types';
import { useUrlState } from '../../app/url-state';
import { useUiStore } from '../../app/store';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { BoardSkeleton, CliBox, RichText, SectionLabel, TerminalHint } from '../../components/domain/Primitives';
import { WorkflowField } from '../../components/domain/WorkflowControls';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Icon } from '../../components/ui/Icon';
import { ICON_PATHS } from '../../components/ui/icon-paths';
import type { IconName } from '../../components/ui/icon-paths';
import { OnboardingActions as Actions, OnboardingColumn as Column, OnboardingFrame as Frame, OnboardingKeys as Keys, OnboardingPara as Para, OnboardingTile as Tile, OnboardingTitle as Title, ProgressCard } from './OnboardingParts';
import { OnboardingBasics } from './OnboardingBasics';
import { OnboardingDone } from './OnboardingDone';
import { ThemeCards } from './ThemeCards';
import { useOnboardingStore } from './onboarding-store';
import { decide, needsLaunchStatus } from '../../app/launch-decision';
import type { LaunchContext } from '../../backend/types';
import { SetupBoot } from './SetupBoot';
import './onboarding.css';
const basicsRows=z.array(z.tuple([z.enum(['Manage','Eval','Share','Search','More to come']),z.string()]));
const steps=['boot','welcome','style','basics','team','feedback','done'];

export function OnboardingScreen(){
 const backend=useBackend(),launch=useLaunchContext(),{step}=useParams();
 const consumed=usePreference('launch:consumedWrittenAt',''),[search]=useSearchParams(),{mock}=useUrlState();
 const manual=step==='boot'&&search.get('start')==='1';
 const ctx=launch.data??null,needsStatus=needsLaunchStatus(ctx,consumed);
 const status=useQuery({queryKey:['status',mock],queryFn:({signal})=>backend.status(undefined,{signal}),enabled:needsStatus});
 const surfaces=useQuery({queryKey:['surfaces'],queryFn:()=>backend.surfaces()});
 if(launch.isPending||surfaces.isPending)return <ScreenFrame ready={false}><Frame current={null} steps={[]} skipped={[]}><Column><Tile/><Title>Setting up your workspace</Title></Column></Frame></ScreenFrame>;
 if(step==='boot'&&manual)return <ManualSetup launch={ctx}/>;
 if(step==='boot'&&needsStatus&&status.isPending)return <ScreenFrame ready={false}/>;
 if(step==='boot'&&ctx&&(decide(ctx,consumed,status.data)==='boot'||existingSetupSession(backend,ctx)))return <SetupBoot key={ctx.writtenAt} launch={ctx}/>;
 if(!surfaces.data?.onboarding)return <Navigate to="/library/global" replace/>;
 return <OnboardingReadScreen/>;
}
function ManualSetup({launch}:{launch:LaunchContext|null}){
 const [request]=useState(()=>launch??{writtenAt:`manual:${Date.now()}`});
 return <SetupBoot key={request.writtenAt} launch={request} restart/>;
}
function OnboardingReadScreen(){
  const {step:raw}=useParams(),state=useUrlState(),backend=useBackend();
  const step=steps.includes(raw??'')?raw??'boot':'boot';
  const query=useQuery({queryKey:['onboarding',state.mock],queryFn:({signal})=>backend.onboarding(undefined,{signal})});
  const status=useQuery({queryKey:['status',state.mock],queryFn:({signal})=>backend.status(undefined,{signal})});
  const library=useQuery({queryKey:['library','Global',state.mock],queryFn:({signal})=>backend.library({scope:'Global'},{signal}),enabled:step==='done'});
  const data=query.data?.ok?query.data.value:query.data?.value;
  const error=query.data?.ok===false?query.data.error:query.isError?query.error.message:status.data?.ok===false?status.data.error:status.isError?status.error.message:null;
  const identity=status.data?.ok?status.data.value:undefined;
  return <ScreenFrame ready={(!query.isPending||state.mock==='loading')&&!status.isPending&&(step!=='done'||!library.isPending||state.mock==='loading')}>
    {error?<BootError error={error} data={data} status={identity} retry={()=>{void query.refetch();void status.refetch();}}/>:data?<OnboardingFlow key={step} step={step} data={data}/>:<Frame current={null} steps={[]} skipped={[]}><Column><Tile/><Title>Setting up {identity?.teams[0]?.name??'your workspace'}</Title><div className="onboarding-loading" aria-label="Loading onboarding"><BoardSkeleton width={320} height={18}/><BoardSkeleton width={520} height={160}/></div></Column></Frame>}
  </ScreenFrame>;
}
function OnboardingFlow({step,data:d}:{step:string;data:Onboarding}){
  const backend=useBackend(),action=useWorkflow(),navigate=useNavigate(),[search,setSearch]=useSearchParams(),setTheme=useUiStore(s=>s.setTheme);
  const skipped=useOnboardingStore(s=>s.onboardingSkipped),setSkipped=useOnboardingStore(s=>s.setSkipped);
  const [workspace,setWorkspace]=useState(d.team.name),[logins,setLogins]=useState(d.INVITEE);
  useEffect(()=>{const saved=backend.prefs.get<unknown>('onboardingSkipped',[]);setSkipped(Array.isArray(saved)?saved.filter((value):value is string=>typeof value==='string'&&d.ONBOARD_STEPS.includes(value)):[]);},[backend,d.ONBOARD_STEPS,setSkipped]);
  const current=d.ONBOARD_STEPS.find(name=>name.toLowerCase()===step)??null;
  const tabs=basicsRows.parse(d.ONBOARD_BASICS),tabKeys=['manage','eval','share','search','more'];
  const tabIndex=Math.max(0,tabKeys.indexOf(search.get('tab')??'manage')),tab=tabs[tabIndex]?.[0]??'Manage';
  const pick=search.get('pick'),picked:Theme=pick==='light'||pick==='dark'||pick==='system'?pick:pick===null&&search.get('theme')==='light'?'light':'system';
  function go(next:string){const nextSearch=new URLSearchParams(search);nextSearch.delete('tab');nextSearch.delete('pick');nextSearch.delete('dialog');navigate('/onboarding/'+next.toLowerCase()+(nextSearch.size?'?'+nextSearch.toString():''));}
  function next(){const index=d.ONBOARD_STEPS.findIndex(name=>name.toLowerCase()===step),destination=d.ONBOARD_STEPS[index+1];if(destination)go(destination);else navigate('/library/global');}
  function back(){if(step==='basics'&&tabIndex>0){setSearch(p=>{p.set('tab',tabKeys[tabIndex-1]??'manage');return p;});return;}const index=d.ONBOARD_STEPS.findIndex(name=>name.toLowerCase()===step);go(d.ONBOARD_STEPS[Math.max(0,index-1)]??'welcome');}
  function skip(){if(current){const nextSkipped=[...new Set([...skipped,current])];if(!action.pref('onboardingSkipped',nextSkipped))return;setSkipped(nextSkipped);}next();}
  function primary(){
    if(step==='basics'&&tabIndex<tabs.length-1){setSearch(p=>{p.set('tab',tabKeys[tabIndex+1]??'more');return p;});return;}
    if(step==='team'){
      const values=logins.split(/[\s,]+/).filter(Boolean);
      if(!workspace.trim()){action.fail('Enter a workspace name.');return;}
      if(!values.length||values.some(login=>! /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login))){action.fail('Enter valid GitHub logins, separated by commas or spaces.');return;}
      if(!action.pref('onboarding:workspace',workspace.trim()))return;
      void action.run(()=>backend.invite({logins:values}),{},next);return;
    }
    if(step==='feedback'){void action.perform(()=>backend.openInEditor(d.ONBOARD_COMMUNITY.invite),next);return;}
    if(step==='done'){navigate('/library/global');return;}
    next();
  }
  useEffect(()=>{function key(event:KeyboardEvent){if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey||action.busy)return;const target=event.target;if(target instanceof Element&&target.closest('button,[role="radio"],[role="tab"],[role="combobox"]'))return;if(event.key==='Enter'){event.preventDefault();primary();}else if(event.key==='Escape'){event.preventDefault();if(step==='team'||step==='feedback')skip();else back();}}document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);});
  if(step==='done')return <OnboardingDone data={d} openLibrary={()=>navigate('/library/global')}/>;
  let body:ReactNode;
  if(step==='boot')body=<><Tile icon="refresh"/><Title>Setting up {d.team.name}</Title><Para>{`Fetching ${d.TEAM_REPO} and placing the team's Global set on this machine.`}</Para><ProgressCard rows={d.bootRows} placed={3} total={d.BOOT_STEPS}/><TerminalHint command="npx -y terum-skills@latest sync" prefix="Same as"/></>;
  else if(step==='welcome')body=<><Tile mark/><Title><RichText text={d.WELCOME_LINES[0]??''}/></Title><Para>{d.WELCOME_LINES[1]??''}</Para><span className="onboarding-line">Joined {d.team.key} as {d.me.handle} · {d.GLOBAL_SET.length} skills placed · {d.teamN} members</span><Actions primary="Continue" onPrimary={primary}/><Keys pairs={[["↵","to continue"]]}/></>;
  else if(step==='style')body=<><Tile icon="sun"/><Title>Choose your style</Title><Para>Follow the system, or a fixed theme; change it any time in Settings&nbsp;▸&nbsp;Appearance.</Para><ThemeCards options={d.THEME_OPTIONS} selected={picked} onSelect={value=>{setTheme(value);setSearch(p=>{p.set('pick',value);if(p.has('theme'))p.set('theme',value);return p;});}}/><Actions primary="Continue" onPrimary={primary}/><Keys pairs={[["↵","to continue"],["esc","to go back"]]} back={back}/></>;
  else if(step==='basics')body=<><Tile/><Title>The basics</Title><Para>Five things terum-skills does; skip the tour any time.</Para><div className="onboarding-tabs" role="tablist" aria-label="The basics">{tabs.map(([label,icon],i)=><button type="button" className="tab" key={label} role="tab" aria-selected={label===tab} aria-controls="onboarding-basics-panel" id={'onboarding-tab-'+i} data-active={label===tab||undefined} onClick={()=>setSearch(p=>{p.set('tab',tabKeys[i]??'manage');return p;})}><Icon name={Object.hasOwn(ICON_PATHS,icon)?icon as IconName:'box'} size={14}/>{label}</button>)}</div><div className="onboarding-basics-panel" role="tabpanel" id="onboarding-basics-panel" aria-labelledby={'onboarding-tab-'+tabIndex}><OnboardingBasics data={d} tab={tab}/></div><div className="onboarding-basics-caption"><Para bright>{d.BASICS_COPY[tab]??''}</Para></div><Actions primary={tabIndex===tabs.length-1?'Continue':'Next'} secondary="Skip the tour" onPrimary={primary} onSecondary={skip}/><Keys pairs={[["↵","to go on"],["esc","to go back"]]} back={back}/><div className="onboarding-hint-slot">{d.BASICS_HINT[tab]&&<TerminalHint command={d.BASICS_HINT[tab]} prefix="From the terminal"/>}</div></>;
  else if(step==='team')body=<><Tile/><Title>Your workspace</Title><Para>Name it and invite your team; GitHub emails each invitation, and the join block runs the wizard for them.</Para><div className="onboarding-fields"><div><SectionLabel>Workspace name</SectionLabel><WorkflowField aria-label="Workspace name" value={workspace} onChange={e=>setWorkspace(e.target.value)}/><span>How the team appears here and in the sidebar; the repository stays {d.TEAM_REPO}.</span></div><div><SectionLabel>GitHub logins</SectionLabel><WorkflowField aria-label="GitHub logins" value={logins} onChange={e=>setLogins(e.target.value)}/><span>Their GitHub identity, not a team handle — they choose that when they join. Inviting needs admin access to the repository and gh signed in.</span></div><div><SectionLabel>Send them this</SectionLabel><CliBox command={d.joinBlock}/><span><RichText text={d.JOIN_BLOCK_NOTE}/></span></div></div><Actions primary="Invite" secondary="Skip for now" icon="user-plus" onPrimary={primary} onSecondary={skip} busy={action.busy}/><Keys pairs={[["↵","to invite"],["esc","to skip"]]}/><TerminalHint command={'npx -y terum-skills@latest invite '+d.INVITEE} prefix="From the terminal"/></>;
  else body=<><Tile/><Title>Feedback and requests</Title><Para>{`Join the team on ${d.ONBOARD_COMMUNITY.name} to ask for what you need and say what got in your way.`}</Para><div className="onboarding-feedback-wrap"><div className="onboarding-feedback"><div><Icon name="users" size={16}/></div><div><span>terum-skills on {d.ONBOARD_COMMUNITY.name}</span><span>{d.ONBOARD_COMMUNITY.invite}</span></div></div></div><Actions primary="Join" secondary="Skip for now" icon="external-link" onPrimary={primary} onSecondary={skip} busy={action.busy}/><Keys pairs={[["↵","to join"],["esc","to skip"]]}/></>;
  return <Frame current={current} steps={d.ONBOARD_STEPS} skipped={skipped}><Column>{body}{action.error&&<div role="alert" className="onboarding-error-line"><RichText text={action.error}/></div>}</Column></Frame>;
}
function BootError({error,data,status,retry}:{error:string;data:Onboarding|undefined;status:StatusResult|undefined;retry:()=>void}){
  const backend=useBackend(),navigate=useNavigate(),action=useWorkflow();
  const team=status?.teams[0],repo=data?.TEAM_REPO??team?.remote?.replace(/^github\.com\//,'')??'—';
  const rows:Onboarding['bootRows']=data?.failedBootRows??[['done',`Team ${team?.key??'—'} found on this machine`,`@${status?.me.handle??'—'}`],['failed',`Couldn't fetch ${repo}`,'not reached'],['pending',"Placing the team's Global set into ~/.claude/skills",'0 of —'],['pending','Recording the sync','']];
  function offline(){navigate('/library/global');}
  function again(){void action.run(()=>backend.sync({}),{},retry);}
  useEffect(()=>{function key(event:KeyboardEvent){if(event.defaultPrevented)return;if(event.target instanceof Element&&event.target.closest('button'))return;if(event.key==='Enter'){event.preventDefault();again();}if(event.key==='Escape'){event.preventDefault();offline();}}document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);});
  return <Frame current={null} steps={[]} skipped={[]}><Column><Tile icon="alert"/><Title>Couldn't sync {data?.team.name??team?.name??'your workspace'}</Title><Para>GitHub could not be reached; your clone is still here, so the Library can open with what synced last.</Para><ProgressCard rows={rows} placed={data?1:0} total={data?.BOOT_STEPS??null} failed/><div className="onboarding-error-line" role="alert"><RichText text={action.error??error}/></div><Actions primary="Retry" secondary="Continue offline" icon="refresh" onPrimary={again} onSecondary={offline} busy={action.busy}/><Keys pairs={[["↵","to retry"],["esc","to continue offline"]]}/><TerminalHint command="npx -y terum-skills@latest sync" prefix="Same as"/></Column></Frame>;
}
