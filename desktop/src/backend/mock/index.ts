import { isUnderRoot, normalizeSeparators } from '../../lib/skill-path';
import { z } from 'zod';
import { browserPrefs } from '../prefs';
import { FEATURE_KEYS } from '../types';
import type { Settings, SyncResult, ChangeSource, Features, Identity, Library, Project, Root, LibraryScope, SkillDetail } from '../types';
import { decodeText } from '../../lib/fixture-text';
import { overviewCopy } from '../../lib/overview-copy';
import { abbreviateHome } from '../paths';
import type { Backend } from '../Backend';
import type { ConnectBatch, ConnectOutcome, InviteResult, Result, Roster, Run, SearchHit, SetupResult, SkillCard } from '../types';
import { design, inboxItems, skillByRef, cardOf, detailOf, catalogData } from './data';
import { cli, library_title, roster_by_adoption, statusLines } from './derive';
import { onboardingData } from './onboarding';
import { readScenario } from './scenario';
import { RAW_MD } from './raw-md';
import { statusCounts } from './status-counts';
import { createRun } from './run';
import type { RunContext } from './run';
export const MOCK_REMOVE_DETAIL = [
 'terum-skills will be removed from this machine.',
 ...design.TEAMS.map(t=>`  Team: ${t.key} (${t.remote}, handle ${t.handle})`),
 `  Placed skills (${design.PLACEMENTS_N}): ${design.PLACEMENTS.map(p=>p[0]).join(', ')}`,
 `  Local clones (1): ${design.TEAMS.map(t=>t.clone).join(', ')}`,
 '    (a clone holding uncommitted or unpushed work is moved to ~/.terum/skills/quarantine instead)',
 '  Version cache and run files for these teams',
 '  Session-start hook in ~/.claude/settings.json',
 '  /terum-skills Claude Code skill at ~/.claude/skills/terum-skills',
 '  Downloaded desktop app bundle at ~/.terum/skills/app (all versions)',
 '  Desktop launch state in ~/.terum/skills/run (app.json, latest-version.json)',
 '  ~/.terum/skills/config.json',
 'Kept: ~/.terum/skills/backups (settings backups and a record of this uninstall)',
 'Your membership and installed-skill records in the team repo are unchanged. Rejoining does not re-place skills; `npx -y terum-skills@latest install member <handle>` does.',
 'The package itself is not removed by this command; the last line tells you how.',
];
export const MOCK_REMOVE_ADVICE = [
 'This copy of terum-skills runs from ~/.npm/_npx/terum-skills/node_modules/terum-skills/dist/index.js.',
 'It is an npx cache copy, so there is nothing to uninstall for it. If you also installed the package globally or in a project, remove that with the tool you used, e.g. npm uninstall -g terum-skills.',
 'The desktop app was deleted from ~/.terum/skills/app. A copy that is running keeps running until you quit it; it cannot be reopened from the Dock. `npx -y terum-skills@latest app` downloads it again (needs gh and the release).',
 "This app's own preferences (theme, layout) are kept by the app and were not touched.",
];
const updateAdvice=['Cache request recorded as: terum-skills@latest',"To request the registry's latest release, run:",'  npx -y terum-skills@latest <command>','This does not update other local or global installations.'];
const removed = new Set<string>();
/** Restore the mock fixture between independent test cases; runs retain state until reset. */
export function resetMockRemovals():void { removed.clear(); }
const cancelled=(error:string):Result<never>=>({ok:false,error,cancelled:true});
const fatal=decodeText(design.ONBOARD_FETCH_ERROR);
const errors={status:"Could not read ~/.terum/skills/config.json.",library:"EACCES: permission denied, scandir '~/.terum/skills'",settings:"Invalid ~/.terum/skills/config.json: Expected property name or '}' in JSON at position 412 (line 14 column 3)",inbox:fatal,marketplace:"fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com",share:"ENOENT: no such file or directory, scandir '~/.terum/skills/teams/terum/people'",skill:(ref:string)=>`ENOENT: no such file or directory, open '~/.claude/skills/${ref}/SKILL.md'`,onboarding:design.ONBOARD_FETCH_ERROR.replaceAll("&#39;", "'")};
const ok=<T>(value:T):Result<T>=>({ok:true,value});
const fail=(error:string):Result<never>=>({ok:false,error:abbreviateHome(decodeText(error),'')});
const zeroCopy=overviewCopy;
const zeroOverview={skills:'0',skills_note:zeroCopy.skills,evaluated:'—',meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:zeroCopy.evaluated,installs:'0',installs_note:zeroCopy.installs,attention:'0',attention_lines:[zeroCopy.attention],attention_link:design.LIBRARY_OVERVIEW.attention_link,zero:zeroCopy};
function removalState<T extends SkillCard>(skill:T):T { return removed.has(skill.name)?{...skill,installed:'absent',placed:false,onDiskOnly:false,paths:[]}:skill; }
export function createMockBackend(opts:{latencyMs?:number}={}):Backend & {readonly quitRequested:boolean} {
 const identity:Identity=structuredClone({...design.ME,initials:'TZ',footerLabel:design.MACHINE.gh_login});
 const listeners=new Set<(source:ChangeSource)=>void>();
 const latency=opts.latencyMs??0;
 if(!Number.isFinite(latency)||latency<0)throw new Error('latencyMs must be a finite nonnegative number.');
 async function read<T>(family:keyof typeof errors,get:(scenario:ReturnType<typeof readScenario>)=>Result<T>,ref=''):Promise<Result<T>>{
  const scenario=readScenario();
  if(scenario==='loading')return new Promise<Result<T>>(()=>{ /* Deliberately pending: the loading board has no completion. */ });
  const delay=scenario==='slow'?2000:latency;
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  if(scenario==='error')return fail(typeof errors[family]==='function'?errors[family](ref):errors[family]);
  const result=get(scenario);
  return structuredClone(result.ok?result:{...result,error:abbreviateHome(decodeText(result.error),'')});
 }
 function long<T>(family:Exclude<keyof typeof errors,'skill'>,script:(ctx:RunContext)=>Promise<Result<T>>):Run<T>{
  const scenario=readScenario();
  return createRun(async ctx=>{if(scenario==='error')return fail(errors[family]);if(scenario==='loading'){while(true)await ctx.sleep(60_000);}if(scenario==='slow'||latency)await ctx.sleep(scenario==='slow'?2000:latency);return structuredClone(await script(ctx));});
 }
 const profileValues: {name?:string;bio?:string;role?:string;projects?:string[]} = {};
 const declined = new Set<string>();
 // A successful mock install flips the fixture's installed state, so the UI updates like the real adapter's.
 const installedRefs = new Set<string>();
 const withInstall = <T extends SkillCard>(card:T):T => installedRefs.has(card.name)?{...card,installed:'placed',placed:true,onDiskOnly:false}:card;
 /** Projects created in this session, shown alongside the fixture's own so the Add flow is exercisable in mock mode. */
 const created: {name:string;remote:string|null}[] = [];
 /** Endorsements this session opened, so a project's card reflects what the picker did. */
 const endorsed: {project:string;name:string}[] = [];
 const asProject=(q:{name:string;remote:string|null}):Project=>({name:q.name,key:q.name,ico:'folder',desc:'',skills:0,members:0,remote:q.remote??'—',installed:false,favorites:null,updated:null,path:null,admin:null,evaluated:null,memberHandles:[],memberInitials:[],skillsIn:[]});
 const roster=():Roster=>({members:design.ROSTER.map(q=>({...q,...(q.handle===design.ME.handle?profileValues:{}),lastPublish:q.last_publish,status:design.MEMBER[q.handle]?.[0]??'',projects:q.handle===design.ME.handle?profileValues.projects??design.MEMBER[q.handle]?.[1]??[]:design.MEMBER[q.handle]?.[1]??[],lastSeen:design.MEMBER[q.handle]?.[2]??''})),byAdoption:roster_by_adoption().map(q=>q.handle),invited:design.INVITED,member:Object.fromEntries(Object.entries(design.MEMBER).map(([handle,[status,projects,lastSeen]])=>[handle,{status,projects:handle===design.ME.handle?profileValues.projects??projects:projects,lastSeen}]))});
 async function connectPicker(ctx:RunContext,team:string):Promise<Result<ConnectOutcome>>{
  const batch:ConnectBatch={kind:'batch',shared:[],declined:[],refused:[]};
  const remaining=[...design.LOCAL_UNSHARED];
  while(true){
   const end=batch.shared.length?'Done':'Skip';
   const answer=await ctx.ask('select',`Connect a local skill folder to team ${team}?`,{choices:[...remaining,end]});
   if(answer==='Skip')return cancelled('Connect was declined.');
   if(answer==='Done')return ok(batch);
   const name=String(answer);
   remaining.splice(remaining.indexOf(name),1);
   if(await ctx.ask('confirm',`Connect ${name}?`)){batch.shared.push({id:name,name});ctx.print(`Connected ${name}.`);}else batch.declined.push(name);
  }
 }
 let quitRequested=false;
 const backend:Backend & {readonly quitRequested:boolean} = {
  get quitRequested(){return quitRequested;},
  async quit(){quitRequested=true;try{window.close();}catch{ /* jsdom / Playwright: no-op */ }},
  async setWindowBackground(){return ok(undefined);},
  async launchContext(){return null;},
  async refreshLaunch(){return null;},
  onLaunchRequest(){return ()=>{};},
  async features(){return Object.fromEntries(FEATURE_KEYS.map(key=>[key,true])) as Features;},
  async windowAction(){return ok(undefined);},
  async openUrl(url){try{window.open(url,'_blank','noopener');return ok(undefined);}catch(error){return fail(error instanceof Error?error.message:String(error));}},
  async revealPath(){return ok(undefined);},
  async pickFolder(){return ok('/Users/you/code/new-project');},
  async capabilities(){return {appVersion:design.APP_VERSION,windowChrome:'cosmetic',disablePerMachine:true,inboxEventLog:true,offtargetKind:true,machineRegistry:true,perCaseEvalTables:true,evalCommitChoice:false,openInEditor:true,clipboard:true};},
  async surfaces(){return {divergence:true,status:true,settings:true,onboarding:true,library:true,skill:true,receipts:true,inbox:true,catalog:true,roster:true,update:true,checkouts:false,appUpdate:false};},
  async status(){return structuredClone(ok({machine:{...design.MACHINE,hostname:design.MACHINE.name},me:identity,teams:readScenario()==='no-team'?[]:mockTeams(),tools:{git:true,gh:true},roots:mockRoots(),counts:statusCounts(location.hash,readScenario())}));},
  settings:async()=>{const result=await read<Settings>('settings',()=>ok({INVITE_TIP:design.INVITE_TIP,JOIN_BLOCK_NOTE:design.JOIN_BLOCK_NOTE,INVITEE:design.INVITEE,K:design.K,MACHINE:{...design.MACHINE,hostname:design.MACHINE.name},ME:identity,TEAMS:mockTeams(),TEAM_POLICY:{...design.TEAM_POLICY,categories:design.CATEGORIES.map(([name])=>name),projects:design.PROJECTS.map(project=>project.name),categoriesNote:'From SKILL.md frontmatter; the list is admin-extendable.'},tools:{git:true,gh:true},syncNote:null,PLACEMENTS:design.PLACEMENTS,PLACEMENTS_N:design.PLACEMENTS_N,PINNED_N:design.PINNED_N,APPROVALS:design.APPROVALS,QUARANTINE:design.QUARANTINE,SHARED:design.SHARED,LOCAL_UNSHARED:design.LOCAL_UNSHARED,HOOK:design.HOOK,APP_VERSION:design.APP_VERSION,AGENT_CLI:design.AGENT_CLI,AGENT_CLI_AUTH:'signed-in',COMMUNITY:design.COMMUNITY,STORAGE:design.STORAGE,SETTINGS_NAV:design.SETTINGS_NAV,SHORTCUTS:design.SHORTCUTS,INBOX_KIND_TEXT:design.INBOX_KIND_TEXT,THEME_OPTIONS:design.THEME_OPTIONS,CLI_VERSION:design.CLI_VERSION,CLI_LATEST:design.CLI_LATEST,FOLLOWING:design.FOLLOWING,SHARED_SPECIMEN:design.SHARED_SPECIMEN}));return result.ok?result:{...result,reason:result.error.includes('Invalid')&&result.error.includes('config.json')?'invalid-config':'unreadable'};},
  onboarding:async()=>{const result=await read('onboarding',()=>ok(onboardingData()));return result.ok?result:{...result,value:onboardingData()};},
  library:({scope})=>read('library',scenario=>{if(scenario==='no-team')return {ok:false,error:'No team is configured on this machine.',reason:'no-team'};const scopes:Record<string,readonly string[]>=design.LIST_OF;const root=mockRoots().find(r=>scope.kind==='global'?r.kind==='global':r.id===scope.root);if(!root)return fail('No such checkout: '+(scope.kind==='checkout'?scope.root:'global'));const canonical=root.label;const skills=scenario==='empty'?[]:canonical==='Global'?design.SKILLS:design.SKILLS.filter(skill=>skill.project!=='local'&&scopes[skill.name]?.includes(canonical));return ok({scanned:null,root,team:{kind:'ok',team:design.TEAMS[0]!.name},skills:skills.map(s=>removalState(withInstall({...cardOf(s),path:root.kind==='global'?'~/.claude/skills/'+s.name:root.root+'/.claude/skills/'+s.name,...(scenario==='on-disk-only'&&s.name==='deploy-check'?{installed:'placed' as const,placed:false,onDiskOnly:true,paths:[['~/.claude/skills/deploy-check','global']] as [string,string][]}:{}),enabled:backend.prefs.get('enabled:'+s.name,s.enabled??true),favorite:backend.prefs.get('favorite:'+s.name,s.favorite??false)}))),overview:scenario==='empty'?zeroOverview:(Object.hasOwn(design.OVERVIEW_BY_SCOPE,canonical)?(design.OVERVIEW_BY_SCOPE as Record<string,Library['overview']>)[canonical]!:zeroOverview),title:scenario==='empty'?'0 skills':library_title(canonical)});}),
  localSkill:({path})=>read('skill',()=>{const detail=skillByRef(path.split(/[\\/]/).filter(Boolean).at(-1)??'');return detail.ok?ok({...detail.value,team:null,skillRef:'local:'+path,path,pathLabel:path,repoPath:path,owningRoot:mockOwningRoot(path)}):{ok:false,error:path+' is not in any Library root.',reason:'not-in-library'};}),
  checkouts:{add:path=>long('settings',async ctx=>{ctx.print('Registered '+path);for(const listener of listeners)listener('config');return ok({path,registered:true});}),remove:path=>long('settings',async ctx=>{ctx.print('Forgot '+path);for(const listener of listeners)listener('config');return ok({path,placementsRemaining:0});}),discover:()=>long('settings',async()=>ok({candidates:[],scanned:0,truncated:false,problems:[]}))},
  projects:{create:({name,remote})=>long('marketplace',async ctx=>{if(catalogData().projects.some(p=>p.name.toLowerCase()===name.toLowerCase())||created.some(p=>p.name.toLowerCase()===name.toLowerCase()))return fail(`team already has a project named ${name}.`);created.push({name,remote:remote??null});ctx.print('Created project '+name);for(const listener of listeners)listener('clone');return ok({team:'team',name,remotes:remote?[remote]:[],skills:0});})},
  skill:({ref,at})=>read('skill',scenario=>{if(scenario==='not-installed'&&ref==='deploy-check')return ok(scopedDetail(removalState(detailOf(design.DETAIL_NOT_INSTALLED)),at));const result=skillByRef(ref);
   if(result.ok&&scenario==='invalid-newest')Object.assign(result.value,{latestState:'invalid',receipt:null,summary:null,reportNumbers:null,invalidReceiptFile:`evals/deploy-check/${design.DETAIL.version_full}/20260829T221500Z.json`});
   if(result.ok&&scenario==='version-mismatch')result.value.versions={placed:'a1b2c3d4'+'0'.repeat(32),teamCurrent:'5f0e12ab9c3d'+'0'.repeat(28),evaluated:'5f0e12ab9c3d'+'0'.repeat(28)};
   if(result.ok&&scenario==='raw-md')result.value.skillMd={frontmatter:'',body:[],markdown:RAW_MD};
   return result.ok?ok(scopedDetail(removalState(withInstall({...result.value,...(scenario==='not-installed'?{installed:'absent' as const,placed:false,onDiskOnly:false,root:'Marketplace' as const,flags:[]}:{}),...(scenario==='on-disk-only'&&ref==='deploy-check'?{installed:'placed' as const,placed:false,onDiskOnly:true,path:'~/.claude/skills/deploy-check',pathLabel:'~/.claude/skills/deploy-check',paths:[['~/.claude/skills/deploy-check','global']] as [string,string][]}:{}),enabled:scenario==='disabled'?false:backend.prefs.get('enabled:'+ref,result.value.enabled),favorite:backend.prefs.get('favorite:'+ref,result.value.favorite)})),at)):result;},ref),
  evalReport:async({ref})=>{const detail=await backend.skill({ref});if(!detail.ok)return detail;const {receipt,summary,incumbentLift,reportNumbers,history,versions,latestState,invalidReceiptFile,localRuns,evalEstimate,evalEstimateText,evalEstimateTip,scoreFractions,wlt}=detail.value;return ok({receipt,summary,incumbentLift,reportNumbers,history,versions,latestState,invalidReceiptFile,localRuns,evalEstimate,evalEstimateText,evalEstimateTip,scoreFractions,wlt});},
  receipts:({skillId,version})=>read('library',()=>{const detail=skillByRef(skillId);if(!detail.ok)return fail(detail.error);return ok(detail.value.version===version?detail.value.receipt??null:null);}),
  inbox:()=>read('inbox',scenario=>ok(scenario==='empty'?[]:inboxItems())),
  catalog:(query)=>read('marketplace',scenario=>{const catalog=catalogData();catalog.projects=[...catalog.projects,...created.map(asProject)];catalog.projects=catalog.projects.map(project=>{const added=endorsed.filter(row=>row.project===project.key).map(row=>row.name).filter(name=>!project.skillsIn.includes(name));return added.length?{...project,skills:project.skills+added.length,skillsIn:[...project.skillsIn,...added]}:project;});catalog.projectsByMembers=[...catalog.projectsByMembers,...created.map(q=>q.name)];if(scenario==='on-disk-only')catalog.skills=catalog.skills.map(skill=>skill.name==='deploy-check'?{...skill,installed:'placed' as const,placed:false,onDiskOnly:true,paths:[['~/.claude/skills/deploy-check','global']] as [string,string][]}:skill);catalog.skills=catalog.skills.map(skill=>removalState(withInstall(skill)));catalog.extras=catalog.extras.map(skill=>removalState(withInstall(skill)));catalog.people=catalog.people.map(person=>person.handle===design.ME.handle?{...person,...profileValues,teamsLine:profileValues.projects?.join(' · ')??person.teamsLine,declined:[...declined]}:person);return ok({...catalog,skills:catalog.skills.filter(s=>!query?.q||(s.name+' '+s.desc).toLowerCase().includes(query.q.toLowerCase()))});}),
  roster:()=>read('share',scenario=>{const all=roster();return ok(scenario==='empty'?{byAdoption:all.byAdoption.filter(h=>h===design.ME.handle),members:all.members.filter(m=>m.handle===design.ME.handle),invited:[],member:Object.fromEntries(Object.entries(all.member).filter(([h])=>h===design.ME.handle))}:all);}),
  search:args=>read('marketplace',()=>{const hits:SearchHit[]=[...design.CATALOG.map(s=>({kind:'skill' as const,ref:s.name,name:s.name,description:s.desc})),...design.PEOPLE.map(p=>({kind:'member' as const,ref:p.handle,name:p.name,description:p.role})),...design.PROJECTS.map(p=>({kind:'project' as const,ref:p.key,name:p.name,description:p.desc}))].map(hit=>({...hit,team:null,category:null,author:null,installs:null,latest:null,endorsed:null,unresolved:null}));return ok(hits.filter(h=>(!args.kinds||args.kinds.includes(h.kind))&&(h.name+' '+h.description).toLowerCase().includes(args.q.toLowerCase())));}),
  install:args=>long('library',async ctx=>{ctx.print(`Installing ${args.ref}…`);if(!args.ref.trim())return fail('A ref is required.');const detail=skillByRef(args.ref);if((args.kind??'skill')==='skill'&&!detail.ok)return fail(detail.error);if(!await ctx.ask('confirm',`Approve these tools for ${args.ref}?`))return cancelled('Install was declined.');ctx.progress(1,1,'Installed');if((args.kind??'skill')==='skill'){const name=args.ref.split('/').at(-1)??args.ref;installedRefs.add(name);removed.delete(name);for(const listener of listeners)listener('placed');}return ok([{id:args.ref,name:args.ref,scope:args.scope??'Global'}]);}),
  uninstallSkill:args=>long('library',async ctx=>{
   const catalog=catalogData(),cards=[...catalog.skills,...catalog.extras];
   let names:string[],question:string;
   if(args.kind==='project'&&args.project){
    const project=catalog.projects.find(p=>p.key===args.project);
    if(!project)return fail(`Unknown project ${args.project}.`);
    names=project.skillsIn.filter(name=>!removed.has(name)&&cards.some(card=>card.name===name&&card.placed));
    question=`Remove ${args.project}'s ${names.length} skills from this machine?`;
   }else if(args.kind==='member'&&args.member){
    const person=catalog.people.find(p=>p.handle===args.member);
    if(!person)return fail(`Unknown member ${args.member}.`);
    names=person.installable.filter(name=>!removed.has(name));
    question=args.member===design.ME.handle?`Remove everything you installed (${names.length} skills)?`:`Remove ${args.member}'s ${names.length} skills from this machine?`;
   }else{
    const skill=skillByRef(args.ref);
    if(!skill.ok)return fail(skill.error);
    names=[args.ref];question=`Remove ${skill.value.name}?`;
   }
   if(!names.length)return ok([]);
   const paths=names.flatMap(name=>cards.find(card=>card.name===name)?.paths??[]);
   const detail=[`Folders removed (${paths.length}):`,...paths.map(([path,scope])=>`  ${path}  ·  ${scope==='global'?'Global':`project ${scope}`}`),
    'Local changes are moved to ~/.terum/skills/quarantine, never deleted.',
    `Install records dropped from your people file (${names.length}): ${names.join(', ')}`,
    ...(args.kind==='member'?[`Targets are ${args.member}'s current installed list, not what you installed from them.`]:args.kind==='project'?['Copies installed to Global stay.']:[])];
   if(!await ctx.ask('confirm',question,{detail}))return cancelled('Remove was declined.');
   for(const name of names)removed.add(name);
   for(const listener of listeners){listener('placed');listener('config');}
   return ok(names.map(name=>({id:name,name})));
  }),
  setIdentity:args=>long('settings',async ctx=>{
   const fields=[['name','name',args.name,z.string().min(1)],['email','email',args.email,z.email()],['default-handle','default_handle',args.defaultHandle,z.string().transform(value=>value.trim().toLowerCase()).pipe(z.string().min(1).max(39).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))]] as const;
   const next={...identity};const updated:{key:string;value:string}[]=[];
   for(const [key,field,value,schema] of fields){if(value===undefined)continue;const parsed=schema.safeParse(value);if(!parsed.success)return fail(`Invalid ${key}: ${parsed.error.issues.map(issue=>issue.message).join('; ')}`);next[field]=parsed.data;updated.push({key,value:parsed.data});}
   if(!updated.length)return fail('Use --set <key>=<value>. Accepted keys: name, email, default-handle.');
   const notice=`This changes the author line (${next.name} <${next.email}>) that the next sync writes into the skills you have connected on this machine; skills you authored elsewhere keep their recorded author.`;
   ctx.print(notice);Object.assign(identity,next);for(const listener of listeners)listener('config');return ok({updated,notice});
  }),
  uninstallMachine:()=>long('settings',async ctx=>{
   const detail=[...MOCK_REMOVE_DETAIL];
   if(!await ctx.ask('confirm','Remove terum-skills from this machine?',{detail}))return cancelled('Uninstall was cancelled.');
   ctx.print("Wrote a record of this machine's terum-skills state to ~/.terum/skills/backups/uninstall.2026-09-09T12-00-00-000Z.json.");
   for(const t of design.TEAMS){ctx.print(`Leaving ${t.key}…`);ctx.print(`Left ${t.key}.`);}
   return ok({removed:design.TEAMS.map(t=>t.key),removedPlacements:design.PLACEMENTS_N,hookRemoved:true,wrapperRemoved:true,configRemoved:true,kept:['~/.terum/skills/backups'],record:'~/.terum/skills/backups/uninstall.2026-09-09T12-00-00-000Z.json',advice:[...MOCK_REMOVE_ADVICE]});
  }),
  connect:args=>long<ConnectOutcome|undefined>('share',async ctx=>{ctx.print('Connecting local skills…');if(Object.values(args).some(v=>v!==undefined)){const name=(args.path??design.LOCAL_UNSHARED[0]??'local-skill').replace(/\/$/,'').split('/').pop();if(!name)return fail('A skill folder is required.');return await ctx.ask('confirm',`Connect ${name}?`)?ok({id:name,name}):cancelled('Connect was declined.');}return connectPicker(ctx,design.TEAMS[0]?.key??'terum');}),
  profile:args=>long('share',async()=>{
    if(args.role!==undefined&&args.role.length>32)return fail('Role must be at most 32 characters.');
    if(args.name==='')return fail('Name must not be empty.');
    for(const project of args.projects??[])if(!design.PROJECTS.some(row=>row.key===project||row.name===project))return fail(`Unknown project ${project}.`);
    const current:Record<string,unknown>={name:design.ME.name,bio:'',role:design.ROSTER.find(person=>person.handle===design.ME.handle)?.role??'',projects:design.MEMBER[design.ME.handle]?.[1]??[],...profileValues};
    const changed=Object.entries(args).filter(([key,value])=>value!==undefined&&JSON.stringify(value)!==JSON.stringify(current[key])).map(([key])=>key==='name'?'display_name':key);
    Object.assign(profileValues,args);return ok({handle:design.ME.handle,changed});
  }),
  decline:args=>long('share',async()=>{const ref=args.ref.split('/').at(-1)??'';const catalog=catalogData(),skill=[...catalog.skills,...catalog.extras].map(withInstall).find(row=>row.name===ref);if(!skill)return fail(`No skill named ${ref}.`);if(skill.installed!=='absent')return fail(`${ref} is installed; run uninstall-skill first.`);declined.add(ref);return ok({id:ref});}),
  publish:args=>long('share',async ctx=>{
   const refs=args.refs??(args.ref===undefined?[]:[args.ref]);const resolved=refs.map(ref=>skillByRef(ref));const missing=resolved.find(result=>!result.ok);
   if(missing&&!missing.ok)return fail(missing.error);ctx.print(`Publishing ${refs.join(', ')}…`);
   if(args.project){for(const ref of refs)endorsed.push({project:args.project,name:ref});for(const listener of listeners)listener('clone');}
   return ok({name:refs[0]??'',version:refs.length?design.DETAIL.version:null,changed:refs.length>0,prUrl:args.project?`https://github.com/terum/team-skills/pull/${140+endorsed.length}`:null,outcomes:refs.map(name=>({name,outcome:'added' as const}))});
  }),
  sync:args=>long<SyncResult>('onboarding',async ctx=>{ctx.print('Syncing team skills…');const names=design.QUARANTINE.map(q=>q[1]??'');if(args.prune&&!await ctx.ask('confirm',`Delete ${names.length} quarantined item(s)?`)){ctx.print('Prune cancelled; nothing deleted.');return ok({placed:0,deferred:[],notices:[],changed:false,teams:[]});}return ok({placed:design.SKILLS.map(s=>s.name).length,deferred:[],notices:[],changed:true,teams:[{team:args.team??design.TEAMS[0]!.key,state:'synced'}]});}),
  invite:args=>long<InviteResult>('share',async ctx=>{if(!args.logins.length||args.logins.some(login=>!login.trim()))return fail('At least one GitHub login is required.');ctx.print(`Inviting ${args.logins.join(', ')}…`);if(readScenario()==='partial'){const [first,...rest]=args.logins;const failed=rest.map(login=>({login,error:`Could not invite @${login} (GitHub status 422). gh: Validation Failed (HTTP 422)`}));return {ok:false,error:failed.map(f=>f.error).join('\n'),value:{invited:first?[first]:[],already:[],failed}};}return ok({invited:[...args.logins],already:[],failed:[]});}),
  team:args=>long('share',async ctx=>{const name=args.team??args.name??design.TEAMS[0]?.name??'Terum';ctx.print(`${args.kind}: ${name}`);if(args.kind==='leave'&&!await ctx.ask('confirm',`Leave ${name}? This removes ${design.PLACEMENTS_N} placed skill(s) from this machine.`))return cancelled('Leave was declined.');return ok({name,kind:args.kind});}),
  setup:args=>long('share',async ctx=>{ctx.print('Setting up terum-skills…');const choice=await ctx.ask('select','Create a team or join one?',{choices:['Create a new team','Join an existing team']});const role=choice==='Create a new team'?'creator' as const:'joiner' as const;const team=args.target??design.TEAM_REPO;let connected:ConnectOutcome|undefined;if(args.offerConnect!==false){const picked=await connectPicker(ctx,team);if(!picked.ok)return fail(picked.error);connected=picked.value;}const steps:NonNullable<SetupResult['steps']>={role:'done',team:'done',actions:connected?'done':'skipped'};ctx.print('Looking for skill folders on this machine…');if(await ctx.ask('confirm','Look for skill folders on this machine and add them to your library?')){await ctx.ask('text','Look under which folder?',{default:'~'});ctx.print('No skill folders found under ~.');steps.discover='done';}else steps.discover='skipped';steps.evals=await ctx.ask('confirm','Evaluate the 1 shared skill that has no receipt yet? This runs Claude on each one and commits each receipt to the team repo.')?'done':'skipped';return ok({team,role,...(connected?{connected}:{}),steps});}),
  eval:args=>long('library',async ctx=>{const detail=skillByRef(args.ref);if(!detail.ok)return fail(detail.error);ctx.print(`Evaluating ${args.ref}…`);ctx.progress(1,1,'Complete');return ok({name:args.ref,runDir:`~/.terum/skills/evals/terum/${args.ref}/20260906T120000Z`,executionStatus:'complete' as const,commit:args.commit?{ok:true as const,receiptPath:`evals/${args.ref}/20260906T120000Z.json`}:null});}),
  validate:args=>read('library',()=>{const name=args.ref??design.DETAIL.name;const detail=skillByRef(name);return detail.ok?ok({name,findings:0,warnings:0}):fail(detail.error);}),
  update:()=>read('settings',()=>ok({running:design.CLI_VERSION,latest:design.CLI_LATEST,observation:'newer',launch:'npx',description:`${design.CLI_VERSION} installed · ${design.CLI_LATEST} available`,advice:updateAdvice,lines:[`terum-skills ${design.CLI_VERSION}`,`Latest advertised release: ${design.CLI_LATEST}`,...updateAdvice]})),
  appUpdate:{
   check:()=>read('settings',()=>ok({appVersion:design.APP_VERSION,supported:false,cliVersion:design.CLI_VERSION,latest:design.CLI_LATEST,latestAt:null,probe:'skipped' as const,probeError:null,staged:null,installed:[],lastApply:null,newer:false,ppid:0})),
   stage:()=>long('settings',async()=>fail('The mock backend does not download or install anything.')),
   apply:async()=>fail('The mock backend does not download or install anything.'),
  },
  diagnostics:()=>long('status',async ctx=>{for(const line of statusLines(design))ctx.print(line);return ok(undefined);}),
  async openInEditor(path){return (path==='~'||path.startsWith('~/')||path.startsWith('/'))?ok(undefined):fail('An editor path is required.');},
  async copyToClipboard(text){try{if(!navigator.clipboard?.writeText)return fail('Clipboard unavailable.');await navigator.clipboard.writeText(text);return ok(undefined);}catch(error){return fail(error instanceof Error?error.message:'Clipboard unavailable.');}},
  async copyImage(png){try{if(png.type!=='image/png')return fail('Expected a PNG image.');if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')return fail('Clipboard unavailable.');await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);return ok(undefined);}catch(error){return fail(error instanceof Error?error.message:'Clipboard unavailable.');}},
  prefs:browserPrefs(),
  subscribe:listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}
 };
 return backend;
}

