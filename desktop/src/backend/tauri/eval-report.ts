import { z } from 'zod';
import { roiFractions } from '../score-fractions';
import { comparisonSummary, receiptSummary } from '../receipt-summary';
import type { EvalReportModel, Receipt } from '../types';
// §3.2: the version vocabulary exists once, and the desktop imports the leaf by relative path.
import { recordedVersionLabel as versionText } from '../../../../src/lib/versions.js';

/** A history row's version was a 40-hex tree hash before layout 3, which is why it was sliced to 12;
 *  it now holds a version FOLDER (`v1`), where slicing means nothing and the bare folder is not the
 *  UI form (§3.2). Anything that does not parse — a hash, the `—` sentinel — is passed through. */


const comparison = z.object({ win:z.number(), loss:z.number(), tie:z.number(), net_lift:z.number(), sign_p:z.number() }).passthrough();
const efficiency = z.object({ turns:z.number().nullish(), duration_ms:z.number().nullish(), cost_usd:z.number().nullish() }).passthrough();
const executionStatus = z.enum(['complete','partial','failed']);
const verdict = z.enum(['PASS','NEUTRAL','FAIL']);
/** Eval-engine §5.3 rev 20: the receipt's own per-(case × rep) verdicts and per-arm tally. Both optional — a receipt written before rev 20 has neither, and the report says so instead of deriving them. */
const caseRunArm = z.object({ passed:z.boolean().nullable(), checks:z.array(z.tuple([z.string(),z.boolean()])) }).passthrough();
const caseRow = z.object({ case:z.string(), rep:z.number(), arms:z.record(z.string(),caseRunArm), outcomes:z.record(z.string(),z.enum(['win','loss','tie'])) }).passthrough();
const caseRuns = z.record(z.string(), z.object({ passed:z.number(), total:z.number() }).passthrough());
export const cliReceipt = z.object({
 path:z.string(), version:z.string().nullable(), run_id:z.string(), verdict, execution_status:executionStatus,
 expected_rows:z.number(), scored_rows:z.number(), attribution:z.string(),
 comparisons:z.record(z.string(),comparison), arm_scores:z.record(z.string(),z.number().nullable()),
 per_case:z.array(caseRow).optional(), case_runs:caseRuns.optional(),
 triggers:z.object({tp:z.number(),fn:z.number(),fp:z.number(),tn:z.number(),recall:z.number().nullable(),precision:z.number().nullable()}).passthrough().nullable(),
 efficiency:z.record(z.string(),efficiency),
 provenance:z.object({timestamp:z.string(),runner_handle:z.string(),model:z.string(),judge_model:z.string(),cc_version:z.string(),engine_version:z.string(),engine_commit:z.string(),k:z.number(),cases:z.array(z.string())}).passthrough(),
}).passthrough();
const receipt = cliReceipt;
export const cliEvalReport = z.object({
 versions:z.object({placed:z.string().nullable(),teamCurrent:z.string().nullable(),evaluated:z.string().nullable()}),
 latestState:z.enum(['ok','none','invalid']), latest:receipt.nullable(),
 history:z.array(z.object({version:z.string(),run_id:z.string(),timestamp:z.string(),runner_handle:z.string(),comparison:comparison.nullable(),verdict,execution_status:executionStatus})),
 localRuns:z.array(z.object({run_id:z.string(),run_dir:z.string(),execution_status:z.enum(['complete','partial','failed','unknown']),committed:z.boolean(),receipt:receipt.nullable()})),
}).passthrough();
type CliReceipt = z.infer<typeof receipt>;
type Comparison = z.infer<typeof comparison>;
function wlt(c:Comparison):[number,number,number] { return [c.win,c.loss,c.tie]; }
/** Display precision for a receipt's own fractions: two decimals, the form the arm-score prose and
 *  Table 2 show. Rendering only — the receipt's stored value is never rounded. */
