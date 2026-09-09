import { useBackend } from '../backend';
import { CenteredState } from '../components/domain/Primitives';
import { WorkflowDialog } from '../components/domain/WorkflowControls';
import { Button } from '../components/ui/Button';
import { useEvalRun } from './eval-run-context';
import { useMachineRemoval } from './machine-removal-context';

const command='npx -y terum-skills@latest uninstall';
const title='Remove terum-skills from this machine?';
export function MachineRemovalHost(){
 const backend=useBackend(),evalRun=useEvalRun(),{current:state,answer,dismiss}=useMachineRemoval();
 if(!state||state.phase==='cancelled')return null;
 if(state.phase==='reading')return <WorkflowDialog title={title} body="" primary={null} status="Reading what this machine holds…" command={command} closeLabel="Cancel" close={dismiss} submit={()=>{}}/>;
 if(state.phase==='refused')return <WorkflowDialog title="Stop the running eval first" body="Removing terum-skills deletes the version cache and the clone the eval is using (Settings ▸ Evals)." primary="Show eval" command={command} close={dismiss} submit={()=>{evalRun.show();dismiss();}}/>;
 if(state.phase==='done'&&state.result?.ok){
  const result=state.result.value;
  return <section role="region" aria-label="terum-skills was removed from this machine" className="removal-complete" style={{position:'fixed',inset:0,zIndex:50,background:'var(--tk-bg1)',display:'flex',alignItems:'center',justifyContent:'center'}}>
   <CenteredState icon="check" title="terum-skills was removed from this machine" body="" primary="Quit" onPrimary={()=>void backend.quit()}>
    <div>Left: {result.removed.join(', ')||'none'}</div>
    <div>Placed skills removed: {result.removedPlacements}</div>
    <div>Hook: {result.hookRemoved?'removed':'none'}</div>
    <div>/terum-skills skill: {result.wrapperRemoved?'removed':'none'}</div>
    <div>config.json: {result.configRemoved?'removed':'kept'}</div>
    <div>Kept: {result.kept.join(', ')}</div>
    <div>Record: {result.record}</div>
    <Button kind="ghost" onClick={()=>void backend.revealPath(result.record)}>Show in Finder</Button>
    {result.advice.map((line,i)=><div key={i}>{line}</div>)}
    <pre className="board-mono" role="log">{state.lines.join('\n')}</pre>
   </CenteredState>
  </section>;
 }
 if(state.phase==='failed')return <WorkflowDialog title="Remove terum-skills from this machine" body="" primary={null} command={command} close={dismiss} submit={()=>{}} closeLabel="Close" error={state.result&&!state.result.ok?state.result.error:null} lines={state.lines}/>;
 return <WorkflowDialog danger title={state.question??title} body="" primary={state.phase==='asking'?'Remove':null} command={command} close={()=>answer(false)} submit={()=>answer(true)} busy={state.phase==='removing'} lines={state.lines} dismissKeepsRunning={false} hideBusyClose closeLabel="Cancel">
  {state.detail.map((line,i)=><div key={i} className="settings-bullet" style={{whiteSpace:'pre-wrap'}}>{line}</div>)}
 </WorkflowDialog>;
}
