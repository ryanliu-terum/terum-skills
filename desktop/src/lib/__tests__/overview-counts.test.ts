import { describe, expect, it } from 'vitest';
import { evaluatedOverview, unpublishedCount, unpublishedOverview } from '../overview-counts';
import { overviewCopy } from '../overview-copy';
import type { SkillCard } from '../../backend/types';

type Verdict = NonNullable<SkillCard['localEval']>['verdict'];
/** Only the two fields these counters read; the rest of the card is irrelevant to them. */
const card=(verdict:Verdict|null,localMatch:SkillCard['localMatch']='none'):SkillCard=>
 ({localEval:verdict===null?null:{verdict,w:1,l:0,t:0,n:1,lift:0,partial:null,signP:'0.500',runnerHandle:null,version:null},localMatch}) as unknown as SkillCard;

describe('evaluatedOverview',()=>{
 it('reports the zero caption only when nothing is evaluated',()=>{
  expect(evaluatedOverview([])).toEqual({evaluated:'0',meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:overviewCopy.evaluated});
  expect(evaluatedOverview([card(null),card(null)])).toEqual({evaluated:'0',meter:{pass_:0,neutral:0,fail:0,total:2},meter_text:overviewCopy.evaluated});
 });
 it('captions a nonzero count with its own verdicts, never the zero copy (the 2 · "Nothing evaluated yet" bug)',()=>{
  const overview=evaluatedOverview([card('PASS'),card('FAIL'),card(null)]);
  expect(overview).toEqual({evaluated:'2',meter:{pass_:1,neutral:0,fail:1,total:3},meter_text:'1 pass · 0 neutral · 1 fail'});
  expect(overview.meter_text).not.toBe(overviewCopy.evaluated);
 });
 it('counts every skill in the meter total so the unevaluated remainder is its own segment',()=>{
  const {meter}=evaluatedOverview([card('PASS'),card('NEUTRAL'),card(null),card(null)]);
  expect(meter).toEqual({pass_:1,neutral:1,fail:0,total:4});
  expect(meter.total-meter.pass_-meter.neutral-meter.fail).toBe(2);
 });
});

describe('unpublishedCount',()=>{
 it('counts only folders tied to no team skill',()=>{
  expect(unpublishedCount([card(null,'none'),card(null,'identical'),card(null,'differs')])).toBe(1);
  expect(unpublishedCount([])).toBe(0);
 });
 it('reports an unknown rather than a count when any card predates the overlay',()=>{
  expect(unpublishedCount([card(null,'none'),card(null,null)])).toBeNull();
  expect(unpublishedOverview([card(null,'none'),card(null,null)])).toEqual({unpublished:'—',unpublished_note:''});
 });
 it('drops the note at zero and carries it above zero',()=>{
  expect(unpublishedOverview([card(null,'identical')])).toEqual({unpublished:'0',unpublished_note:''});
  expect(unpublishedOverview([card(null,'none')])).toEqual({unpublished:'1',unpublished_note:'never published to the marketplace'});
 });
});
