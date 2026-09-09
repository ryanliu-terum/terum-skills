import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import { App } from '../../../app/App';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';
const tree='5f0e12ab9c3d'+'0'.repeat(28);
function receipt(model='sonnet') { return {
 path:'/repo/evals/id/'+tree+'/20260909T010000Z.json',version:tree,run_id:'20260909T010000Z',verdict:'PASS',execution_status:'complete',expected_rows:9,scored_rows:9,attribution:'Recorded reason',
 comparisons:{'candidate-vs-baseline':{win:6,loss:1,tie:2,net_lift:5/9,sign_p:0.125}},arm_scores:{candidate:0.81,baseline:0.45},triggers:{tp:3,fn:1,fp:2,tn:4,recall:0.75,precision:0.6},
 efficiency:{candidate:{turns:2,duration_ms:61000,cost_usd:0.4},baseline:{turns:3,duration_ms:90000,cost_usd:0.5}},
 provenance:{timestamp:'2026-09-09T01:00:00Z',runner_handle:'mira',model,judge_model:'judge',cc_version:'2.1.250',engine_version:'0.1.7',engine_commit:'abc123',k:3,cases:['one','two','three']},
 }; }
function report(model='sonnet'){return {versions:{placed:tree,teamCurrent:tree,evaluated:tree},latestState:'ok',latest:receipt(model),history:[],localRuns:[]};}
function adapter(value:unknown,prints:string[]=[]){const f=fakeBridge((args,emit)=>{for(const line of prints)emit({kind:'stdout',line:JSON.stringify({t:'print',level:'warn',line})});emit({kind:'stdout',line:JSON.stringify({t:'result',verb:args[0],ok:true,exitCode:0,value})});});return {backend:createTauriBackend(f.bridge),...f};}
afterEach(()=>{cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});
it('retains invalid-newest diagnostics without substituting an older receipt',async()=>{
 const {backend,spawns}=adapter({...report(),latestState:'invalid',latest:null},['warning: the newest receipt is invalid (/repo/evals/id/bad.json); older receipts are listed in history only.']);
 const r=await backend.evalReport({ref:'deploy-check',team:'acme'});expect(r.ok).toBe(true);if(!r.ok)throw new Error(r.error);
 expect(r.value.latestState).toBe('invalid');expect(r.value.receipt).toBeNull();expect(r.value.invalidReceiptFile).toContain('bad.json');
 expect(spawns[0]?.args).toEqual(['eval-report','--team','acme','--','deploy-check']);
});
it('maps the stated receipt values and formats their units without fixture constants',async()=>{
 const {backend}=adapter(report());const r=await backend.evalReport({ref:'deploy-check'});if(!r.ok)throw new Error(r.error);
 expect(r.value.summary).toEqual({w:6,l:1,t:2,n:9,lift:56,verdict:'PASS',partial:null,signP:'0.125'});
 expect(r.value.reportNumbers).toEqual({holes:0,nRounds:9,triggerTotal:6});
 expect(r.value.receipt).toMatchObject({model:'sonnet',cc:'2.1.250',runner:'mira',timestamp:'2026-09-09 01:00 UTC',catalog:0,per_case:[],arm:{candidate:0.81,baseline:0.45,incumbent:null},eff:{candidate:['2','61 s','$0.40'],baseline:['3','90 s','$0.50'],incumbent:null}});
 expect(r.value.scoreFractions).toEqual({routesExpected:4,roi:null,quality:[0.81,0.45]});
 expect(r.value.evalEstimate).toEqual({cases:3,k:3,arms:2,runs:18,minutes:25,dollars:8,model:'sonnet'});
 expect(r.value.evalEstimateText).toMatch(/arm-run pricing from the last receipt\.$/);
});
it('does not estimate a default Sonnet run from an Opus receipt',async()=>{
 const r=await adapter(report('opus')).backend.evalReport({ref:'deploy-check'});expect(r.value?.evalEstimateText).toBe('');expect(r.value?.evalEstimate).toBeNull();
});
it('withholds estimates with missing efficiency and does not substitute locals for invalid receipts',async()=>{
 const latest=receipt();latest.efficiency.candidate.cost_usd=null as unknown as number;
 const r=await adapter({...report(),latest}).backend.evalReport({ref:'deploy-check'});expect(r.value?.evalEstimate).toBeNull();
 const invalid=await adapter({...report(),latestState:'invalid',latest:null,localRuns:[{run_id:'local',run_dir:'/tmp/run',execution_status:'complete',committed:false,receipt:receipt()}]}).backend.evalReport({ref:'deploy-check'});expect(invalid.value?.receipt).toBeNull();expect(invalid.value?.localRuns[0]?.receipt?.run_id).toBe('20260909T010000Z');
});
it('shows the newest local receipt and appends only uncommitted local history',async()=>{
 const local={run_id:'20260909T010000Z',run_dir:'/tmp/run',execution_status:'complete',committed:false,receipt:receipt()};
 const history={version:tree,run_id:'old',timestamp:'2026-09-08T00:00:00Z',runner_handle:'sam',comparison:receipt().comparisons['candidate-vs-baseline'],verdict:'PASS',execution_status:'complete'};
 const r=await adapter({...report(),latestState:'none',latest:null,history:[history],localRuns:[local,{...local,run_id:'committed',committed:true}]}).backend.evalReport({ref:'deploy-check'});
 expect(r.value?.receipt?.run_id).toBe(local.run_id);expect(r.value?.latestState).toBe('none');expect(r.value?.history).toHaveLength(2);expect(r.value?.history[0]).toMatchObject({when:'2026-09-08',runner:'sam',version:tree.slice(0,12),wlt:[6,1,2]});expect(r.value?.history[1]).toMatchObject({local:true,runner:'local'});expect(r.value?.evalEstimate).toBeNull();
});
it('only serves a committed receipt matching the requested raw version',async()=>{
 const {backend}=adapter({...report(),versions:{...report().versions,evaluated:'different'}});
 expect((await backend.receipts({skillId:'deploy-check',version:tree})).value?.run_id).toBe('20260909T010000Z');
 expect((await backend.receipts({skillId:'deploy-check',version:'other'})).value).toBeNull();
 expect((await adapter({...report(),latestState:'none'}).backend.receipts({skillId:'deploy-check',version:tree})).value).toBeNull();
});
it('renders the installed/team version mismatch through the App using CLI inventory frames',async()=>{
 const value={...report(),versions:{...report().versions,placed:'a1b2c3d4'+'0'.repeat(32)}};
 const f=fakeBridge((args,emit)=>{
  if(args[0]==='eval-report'){emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'eval-report',ok:true,exitCode:0,value})});return;}
  const name=args[0]==='ls'?args.includes('--local')?'ls-local':'ls':args[0]==='validate'?'validate-deploy-check':args[0]!;
  for(const line of readFileSync(resolve('../.planning/codex-runs/m7-S7g/frames',name+'.jsonl'),'utf8').trim().split('\n'))emit({kind:'stdout',line});
 });
 location.hash='#/skill/deploy-check?tab=evals';
 render(createElement(BackendContext,{value:createTauriBackend(f.bridge)},createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement(Tooltip.Provider,null,createElement(App)))));
 expect(await screen.findByText("Your installed copy is a1b2c3d4; the team's current version is 5f0e12ab. The receipt below is for the team's version.")).toBeVisible();
});
it('preserves a failed eval commit value and notifies clone subscribers',async()=>{
 const value={name:'deploy-check',runDir:'/tmp/run',executionStatus:'complete',commit:{ok:false,error:'push refused'}};
 const f=fakeBridge((args,emit)=>emit({kind:'stdout',line:JSON.stringify({t:'result',verb:args[0],ok:false,exitCode:1,error:'push refused',value})}));
 const backend=createTauriBackend(f.bridge),listener=vi.fn();backend.subscribe(listener);
 expect(await backend.eval({ref:'deploy-check',commit:true}).done).toEqual({ok:false,error:'push refused',value});expect(listener).toHaveBeenCalledWith('clone');
});

it.each([true,false])('takes evalCommitChoice=%s only from the CLI feature',async enabled=>{
 const f=fakeBridge((args,emit)=>{emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,verbs:[],features:{runEvalInApp:enabled}})});emit({kind:'stdout',line:JSON.stringify({t:'result',verb:args[0],ok:true,exitCode:0,value:{}})});});
 expect((await createTauriBackend(f.bridge).capabilities()).evalCommitChoice).toBe(enabled);
});

it('does not label an already committed local receipt as an uncommitted run',async()=>{
 const r=await adapter({...report(),latestState:'none',latest:null,localRuns:[{run_id:'20260909T010000Z',run_dir:'/tmp/run',execution_status:'complete',committed:true,receipt:receipt()}]}).backend.evalReport({ref:'deploy-check'});
 expect(r.value?.receipt).toBeNull();expect(r.value?.localRuns[0]?.committed).toBe(true);
});
