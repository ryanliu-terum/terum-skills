import type { CloneState, Receipt, ReceiptSummary } from '../types';
import { design as d } from './fixture';
type Sample = { wlt?: readonly number[] | null | undefined; cases?: number | undefined; partial?: readonly number[] | null | undefined };
type Card = (typeof d.CATALOG)[number];
type Person = (typeof d.ROSTER)[number];
type Project = (typeof d.PROJECTS)[number];
const authors: Record<string, string> = d.AUTHOR_OF;
const lists: Record<string, string[]> = d.LIST_OF;
export function round_half_even(value: number): number {
 if (!Number.isFinite(value)) throw new RangeError('Cannot round a non-finite number.');
 const floor = Math.floor(value), fraction = value - floor;
 return fraction === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value);
}
export function expected_rows(s: Sample): number { return d.K * (s.cases ?? d.DEFAULT_CASES); }
export function receipt_of(s: Sample): Omit<ReceiptSummary, 'signP'> | null {
 if (!s.wlt) return null;
 const [w, l, t] = s.wlt;
 if (w === undefined || l === undefined || t === undefined || s.wlt.length !== 3 || s.wlt.some(n => !Number.isInteger(n) || n < 0) || w + l + t === 0) throw new RangeError('W/L/T must contain three nonnegative integers with a positive total.');
 const n = w + l + t;
 const partial = s.partial;
 if (partial && (partial.length !== 2 || partial[0] !== n || partial[1] === undefined || partial[1] < n)) throw new RangeError('Invalid partial row counts.');
 return {w,l,t,n,lift:round_half_even((w-l)/n*100),verdict:3*(w-l)>=n?'PASS':3*(l-w)>=n?'FAIL':'NEUTRAL',partial:partial?[n,partial[1]!]:null};
}
export function sign_p(w: number, l: number): string {
 if (![w,l].every(n=>Number.isSafeInteger(n)&&n>=0)) throw new RangeError('Sign test requires nonnegative integer counts.');
 const n=w+l;
 if (n>10000) throw new RangeError('Sign test count exceeds supported range.');
 let combination=1n,sum=1n;
 for(let k=1;k<=Math.min(w,l);k++){combination=combination*BigInt(n-k+1)/BigInt(k);sum+=combination;}
 const denominator=2n**BigInt(n),numerator=sum*2n>denominator?denominator:sum*2n;
 const thousandths=(numerator*2000n+denominator)/(2n*denominator);
 return `${thousandths/1000n}.${String(thousandths%1000n).padStart(3,'0')}`;
}
export function summary_of(s:Sample):ReceiptSummary|null {const r=receipt_of(s);return r?{...r,signP:sign_p(r.w,r.l)}:null;}
export function lift_number(lift:number):string{return `${lift>0?'+':lift<0?'−':'±'}${Math.abs(lift)}%`;}
export function per_case_rows(rc:Pick<Receipt,'per_case'>):[string,number,number,[number,number,number],number][]{return rc.per_case.map(c=>[c[0],c[1],c[2],c[3],c[4]??0]);}
export function rows_from_per_case(rc:Pick<Receipt,'per_case'>):string{return per_case_rows(rc).map(([, , ,[w,l,t],holes])=>'W'.repeat(w)+'L'.repeat(l)+'T'.repeat(t)+'-'.repeat(holes)).join('');}
export function strip_cell(rc:Pick<Receipt,'per_case'|'k'>,i:number):[string,number,string]{const row=per_case_rows(rc)[Math.floor(i/rc.k)],outcome=rows_from_per_case(rc)[i];const words:Record<string,string>={W:'win',L:'loss',T:'tie','-':'unscored'};if(!Number.isInteger(i)||i<0||!row||!outcome)throw new RangeError('Row strip index out of range.');return [row[0],i%rc.k+1,words[outcome]!];}
export function installs_of(s:{installs:string}):number{const word=s.installs.trim().split(/\s+/)[0]??'';if(!/^[+-]?\d+$/.test(word))throw new TypeError('Invalid install count: '+s.installs);const n=Number(word);if(!Number.isSafeInteger(n))throw new RangeError('Install count exceeds the safe integer range.');return n;}
export function tokens_of(s:{size:string}):number{const word=s.size.split('k')[0]?.trim()??'';const n=Number(word);if(!word||!Number.isFinite(n))throw new TypeError('Invalid token size: '+s.size);return n;}
export function top_rated(n=3):Card[]{return [...d.CATALOG].sort((a,b)=>installs_of(b)-installs_of(a)).slice(0,n);}
export function skills_by(handle:string):Card[]{return d.CATALOG.filter(s=>authors[s.name]===handle);}
export function adoption_of(handle:string):number{return skills_by(handle).reduce((sum,s)=>sum+installs_of(s),0);}
export function people_by_adoption():Person[]{return [...d.PEOPLE].sort((a,b)=>adoption_of(b.handle)-adoption_of(a.handle));}
export function roster_by_adoption():Person[]{return [...d.ROSTER].sort((a,b)=>adoption_of(b.handle)-adoption_of(a.handle));}
export function projects_by_members():Project[]{return [...d.PROJECTS].sort((a,b)=>b.members-a.members);}
export function project_members(q:Pick<Project,'name'>):Person[]{return roster_by_adoption().filter(p=>d.MEMBER[p.handle]?.[1].includes(q.name));}
export function last_seen_days(text:string):number|null{return text==='today'?0:text==='yesterday'?1:/^\d+ days ago$/.test(text)?Number.parseInt(text,10):null;}
export function skills_in(q:Pick<Project,'name'>):Card[]{return top_rated(d.CATALOG.length).filter(s=>lists[s.name]?.includes(q.name));}
export function person_buckets(handle:string):[string,Card[]][]{return ['Global',...d.PROJECTS.map(q=>q.name)].map((name):[string,Card[]]=>[name,skills_by(handle).filter(s=>lists[s.name]?.[0]===name).sort((a,b)=>installs_of(b)-installs_of(a))]).filter(([,rows])=>rows.length>0);}
export function filter_matches(s:Card,f=d.FILTER_DEFAULT):boolean{const r=receipt_of(s);return r?f.verdicts.includes(r.verdict)&&r.lift>=f.lift_min&&tokens_of(s)<=f.tokens_max&&installs_of(s)>=f.installs_min:f.verdicts.includes('Not evaluated');}
export function filter_count(f=d.FILTER_DEFAULT):number{return d.CATALOG.filter(s=>filter_matches(s,f)).length;}
export function category_skills(key:string):Card[]{return top_rated(d.CATALOG.length).filter(s=>s.category===key);}
export function person_place_note(q:Pick<Person,'handle'>):string{const mine=skills_by(q.handle),missing=mine.filter(s=>s.installed===false),here=missing.filter(s=>lists[s.name]?.[0]==='Global'||d.PROJECTS.some(p=>p.name===lists[s.name]?.[0]&&p.path)),away=missing.filter(s=>!here.includes(s)),repos=[...new Set(away.map(s=>lists[s.name]?.[0]))].sort();if(!away.length)return missing.length===mine.length?`Install places all ${mine.length} on this machine`:`Install places the other ${missing.length} on this machine`;const where=repos.length===1?repos[0]:'their repos';return !here.length&&missing.length===mine.length?`Placed when you sync in ${where}`:`${here.length} place now · ${away.length} when you sync in ${where}`;}
export function publish_line(q:Pick<Person,'last_publish'>):string{if(q.last_publish==='—')return 'Nothing shared yet';const [when,...name]=q.last_publish.split(' · ');return `Published ${name.join(' · ')} · ${when}`;}
export function teams_line(handle:string):string{const teams=d.MEMBER[handle]?.[1]??[];return teams.length?'On '+(teams.length===1?teams[0]:teams.slice(0,-1).join(', ')+' and '+teams.at(-1)):'On no project yet';}
export function plural(n:number,word:string):string{return `${n} ${word}${n===1?'':'s'}`;}
export function ago(days:number):string{return days===0?'today':plural(days,'day')+' ago';}
export function short_ago(when:string):string{if(when==='today'||when==='just now')return 'now';const [n,unit]=when.split(' ');return `${n}${unit?.[0]??''}`;}
export function iso(days:number):string{const date=new Date(d.generatedFrom.today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-days);return date.toISOString().slice(0,10);}
export function digest_of(s:{name:string;activity:string[][]},days:number){const installs:string[]=[],evals:string[]=[],favs:string[]=[],events:[string,string,number][]=[];for(const [ini,text,when] of s.activity){if(!ini||!text||!when)continue;const day=Number.parseInt(when,10)||0;if(day<days||day>days+30)continue;const who=[...text.matchAll(/<b>(\w+)<\/b>/g)].map(m=>m[1]!);if(text.includes(' installed')){installs.push(...who);events.push([ini,text.replace(' installed to ',' installed it to '),day]);}else if(text.includes(' ran an eval')){evals.push(...who);events.push([ini,text,day]);}else if(text.includes(' favorited')){favs.push(...who);events.push([ini,text.replace(' favorited',' favorited it'),day]);}}return {installs,evals,favs,events,title:`${s.name} · ${plural(installs.length,'install')}, ${plural(evals.length,'eval')}, ${plural(favs.length,'favorite')}`,fact:[installs.length?installs.join(', ')+' installed':'',evals.length?evals.join(', ')+(evals.length===1?' ran an eval':' ran evals'):'',favs.length?favs.join(', ')+' favorited':''].filter(Boolean).join(' · ')};}
export function digest_sentence(it:{name:string;digest:{installs:string[];evals:string[];favs:string[]}}):string{const {installs,evals,favs}=it.digest;const words:Record<string,string>=d.WORDS;const word=(n:number)=>words[n]??String(n);const first=word(installs.length);const parts=[`${first[0]!.toUpperCase()+first.slice(1)} teammate${installs.length===1?'':'s'} installed ${it.name}`,evals.length?`${word(evals.length)} ran an eval on it`:'',favs.length?`${word(favs.length)} favorited it`:''].filter(Boolean);return (parts.length>1?parts.slice(0,-1).join(', ')+' and '+parts.at(-1):parts[0])+'.';}
export function cli(command:string):string{return 'npx -y terum-skills@latest '+command;}
export function skill_ref(s:{repo?:string|undefined;name:string}):string{return `${s.repo||d.TEAM_REPO}/${s.name}`;}
export function share_command(s:{repo?:string;project:string;name:string;version:string}):string{return cli(`install ${skill_ref(s)}@${s.version}`);}
export function eval_command(s:{name:string}):string{return cli(`eval ${s.name} --k ${d.K} --commit`);}
export function eval_estimate(s:{receipt:Receipt}){const rc=s.receipt,cases=per_case_rows(rc).length,arms=[rc.eff.candidate,rc.eff.incumbent,rc.eff.baseline].filter((a):a is string[]=>a!==null),perArm=cases*rc.k,seconds=arms.reduce((sum,a)=>sum+Number.parseFloat(a[1]!),0)*perArm,dollars=arms.reduce((sum,a)=>sum+Number.parseFloat(a[2]!.replace('$','')),0)*perArm;return {cases,k:rc.k,arms:arms.length,runs:perArm*arms.length,minutes:5*round_half_even(seconds/60/5),dollars:round_half_even(dollars),model:rc.model};}
export function eval_estimate_text(s:{receipt:Receipt}):string{const e=eval_estimate(s);return `${e.cases} cases × k=${e.k} reps × ${e.arms} arms, ${e.runs} agent runs on ${e.model} from this machine: roughly ${e.minutes} minutes and about $${e.dollars} of API spend.`;}
export function eval_estimate_tip(s:{receipt:Receipt}):string{const e=eval_estimate(s);return `About ${e.runs} agent runs · ${e.minutes} minutes · $${e.dollars} on this machine`;}
export function index_of(kind:string,sub?:string):number{const index=d.INBOX.findIndex(it=>it.kind===kind&&(sub===undefined||it.sub===sub));if(index<0)throw new RangeError('No inbox item of kind '+kind+(sub?' / '+sub:''));return index;}
export function incumbent_lift(s:Sample&{receipt?:{incumbent?:{wlt:readonly number[]}|null}|null|undefined;incumbent?:readonly number[]|null|undefined}):[number,string]|null{const values=s.receipt?.incumbent?.wlt??s.incumbent;if(!values)return null;const r=receipt_of({wlt:values})!;return [r.lift,sign_p(r.w,r.l)];}
export function report_numbers(s:Sample&{receipt?:{triggers:{fp:number;tn:number}}|null|undefined;sessions?:number|undefined;on_target?:number|undefined}){const r=receipt_of(s),holes=r?.partial?r.partial[1]-r.partial[0]:0,tg=s.receipt?.triggers;return {holes,nRounds:(r?.n??0)+holes,triggerTotal:tg?tg.fp+tg.tn:0,...(s.sessions===undefined?{}:{precisionObserved:((s.on_target??0)/s.sessions).toFixed(2)})};}
export function verdict_counts():Record<'PASS'|'NEUTRAL'|'FAIL'|'Not evaluated',number>{const counts={PASS:0,NEUTRAL:0,FAIL:0,'Not evaluated':0};for(const s of d.CATALOG)counts[receipt_of(s)?.verdict??'Not evaluated']++;return counts;}
export function bulk_install(q:Project){return {total:q.skills,asking:skills_in(q).filter(s=>s.grants?.length).length};}
export function person_on_disk(handle:string):[number,number]{const mine=skills_by(handle);return [mine.filter(s=>s.installed!==false).length,mine.length];}
export function category_remaining(key:string,n:number):number{return n-category_skills(key).length;}
export function library_title(scope:string):string{const titles:Record<string,string>=d.DERIVED.libraryTitles;return Object.hasOwn(titles,scope)?titles[scope]!:'0 skills';}
export function score_fractions(rc:Receipt|null):{roi:[number,number]|null;quality:[number,number]|null}{if(!rc)return {roi:null,quality:null};const c=Number.parseFloat(rc.eff.candidate[2]!.replace('$','')),b=Number.parseFloat(rc.eff.baseline[2]!.replace('$','')),max=Math.max(c,b);return {roi:[c/max,b/max],quality:[rc.arm.candidate,rc.arm.baseline]};}

