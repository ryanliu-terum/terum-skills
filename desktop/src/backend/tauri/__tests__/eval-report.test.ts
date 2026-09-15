import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
 expect(r.value.scoreFractions).toEqual({routesExpected:4,roi:[0.8,1]});
 expect(r.value.receipt).not.toHaveProperty('case_rows');expect(r.value.receipt).not.toHaveProperty('case_runs');
 expect(r.value.evalEstimate).toEqual({cases:3,k:3,arms:2,runs:18,minutes:25,dollars:8,model:'sonnet'});
 expect(r.value.evalEstimateText).toMatch(/arm-run pricing from the last receipt\.$/);
});
it('states the receipt numbers at display precision, never a raw float',async()=>{
 // 5/9, 1/9 and 1/3 stringify as 0.5555555555555556, 0.1111111111111111, 0.3333333333333333. The
 // prose reads them the way Figure 1's bars and the per-case table already label them \u2014 two decimals
 // \u2014 and the sign p the way Figure 2 states it. Rendering only: `summary` still carries the number.
 const latest={...receipt(),arm_scores:{candidate:5/9,baseline:1/9,incumbent:null},comparisons:{'candidate-vs-baseline':{win:6,loss:1,tie:2,net_lift:1/3,sign_p:0.125}}};
 const r=await adapter({...report(),latest}).backend.evalReport({ref:'deploy-check'});if(!r.ok)throw new Error(r.error);
 expect(r.value.receipt?.abstract).toBe('3 cases at k=3. Candidate vs baseline: 6W\u20131L\u20132T, net lift 0.33, sign p 0.125. Verdict PASS.');
 expect(r.value.receipt?.results).toBe('Arm scores: candidate 0.56, baseline 0.11, incumbent \u2014.');
 for(const text of [r.value.receipt?.abstract,r.value.receipt?.results,r.value.receipt?.trigger_text,r.value.receipt?.coverage,r.value.receipt?.efficiency_text])expect(text).not.toMatch(/\d\.\d{4,}/);
 expect(r.value.summary?.lift).toBe(33);
});
it('rev 20: maps the receipt\'s per-case rows and tally verbatim, and states them in §2 at k=1 and k>1',async()=>{
 const rows=[{case:'one',rep:0,arms:{candidate:{passed:true,checks:[['file_exists:out.md',true]]},baseline:{passed:false,checks:[['file_exists:out.md',false]]}},outcomes:{'candidate-vs-baseline':'win'}}];
 const latest={...receipt(),per_case:rows,case_runs:{candidate:{passed:1,total:3},baseline:{passed:0,total:3}},provenance:{...receipt().provenance,k:1}};
 const r=await adapter({...report(),latest}).backend.evalReport({ref:'deploy-check'});if(!r.ok)throw new Error(r.error);
 expect(r.value.receipt?.case_rows).toEqual(rows);expect(r.value.receipt?.case_runs).toEqual({candidate:{passed:1,total:3},baseline:{passed:0,total:3}});
 expect(r.value.receipt?.results).toBe('Candidate passed 1 of 3 cases, baseline 0 of 3. A case passes an arm when every deterministic check passes. Check share by arm: candidate 0.81, baseline 0.45.');
 const three=await adapter({...report(),latest:{...latest,provenance:{...latest.provenance,k:3},case_runs:{candidate:{passed:2,total:9},baseline:{passed:0,total:9}}}}).backend.evalReport({ref:'deploy-check'});
 expect(three.value?.receipt?.results).toBe('Candidate passed 2 of 9 case-runs (3 cases × 3 reps), baseline 0 of 9. A case-run passes an arm when every deterministic check passes. Check share by arm: candidate 0.81, baseline 0.45.');
});
it('keeps ROI fractions null when an arm cost is missing',async()=>{
 const latest=receipt();latest.efficiency.candidate.cost_usd=null as unknown as number;
 const r=await adapter({...report(),latest}).backend.evalReport({ref:'deploy-check'});if(!r.ok)throw new Error(r.error);
 expect(r.value.scoreFractions.roi).toBeNull();
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
it('§3.2: a history row carrying a version FOLDER is labelled, not sliced',async()=>{
 // The row above pins the legacy shape (a 40-hex tree hash, sliced to 12). Under layout 3 the same
 // field holds `v12`, where the slice means nothing and the bare folder is not the UI form.
 const history={version:'v12',run_id:'old',timestamp:'2026-09-08T00:00:00Z',runner_handle:'sam',comparison:receipt().comparisons['candidate-vs-baseline'],verdict:'PASS',execution_status:'complete'};
 const r=await adapter({...report(),history:[history]}).backend.evalReport({ref:'deploy-check'});
 expect(r.value?.history[0]).toMatchObject({version:'Version 12'});
});
it('only serves a committed receipt matching the requested raw version',async()=>{
 const {backend}=adapter({...report(),versions:{...report().versions,evaluated:'different'}});
 expect((await backend.receipts({skillId:'deploy-check',version:tree})).value?.run_id).toBe('20260909T010000Z');
 expect((await backend.receipts({skillId:'deploy-check',version:'other'})).value).toBeNull();
 expect((await adapter({...report(),latestState:'none'}).backend.receipts({skillId:'deploy-check',version:tree})).value).toBeNull();
});
it('renders the installed/team version mismatch through the App using CLI inventory frames',async()=>{
 // Layout 3: these fields hold version FOLDERS, not the 40-hex tree hashes this fixture carried
 // before the refactor — so the sentence names versions rather than slicing an identifier (§3.2).
 const value={...report(),versions:{...report().versions,placed:'v1',teamCurrent:'v2'}};
 const f=fakeBridge((args,emit)=>{
  if(args[0]==='eval-report'){emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'eval-report',ok:true,exitCode:0,value})});return;}
  const name=args[0]==='ls'?args.includes('--local')?'ls-local':'ls':args[0]==='validate'?'validate-deploy-check':args[0]!;
  for(const line of readFileSync(resolve('../.planning/codex-runs/m7-S7g/frames',name+'.jsonl'),'utf8').trim().split('\n'))emit({kind:'stdout',line});
 });
 location.hash='#/skill/deploy-check?tab=evals';
 render(createElement(BackendContext,{value:createTauriBackend(f.bridge)},createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement(Tooltip.Provider,null,createElement(App)))));
 expect(await screen.findByText("Your installed copy is Version 1; the team's current version is Version 2. The receipt below is for the team's version.")).toBeVisible();
});