function fixed2(value:number|null|undefined):string { return value==null?'—':value.toFixed(2); }
/** A sign-test p in the form every surface states it (§12), so prose and Figure 2 cannot disagree. */
function fixed3(value:number|null|undefined):string { return value==null?'—':value.toFixed(3); }
/** §2's opening line. With rev-20 fields it states the receipt's case-run tally verbatim (the card's Quality number) and keeps the arm scores as the check share; without them, the arm scores alone. */
function resultsText(r:CliReceipt):string {
 const armScores=Object.entries(r.arm_scores).map(([arm,score])=>`${arm} ${fixed2(score)}`).join(', ');
 const runs=r.case_runs;if(!runs)return `Arm scores: ${armScores}.`;
 const k=r.provenance.k,say=(arm:string):string=>{const t=runs[arm];return t?`${t.passed} of ${t.total}`:'—';};
 return `Candidate passed ${say('candidate')} ${k===1?'cases':`case-runs (${r.provenance.cases.length} cases × ${k} reps)`}, baseline ${say('baseline')}. A ${k===1?'case':'case-run'} passes an arm when every deterministic check passes. Check share by arm: ${armScores}.`;
}
function mapReceipt(r:CliReceipt):Receipt {
 const p=r.provenance,c=r.comparisons['candidate-vs-baseline'],inc=r.comparisons['candidate-vs-incumbent'],t=r.triggers,signP=fixed3(c?.sign_p);
 const eff=(arm:string):string[]=>{const e=r.efficiency[arm];return [String(e?.turns??'—'),e?.duration_ms==null?'—':`${Math.round(e.duration_ms/1000)} s`,e?.cost_usd==null?'—':`$${e.cost_usd.toFixed(2)}`];};
 return {
 when:p.timestamp.slice(0,10),date:p.timestamp.slice(0,10),timestamp:p.timestamp.slice(0,16).replace('T',' ')+' UTC',runner:p.runner_handle,run_id:r.run_id,catalog:0,
 incumbent:inc?{wlt:wlt(inc),version:'—'}:null,sign_p:signP,inc_p:fixed3(inc?.sign_p),
 arm:{candidate:r.arm_scores.candidate??0,incumbent:r.arm_scores.incumbent??null,baseline:r.arm_scores.baseline??0},
 triggers:{tp:t?.tp??0,fn:t?.fn??0,fp:t?.fp??0,tn:t?.tn??0,recall:fixed2(t?.recall),precision:fixed2(t?.precision),misses:[]},
 eff:{candidate:eff('candidate'),incumbent:r.efficiency.incumbent?eff('incumbent'):null,baseline:eff('baseline')},
 attribution:r.attribution,model:p.model,judge:p.judge_model,cc:p.cc_version,k:p.k,engine:p.engine_version,per_case:[],
 // Rev 20: the receipt's own rows and tally, or neither — the report never derives them (AGENTS invariant 6).
 ...(r.per_case&&r.case_runs?{case_rows:r.per_case,case_runs:r.case_runs}:{}),
 abstract:c?`${p.cases.length} cases at k=${p.k}. Candidate vs baseline: ${c.win}W–${c.loss}L–${c.tie}T, net lift ${fixed2(c.net_lift)}, sign p ${signP}. Verdict ${r.verdict}.`:'No baseline comparison in this receipt.',
 results:resultsText(r),
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
 const history:EvalReportModel['history']=report.history.map(h=>({when:h.timestamp.slice(0,10),runner:h.runner_handle,version:versionText(h.version),wlt:h.comparison?wlt(h.comparison):[0,0,0],rows:'',summary:comparisonSummary(h.comparison,h.verdict)}));
 for(const run of report.localRuns.filter(run=>!run.committed)){const c=run.receipt?.comparisons['candidate-vs-baseline'];history.push({when:run.receipt?.provenance.timestamp.slice(0,10)??run.run_id,runner:'local',version:versionText(run.receipt?.version??'—'),wlt:c?wlt(c):[0,0,0],rows:'',summary:receiptSummary(run.receipt),local:true});}
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
 scoreFractions:{routesExpected:t?t.tp+t.fn:null,roi: roiFractions(r?.efficiency.candidate?.cost_usd, r?.efficiency.baseline?.cost_usd)},
 history,versions:report.versions,latestState:report.latestState,invalidReceiptFile:report.latestState==='invalid'?lines.find(line=>line.includes('newest receipt is invalid'))??null:null,localRuns,evalEstimate,evalEstimateText,evalEstimateTip:evalEstimateText};
}
