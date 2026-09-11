import type { RunContext } from './run';
import type { Onboarding } from '../types';
import { design as d, cardOf } from './data';
import { cli, share_command, summary_of } from './derive';
export function onboardingData():Onboarding{
 const team=d.TEAMS[0];const person=d.ROSTER[0];const project=d.PROJECTS[1];const sample=d.SKILLS[0];
 if(!team||!person||!project||!sample||!d.DETAIL.receipt)throw new Error('Onboarding requires team, roster, project, skill and receipt fixtures.');
 const boot=(failed:boolean):[string,string,string][]=>[['done',`Team ${team.key} found on this machine`,`@${d.ME.handle}`],[failed?'failed':'done',failed?`Couldn't fetch ${d.TEAM_REPO}`:`Fetched ${d.TEAM_REPO}`,failed?'not reached':'main'],[failed?'pending':'done',"Nothing new to place",failed?'':'the join placed the Global set'],[failed?'pending':'current','Recording the sync',failed?'':'run/terum.stamp'],...(failed?[]:[['pending','Approve updated tools for <skill>? · asked only when a grant changed upstream',''] as [string,string,string]])];
 return {ONBOARD_STEPS:d.ONBOARD_STEPS,ONBOARD_BASICS:d.ONBOARD_BASICS,GLOBAL_SET:d.GLOBAL_SET,BOOT_STEPS:d.BOOT_STEPS,ONBOARD_LATER:d.ONBOARD_LATER,ONBOARD_COMMUNITY:d.ONBOARD_COMMUNITY,ONBOARD_FETCH_ERROR:d.ONBOARD_FETCH_ERROR,WELCOME_LINES:d.WELCOME_LINES,BASICS_COPY:d.BASICS_COPY,BASICS_HINT:d.BASICS_HINT,THEME_OPTIONS:d.THEME_OPTIONS,LIBRARY_OVERVIEW:d.LIBRARY_OVERVIEW,INVITEE:d.INVITEE,TEAM_REPO:d.TEAM_REPO,INVITE_TIP:d.INVITE_TIP,JOIN_BLOCK_NOTE:d.JOIN_BLOCK_NOTE,skill:cardOf(sample),summary:summary_of(d.DETAIL),arm:d.DETAIL.receipt.arm,used_by:d.DETAIL.used_by,installs_n:d.DETAIL.installs_n,shareCommand:share_command(d.DETAIL),rosterInitials:d.ROSTER.map(q=>q.initials),team,me:d.ME,teamN:d.TEAM_N,searchResults:[{kind:'skill',name:sample.name,meta:`${sample.project} / ${sample.category} · skill`},{kind:'person',name:person.name,meta:`${person.handle} · ${person.role}`,initials:person.initials},{kind:'project',name:project.name,meta:`${project.skills} skills · project`}],joinBlock:cli(`setup ${d.TEAM_REPO}`),bootRows:boot(false),failedBootRows:boot(true)};
}

/** The mock drives the same choices and outcome shapes as the CLI wizard. */
export async function replaySetupEvals(ctx: RunContext): Promise<'queued' | 'batched' | 'done' | 'skipped'> {
 const estimate = "Evaluating 2 skills, 4 at a time: no earlier runs to estimate from; each eval runs the skill's cases against a baseline on this machine and bills your Claude account.";
 ctx.print(estimate);
 const choice = await ctx.ask('select', 'Evaluate the 2 shared skills that have no receipt yet? This runs Claude on each one and commits each receipt to the team repo.', {
  choices: ['Now', 'In batches', 'Overnight', 'Skip'], default: 'Overnight', detail: [estimate], descriptions: [
   'Runs all 2, 4 at a time, in this terminal.', 'Asks how many at a time and checks in between batches.',
   'Queues them; the app runs them between 01:00 and 05:00 while it is open and idle.',
   'Evaluate any skill later with `npx -y terum-skills@latest eval <skill>`.',
  ],
 });
 if(choice==='Overnight'){ctx.print('Queued 2 evals for overnight: the app runs them in parallel between 01:00 and 05:00 while it is open and idle. Run them now with `npx -y terum-skills@latest eval --drain`.');return 'queued';}
 if(choice==='Skip')return 'skipped';
 let parallel=4;
 if(choice==='In batches'){
  for(;;){const answer=String(await ctx.ask('text','How many at a time?',{default:'4'}));if(/^\d+$/.test(answer)&&Number.isSafeInteger(Number(answer))&&Number(answer)>=1){parallel=Number(answer);break;}ctx.print('Enter a whole number of at least 1.');}
 }
 ctx.print(`Evaluating 2 skills, ${parallel} at a time…`);ctx.print('✓ deploy-check');ctx.progress(1,2,'evals');
 if(parallel===1&&!(await ctx.ask('confirm','Continue with the next 1? (1 of 2 done, 1 left)'))){ctx.print('Queued 1 evals for later. Run them with `npx -y terum-skills@latest eval --drain`.');return 'batched';}
 await ctx.sleep(150);ctx.print('✗ release-notes: Hygiene failed for release-notes');ctx.progress(2,2,'evals');await ctx.sleep(150);
 ctx.print('Evaluated 1 of 2; 1 failed.');return choice==='In batches'?'batched':'done';
}
