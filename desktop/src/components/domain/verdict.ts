import type { ReceiptSummary, TokenKey } from '../../backend/types';
export function verdictToken(summary:ReceiptSummary|null,{muted=false}:{muted?:boolean}={}):{fg:TokenKey;bg:TokenKey|'tint-good'|'tint-bad'}{
 if(!summary||summary.partial||muted)return {fg:'text3',bg:'bg3'};
 return summary.verdict==='PASS'?{fg:'good',bg:'tint-good'}:summary.verdict==='FAIL'?{fg:'bad',bg:'tint-bad'}:{fg:'text2',bg:'bg4'};
}
export function liftLabel(summary:ReceiptSummary|null):string{return summary?`${summary.lift>0?'+':summary.lift<0?'−':'±'}${Math.abs(summary.lift)}%`:'—';}
import type { CardProvenance } from '../../backend/types';
/** The provenance every displayed receipt number is read against, in the receipt's own terms. */
export function provenanceLine(p:CardProvenance):string{return `${p.model} · k=${p.k} · agent CLI ${p.ccVersion} · run by ${p.runner} · ${p.when}`;}
