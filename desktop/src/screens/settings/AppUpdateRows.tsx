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
import { appUpdatePolicy, recordAppUpdateAttempt, stagedAppUpdate, type AppUpdateErrors } from '../../lib/app-update';
import { isNewer } from '../../lib/version-compare';
import { concludeDownload, planUpdate } from '../../lib/update-and-relaunch';
import { SettingRow as Row, Value, StatusValue } from './SettingsParts';

export function AppUpdateRows({mode,appVersion,report}:{mode:'notice'|'full';appVersion:string|null;report:UpdateAdvice|null}):ReactNode {
 const backend=useBackend(),action=useWorkflow(),[search,setSearch]=useSearchParams(),client=useQueryClient();
 const policy=appUpdatePolicy(usePreference('updates:app:policy','on-close'));
 const row=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(search.get('focus')==='app'){row.current?.focus();setSearch(previous=>{const next=new URLSearchParams(previous);next.delete('focus');return next;},{replace:true});}},[search,setSearch]);
 const policies={ask:'Ask me', 'on-close':'When I quit', overnight:'Overnight'};
 const descriptions={ask:'Ask me — show Install now, never install by itself','on-close':'When I quit — install the downloaded update after the app closes',overnight:'Overnight — install and relaunch between 01:00 and 05:00 while the app is open and idle'};
 const automatic=useQuery<AppUpdateErrors>({queryKey:['app-update-policy-outcome'],enabled:false,queryFn:skipToken,gcTime:Infinity}).data;
 const background=useQuery<string|null>({queryKey:['app-update-staging'],enabled:false,queryFn:skipToken}).data;
 const v=appVersion??'—';
 const status=useQuery({queryKey:['app-update'],queryFn:()=>backend.appUpdate.check(),enabled:mode==='full',staleTime:Infinity,gcTime:Infinity,refetchOnWindowFocus:false,refetchOnMount:false,retry:false});
 const [relaunch,setRelaunch]=useState<string|null>(null),[notPublished,setNotPublished]=useState(false);
 const recheck=()=>void action.perform(()=>backend.appUpdate.check({force:true}),value=>client.setQueryData(['app-update'],{ok:true,value}));
 function download(version:string|null){if(version===null)return;setNotPublished(false);client.setQueryData(['app-update-staging'],version);void action.run(()=>backend.appUpdate.stage(version),{},value=>{setNotPublished(value.notPublished);if(value.staged)client.setQueryData<Result<AppUpdateStatus>>(['app-update'],current=>current?.ok?{ok:true,value:{...current.value,staged:version}}:current);}).finally(()=>client.setQueryData(['app-update-staging'],null));}
 // "Update and relaunch" is one gesture over the same backend calls the rows above use one at a time: a forced probe,
 // the download, then the same confirmation dialog. It owns a second workflow so its lines, error and Cancel never mix
 // with a Download or Install now already running from the status row.
 const oneShot=useWorkflow(),[phase,setPhase]=useState<'idle'|'checking'|'downloading'>('idle'),[outcome,setOutcome]=useState<string|null>(null);
 async function updateNow(){
  if(oneShot.busy||phase!=='idle')return;
  setOutcome(null);setPhase('checking');
  try{
   // The staging marker is set before the fresh observation is published, so the launch hook's automatic policy sees a
   // download in flight and does not start a second one for the same version. The reverse race is closed here too: a
   // download the policy began while this probe was in flight (a focus recheck landed first) is left alone.
   const seen={inFlight:false};
   const checked=await oneShot.perform(()=>backend.appUpdate.check({force:true}),value=>{const plan=planUpdate(value);if(plan.kind==='download'){if(client.getQueryData(['app-update-staging']))seen.inFlight=true;else client.setQueryData(['app-update-staging'],plan.version);}client.setQueryData(['app-update'],{ok:true,value});});
   if(!checked?.ok)return;
   const plan=planUpdate(checked.value);
   if(plan.kind==='unsupported')setOutcome(`There is no desktop build for this machine (${checked.value.platform}).`);
   else if(plan.kind==='not-checked')setOutcome('Release advertisements are not checked on this machine, so there is nothing to update from here.');
   else if(plan.kind==='unreachable')oneShot.fail(`Could not reach github.com to check for a newer app.${plan.error?` ${plan.error}`:''}`);
   else if(plan.kind==='up-to-date')setOutcome(`Checked just now · ${v} is the newest build (${checked.value.platform}).`);
   else if(plan.kind==='installed')setOutcome(`${plan.version} is already installed on this machine. Quit and reopen the app to run it.`);
   else if(plan.kind==='ready')setRelaunch(plan.version);
   else if(seen.inFlight)setOutcome(`${plan.version} is downloading already; Install now appears above once it is verified.`);
   else{
    setPhase('downloading');recordAppUpdateAttempt(client,plan.version);
    const staged=await oneShot.run(()=>backend.appUpdate.stage(plan.version),{},value=>{if(value.staged)client.setQueryData<Result<AppUpdateStatus>>(['app-update'],current=>current?.ok?{ok:true,value:{...current.value,staged:plan.version}}:current);}).finally(()=>client.setQueryData(['app-update-staging'],null));
    if(!staged?.ok)return;
    const downloaded=concludeDownload(staged.value);
    if(downloaded.kind==='ready')setRelaunch(downloaded.version);
    else if(downloaded.kind==='not-published')setOutcome(`${downloaded.version} is announced but its files are not published yet. Try again in a few minutes.`);
    else oneShot.fail(downloaded.error);
   }
  }finally{setPhase('idle');}
 }
 let desc:ReactNode,control:ReactNode=<Value quiet>—</Value>,showsError=false;
 const s=status.data?.ok?status.data.value:null;
 if(mode==='notice'){
  if(isNewer(report?.latest,appVersion)){desc=`${v} · ${report?.latest} available · update terum-skills to install it from here`;control=<Button onClick={()=>setSearch(p=>{p.delete('team');p.set('dialog','update');return p;})}>Show update command</Button>;}
  else if(report?.latest){desc=`${v} · up to date`;control=<StatusValue kind="ok">Up to date</StatusValue>;}
  else desc=`${v} · no newer app is advertised on this machine.`;
 }else if(status.isPending)desc=`${v} · checking…`;
 else if(status.data?.ok===false||status.isError){const error=status.data?.ok===false?status.data.error:status.error?.message;desc=<>{`${v} · the update check did not run.`} <span role="alert">{error}</span></>;control=<Button icon="refresh" onClick={recheck}>Check again</Button>;}
 else if(!s||!s.supported)desc=`${v} · there is no desktop build for this machine.`;
 else if(s.lastApply && s.lastApply.phase!=='launched' && (!s.newer||s.lastApply.version===s.latest)){const last=s.lastApply;desc=<>{`${v} · installing ${last.version} did not finish.`} <span role="alert">{last.error??'The installer did not report completion. Try again.'}</span></>;control=<Button onClick={()=>setRelaunch(last.version)}>Try again</Button>;}
 else if(s.lastApply?.phase==='launched'&&s.lastApply.version===appVersion&&!s.newer){desc=`Updated to ${s.lastApply.version}${s.reason==='on-close'?' when you quit':s.reason==='overnight'?' overnight':''}`;control=<StatusValue kind="ok">Up to date</StatusValue>;}
 else if(s.probe==='skipped'&&s.latest===null)desc=`${v} · release advertisements are not checked on this machine.`;
 else if(s.probe==='failed'&&!s.newer){desc=`${v} · could not reach github.com to check for a newer app.`;control=<Button icon="refresh" onClick={recheck}>Check again</Button>;}
 else if(s.latest===null&&!s.newer){desc=`${v} · no release advertisement has been read on this machine yet.`;control=<Button icon="refresh" onClick={recheck}>Check again</Button>;}
 // "Up to date" is a claim about a cache, so the row always offers the probe that can disprove it.
 else if(!s.newer){desc=`${v} · up to date${s.latestAt!==null?` · checked ${relativeTime(s.latestAt)}`:''}`;control=<><StatusValue kind="ok">Up to date</StatusValue><Button icon="refresh" onClick={recheck}>Check again</Button></>;}
 else if(action.busy||background){desc=`${v} · downloading ${s.latest} (${s.platform})…`;control=<><Button disabled>Downloading…</Button>{action.busy?<Button onClick={()=>void action.stop()}>Cancel</Button>:null}</>;}
 else if(stagedAppUpdate(s)!==null){desc=`${v} · ${s.latest} downloaded and verified.`;control=<Button kind="primary" icon="refresh" onClick={()=>setRelaunch(s.latest)}>Install now</Button>;}
 else if(notPublished)desc=`${v} · ${s.latest} is announced but its files are not published yet.`;
 else if(action.error){showsError=true;desc=<>{`${v} · ${s.latest} could not be downloaded.`} <span role="alert">{action.error}</span></>;control=<Button onClick={()=>download(s.latest)}>Try again</Button>;}
 else{desc=`${v} · ${s.latest} available (${s.platform} build).`;control=<Button kind="primary" icon="arrow-down-to-line" onClick={()=>download(s.latest)}>Download</Button>;}
 // A stale marker for another version never outranks a real update: the failure is said first, the update still offered.
 if(s?.lastApply&&s.lastApply.phase!=='launched'&&s.newer&&s.lastApply.version!==s.latest){const last=s.lastApply;desc=<><span role="alert">{`Installing ${last.version} did not finish: ${last.error??'the installer did not report completion.'}`}</span> {desc}</>;}
 if(s?.lastApply?.phase==='launched'&&s.lastApply.version===appVersion&&s.newer){const last=s.lastApply;desc=<>{`Updated to ${last.version}${s.reason==='on-close'?' when you quit':s.reason==='overnight'?' overnight':''}. `}{desc}</>;}
 const loose=action.error&&!showsError&&relaunch===null?action.error:null;
 return <><div id="app-update-row" ref={row} tabIndex={-1} aria-label="Terum Skills app"><Row title="Terum Skills app" desc={loose===null?desc:<>{desc} <span role="alert">{loose}</span></>}>{control}</Row>{Object.entries(automatic??{}).map(([concern,error])=><span role="alert" key={concern}>{error}</span>)}{s?.acknowledgementError?<span role="alert">{s.acknowledgementError}</span>:null}</div>{mode==='full'&&s?.supported!==false?<Row title="Update and relaunch" desc={<>{'Checks github.com now, downloads and verifies the newest build, then installs it and relaunches the app. Anything the app is running — an eval, a sync — is stopped when it closes.'}{outcome!==null?<span role="status" style={{display:'block'}}>{outcome}</span>:null}{oneShot.notice!==null?<span role="status" style={{display:'block'}}>{oneShot.notice}</span>:null}{oneShot.error!==null?<span role="alert" style={{display:'block'}}>{oneShot.error}</span>:null}</>}>{phase==='downloading'?<><Button disabled>Downloading…</Button><Button onClick={()=>void oneShot.stop()}>Cancel</Button></>:<Button kind="primary" icon="refresh" disabled={phase!=='idle'||action.busy||!!background} onClick={()=>void updateNow()}>{phase==='checking'?'Checking…':'Update and relaunch…'}</Button>}</Row>:null}{oneShot.lines.map((line,index)=><span role="status" key={'update-'+index}>{line}</span>)}{mode==='full'?<Row title="Install updates" desc={<>{Object.entries(descriptions).map(([key,text])=><span key={key} style={{display:'block'}}>{text}</span>)}</>}><InlineChoice label="Install updates" value={policies[policy]} options={Object.values(policies)} onChange={value=>{const selected=value==='Ask me'?'ask':value==='Overnight'?'overnight':'on-close';action.pref('updates:app:policy',selected);}}/></Row>:null}{action.lines.map((line,index)=><span role="status" key={index}>{line}</span>)}{relaunch!==null?<Dialog open onOpenChange={open=>{if(!open&&!action.busy)setRelaunch(null);}}><DialogPopup><DialogTitle>{`Install ${relaunch} and relaunch now?`}</DialogTitle><p>{`Terum Skills ${relaunch} is downloaded and verified. Relaunching closes this window; anything the app is running — an eval, a sync — is stopped when it closes.`}</p>{action.error?<span role="alert">{action.error}</span>:null}<Button disabled={action.busy} onClick={()=>setRelaunch(null)}>Later</Button><Button kind="primary" disabled={action.busy} onClick={()=>void action.perform(()=>backend.appUpdate.apply(relaunch,'manual'),()=>{void backend.quit().catch(action.fail);})}>Relaunch</Button></DialogPopup></Dialog>:null}</>;
}
