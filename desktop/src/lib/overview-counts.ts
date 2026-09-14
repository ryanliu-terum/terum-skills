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

/** How many Library folders have never been published to the team marketplace. Publish state is the
 *  byte-level overlay `localMatch` (types.ts): 'none' is a folder tied to no team skill at all —
 *  never published; 'identical' and 'differs' are both published skills (unedited, or edited since);
 *  null is a CLI too old to report the overlay, which is an unknown the tile must report as a dash
 *  rather than fabricate a count from (chrome-library.test.ts's "never fabricated counters" rule).
 *  This is the same predicate `libraryVersionLabel` (components/domain/presentation.ts) uses to label
 *  a card 'Unpublished', including its "say nothing rather than guess" rule for null — the tile and
 *  the cards it counts must not disagree about what unpublished means.
 *  NOTE: this counts NEVER-PUBLISHED only. Locally-modified-since-publish ('differs') is a distinct
 *  state and is deliberately excluded — see the PR description. */
export function unpublishedCount(skills:readonly SkillCard[]):number|null {
 if(skills.some(skill=>skill.localMatch===null))return null;
 return skills.filter(skill=>skill.localMatch==='none').length;
}

/** The Unpublished tile's number and the caption under it, from one count — so the tile can no more
 *  claim "Everything here is published" over a nonzero number than the Evaluated tile could claim
 *  "Nothing evaluated yet" over one. A dash carries no caption: an unknown explains nothing. */
export function unpublishedOverview(skills:readonly SkillCard[]):{unpublished:string;unpublished_note:string} {
 const count=unpublishedCount(skills);
 return count===null?{unpublished:'—',unpublished_note:''}:{unpublished:String(count),unpublished_note:count?'never published to the marketplace':''};
}
