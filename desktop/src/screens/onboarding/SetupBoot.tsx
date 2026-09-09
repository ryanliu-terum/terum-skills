import { useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { PromptContext, setupSession, useBackend, SETUP_STEP_TO_BOARD } from '../../backend';
import type { LaunchContext, Onboarding, SetupStep } from '../../backend/types';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { OnboardingActions, OnboardingColumn, OnboardingFrame, OnboardingPara, OnboardingTile, OnboardingTitle, ProgressCard } from './OnboardingParts';

const rows: readonly [SetupStep, string][] = [
 ['github','Checking GitHub access'], ['team','Configuring the team'],
 ['actions','Offering local skills'], ['hook','Offering the session hook and Claude Code skill'],
];
export function SetupBoot({launch,restart=false}:{launch:LaunchContext;restart?:boolean}) {
 const backend=useBackend(), ask=useContext(PromptContext), navigate=useNavigate();
 const [session]=useState(()=>setupSession(backend,launch));
 const state=useSyncExternalStore(session.subscribe,session.snapshot);
 useEffect(()=>{if(restart&&session.snapshot().outcome!=='running')void session.retry();else void session.start(ask);},[session,ask,restart]);
 const result=state.result, failed=result?.ok===false&&!result.cancelled;
 const steps=result?.value?.steps;
 const cardRows:Onboarding['bootRows']=rows.map(([key,label])=>{
  const outcome=steps?.[key];
  const complete=key==='hook'?outcome!==undefined&&steps?.wrapper!==undefined:outcome!==undefined;
  const skipped=key==='hook'?outcome==='skipped'&&steps?.wrapper==='skipped':outcome==='skipped';
  return [complete?'done':!result&&(state.activeStep===key||(key==='hook'&&state.activeStep==='wrapper'))?'current':'pending',label,skipped?'Skipped':complete?'Done':''];
 });
 if(state.progress)cardRows.push(['running',state.progress.label??'Setup progress','']);
 const current=state.activeStep?SETUP_STEP_TO_BOARD[state.activeStep]:null;
 return <ScreenFrame><OnboardingFrame steps={[]} current={null} skipped={[]}><OnboardingColumn>
  <OnboardingTile icon={failed?'alert':result?.ok?'check-circle':'refresh'}/>
  <OnboardingTitle>{{running:'Setting up your workspace',finished:'Setup finished',handoff:'Ask your team owner to invite you',cancelled:'Setup cancelled',failed:"Couldn't finish setup"}[state.outcome]}</OnboardingTitle>
  {launch.target&&<OnboardingPara>{launch.target}</OnboardingPara>}
  <ProgressCard label="Setup progress" rows={cardRows} placed={state.progress?.done??null} total={state.progress?.total??null} failed={failed}/>
  <div role="status" aria-live="polite">{result?(result.ok?state.outcome==='handoff'?'Ask your team owner to invite you.':'Setup finished.':result.error):state.progress?.label??current??'Setup is running.'}</div>
  <div aria-label="Setup output" className="onboarding-error-line">{(state.outcome==='handoff'?state.lines.slice(-5):state.lines).map((line,index)=><div key={index}>{line}</div>)}</div>
  {failed&&<div role="alert" className="onboarding-error-line">{result.error}</div>}
  {state.persistenceError&&<div role="alert">{state.persistenceError}</div>}
  {state.outcome==='running'?<OnboardingActions primary="Stop" onPrimary={()=>void session.stop()}/>:state.outcome==='failed'||state.outcome==='cancelled'?<OnboardingActions primary="Retry" onPrimary={()=>void session.retry()} secondary="Back" onSecondary={()=>navigate('/library/global')}/>:<OnboardingActions primary={state.outcome==='handoff'?'Back to the Library':'Open the Library'} onPrimary={()=>navigate('/library/global')}/>}
 </OnboardingColumn></OnboardingFrame></ScreenFrame>;
}
