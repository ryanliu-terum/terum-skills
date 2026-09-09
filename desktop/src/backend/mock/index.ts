import { z } from 'zod';
import { browserPrefs } from '../prefs';
import { FEATURE_KEYS } from '../types';
import type { ChangeSource, Features, Identity } from '../types';
import { decodeText } from '../../lib/fixture-text';
import { abbreviateHome } from '../paths';
import type { Backend } from '../Backend';
import type { ConnectBatch, ConnectOutcome, Result, Roster, Run, SearchHit } from '../types';
import { design, inboxItems, skillByRef, cardOf, detailOf, catalogData } from './data';
import { library_title, roster_by_adoption } from './derive';
import { onboardingData } from './onboarding';
import { readScenario } from './scenario';
import { statusCounts } from './status-counts';
import { createRun } from './run';
import type { RunContext } from './run';
const updateAdvice=['Cache request recorded as: terum-skills@latest',"To request the registry's latest release, run:",'  npx -y terum-skills@latest <command>','This does not update other local or global installations.'];
const cancelled=(error:string):Result<never>=>({ok:false,error,cancelled:true});
const fatal=decodeText(design.ONBOARD_FETCH_ERROR);
const errors={library:"EACCES: permission denied, scandir '~/.terum/skills'",settings:"Invalid ~/.terum/skills/config.json: Expected property name or '}' in JSON at position 412 (line 14 column 3)",inbox:fatal,marketplace:"fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com",share:"ENOENT: no such file or directory, scandir '~/.terum/skills/teams/terum/people'",skill:(ref:string)=>`ENOENT: no such file or directory, open '~/.claude/skills/${ref}/SKILL.md'`,onboarding:design.ONBOARD_FETCH_ERROR.replaceAll("&#39;", "'")};
const ok=<T>(value:T):Result<T>=>({ok:true,value});
const fail=(error:string):Result<never>=>({ok:false,error:abbreviateHome(decodeText(error),'')});
export function createMockBackend(opts:{latencyMs?:number}={}):Backend {
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
 const backend:Backend = {
  async setWindowBackground(){return ok(undefined);},
  async launchContext(){return null;},
  async refreshLaunch(){return null;},
  onLaunchRequest(){return ()=>{};},
  async features(){return Object.fromEntries(FEATURE_KEYS.map(key=>[key,true])) as Features;},
  async windowAction(){return ok(undefined);},
  async openUrl(url){try{window.open(url,'_blank','noopener');return ok(undefined);}catch(error){return fail(error instanceof Error?error.message:String(error));}},
  async revealPath(){return ok(undefined);},
  async capabilities(){return {appVersion:design.APP_VERSION,windowChrome:'cosmetic',disablePerMachine:true,inboxEventLog:true,offtargetKind:true,machineRegistry:true,perCaseEvalTables:true,openInEditor:true,clipboard:true};},
  async surfaces(){return {status:true,settings:true,onboarding:true,library:true,skill:true,receipts:true,inbox:true,catalog:true,roster:true,update:true};},
  async status(){return structuredClone(ok({machine:{...design.MACHINE,hostname:design.MACHINE.name},me:identity,teams:readScenario()==='no-team'?[]:mockTeams(),tools:{git:true,gh:true},projects:sidebarProjects(),counts:statusCounts(location.hash,readScenario())}));},
  settings:()=>read('settings',()=>ok({MACHINE:{...design.MACHINE,hostname:design.MACHINE.name},ME:identity,TEAMS:mockTeams(),TEAM_POLICY:{...design.TEAM_POLICY,categories:design.CATEGORIES.map(([name])=>name),projects:design.PROJECTS.map(project=>project.name),categoriesNote:'From SKILL.md frontmatter; the list is admin-extendable.'},tools:{git:true,gh:true},syncNote:null,PLACEMENTS:design.PLACEMENTS,PLACEMENTS_N:design.PLACEMENTS_N,PINNED_N:design.PINNED_N,APPROVALS:design.APPROVALS,QUARANTINE:design.QUARANTINE,SHARED:design.SHARED,LOCAL_UNSHARED:design.LOCAL_UNSHARED,HOOK:design.HOOK,APP_VERSION:design.APP_VERSION,AGENT_CLI:design.AGENT_CLI,AGENT_CLI_AUTH:'signed-in',COMMUNITY:design.COMMUNITY,STORAGE:design.STORAGE,SETTINGS_NAV:design.SETTINGS_NAV,SHORTCUTS:design.SHORTCUTS,INBOX_KIND_TEXT:design.INBOX_KIND_TEXT,THEME_OPTIONS:design.THEME_OPTIONS,CLI_VERSION:design.CLI_VERSION,CLI_LATEST:design.CLI_LATEST,FOLLOWING:design.FOLLOWING,SHARED_SPECIMEN:design.SHARED_SPECIMEN})),
  onboarding:async()=>{const result=await read('onboarding',()=>ok(onboardingData()));return result.ok?result:{...result,value:onboardingData()};},
  library:({scope})=>read('library',scenario=>{if(scenario==='no-team')return {ok:false,error:'No team is configured on this machine.',reason:'no-team'};const scopes:Record<string,readonly string[]>=design.LIST_OF;const canonical=['Global','Terum','SSM','MRF'].find(s=>s.toLowerCase()===scope.toLowerCase())??scope;const skills=scenario==='empty'?[]:canonical==='Global'?design.SKILLS:design.SKILLS.filter(skill=>skill.project!=='local'&&scopes[skill.name]?.includes(canonical));return ok({skills:skills.map(s=>({...cardOf(s),enabled:backend.prefs.get('enabled:'+s.name,s.enabled??true),favorite:backend.prefs.get('favorite:'+s.name,s.favorite??false)})),overview:design.LIBRARY_OVERVIEW,title:scenario==='empty'?'0 skills':`${skills.length} of ${library_title(canonical)}`});}),
  skill:({ref})=>read('skill',scenario=>{if(scenario==='not-installed'&&ref==='deploy-check')return ok(detailOf(design.DETAIL_NOT_INSTALLED));const result=skillByRef(ref);return result.ok?ok({...result.value,enabled:scenario==='disabled'?false:backend.prefs.get('enabled:'+ref,result.value.enabled),favorite:backend.prefs.get('favorite:'+ref,result.value.favorite)}):result;},ref),
  receipts:({skillId,version})=>read('library',()=>{const detail=skillByRef(skillId);if(!detail.ok)return fail(detail.error);return ok(detail.value.version===version?detail.value.receipt??null:null);}),
  inbox:()=>read('inbox',scenario=>ok(scenario==='empty'?[]:inboxItems())),
  catalog:(query)=>read('marketplace',()=>{const catalog=catalogData();catalog.people=catalog.people.map(person=>person.handle===design.ME.handle?{...person,...profileValues,teamsLine:profileValues.projects?.join(' · ')??person.teamsLine,declined:[...declined]}:person);return ok({...catalog,skills:catalog.skills.filter(s=>!query?.q||(s.name+' '+s.desc).toLowerCase().includes(query.q.toLowerCase()))});}),
  roster:()=>read('share',scenario=>{const all=roster();return ok(scenario==='empty'?{byAdoption:all.byAdoption.filter(h=>h===design.ME.handle),members:all.members.filter(m=>m.handle===design.ME.handle),invited:[],member:Object.fromEntries(Object.entries(all.member).filter(([h])=>h===design.ME.handle))}:all);}),
  search:args=>read('marketplace',()=>{const hits:SearchHit[]=[...design.CATALOG.map(s=>({kind:'skill' as const,ref:s.name,name:s.name,description:s.desc})),...design.PEOPLE.map(p=>({kind:'member' as const,ref:p.handle,name:p.name,description:p.role})),...design.PROJECTS.map(p=>({kind:'project' as const,ref:p.key,name:p.name,description:p.desc}))].map(hit=>({...hit,team:null,category:null,author:null,installs:null,latest:null,endorsed:null,unresolved:null}));return ok(hits.filter(h=>(!args.kinds||args.kinds.includes(h.kind))&&(h.name+' '+h.description).toLowerCase().includes(args.q.toLowerCase())));}),
  install:args=>long('library',async ctx=>{ctx.print(`Installing ${args.ref}…`);if(!args.ref.trim())return fail('A ref is required.');const detail=skillByRef(args.ref);if((args.kind??'skill')==='skill'&&!detail.ok)return fail(detail.error);if(!await ctx.ask('confirm',`Approve these tools for ${args.ref}?`))return cancelled('Install was declined.');ctx.progress(1,1,'Installed');return ok([{id:args.ref,name:args.ref,scope:args.scope??'Global'}]);}),
  uninstallSkill:args=>long('library',async ctx=>{const skill=skillByRef(args.ref);if(!skill.ok)return fail(skill.error);ctx.print(`Removing ${args.ref}…`);if(!await ctx.ask('confirm',`Remove ${args.ref}?`))return cancelled('Remove was declined.');return ok([{id:args.ref,name:args.ref}]);}),
  setIdentity:args=>long('settings',async ctx=>{
   const fields=[['name','name',args.name,z.string().min(1)],['email','email',args.email,z.email()],['default-handle','default_handle',args.defaultHandle,z.string().transform(value=>value.trim().toLowerCase()).pipe(z.string().min(1).max(39).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))]] as const;
   const next={...identity};const updated:{key:string;value:string}[]=[];
   for(const [key,field,value,schema] of fields){if(value===undefined)continue;const parsed=schema.safeParse(value);if(!parsed.success)return fail(`Invalid ${key}: ${parsed.error.issues.map(issue=>issue.message).join('; ')}`);next[field]=parsed.data;updated.push({key,value:parsed.data});}
   if(!updated.length)return fail('Use --set <key>=<value>. Accepted keys: name, email, default-handle.');
   const notice=`This changes the author line (${next.name} <${next.email}>) that the next sync writes into the skills you have connected on this machine; skills you authored elsewhere keep their recorded author.`;
   ctx.print(notice);Object.assign(identity,next);for(const listener of listeners)listener('config');return ok({updated,notice});
  }),
  uninstallMachine:()=>long('settings',async ctx=>{ctx.print('Removing terum-skills…');return await ctx.ask('confirm','Remove terum-skills from this machine?')?ok({removed:design.SKILLS.map(s=>s.name)}):cancelled('Remove was declined.');}),
  connect:args=>long<ConnectOutcome|undefined>('share',async ctx=>{ctx.print('Connecting local skills…');if(Object.values(args).some(v=>v!==undefined)){const name=(args.path??design.LOCAL_UNSHARED[0]??'local-skill').replace(/\/$/,'').split('/').pop();if(!name)return fail('A skill folder is required.');return await ctx.ask('confirm',`Connect ${name}?`)?ok({id:name,name}):cancelled('Connect was declined.');}return connectPicker(ctx,design.TEAMS[0]?.key??'terum');}),
  profile:args=>long('share',async()=>{
    if(args.role!==undefined&&args.role.length>32)return fail('Role must be at most 32 characters.');
    if(args.name==='')return fail('Name must not be empty.');
    for(const project of args.projects??[])if(!design.PROJECTS.some(row=>row.key===project||row.name===project))return fail(`Unknown project ${project}.`);
    const current:Record<string,unknown>={name:design.ME.name,bio:'',role:design.ROSTER.find(person=>person.handle===design.ME.handle)?.role??'',projects:design.MEMBER[design.ME.handle]?.[1]??[],...profileValues};
    const changed=Object.entries(args).filter(([key,value])=>value!==undefined&&JSON.stringify(value)!==JSON.stringify(current[key])).map(([key])=>key==='name'?'display_name':key);
    Object.assign(profileValues,args);return ok({handle:design.ME.handle,changed});
  }),
  decline:args=>long('share',async()=>{const ref=args.ref.split('/').at(-1)??'';const catalog=catalogData(),skill=[...catalog.skills,...catalog.extras].find(row=>row.name===ref);if(!skill)return fail(`No skill named ${ref}.`);if(skill.installed)return fail(`${ref} is installed; run uninstall-skill first.`);declined.add(ref);return ok({id:ref});}),
  publish:args=>long('share',async ctx=>{const skill=skillByRef(args.ref);if(!skill.ok)return fail(skill.error);ctx.print(`Publishing ${args.ref}…`);return ok({name:args.ref,version:skill.value.version??design.DETAIL.version,changed:true});}),
  sync:args=>long('onboarding',async ctx=>{ctx.print('Syncing team skills…');const names=design.QUARANTINE.map(q=>q[1]??'');if(args.prune&&!await ctx.ask('confirm',`Delete ${names.length} quarantined item(s)?`)){ctx.print('Prune cancelled; nothing deleted.');return ok({placed:[],removed:[]});}return ok({placed:design.SKILLS.map(s=>s.name),removed:args.prune?names:[]});}),
  invite:args=>long('share',async ctx=>{if(!args.logins.length||args.logins.some(login=>!login.trim()))return fail('At least one GitHub login is required.');ctx.print(`Inviting ${args.logins.join(', ')}…`);return ok({invited:[...args.logins]});}),
  team:args=>long('share',async ctx=>{const name=args.team??args.name??design.TEAMS[0]?.name??'Terum';ctx.print(`${args.kind}: ${name}`);if(args.kind==='leave'&&!await ctx.ask('confirm',`Leave ${name}? This removes ${design.PLACEMENTS_N} placed skill(s) from this machine.`))return cancelled('Leave was declined.');return ok({name,kind:args.kind});}),
  setup:args=>long('share',async ctx=>{ctx.print('Setting up terum-skills…');const choice=await ctx.ask('select','Create a team or join one?',{choices:['Create a new team','Join an existing team']});const role=choice==='Create a new team'?'creator' as const:'joiner' as const;const team=args.target??design.TEAM_REPO;if(args.offerConnect!==false){const connected=await connectPicker(ctx,team);if(!connected.ok)return fail(connected.error);return ok({team,role,connected:connected.value});}return ok({team,role});}),
  eval:args=>long('library',async ctx=>{const detail=skillByRef(args.ref);if(!detail.ok)return fail(detail.error);ctx.print(`Evaluating ${args.ref}…`);ctx.progress(1,1,'Complete');return ok({name:args.ref,receipt:detail.value.receipt??null});}),
  validate:args=>read('library',()=>{const name=args.ref??design.DETAIL.name;const detail=skillByRef(name);return detail.ok?ok({name,findings:0,warnings:0}):fail(detail.error);}),
  update:()=>read('settings',()=>ok({running:design.CLI_VERSION,latest:design.CLI_LATEST,observation:'newer',launch:'npx',description:`${design.CLI_VERSION} installed · ${design.CLI_LATEST} available`,advice:updateAdvice,lines:[`terum-skills ${design.CLI_VERSION}`,`Latest advertised release: ${design.CLI_LATEST}`,...updateAdvice]})),
  async openInEditor(path){return path.trim()?ok(undefined):fail('An editor path is required.');},
  async copyToClipboard(text){try{if(!navigator.clipboard?.writeText)return fail('Clipboard unavailable.');await navigator.clipboard.writeText(text);return ok(undefined);}catch(error){return fail(error instanceof Error?error.message:'Clipboard unavailable.');}},
  async copyImage(png){try{if(png.type!=='image/png')return fail('Expected a PNG image.');if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')return fail('Clipboard unavailable.');await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);return ok(undefined);}catch(error){return fail(error instanceof Error?error.message:'Clipboard unavailable.');}},
  prefs:browserPrefs(),
  subscribe:listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}
 };
 return backend;
}

function sidebarProjects(){return Object.keys(design.COUNTS).filter(key=>!['Global','Pushes','Updates','Alerts'].includes(key));}
function mockTeams(){return design.TEAMS.map(team=>({...team,policy:design.TEAM_POLICY,categories:design.CATEGORIES.map(([name])=>name),pending:[],joinCommand:null,joinBlock:null}));}
