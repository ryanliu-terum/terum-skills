import { useParams, useSearchParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import { useUrlState } from '../../app/url-state';
import { Shell } from '../../components/domain/Shell';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { BoardSkeleton, CenteredState, ErrorLine } from '../../components/domain/Primitives';
import { WorkflowHeader } from '../../components/domain/WorkflowControls';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Icon } from '../../components/ui/Icon';
import { SettingsContent } from './SettingsContent';
import { SettingCard } from './SettingsParts';
import { settingsSections } from './settings-data';
import './settings.css';

export function SettingsScreen(){
  const params=useParams(),state=useUrlState(),backend=useBackend(),action=useWorkflow(),navigate=useNavigate(),[search]=useSearchParams();
  const section=settingsSections.find(([key])=>key===params.section)?.[0]??'account';
  const query=useQuery({queryKey:['settings',state.mock],queryFn:({signal})=>backend.settings(undefined,{signal})});
  const status=useQuery({queryKey:['status',state.mock],queryFn:({signal})=>backend.status(undefined,{signal})});
  const catalog=useQuery({queryKey:['catalog',state.mock],queryFn:({signal})=>backend.catalog(undefined,{signal}),enabled:section==='teams'});
  const data=query.data?.ok?query.data.value:undefined, identity=status.data?.ok?status.data.value:undefined;
  const error=query.data?.ok===false?query.data.error:query.isError?query.error.message:status.data?.ok===false?status.data.error:status.isError?status.error.message:section==='teams'&&catalog.data?.ok===false?catalog.data.error:section==='teams'&&catalog.isError?catalog.error.message:null;
  const loading=!data||!identity||(section==='teams'&&catalog.isPending);
  const selected=error||state.mock==='loading'?'account':section;
  return <Shell selected="Settings" counts={loading||error?null:undefined}><ScreenFrame ready={(!query.isPending||state.mock==='loading')&&!status.isPending&&(section!=='teams'||!catalog.isPending||state.mock==='loading')}><WorkflowHeader title="Settings" icon="settings"/>
    <div className="settings-body"><nav className="settings-nav" aria-label="Settings sections">{settingsSections.map(([key,label,icon])=><a key={key} href={'#/settings/'+key+(search.size?'?'+search.toString():'')} aria-current={key===selected?'page':undefined} onClick={event=>{event.preventDefault();const next=new URLSearchParams(search);next.delete('dialog');navigate('/settings/'+key+(next.size?'?'+next.toString():''));}}><Icon name={icon} size={16}/><span>{label}</span></a>)}</nav>
    <div className="settings-scroll"><div className={'settings-content'+(error?' wide':'')}>
      {error?<CenteredState alert icon="alert" title="Couldn't read your settings" body="config.json in ~/.terum/skills is not valid JSON. terum-skills never rewrites a file it could not read, so nothing was lost: fix the file or move it aside, then try again." primary="Try again" secondary="Show in Finder" onPrimary={()=>{void query.refetch();void status.refetch();}} onSecondary={()=>void action.open('~/.terum/skills/config.json')}><ErrorLine>{error}</ErrorLine></CenteredState>:loading?<SettingsLoading/>:<SettingsContent key={section} section={section} data={data} status={identity} catalog={catalog.data?.ok?catalog.data.value:undefined}/>}
      {action.error&&<div role="alert" className="settings-action-error">{action.error}</div>}
    </div></div></div>
  </ScreenFrame></Shell>;
}
function SettingsLoading(){return <><div className="settings-loading-head" data-testid="settings-skeleton"><BoardSkeleton width={96} height={18}/><BoardSkeleton width={240} height={12}/></div>{[2,4,1].map((count,i)=><div className="settings-group" key={i}><BoardSkeleton width={64} height={12}/><SettingCard>{Array.from({length:count},(_,j)=><div className="settings-loading-row" key={j}><div><BoardSkeleton width={120} height={12}/><BoardSkeleton width={260} height={10}/></div><BoardSkeleton width={72} height={24} radius={6}/></div>)}</SettingCard></div>)}</>;}
