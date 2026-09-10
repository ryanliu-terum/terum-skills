import { z } from 'zod';
import { roiFractions } from '../score-fractions';
import type { EvalReportModel, Receipt, ReceiptSummary } from '../types';

const comparison = z.object({ win:z.number(), loss:z.number(), tie:z.number(), net_lift:z.number(), sign_p:z.number() }).passthrough();
const efficiency = z.object({ turns:z.number().nullish(), duration_ms:z.number().nullish(), cost_usd:z.number().nullish() }).passthrough();
const executionStatus = z.enum(['complete','partial','failed']);
const verdict = z.enum(['PASS','NEUTRAL','FAIL']);
const receipt = z.object({
 path:z.string(), version:z.string(), run_id:z.string(), verdict, execution_status:executionStatus,
 expected_rows:z.number(), scored_rows:z.number(), attribution:z.string(),
 comparisons:z.record(z.string(),comparison), arm_scores:z.record(z.string(),z.number().nullable()),
 triggers:z.object({tp:z.number(),fn:z.number(),fp:z.number(),tn:z.number(),recall:z.number().nullable(),precision:z.number().nullable()}).passthrough().nullable(),
 efficiency:z.record(z.string(),efficiency),
 provenance:z.object({timestamp:z.string(),runner_handle:z.string(),model:z.string(),judge_model:z.string(),cc_version:z.string(),engine_version:z.string(),engine_commit:z.string(),k:z.number(),cases:z.array(z.string())}).passthrough(),
}).passthrough();
export const cliEvalReport = z.object({
 versions:z.object({placed:z.string().nullable(),teamCurrent:z.string().nullable(),evaluated:z.string().nullable()}),
 latestState:z.enum(['ok','none','invalid']), latest:receipt.nullable(),
 history:z.array(z.object({version:z.string(),run_id:z.string(),timestamp:z.string(),runner_handle:z.string(),comparison:comparison.nullable(),verdict,execution_status:executionStatus})),
 localRuns:z.array(z.object({run_id:z.string(),run_dir:z.string(),execution_status:z.enum(['complete','partial','failed','unknown']),committed:z.boolean(),receipt:receipt.nullable()})),
}).passthrough();
type CliReceipt = z.infer<typeof receipt>;
type Comparison = z.infer<typeof comparison>;
function wlt(c:Comparison):[number,number,number] { return [c.win,c.loss,c.tie]; }
function summary(c:Comparison|null|undefined,v:ReceiptSummary['verdict'],partial:ReceiptSummary['partial']=null):ReceiptSummary|null {
 return c ? {w:c.win,l:c.loss,t:c.tie,n:c.win+c.loss+c.tie,lift:Math.round(c.net_lift*100),verdict:v,partial,signP:c.sign_p.toFixed(3)} : null;
}
function receiptSummary(r:CliReceipt|null):ReceiptSummary|null {
 return r?summary(r.comparisons['candidate-vs-baseline'],r.verdict,r.execution_status==='partial'?[r.scored_rows,r.expected_rows]:null):null;
}
function mapReceipt(r:CliReceipt):Receipt {
 const p=r.provenance,c=r.comparisons['candidate-vs-baseline'],inc=r.comparisons['candidate-vs-incumbent'],t=r.triggers;
 const eff=(arm:string):string[]=>{const e=r.efficiency[arm];return [String(e?.turns??'—'),e?.duration_ms==null?'—':`${Math.round(e.duration_ms/1000)} s`,e?.cost_usd==null?'—':`$${e.cost_usd.toFixed(2)}`];};
 return {
 when:p.timestamp.slice(0,10),date:p.timestamp.slice(0,10),timestamp:p.timestamp.slice(0,16).replace('T',' ')+' UTC',runner:p.runner_handle,run_id:r.run_id,catalog:0,
 incumbent:inc?{wlt:wlt(inc),version:'—'}:null,sign_p:c?.sign_p.toFixed(3)??'—',inc_p:inc?.sign_p.toFixed(3)??'—',
 arm:{candidate:r.arm_scores.candidate??0,incumbent:r.arm_scores.incumbent??null,baseline:r.arm_scores.baseline??0},
 triggers:{tp:t?.tp??0,fn:t?.fn??0,fp:t?.fp??0,tn:t?.tn??0,recall:t?.recall?.toFixed(2)??'—',precision:t?.precision?.toFixed(2)??'—',misses:[]},
 eff:{candidate:eff('candidate'),incumbent:r.efficiency.incumbent?eff('incumbent'):null,baseline:eff('baseline')},
 attribution:r.attribution,model:p.model,judge:p.judge_model,cc:p.cc_version,k:p.k,engine:p.engine_version,per_case:[],
 abstract:c?`${p.cases.length} cases at k=${p.k}. Candidate vs baseline: ${c.win}W–${c.loss}L–${c.tie}T, net lift ${c.net_lift}, sign p ${c.sign_p}. Verdict ${r.verdict}.`:'No baseline comparison in this receipt.',
 results:`Arm scores: ${Object.entries(r.arm_scores).map(([arm,score])=>`${arm} ${score??'—'}`).join(', ')}.`,
 trigger_text:t?`Trigger counts: ${t.tp} true positives, ${t.fn} false negatives, ${t.fp} false positives, ${t.tn} true negatives.`:'No trigger evaluation in this receipt.',
 efficiency_text:'Per-task means by arm are in Table 2.',
 coverage:`${r.scored_rows} of ${r.expected_rows} rounds scored; execution ${r.execution_status}. Run ${r.run_id} by ${p.runner_handle}, engine ${p.engine_version} (${p.engine_commit}), agent CLI ${p.cc_version}.`,
 };
}
/** Format a single receipt's stated statistics; never reconstruct or combine runs. */
export function mapEvalReport(report:z.infer<typeof cliEvalReport>,lines:readonly string[]=[]):EvalReportModel {
 const r=report.latestState==='ok'?report.latest:report.latestState==='none'?report.localRuns.find(run=>!run.committed&&run.receipt!==null)?.receipt??null:null;
 const s=receiptSummary(r),inc=r?.comparisons['candidate-vs-incumbent'],t=r?.triggers;
 const holes=s?.partial?r!.expected_rows-r!.scored_rows:0;
 const localRuns=report.localRuns.map(run=>({runId:run.run_id,runDir:run.run_dir,executionStatus:run.execution_status,committed:run.committed,receipt:run.receipt?mapReceipt(run.receipt):null,summary:receiptSummary(run.receipt)}));
 const history:EvalReportModel['history']=report.history.map(h=>({when:h.timestamp.slice(0,10),runner:h.runner_handle,version:h.version.slice(0,12),wlt:h.comparison?wlt(h.comparison):[0,0,0],rows:'',summary:summary(h.comparison,h.verdict)}));
 for(const run of report.localRuns.filter(run=>!run.committed)){const c=run.receipt?.comparisons['candidate-vs-baseline'];history.push({when:run.receipt?.provenance.timestamp.slice(0,10)??run.run_id,runner:'local',version:(run.receipt?.version??'—').slice(0,12),wlt:c?wlt(c):[0,0,0],rows:'',summary:receiptSummary(run.receipt),local:true});}
 let evalEstimate:EvalReportModel['evalEstimate']=null,evalEstimateText='';
 const latest=report.latest;
 if(report.latestState==='ok'&&latest?.provenance.model==='sonnet'&&Object.values(latest.efficiency).every(e=>e.cost_usd!=null&&e.duration_ms!=null)){
  const p=latest.provenance,arms=Object.values(latest.efficiency),perArm=p.cases.length*p.k;
  const dollars=Math.round(arms.reduce((n,e)=>n+e.cost_usd!*perArm,0)),minutes=5*Math.round(arms.reduce((n,e)=>n+e.duration_ms!/1000*perArm,0)/60/5);
  evalEstimate={cases:p.cases.length,k:p.k,arms:arms.length,runs:perArm*arms.length,minutes,dollars,model:p.model};
  evalEstimateText=`${p.cases.length} cases × k=${p.k} reps × ${arms.length} arms, ${perArm*arms.length} agent runs on ${p.model} from this machine: roughly ${minutes} minutes and about $${dollars} — arm-run pricing from the last receipt.`;
 }
 return {receipt:r?mapReceipt(r):null,summary:s,wlt:s?[s.w,s.l,s.t]:null,incumbentLift:inc?[Math.round(inc.net_lift*100),inc.sign_p.toFixed(3)]:null,
 reportNumbers:s?{holes,nRounds:s.n+holes,triggerTotal:t?t.fp+t.tn:0}:null,
 scoreFractions:{routesExpected:t?t.tp+t.fn:null,roi: roiFractions(r?.efficiency.candidate?.cost_usd, r?.efficiency.baseline?.cost_usd),quality:r?.arm_scores.candidate!=null&&r.arm_scores.baseline!=null?[r.arm_scores.candidate,r.arm_scores.baseline]:null},
 history,versions:report.versions,latestState:report.latestState,invalidReceiptFile:report.latestState==='invalid'?lines.find(line=>line.includes('newest receipt is invalid'))??null:null,localRuns,evalEstimate,evalEstimateText,evalEstimateTip:evalEstimateText};
}
