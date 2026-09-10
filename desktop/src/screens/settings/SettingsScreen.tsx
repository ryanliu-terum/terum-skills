import { useParams, useSearchParams, useNavigate, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import { useUrlState } from '../../app/url-state';
import { Shell } from '../../components/domain/Shell';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { BoardSkeleton, CenteredState, ErrorLine, TerminalHint } from '../../components/domain/Primitives';
import { WorkflowHeader } from '../../components/domain/WorkflowControls';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Icon } from '../../components/ui/Icon';
import { SettingsContent } from './SettingsContent';
import { SettingCard } from './SettingsParts';
import { settingsSections } from './settings-data';
import './settings.css';

export function SettingsScreen(){
  const params=useParams(),state=useUrlState(),backend=useBackend(),action=useWorkflow(),navigate=useNavigate(),[search]=useSearchParams();
  const surfaces=useQuery({queryKey:['surfaces'],queryFn:()=>backend.surfaces()});
  const section=settingsSections.find(([key])=>key===params.section)?.[0]??'account';
  const query=useQuery({queryKey:['settings',state.mock],queryFn:({signal})=>backend.settings(undefined,{signal})});
  const status=useQuery({queryKey:['status',state.mock],queryFn:({signal})=>backend.status(undefined,{signal})});
  const capabilities=useQuery({queryKey:['capabilities'],queryFn:()=>backend.capabilities()});
  const update=useQuery({queryKey:['update',state.mock],queryFn:({signal})=>backend.update(undefined,{signal}),enabled:section==='updates'&&query.data?.ok===true&&status.data?.ok===true,refetchOnWindowFocus:false});
  const data=query.data?.value, identity=status.data?.value;
  const error=query.data?.ok===false?query.data.error:query.isError?query.error.message:status.data?.ok===false?status.data.error:status.isError?status.error.message:null;
  const reason=query.data?.ok===false?query.data.reason:status.data?.ok===false?status.data.reason:undefined;
  const loading=!data||!identity;
  const selected=(error&&loading)||state.mock==='loading'?'account':section;
  if(section==='inbox'&&surfaces.data?.inbox===false)return <Navigate to="/settings/account" replace/>;
  return <Shell selected="Settings" counts={loading?null:undefined}><ScreenFrame ready={(!query.isPending||state.mock==='loading')&&!status.isPending&&(section!=='updates'||!!error||state.mock==='loading'||(!update.isPending&&!capabilities.isPending))}><WorkflowHeader title="Settings" icon="settings"/>
    <div className="settings-body"><nav className="settings-nav" aria-label="Settings sections">{settingsSections.filter(([key])=>key!=='inbox'||surfaces.data?.inbox===true).map(([key,label,icon])=><a key={key} href={'#/settings/'+key+(search.size?'?'+search.toString():'')} aria-current={key===selected?'page':undefined} onClick={event=>{event.preventDefault();const next=new URLSearchParams(search);next.delete('dialog');navigate('/settings/'+key+(next.size?'?'+next.toString():''));}}><Icon name={icon} size={16}/><span>{label}</span></a>)}</nav>
    <div className="settings-scroll"><div className={'settings-content'+(error&&loading?' wide':'')}>
      {error&&loading?reason==='no-team'?<CenteredState icon="box" title="No team on this machine" body="Create a team or join the one you were invited to. Setup runs here in the app." primary="Start setup" secondary="Copy terminal command" onPrimary={()=>navigate('/onboarding/boot?start=1')} onSecondary={()=>void action.perform(()=>backend.copyToClipboard('npx -y terum-skills@latest setup'))}><TerminalHint command="npx -y terum-skills@latest setup" prefix="From the terminal"/></CenteredState>:reason==='invalid-config'?<CenteredState alert icon="alert" title="Couldn't read your settings" body="config.json in ~/.terum/skills is not valid JSON. terum-skills never rewrites a file it could not read, so nothing was lost: fix the file or move it aside, then try again." primary="Try again" secondary="Show in Finder" onPrimary={()=>{void query.refetch();void status.refetch();}} onSecondary={()=>void action.perform(()=>backend.revealPath('~/.terum/skills/config.json'))}><ErrorLine>{error}</ErrorLine></CenteredState>:<CenteredState alert icon="alert" title="Couldn't read your settings" body="terum-skills could not read your settings, so this page shows nothing rather than stale values. The message below is the CLI's own." primary="Try again" secondary="Show in Finder" onPrimary={()=>{void query.refetch();void status.refetch();}} onSecondary={()=>void action.perform(()=>backend.revealPath('~/.terum/skills'))}><ErrorLine>{error}</ErrorLine></CenteredState>:loading?<SettingsLoading/>:<>{error&&<ErrorLine>{error}</ErrorLine>}<SettingsContent surfaces={surfaces.data} key={section} section={section} data={data} status={identity} report={update.data?.ok?update.data.value:null} updateError={update.data?.ok===false?update.data.error:update.isError?update.error.message:null} appVersion={capabilities.data?.appVersion??null}/></>}
      {action.error&&<div role="alert" className="settings-action-error">{action.error}</div>}
    </div></div></div>
  </ScreenFrame></Shell>;
}
function SettingsLoading(){return <><div className="settings-loading-head" data-testid="settings-skeleton"><BoardSkeleton width={96} height={18}/><BoardSkeleton width={240} height={12}/></div>{[2,4,1].map((count,i)=><div className="settings-group" key={i}><BoardSkeleton width={64} height={12}/><SettingCard>{Array.from({length:count},(_,j)=><div className="settings-loading-row" key={j}><div><BoardSkeleton width={120} height={12}/><BoardSkeleton width={260} height={10}/></div><BoardSkeleton width={72} height={24} radius={6}/></div>)}</SettingCard></div>)}</>;}
