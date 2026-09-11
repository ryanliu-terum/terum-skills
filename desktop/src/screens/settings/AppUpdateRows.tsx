import { useEffect, useRef, useState, type ReactNode } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useBackend, usePreference } from '../../backend';
import type { AppUpdateStatus, Result, UpdateAdvice } from '../../backend/types';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Button } from '../../components/ui/Button';
import { InlineChoice } from '../../components/domain/WorkflowControls';
import { Dialog, DialogPopup, DialogTitle } from '../../components/ui/Dialog';
import { relativeTime } from '../../lib/relative-time';
import { isNewer } from '../../lib/version-compare';
import { SettingRow as Row, Value, StatusValue } from './SettingsParts';

export function AppUpdateRows({mode,appVersion,report}:{mode:'notice'|'full';appVersion:string|null;report:UpdateAdvice|null}):ReactNode {
 const backend=useBackend(),action=useWorkflow(),[,setSearch]=useSearchParams(),client=useQueryClient();
 const policy=usePreference<'ask'|'on-close'|'overnight'>('updates:app:policy','on-close');
 const row=useRef<HTMLDivElement>(null);
 useEffect(()=>{row.current?.focus();},[]);
 const policies={ask:'Ask me', 'on-close':'When I quit', overnight:'Overnight'};
 const descriptions={ask:'Ask me — show Install now, never install by itself','on-close':'When I quit — install the downloaded update after the app closes',overnight:'Overnight — install and relaunch between 01:00 and 05:00 while the app is open and idle'};
 const automatic=useQuery<Result<void>>({queryKey:['app-update-policy-outcome'],enabled:false,queryFn:skipToken}).data;
 const background=useQuery<string|null>({queryKey:['app-update-staging'],enabled:false,queryFn:skipToken}).data;
 const v=appVersion??'—';
 const status=useQuery({queryKey:['app-update'],queryFn:()=>backend.appUpdate.check(),enabled:mode==='full',staleTime:Infinity,gcTime:Infinity,refetchOnWindowFocus:false,refetchOnMount:false,retry:false});
 const [relaunch,setRelaunch]=useState<string|null>(null),[notPublished,setNotPublished]=useState(false);
 const recheck=()=>void action.perform(()=>client.fetchQuery({queryKey:['app-update'],queryFn:()=>backend.appUpdate.check({force:true}),staleTime:0,retry:false}),value=>client.setQueryData(['app-update'],{ok:true,value}));
 function download(version:string|null){if(version===null)return;setNotPublished(false);client.setQueryData(['app-update-staging'],version);void action.run(()=>backend.appUpdate.stage(version),{},value=>{setNotPublished(value.notPublished);if(value.staged)client.setQueryData<Result<AppUpdateStatus>>(['app-update'],current=>current?.ok?{ok:true,value:{...current.value,staged:version}}:current);}).finally(()=>client.setQueryData(['app-update-staging'],null));}
 let desc:ReactNode,control:ReactNode=<Value quiet>—</Value>,showsError=false;
 const s=status.data?.ok?status.data.value:null;
 if(mode==='notice'){
  if(isNewer(report?.latest,appVersion)){desc=`${v} · ${report?.latest} available · update terum-skills to install it from here`;control=<Button onClick={()=>setSearch(p=>{p.delete('team');p.set('dialog','update');return p;})}>Show update command</Button>;}
  else if(report?.latest){desc=`${v} · up to date`;control=<StatusValue kind="ok">Up to date</StatusValue>;}
  else desc=`${v} · no newer app is advertised on this machine.`;
 }else if(status.isPending)desc=`${v} · checking…`;
 else if(status.data?.ok===false||status.isError){const error=status.data?.ok===false?status.data.error:status.error?.message;desc=<>{`${v} · the update check did not run.`} <span role="alert">{error}</span></>;control=<Button icon="refresh" onClick={recheck}>Check again</Button>;}
 else if(!s||!s.supported)desc=`${v} · there is no desktop build for this machine.`;
 else if(s.lastApply?.phase==='failed'){const last=s.lastApply;desc=<>{`${v} · installing ${last.version} did not finish.`} <span role="alert">{last.error}</span></>;control=<Button onClick={()=>setRelaunch(last.version)}>Try again</Button>;}
 else if(s.lastApply?.phase==='launched'&&s.lastApply.version===appVersion&&!s.newer){desc=`Updated to ${s.lastApply.version}${s.lastApply.reason==='on-close'?' when you quit':s.lastApply.reason==='overnight'?' overnight':''}`;control=<StatusValue kind="ok">Up to date</StatusValue>;}
 else if(s.probe==='skipped'&&s.latest===null)desc=`${v} · release advertisements are not checked on this machine.`;
 else if(s.probe==='failed'&&!s.newer){desc=`${v} · could not reach github.com to check for a newer app.`;control=<Button icon="refresh" onClick={recheck}>Check again</Button>;}
 else if(!s.newer){desc=`${v} · up to date${s.latestAt!==null?` · checked ${relativeTime(s.latestAt)}`:''}`;control=<StatusValue kind="ok">Up to date</StatusValue>;}
 else if(action.busy||background){desc=`${v} · downloading ${s.latest}…`;control=<><Button disabled>Downloading…</Button>{action.busy?<Button onClick={()=>void action.stop()}>Cancel</Button>:null}</>;}
 else if(s.staged===s.latest){desc=`${v} · ${s.latest} downloaded and verified.`;control=<Button kind="primary" icon="refresh" onClick={()=>setRelaunch(s.latest)}>Install now</Button>;}
 else if(notPublished)desc=`${v} · ${s.latest} is announced but its files are not published yet.`;
 else if(action.error){showsError=true;desc=<>{`${v} · ${s.latest} could not be downloaded.`} <span role="alert">{action.error}</span></>;control=<Button onClick={()=>download(s.latest)}>Try again</Button>;}
 else{desc=`${v} · ${s.latest} available.`;control=<Button kind="primary" icon="arrow-down-to-line" onClick={()=>download(s.latest)}>Download</Button>;}
 if(s?.lastApply?.phase==='launched'&&s.lastApply.version===appVersion&&s.newer){const last=s.lastApply;desc=<>{`Updated to ${last.version}${last.reason==='on-close'?' when you quit':last.reason==='overnight'?' overnight':''}. `}{desc}</>;}
 const loose=action.error&&!showsError&&relaunch===null?action.error:automatic?.ok===false?automatic.error:null;
 return <><div id="app-update-row" ref={row} tabIndex={-1} aria-label="Terum Skills app"><Row title="Terum Skills app" desc={loose===null?desc:<>{desc} <span role="alert">{loose}</span></>}>{control}</Row></div>{mode==='full'?<Row title="Install updates" desc={descriptions[policy]}><InlineChoice label="Install updates" value={policies[policy]} options={Object.values(policies)} onChange={value=>{const selected=value==='Ask me'?'ask':value==='Overnight'?'overnight':'on-close';action.pref('updates:app:policy',selected);}}/></Row>:null}{action.lines.map((line,index)=><span role="status" key={index}>{line}</span>)}{relaunch!==null?<Dialog open onOpenChange={open=>{if(!open&&!action.busy)setRelaunch(null);}}><DialogPopup><DialogTitle>{`Install ${relaunch} and relaunch now?`}</DialogTitle><p>{`Terum Skills ${relaunch} is downloaded and verified. Relaunching closes this window; anything the app is running — an eval, a sync — is stopped when it closes.`}</p>{action.error?<span role="alert">{action.error}</span>:null}<Button disabled={action.busy} onClick={()=>setRelaunch(null)}>Later</Button><Button kind="primary" disabled={action.busy} onClick={()=>void action.perform(()=>backend.appUpdate.apply(relaunch),()=>{void backend.quit().catch(action.fail);})}>Relaunch</Button></DialogPopup></Dialog>:null}</>;
}