// MRF has no origin, so the header's "GitHub: not connected" state is reachable in the mock too.
const MOCK_ORIGIN:Record<string,string|null>={Terum:'ryanliu-terum/terum-skills',SSM:'ryanliu-terum/ssm',MRF:null};
function mockRoots():Root[]{const scenario=readScenario();const global:Root={id:'global',kind:'global',label:'Global',root:'~/.claude/skills',rootState:'scanned',registered:false,detected:false,count:design.COUNTS.Global,remote:null};
 if(scenario==='no-projects')return [global];
 return [global,...(['Terum','SSM','MRF'] as const).map((name):Root=>({id:'/Users/you/code/'+name.toLowerCase(),kind:'checkout',label:name,root:'/Users/you/code/'+name.toLowerCase(),rootState:scenario==='missing-root'&&name==='SSM'?'absent':'scanned',registered:!(scenario==='detected-root'&&name==='SSM'),detected:scenario==='detected-root'&&name==='SSM',count:scenario==='missing-root'&&name==='SSM'?undefined:design.COUNTS[name],remote:MOCK_ORIGIN[name]===null?null:{url:'https://github.com/'+MOCK_ORIGIN[name],slug:MOCK_ORIGIN[name]!}}))];}
/** Which mock Library root holds this folder — the longest match, so a checkout nested inside
 *  another names the inner one, exactly as the CLI's own section assignment would. Null when the
 *  path is under no mock root, and the page then falls back to `root` as it does today. */