it('does not label an already committed local receipt as an uncommitted run',async()=>{
 const r=await adapter({...report(),latestState:'none',latest:null,localRuns:[{run_id:'20260909T010000Z',run_dir:'/tmp/run',execution_status:'complete',committed:true,receipt:receipt()}]}).backend.evalReport({ref:'deploy-check'});
 expect(r.value?.receipt).toBeNull();expect(r.value?.localRuns[0]?.committed).toBe(true);
});

// EV-20 (amended 2026-09-14, Ryan): the History rail opens a prior run. Every assertion below is
// about ONE receipt at a time — the opened run is rendered from its own receipt and labelled with
// its own version, and no figure is derived across runs (eval-engine §12:503).
function olderRun(){const base=receipt();return {version:'v1',run_id:'20260908T000000Z',timestamp:'2026-09-08T00:00:00Z',runner_handle:'sam',comparison:{win:4,loss:2,tie:3,net_lift:2/9,sign_p:0.34},verdict:'NEUTRAL',execution_status:'complete',
 receipt:{...base,path:'/repo/evals/id/v1/20260908T000000Z.json',version:'v1',run_id:'20260908T000000Z',verdict:'NEUTRAL',comparisons:{'candidate-vs-baseline':{win:4,loss:2,tie:3,net_lift:2/9,sign_p:0.34}},provenance:{...base.provenance,timestamp:'2026-09-08T00:00:00Z',runner_handle:'sam'}}};}
