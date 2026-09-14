import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PromptContext, setupSession, useBackend, SETUP_STEP_TO_BOARD } from '../../backend';
import { SETUP_STEP_KEYS } from '../../backend/types';
import type { LaunchContext, Onboarding, SetupStep } from '../../backend/types';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { OnboardingActions, OnboardingColumn, OnboardingFrame, OnboardingPara, OnboardingTile, OnboardingTitle, ProgressCard } from './OnboardingParts';
import { ReconcileDialog } from '../../components/domain/ReconcileDialog';
import { SectionLabel } from '../../components/domain/Primitives';
import { WorkflowField } from '../../components/domain/WorkflowControls';
import { reconcileHasRows } from '../../components/domain/reconcile';

const rows: readonly [SetupStep, string][] = [
 ['github','Checking GitHub access'], ['team','Configuring the team'],
 ['projects','Adding a project to your library'],
 ['evals','Evaluating shared skills'], ['hook','Offering the session hook and Claude Code skill'],
];
// A drawn row is behind the wizard once the CLI has moved past its step. SETUP_STEP_KEYS is the wizard's
// own order, so an unreached step (`invite` between team and projects) ranks a row without needing a row.
const rank=(step:SetupStep|null):number=>step===null?-1:SETUP_STEP_KEYS.indexOf(step);
// `refresh` says "still working", so only the running state may wear it. `handoff` and `refused` are settled
// states with a next action rather than a completion or an error, which is what separates them from `failed`.
const TILE={running:'refresh',finished:'check-circle',handoff:'info',cancelled:'x',refused:'info',failed:'alert'} as const;
export function SetupBoot({launch,restart=false}:{launch:LaunchContext;restart?:boolean}) {
 const backend=useBackend(), ask=useContext(PromptContext), navigate=useNavigate();
 const [session]=useState(()=>setupSession(backend,launch));
 const state=useSyncExternalStore(session.subscribe,session.snapshot);
 useEffect(()=>{if(restart&&session.snapshot().outcome!=='running')void session.retry();else void session.start(ask);},[session,ask,restart]);
 const navigated=useRef(false);
 // Stop is a terminal exit, so a cancelled run hands back to the Library. A RESTARTED screen is the one
 // exception: `retry()` flips the session to running synchronously, but this effect still fires with the
 // outcome captured before that, and navigating on it ran the whole wizard invisibly behind the Library.
 useEffect(()=>{if(!restart&&state.outcome==='cancelled'&&!navigated.current){navigated.current=true;navigate('/library/global');}},[restart,state.outcome,navigate]);
 const result=state.result, failed=result?.ok===false&&!result.cancelled&&!result.refused, refused=result?.ok===false&&result.refused===true;
 const steps=result?.value?.steps;
 const [reconcileDismissed,setReconcileDismissed]=useState(false);
 // `handoff` is the CLI's "you picked Join and named no repository" exit. It used to end the screen with
 // "Ask your team owner to invite you" and a single Back button, which is wrong for the common joiner: one
 // who accepted the invitation days ago and now has nothing pending to accept. Naming the repository is the
 // whole of what setup still needs, so the screen asks for it and re-enters the wizard with it as the target.
 const [joinTarget,setJoinTarget]=useState('');
 const join=()=>{const target=joinTarget.trim();if(target)navigate(`/onboarding/boot?start=1&target=${encodeURIComponent(target)}`);};
 const reconcileQuery=useQuery({queryKey:['setup-reconcile',launch.writtenAt],enabled:state.outcome==='finished'&&steps?.existing==='printed'&&!reconcileDismissed,queryFn:()=>backend.reconcile.list(),retry:false});
 // Disabling the query keeps its cached data, so the dismissed flag must gate the render too or Done/Cancel/Escape leave the modal open.
 const reconcile=!reconcileDismissed&&reconcileQuery.data?.ok&&reconcileHasRows(reconcileQuery.data.value)?reconcileQuery.data.value:null;
 const progress=state.progress, progressRow=progress?rows.find(([key])=>key===progress.label):undefined;
 const cardRows:Onboarding['bootRows']=rows.map(([key,label])=>{
  const outcome=steps?.[key];
  const complete=key==='hook'?outcome!==undefined&&steps?.wrapper!==undefined:outcome!==undefined;
  const skipped=key==='hook'?outcome==='skipped'&&steps?.wrapper==='skipped':outcome==='skipped';
  // Only the finished run carries `steps`, so mid-run a passed step is read from the active step's rank;
  // a step that ends up skipped reads `done` here and flips to 'Skipped' when the result lands.
  const passed=!result&&rank(state.activeStep)>rank(key);
  return [complete?'done':!result&&(state.activeStep===key||(key==='hook'&&state.activeStep==='wrapper'))?'current':passed?'done':'pending',label,key==='evals'&&progress?.label==='evals'?`${progress.done} of ${progress.total}`:skipped?'Skipped':outcome==='queued'?'Queued':complete?'Done':''];
 });
 if(progress&&!progressRow)cardRows.push(['running',progress.label??'Setup progress','']);
 const current=state.activeStep?SETUP_STEP_TO_BOARD[state.activeStep]:null;
 return <ScreenFrame><OnboardingFrame steps={[]} current={null} skipped={[]}><OnboardingColumn>
  <OnboardingTile icon={TILE[state.outcome]}/>
  <OnboardingTitle>{{running:'Setting up your workspace',finished:'Setup finished',handoff:'Join an existing team',cancelled:'Setup cancelled',refused:'Setup not started',failed:"Couldn't finish setup"}[state.outcome]}</OnboardingTitle>
  {launch.target&&<OnboardingPara>{launch.target}</OnboardingPara>}
  <ProgressCard label="Setup progress" rows={cardRows} placed={progress?.done??null} total={progress?.total??null} failed={failed}/>
  <div role="status" aria-live="polite">{result?(result.ok?state.outcome==='handoff'?"Enter your team's repository, or ask the team owner to invite you.":'Setup finished.':result.error):progressRow?.[1]??progress?.label??current??'Setup is running.'}</div>
  <div aria-label="Setup output" className="onboarding-error-line">{(state.outcome==='handoff'?state.lines.slice(-5):state.lines).map((line,index)=><div key={index} className={line.startsWith('✓ ')?'setup-output-ok':line.startsWith('✗ ')?'setup-output-bad':undefined}>{line}</div>)}</div>
  {state.outcome==='handoff'&&<div className="onboarding-fields"><div><SectionLabel>Your team&#39;s repository</SectionLabel><WorkflowField aria-label="Team repository" placeholder="org/repo" value={joinTarget} onChange={e=>setJoinTarget(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')join();}}/><span>If you already have access — you accepted the invitation, or the owner added you directly — setup joins from here. Nothing needs to be pending.</span></div></div>}
  {failed&&<div role="alert" className="onboarding-error-line">{result.error}</div>}
  {state.persistenceError&&<div role="alert">{state.persistenceError}</div>}
  {refused?<OnboardingActions primary="Open Settings ▸ Team" onPrimary={()=>navigate('/settings/teams')}/>:state.outcome==='running'?<OnboardingActions primary="Stop" onPrimary={()=>void session.stop()}/>:state.outcome==='failed'||state.outcome==='cancelled'?<OnboardingActions primary="Retry" onPrimary={()=>void session.retry()} secondary="Back" onSecondary={()=>navigate('/library/global')}/>:state.outcome==='handoff'?<OnboardingActions primary="Join" secondary="Back to the Library" onPrimary={join} onSecondary={()=>navigate('/library/global')}/>:<OnboardingActions primary="Open the Library" onPrimary={()=>navigate('/library/global')}/>}
 </OnboardingColumn></OnboardingFrame>{reconcile?<ReconcileDialog result={reconcile} title="Your skills" onClose={()=>setReconcileDismissed(true)}/>:null}</ScreenFrame>;
}