function mockOwningRoot(path:string):{id:string;label:string}|null{
 const root=mockRoots().filter(r=>isUnderRoot(path,r.root)).sort((a,b)=>normalizeSeparators(b.root).length-normalizeSeparators(a.root).length)[0];
 return root?{id:root.kind==='global'?'Global':root.id,label:root.label}:null;
}
/** A scoped read names the root the reader clicked, as the real adapter does, so the crumb, the
 *  sidebar, the Remove destination and #131's dialog wording agree with the URL. `installScopes`
 *  is deliberately untouched: destinations come from the whole machine on both backends. */
function scopedDetail(detail:SkillDetail,at:LibraryScope|undefined):SkillDetail{
 if(at===undefined)return detail;
 const root=mockRoots().find(r=>at.kind==='global'?r.kind==='global':r.id===at.root);
 if(!root)return detail;
 const path=root.kind==='global'?'~/.claude/skills/'+detail.name:root.root+'/.claude/skills/'+detail.name;
 return {...detail,owningRoot:{id:root.kind==='global'?'Global':root.id,label:root.label},scope:root.label,path,pathLabel:path,installScopePaths:Object.fromEntries(mockRoots().flatMap(r=>r.kind==='checkout'?[[r.label,r.root]]:[]))};
}
function mockTeams(){return design.TEAMS.map(team=>({...team,policy:design.TEAM_POLICY,categories:design.CATEGORIES.map(([name])=>name),pending:[],joinCommand:cli(`setup ${design.TEAM_REPO}`),joinBlock:['Send this to your teammate:', '```', 'npm install -g terum-skills', `npx -y terum-skills@latest setup ${design.TEAM_REPO}`, '', `Bare equivalent: npx -y terum-skills@latest team join ${design.TEAM_REPO}`, '```', 'If you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.']}));}