function reportText(){return document.querySelector('.evaluation-report')?.textContent??'';}
function evalsApp(value:unknown,hash='#/skill/deploy-check?tab=evals'){
 const f=fakeBridge((args,emit)=>{
  if(args[0]==='eval-report'){emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'eval-report',ok:true,exitCode:0,value})});return;}
  const name=args[0]==='ls'?args.includes('--local')?'ls-local':'ls':args[0]==='validate'?'validate-deploy-check':args[0]!;
  for(const line of readFileSync(resolve('../.planning/codex-runs/m7-S7g/frames',name+'.jsonl'),'utf8').trim().split('\n'))emit({kind:'stdout',line});
 });
 location.hash=hash;
 render(createElement(BackendContext,{value:createTauriBackend(f.bridge)},createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement(Tooltip.Provider,null,createElement(App)))));
}
it('EV-20: a history row carries its own receipt as its own report, and a row without one carries none',async()=>{
 const older=olderRun();
 const r=await adapter({...report(),history:[older,{...older,run_id:'20260907T000000Z',receipt:null}]}).backend.evalReport({ref:'deploy-check'});
 if(!r.ok)throw new Error(r.error);
 expect(r.value.history[0]).toMatchObject({runId:'20260908T000000Z',when:'2026-09-08',runner:'sam',version:'Version 1'});
 // Its own receipt, not the latest one, and its own numbers — the same shape the latest run renders from.
 expect(r.value.history[0]?.report?.receipt).toMatchObject({run_id:'20260908T000000Z',runner:'sam'});
 expect(r.value.history[0]?.report?.summary).toEqual({w:4,l:2,t:3,n:9,lift:22,verdict:'NEUTRAL',partial:null,signP:'0.340'});
 expect(r.value.history[0]?.report?.numbers).toEqual({holes:0,nRounds:9,triggerTotal:6});
 // A CLI older than the amendment sends no receipt on the row: it stays a listing, never a reconstruction.
 expect(r.value.history[1]?.report).toBeUndefined();
 expect(r.value.history[1]?.summary).toMatchObject({verdict:'NEUTRAL'});
});
it('EV-20: opening a history row renders that run from its own receipt, and names its own version',async()=>{
 evalsApp({...report(),history:[olderRun()]});
 expect(await screen.findByText('run 20260909T010000Z')).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:/sam · Version 1/}));
 expect(await screen.findByText('run 20260908T000000Z')).toBeVisible();
 expect(reportText()).toContain('Evaluation of deploy-check');
 expect(reportText()).toContain('Version 1');
 // One receipt on the surface (§12:503): the latest run is gone from the report, not beside it.
 expect(reportText()).not.toContain('20260909T010000Z');
 expect(screen.getByText(/Opened from History · run 20260908T000000Z by sam/)).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:'Show latest run'}));
 expect(await screen.findByText('run 20260909T010000Z')).toBeVisible();
 expect(screen.queryByText(/Opened from History/)).toBeNull();
});
it('EV-20: ?run= opens the row directly, and an id no row carries falls back to the latest run',async()=>{
 evalsApp({...report(),history:[olderRun()]},'#/skill/deploy-check?tab=evals&run=20260908T000000Z');
 expect(await screen.findByText(/Opened from History · run 20260908T000000Z by sam/)).toBeVisible();
 cleanup();
 evalsApp({...report(),history:[olderRun()]},'#/skill/deploy-check?tab=evals&run=nothing-here');
 expect(await screen.findByText('run 20260909T010000Z')).toBeVisible();
 expect(screen.queryByText(/Opened from History/)).toBeNull();
});
it('EV-20: a version with no receipt of its own still opens an earlier run from History',async()=>{
 evalsApp({...report(),latestState:'none',latest:null,history:[olderRun()]});
 expect(await screen.findByText('No receipt for this version')).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:/sam · Version 1/}));
 expect(await screen.findByText(/this version has no receipt of its own/)).toBeVisible();
 expect(reportText()).toContain('Version 1');
});
