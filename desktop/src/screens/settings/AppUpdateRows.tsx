import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useBackend } from '../../backend';
import type { UpdateAdvice } from '../../backend/types';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Button } from '../../components/ui/Button';
import { Switch } from '../../components/ui/Switch';
import { Dialog, DialogPopup, DialogTitle } from '../../components/ui/Dialog';
import { relativeTime } from '../../lib/relative-time';
import { isNewer } from '../../lib/version-compare';
import { SettingRow as Row, Value, StatusValue } from './SettingsParts';

export function AppUpdateRows({mode,appVersion,report}:{mode:'notice'|'full';appVersion:string|null;report:UpdateAdvice|null}):ReactNode {
 const backend=useBackend(),action=useWorkflow(),[,setSearch]=useSearchParams(),client=useQueryClient();
 const v=appVersion??'—';
 const status=useQuery({queryKey:['app-update'],queryFn:()=>backend.appUpdate.check(),enabled:mode==='full',staleTime:Infinity,gcTime:Infinity,refetchOnWindowFocus:false,refetchOnMount:false,retry:false});
 const [relaunch,setRelaunch]=useState<string|null>(null),[notPublished,setNotPublished]=useState(false);
 const recheck=()=>void action.perform(()=>backend.appUpdate.check({force:true}),value=>client.setQueryData(['app-update'],{ok:true,value}));
 function download(version:string|null){if(version===null)return;setNotPublished(false);void action.run(()=>backend.appUpdate.stage(version),{},value=>{setNotPublished(value.notPublished);void status.refetch();});}
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
 else if(s.probe==='skipped'&&s.latest===null)desc=`${v} · release advertisements are not checked on this machine.`;
 else if(s.probe==='failed'&&!s.newer){desc=`${v} · could not reach github.com to check for a newer app.`;control=<Button icon="refresh" onClick={recheck}>Check again</Button>;}
 else if(!s.newer){desc=`${v} · up to date${s.latestAt!==null?` · checked ${relativeTime(s.latestAt)}`:''}`;control=<StatusValue kind="ok">Up to date</StatusValue>;}
 else if(action.busy){desc=`${v} · downloading ${s.latest}…`;control=<><Button disabled>Downloading…</Button><Button onClick={()=>void action.stop()}>Cancel</Button></>;}
 else if(s.staged===s.latest){desc=`${v} · ${s.latest} downloaded and verified.`;control=<Button kind="primary" icon="refresh" onClick={()=>setRelaunch(s.latest)}>Relaunch now</Button>;}
 else if(notPublished)desc=`${v} · ${s.latest} is announced but its files are not published yet.`;
 else if(action.error){showsError=true;desc=<>{`${v} · ${s.latest} could not be downloaded.`} <span role="alert">{action.error}</span></>;control=<Button onClick={()=>download(s.latest)}>Try again</Button>;}
 else{desc=`${v} · ${s.latest} available.`;control=<Button kind="primary" icon="arrow-down-to-line" onClick={()=>download(s.latest)}>Download {s.latest}</Button>;}
 const loose=action.error&&!showsError&&relaunch===null?action.error:null;
 return <><Row title="Terum Skills app" desc={loose===null?desc:<>{desc} <span role="alert">{loose}</span></>}>{control}</Row>{mode==='full'?<Row title="Download updates automatically" desc="Fetches a new app in the background when one is advertised. Nothing is installed until you press Relaunch."><span className="settings-toggle-hit"><Switch aria-label="Download updates automatically" checked={backend.prefs.get('updates:app:auto',true)} onCheckedChange={value=>action.pref('updates:app:auto',value)}/></span></Row>:null}{action.lines.map((line,index)=><span role="status" key={index}>{line}</span>)}{relaunch!==null?<Dialog open onOpenChange={open=>{if(!open&&!action.busy)setRelaunch(null);}}><DialogPopup><DialogTitle>Relaunch to finish updating</DialogTitle><p>{`Terum Skills ${relaunch} is downloaded and verified. Relaunching closes this window; anything the app is running — an eval, a sync — is stopped when it closes.`}</p>{action.error?<span role="alert">{action.error}</span>:null}<Button disabled={action.busy} onClick={()=>setRelaunch(null)}>Later</Button><Button kind="primary" disabled={action.busy} onClick={()=>void action.perform(()=>backend.appUpdate.apply(relaunch),()=>{void backend.quit().catch(action.fail);})}>Relaunch</Button></DialogPopup></Dialog>:null}</>;
}