/** Library attention counts only the Global library; Inbox badges are separate fixture counts. */
export function attentionCounts() {
 const failingEvals=d.LIBRARY_OVERVIEW.meter.fail;
 const updatesAvailable=d.SKILLS.filter(skill=>skill.flags?.includes('update')).length;
 const notEvaluated=d.LIBRARY_OVERVIEW.meter.total-d.LIBRARY_OVERVIEW.meter.pass_-d.LIBRARY_OVERVIEW.meter.neutral-failingEvals;
 return {failingEvals,updatesAvailable,notEvaluated,attention:failingEvals+updatesAvailable+notEvaluated};
}
/** CLI status wording, without indentation; no repair or credential action is inferred. */
export function cloneStateCopy(state:CloneState,clone:string,remote:string,readable=true):string {
 switch(state.state){
  case 'absent':return `Clone: ${clone} is missing.`;
  case 'foreign':return `Clone: ${clone} is a clone of ${state.origin}, not ${remote}.`;
  case 'incomplete':return state.reason==='unverifiable'?`Clone: ${clone} could not be verified (${state.error??'unknown error'}); check that git is installed before repairing anything.`:`Clone: ${clone} exists but is not a complete clone.`;
  case 'ok':return readable?'From the local clone; GitHub access is not checked.':'Local team details could not be read.';
 }
}
