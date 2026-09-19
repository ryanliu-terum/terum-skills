import type { Receipt, ReceiptSummary, SkillDetail } from '../../../backend/types';
import { decodeText } from '../../../lib/fixture-text';

export type ShareCardFormat='light'|'dark'|'horizontal'|'horizontal-dark';
export interface PassCount { passed:number; total:number }
export interface ShareMetric { label:string; candidate:number|null; baseline:number|null; unit:'cost'|'time' }
export interface ShareCardModel {
 name:string; reference:string; description:string; project:string; category:string; author:string; initials:string;
 summary:ReceiptSummary|null; status:string|null; candidate:PassCount|null; baseline:PassCount|null;
 metrics:ShareMetric[];
}
function count(receipt:Receipt|null,arm:string):PassCount|null {
 const value=receipt?.case_runs?.[arm];
 if(!value)return null;
 if(!Number.isSafeInteger(value.passed)||!Number.isSafeInteger(value.total)||value.total<0||value.passed<0||value.passed>value.total)throw new Error('Invalid recorded pass counts.');
 return value.total===0?null:value;
}
export function metricNumber(raw:string|undefined,unit:'cost'|'time'):number|null {
 if(!raw||raw==='—')return null;
 const match=raw.trim().match(unit==='cost'?/^\$?(\d+(?:\.\d+)?)$/:/^(\d+(?:\.\d+)?)\s*s?$/);
 if(!match)return null;
 const value=Number(match[1]);
 return Number.isFinite(value)&&value>=0?value:null;
}
export function shareCardModel(skill:SkillDetail):ShareCardModel {
 if(skill.evalReportError)throw new Error(skill.evalReportError);
 const receipt=skill.receipt,summary=receipt?skill.summary:null;
 if(summary&&(!Number.isFinite(summary.lift)||[summary.w,summary.l,summary.t,summary.n].some(n=>!Number.isSafeInteger(n)||n<0)||summary.n!==summary.w+summary.l+summary.t))throw new Error('Invalid evaluation summary.');
 const status=summary?.partial?'Partial evaluation':!receipt?(skill.latestState==='invalid'?'Evaluation unavailable':'Not evaluated'):skill.evalStale||skill.localEvalStale?`Evaluated ${skill.versions?.evaluated??'an earlier version'}`:null;
 return {
  name:decodeText(skill.name),reference:decodeText(skill.skillRef.startsWith('local:')?[skill.owningRoot?.label??skill.project,skill.name].filter(Boolean).join('/'):skill.skillRef),description:decodeText(skill.desc),project:decodeText(skill.project),category:decodeText(skill.category),
  author:[decodeText(skill.author.name),skill.author.handle?'@'+decodeText(skill.author.handle):''].filter(Boolean).join(' · '),initials:skill.author.initials,
  summary,status,candidate:count(receipt,'candidate'),baseline:count(receipt,'baseline'),
  metrics:([{label:'Cost / run',index:2,unit:'cost'},{label:'Time / run',index:1,unit:'time'}] as const).map(({label,index,unit})=>({label,unit,candidate:metricNumber(receipt?.eff.candidate[index],unit),baseline:metricNumber(receipt?.eff.baseline[index],unit)})),
 };
}
export function shareFilename(name:string,format:ShareCardFormat='light'):string {
 const suffix='-benchmark'+(format==='light'?'':'-'+format);
 const stem=name.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,Math.min(80,100-suffix.length))||'skill';
 return stem+suffix+'.png';
}
export function chartMaximum(a:number|null,b:number|null,unit:'cost'|'time'):number {
 const step=unit==='cost'?0.1:10;
 return (Math.floor(Math.max(a??0,b??0)/step)+1)*step;
}
