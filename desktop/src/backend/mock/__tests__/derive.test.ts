import { expect,it } from 'vitest';
import { design as d } from '../data';
import * as f from '../derive';
const names=(rows:{name:string}[])=>rows.map(s=>s.name),handles=(rows:{handle:string}[])=>rows.map(s=>s.handle);
const details={'deploy-check':d.DETAIL,'migration-guard':d.DETAIL_PARTIAL,'onboarding-tour':d.DETAIL_NO_RECEIPT,'deploy-check-not-installed':d.DETAIL_NOT_INSTALLED};
const off=d.INBOX.find(it=>it.sessions!==undefined)!;
const author=d.INBOX.find(it=>it.kind==='author')!;
const docs=d.PROJECTS.find(p=>p.key==='docs')!;
const receipt=(s:Parameters<typeof f.receipt_of>[0])=>{const r=f.receipt_of(s);return r?{...r,sign_p:f.sign_p(r.w,r.l)}:null;};
const actual={
 receipts:{...Object.fromEntries([...d.SKILLS,...d.CATALOG,...d.MARKET_EXTRA].map(s=>[s.name,receipt(s)])),...Object.fromEntries(d.INBOX.map(s=>[s.title,receipt(s)]))},
 installs:Object.fromEntries(d.CATALOG.map(s=>[s.name,f.installs_of(s)])),
 tokens:Object.fromEntries(d.CATALOG.map(s=>[s.name,f.tokens_of(s)])),
 topRated:names(f.top_rated(d.CATALOG.length)),verdictCounts:f.verdict_counts(),peopleByAdoption:handles(f.people_by_adoption()),
 adoption:Object.fromEntries(d.ROSTER.map(q=>[q.handle,f.adoption_of(q.handle)])),rosterByAdoption:handles(f.roster_by_adoption()),projectsByMembers:names(f.projects_by_members()),
 projectMembers:Object.fromEntries(d.PROJECTS.map(q=>[q.name,handles(f.project_members(q))])),skillsIn:Object.fromEntries(d.PROJECTS.map(q=>[q.name,names(f.skills_in(q))])),
 personBuckets:Object.fromEntries(d.PEOPLE.map(q=>[q.handle,f.person_buckets(q.handle).map(([bucket,rows])=>[bucket,names(rows)])])),categorySkills:Object.fromEntries(d.CATEGORIES.map(([key])=>[key,names(f.category_skills(key))])),
 filterCount:f.filter_count(),personPlaceNote:Object.fromEntries(d.PEOPLE.map(q=>[q.handle,f.person_place_note(q)])),personOnDisk:Object.fromEntries(d.PEOPLE.map(q=>[q.handle,f.person_on_disk(q.handle)])),
 digest:f.digest_of(d.DETAIL,9),digestSentence:f.digest_sentence({name:author.name,digest:author.digest!}),evalEstimate:f.eval_estimate({receipt:d.DETAIL.receipt!}),evalEstimateText:f.eval_estimate_text({receipt:d.DETAIL.receipt!}),evalEstimateTip:f.eval_estimate_tip({receipt:d.DETAIL.receipt!}),
 evalCommand:Object.fromEntries(Object.entries(details).map(([ref,s])=>[ref,f.eval_command(s)])),shareCommand:Object.fromEntries(Object.entries(details).map(([ref,s])=>[ref,f.share_command(s)])),
 incumbentLift:{...Object.fromEntries([...d.SKILLS,...Object.values(details)].filter(s=>f.incumbent_lift(s)).map(s=>[s.name,f.incumbent_lift(s)])),...Object.fromEntries(d.INBOX.filter(s=>f.incumbent_lift(s)).map(s=>[s.title,f.incumbent_lift(s)]))},
 reportNumbers:{...Object.fromEntries(Object.entries(details).map(([ref,s])=>[ref,f.report_numbers(s)])),[off.title]:f.report_numbers(off)},bulkInstall:{docs:f.bulk_install(docs)},categoryRemaining:Object.fromEntries(d.CATEGORIES.map(([key,,n])=>[key,f.category_remaining(key,n)])),libraryTitles:Object.fromEntries(['Global','Terum','SSM','MRF'].map(scope=>[scope,f.library_title(scope)])),
};
for(const key of Object.keys(d.DERIVED) as (keyof typeof actual)[])it(`matches Python DERIVED.${key} for every entry`,()=>expect(actual[key]).toEqual(d.DERIVED[key]));
it.each([[12.5,12],[13.5,14],[-12.5,-12],[-13.5,-14]])('rounds %s half to even', (n,expected)=>expect(f.round_half_even(n)).toBe(expected));
it.each([[11,3,'0.057'],[8,5,'0.581'],[5,0,'0.063'],[0,0,'1.000']])('sign_p(%s, %s) rounds decimal ties up',(w,l,expected)=>expect(f.sign_p(w,l)).toBe(expected));
it('normalizes and reconstructs full and partial per-case strips',()=>{for(const s of [d.DETAIL,d.DETAIL_PARTIAL]){const rc=s.receipt!;expect(f.rows_from_per_case(rc)).toBe(s.history[0]?.rows);expect(f.per_case_rows(rc)).toHaveLength(s.cases);expect(f.rows_from_per_case(rc)).toHaveLength(f.expected_rows(s));}expect(f.strip_cell(d.DETAIL.receipt!,0)).toEqual(['stale-env-vars',1,'win']);});
it('rejects invalid arithmetic inputs and indices',()=>{expect(()=>f.sign_p(-1,2)).toThrow(RangeError);expect(()=>f.receipt_of({wlt:[0,0,0]})).toThrow(RangeError);expect(()=>f.receipt_of({wlt:[1,0,0],partial:[2,3]})).toThrow(RangeError);expect(()=>f.strip_cell(d.DETAIL.receipt!,-1)).toThrow(RangeError);expect(()=>f.round_half_even(Infinity)).toThrow(RangeError);});
it('ports relative date and text helpers',()=>{expect(f.ago(0)).toBe('today');expect(f.ago(1)).toBe('1 day ago');expect(f.ago(3)).toBe('3 days ago');expect(f.short_ago('just now')).toBe('now');expect(f.short_ago('40 minutes ago')).toBe('40m');expect(f.iso(8)).toBe('2026-08-29');expect(f.last_seen_days('yesterday')).toBe(1);expect(f.last_seen_days('10 days ago')).toBe(10);expect(f.last_seen_days('unknown')).toBeNull();expect(f.index_of('share')).toBe(2);});
it('uses receipt cost maxima and arm scores for score bars',()=>{expect(f.score_fractions(d.DETAIL.receipt)).toEqual({roi:[.38/.51,1],quality:[.82,.61]});expect(f.score_fractions(null)).toEqual({roi:null,quality:null});});
it('rejects malformed numeric fixture strings instead of silently truncating',()=>{expect(()=>f.installs_of({installs:'12x installs'})).toThrow('Invalid install count');expect(()=>f.tokens_of({size:'3xk tokens'})).toThrow('Invalid token size');expect(()=>f.index_of('unknown')).toThrow('No inbox item');});
