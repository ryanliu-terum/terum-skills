import type { SkillCard } from '../backend/types';
import { overviewCopy } from './overview-copy';

/** The Library overview's Evaluated tile: the big number, the meter and the caption under it are all
 *  read off the SAME receipts, so the tile can never claim "Nothing evaluated yet" over a nonzero
 *  count. One skill contributes one verdict; a skill with no receipt is simply not evaluated, and
 *  shows up as the meter's unevaluated remainder (`total` is every skill, never only the scored
 *  ones — the design's `13 of 15` meter spends its fourth segment on that remainder). */
export function evaluatedOverview(skills:readonly SkillCard[]):{evaluated:string;meter:{pass_:number;neutral:number;fail:number;total:number};meter_text:string} {
 const verdicts=skills.map(skill=>skill.localEval?.verdict??null);
 const pass_=verdicts.filter(v=>v==='PASS').length,neutral=verdicts.filter(v=>v==='NEUTRAL').length,fail=verdicts.filter(v=>v==='FAIL').length;
 const evaluated=pass_+neutral+fail;
 return {evaluated:String(evaluated),meter:{pass_,neutral,fail,total:skills.length},meter_text:evaluated?`${pass_} pass · ${neutral} neutral · ${fail} fail`:overviewCopy.evaluated};
}

/** How many Library folders have never been published to the team marketplace, and how many the CLI
 *  could not place either way. Publish state is the byte-level overlay `localMatch` (types.ts): 'none'
 *  is a folder tied to no team skill at all — never published; 'identical' and 'differs' are both
 *  published skills (unedited, or edited since); null is an UNKNOWN — a CLI too old to report the
 *  overlay, or a folder the CLI could not offer at all (an unparseable one; `notOfferedCard` in the
 *  Tauri adapter builds its card with no overlay key). An unknown is reported as its own figure and
 *  never counted as unpublished: until 2026-09-15 a SINGLE unknown row turned the whole tile into a
 *  dash, and since every machine carries at least one not-offered folder the tile read '—' forever.
 *  Bundled folders are out of the reckoning entirely — the manual setup places can never become a
 *  team skill (BUNDLED_NOTE), so it is neither unpublished nor an unknown, just not publishable.
 *  This is the same predicate `libraryVersionLabel` (components/domain/presentation.ts) uses to label
 *  a card 'Unpublished', including its "say nothing rather than guess" rule for null — the tile and
 *  the cards it counts must not disagree about what unpublished means.
 *  NOTE: this counts NEVER-PUBLISHED only. Locally-modified-since-publish ('differs') is a distinct
 *  state and is deliberately excluded — see the PR description. */
export function unpublishedCount(skills:readonly SkillCard[]):{count:number;unknown:number;total:number} {
 const publishable=skills.filter(skill=>!skill.flags.includes('bundled'));
 return {count:publishable.filter(skill=>skill.localMatch==='none').length,unknown:publishable.filter(skill=>skill.localMatch===null).length,total:publishable.length};
}

/** The Unpublished tile's number and the caption under it, from one count — so the tile can no more
 *  claim "Everything here is published" over a nonzero number than the Evaluated tile could claim
 *  "Nothing evaluated yet" over one. The dash is kept for the one case that earns it: NOTHING is
 *  known, so any number would be fabricated. With even one folder placed, the number is what is known
 *  and the caption names the remaining unknowns rather than hiding them behind a dash. */
export function unpublishedOverview(skills:readonly SkillCard[]):{unpublished:string;unpublished_note:string} {
 const {count,unknown,total}=unpublishedCount(skills);
 if(unknown>0&&unknown===total)return {unpublished:'—',unpublished_note:''};
 const unknownNote=unknown===0?'':`${unknown} folder${unknown===1?'':'s'} with an unknown publish state`;
 if(count===0)return {unpublished:'0',unpublished_note:unknownNote};
 return {unpublished:String(count),unpublished_note:'never published to the marketplace'+(unknownNote?' · '+unknownNote:'')};
}
