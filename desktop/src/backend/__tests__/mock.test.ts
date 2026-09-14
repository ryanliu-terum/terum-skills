import { it, expect, afterEach, vi } from 'vitest';
import { createMockBackend, resetMockRemovals, MOCK_REMOVE_DETAIL, MOCK_REMOVE_ADVICE } from '../mock';
import { design } from '../mock/data';
import type { Run, Frame } from '../types';
afterEach(()=>{location.hash='';localStorage.clear();vi.useRealTimers();vi.restoreAllMocks();resetMockRemovals();});
async function answerAll<T>(run:Run<T>,answer:(frame:Extract<Frame,{t:'ask'}>)=>string|boolean){for await(const frame of run.frames){if(frame.t==='ask')run.answer(frame.id,answer(frame));}return run.done;}
it('advertises all mock capabilities and reads current scenarios on every call',async()=>{const b=createMockBackend();expect(await b.capabilities()).toEqual({appVersion:design.APP_VERSION,windowChrome:'cosmetic',disablePerMachine:true,inboxEventLog:true,offtargetKind:true,machineRegistry:true,perCaseEvalTables:true,openInEditor:true,clipboard:true});expect(await b.surfaces()).toEqual({divergence:true,status:true,settings:true,onboarding:true,library:true,skill:true,receipts:true,inbox:true,catalog:true,roster:true,update:true,libraryProjects:false,appUpdate:false});expect((await b.library({scope:{kind:'global'}})).ok).toBe(true);location.hash='#/library/global?__mock=empty';const emptyLibrary=await b.library({scope:{kind:'global'}});expect(emptyLibrary.ok&&emptyLibrary.value.skills).toEqual([]);expect(emptyLibrary.ok&&emptyLibrary.value.title).toBe('0 skills');const status=await b.status();expect(status.ok&&status.value.counts.Global).toBe('0');expect(await b.inbox()).toEqual({ok:true,value:[]});const roster=await b.roster();expect(roster.ok&&roster.value.members.map(m=>m.handle)).toEqual(['teddy']);});
it.each([
 ['library',"EACCES: permission denied, scandir '~/.terum/skills'"],
 ['skill',"ENOENT: no such file or directory, open '~/.claude/skills/deploy-check/SKILL.md'"],
 ['inbox',"Skipping terum: could not fetch https://github.com/terum/team-skills.git: fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com"],
 ['marketplace',"fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com"],
 ['share',"ENOENT: no such file or directory, scandir '~/.terum/skills/teams/terum/people'"],
 ['settings',"Invalid ~/.terum/skills/config.json: Expected property name or '}' in JSON at position 412 (line 14 column 3)"],
 ['onboarding',"Skipping terum: could not fetch https://github.com/terum/team-skills.git: fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com"],
] as const)('returns the exact %s board error',async(family,error)=>{
 const b=createMockBackend();const onboarding=await b.onboarding();
 location.hash='#/frame?__mock=error';
 const reads={library:()=>b.library({scope:{kind:'global'}}),skill:()=>b.skill({ref:'deploy-check'}),inbox:()=>b.inbox(),marketplace:()=>b.catalog(),share:()=>b.roster(),settings:()=>b.settings(),onboarding:()=>b.onboarding()};
 expect(await reads[family]()).toEqual({ok:false,error,...(family==='settings'?{reason:'invalid-config'}:{}),...(family==='onboarding'&&onboarding.ok?{value:onboarding.value}:{})});
 if(family==='marketplace')expect(await b.search({q:'deploy'})).toEqual({ok:false,error});
 if(family==='settings')expect(await b.update()).toEqual({ok:false,error});
 if(family==='onboarding')expect(await b.sync({}).done).toEqual({ok:false,error});
 if(family==='skill')expect(await b.skill({ref:'migration-guard'})).toEqual({ok:false,error:"ENOENT: no such file or directory, open '~/.claude/skills/migration-guard/SKILL.md'"});
});
it('returns disabled and not-installed details without changing fixture data',async()=>{const b=createMockBackend();location.hash='#/skill/deploy-check?__mock=disabled';const off=await b.skill({ref:'deploy-check'});expect(off.ok).toBe(true);if(!off.ok)throw new Error(off.error);expect(off.value.enabled).toBe(false);location.hash='#/skill/deploy-check?__mock=not-installed';const absent=await b.skill({ref:'deploy-check'});expect(absent.ok&&absent.value.root).toBe('Marketplace');expect(absent.ok&&absent.value.installed).toBe('absent');});
it('keeps a catalog-only skill detail consistent with its marketplace card: not installed, not placed',async()=>{const b=createMockBackend();location.hash='#/skill/a11y-audit?root=marketplace';const detail=await b.skill({ref:'a11y-audit'});expect(detail.ok).toBe(true);if(!detail.ok)throw new Error(detail.error);expect(detail.value).toMatchObject({installed:'absent',placed:false});const catalog=await b.catalog();expect(catalog.value?.skills.find(s=>s.name==='a11y-audit')).toMatchObject({installed:'absent'});});
it('treats any requested skill as not installed under the not-installed scenario',async()=>{const b=createMockBackend();location.hash='#/skill/a11y-audit?__mock=not-installed&dialog=install&root=marketplace';const absent=await b.skill({ref:'a11y-audit'});expect(absent.ok).toBe(true);if(!absent.ok)throw new Error(absent.error);expect(absent.value).toMatchObject({name:'a11y-audit',installed:'absent',placed:false,onDiskOnly:false,root:'Marketplace',flags:[]});location.hash='#/skill/a11y-audit';const catalogOnly=await b.skill({ref:'a11y-audit'});expect(catalogOnly.ok&&catalogOnly.value.installed).toBe('absent');location.hash='#/skill/deploy-check';const present=await b.skill({ref:'deploy-check'});expect(present.ok&&present.value.installed).toBe('placed');});
it('honours latency, slow, and deliberately pending loading reads',async()=>{vi.useFakeTimers();const b=createMockBackend({latencyMs:50});const resolved=vi.fn();void b.inbox().then(resolved);await vi.advanceTimersByTimeAsync(49);expect(resolved).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(resolved).toHaveBeenCalledOnce();location.hash='#/inbox?__mock=slow';const slow=vi.fn();void b.inbox().then(slow);await vi.advanceTimersByTimeAsync(1999);expect(slow).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(slow).toHaveBeenCalledOnce();location.hash='#/inbox?__mock=loading';const loading=vi.fn();void b.inbox().then(loading);await vi.advanceTimersByTimeAsync(10000);expect(loading).not.toHaveBeenCalled();});
it('marks declines for install, removal and team leave',async()=>{const b=createMockBackend();for(const run of [b.install({ref:'deploy-check'}),b.uninstallSkill({ref:'deploy-check'}),b.uninstallMachine({}),b.team({kind:'leave'})]){expect(await answerAll<unknown>(run,()=>false)).toMatchObject({ok:false,cancelled:true});}});
it('returns fixture-shaped results for successful verbs',async()=>{const b=createMockBackend();expect((await answerAll(b.install({ref:'deploy-check',scope:'Terum'}),()=>true))).toEqual({ok:true,value:[{id:'deploy-check',name:'deploy-check',scope:'Terum',path:'skills/deploy-check',version:null,profiled:false}]});expect((await b.invite({logins:['sam']}).done)).toEqual({ok:true,value:{invited:['sam'],already:[],failed:[]}});expect((await b.publish({ref:'deploy-check'}).done).ok).toBe(true);expect((await b.eval({ref:'deploy-check'}).done).ok).toBe(true);expect(await b.validate({ref:'deploy-check'})).toEqual({ok:true,value:{name:'deploy-check',findings:0,warnings:0,repairable:0,repairs:[]}});expect((await answerAll(b.setup({}),frame=>frame.kind==='confirm'?false:frame.question.startsWith('Evaluate the ')?'Overnight':'Join an existing team')).ok).toBe(true);});
it('handles unknown refs, invalid preferences, storage corruption and unavailable clipboard',async()=>{const b=createMockBackend();expect((await b.install({ref:'missing'}).done).ok).toBe(false);b.prefs.set('theme','light');expect(b.prefs.get('theme','dark')).toBe('light');localStorage.setItem('terum-skills-app:pref:bad','{broken');expect(b.prefs.get('bad',42)).toBe(42);expect(()=>b.prefs.set('bad',undefined)).toThrow();expect(()=>b.prefs.set('bad',NaN)).toThrow();expect(await b.copyToClipboard('text')).toEqual({ok:false,error:'Clipboard unavailable.'});expect(await b.copyImage(new Blob(['x'],{type:'text/plain'}))).toEqual({ok:false,error:'Expected a PNG image.'});});

it('filters project scopes and isolates returned data from the source fixtures',async()=>{const b=createMockBackend();const mrf=await b.library({scope:{kind:'checkout',root:'/Users/you/code/mrf'}});expect(mrf.ok&&mrf.value.skills.every(s=>['migration-guard','csv-profiler'].includes(s.name))).toBe(true);expect(mrf.ok&&mrf.value.skills.length).toBeGreaterThan(0);const first=await b.library({scope:{kind:'global'}});if(!first.ok)throw new Error(first.error);const n=first.value.skills.length;first.value.skills.pop();const next=await b.library({scope:{kind:'global'}});expect(next.ok&&next.value.skills.length).toBe(n);});

const expectedMachine={...design.MACHINE,hostname:design.MACHINE.name};
const expectedMe={...design.ME,initials:'TZ',footerLabel:design.MACHINE.gh_login};
const expectedTeams=design.TEAMS.map(team=>({...team,policy:design.TEAM_POLICY,categories:design.CATEGORIES.map(([name])=>name),pending:[],joinCommand:'npx -y terum-skills@latest setup '+design.TEAM_REPO,joinBlock:['Send this to your teammate:','```','npm install -g terum-skills','npx -y terum-skills@latest setup '+design.TEAM_REPO,'','Bare equivalent: npx -y terum-skills@latest team join '+design.TEAM_REPO,'```','If you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.']}));
it.each(['loading','error','slow','disabled','not-installed','default'])('status resolves immediately with identity during %s',async scenario=>{
 location.hash='#/library/global?__mock='+scenario;vi.useFakeTimers();
 const status=await createMockBackend({latencyMs:500}).status();
 expect(status).toEqual({ok:true,value:{machine:expectedMachine,me:expectedMe,teams:expectedTeams,counts:design.COUNTS,tools:{git:true,gh:true},roots:[{id:'global',kind:'global',label:'Global',root:'~/.claude/skills',rootState:'scanned',registered:false,count:design.COUNTS.Global,remote:null},...([['Terum','ryanliu-terum/terum-skills'],['SSM','ryanliu-terum/ssm'],['MRF',null]] as const).map(([name,slug])=>({id:'/Users/you/code/'+name.toLowerCase(),kind:'checkout',label:name,root:'/Users/you/code/'+name.toLowerCase(),rootState:'scanned',registered:true,count:design.COUNTS[name],remote:slug===null?null:{url:'https://github.com/'+slug,slug}}))]}});
 expect(status.ok&&status.value.machine.gh_login).toBe('teniroo');
 expect(vi.getTimerCount()).toBe(0);
});
it('clones status and successful long results',async()=>{
 const b=createMockBackend();const first=await b.eval({ref:'deploy-check'}).done;
 if(!first.ok)throw new Error('Expected eval');
 Reflect.set(first.value,'runDir','mutated');
 const next=await b.eval({ref:'deploy-check'}).done;
 expect(next.ok&&next.value.runDir).toBe('~/.terum/skills/evals/local/0000000000000000000000000000000000000000000000000000000000000000/20260906T120000Z');
 const status=await b.status();if(!status.ok)throw new Error(status.error);status.value.machine.gh_login='mutated';
 const fresh=await b.status();expect(fresh.ok&&fresh.value.machine.gh_login).toBe('teniroo');
});
it('returns isolated Settings DTO additions while preserving drawn fixture constants',async()=>{
 const b=createMockBackend();const settings=await b.settings();const onboarding=await b.onboarding();
 expect(settings.ok).toBe(true);expect(onboarding.ok).toBe(true);
 if(!settings.ok||!onboarding.ok)throw new Error('Expected fixture reads');
 const additions={AGENT_CLI_AUTH:'signed-in',MACHINE:expectedMachine,ME:expectedMe,TEAMS:expectedTeams,TEAM_POLICY:{...design.TEAM_POLICY,categories:design.CATEGORIES.map(([name])=>name),projects:design.PROJECTS.map(project=>project.name),categoriesNote:'From SKILL.md frontmatter; the list is admin-extendable.'},tools:{git:true,gh:true},syncNote:null,lastAutomatic:null};
 for(const [key,value] of Object.entries(settings.value))expect(value).toEqual(Object.hasOwn(additions,key)?Reflect.get(additions,key):Reflect.get(design,key));
 for(const key of ['ONBOARD_STEPS','ONBOARD_BASICS','GLOBAL_SET','BOOT_STEPS','ONBOARD_LATER','ONBOARD_COMMUNITY','ONBOARD_FETCH_ERROR','WELCOME_LINES','BASICS_COPY','BASICS_HINT','THEME_OPTIONS','LIBRARY_OVERVIEW','INVITEE','TEAM_REPO','INVITE_TIP','JOIN_BLOCK_NOTE'])expect(Reflect.get(onboarding.value,key)).toEqual(Reflect.get(design,key));
 expect(onboarding.value.skill.name).toBe(design.SKILLS[0]?.name);expect(onboarding.value.summary?.lift).toBe(44);expect(onboarding.value.arm).toEqual(design.DETAIL.receipt?.arm);expect(onboarding.value.rosterInitials).toEqual(design.ROSTER.map(q=>q.initials));expect(onboarding.value.bootRows).toHaveLength(5);expect(onboarding.value.failedBootRows[1]?.[0]).toBe('failed');
 expect(settings.value.SETTINGS_NAV).toEqual(design.SETTINGS_NAV);expect(onboarding.value.ONBOARD_STEPS).toEqual(design.ONBOARD_STEPS);
 settings.value.TEAMS.pop();onboarding.value.ONBOARD_STEPS.pop();
 const nextSettings=await b.settings();const nextOnboarding=await b.onboarding();
 expect(nextSettings.ok&&nextSettings.value.TEAMS).toEqual(expectedTeams);
 expect(nextOnboarding.ok&&nextOnboarding.value.ONBOARD_STEPS).toEqual(design.ONBOARD_STEPS);
});


it('reads skill refs from the configured remote, never project membership (CP-34/CP-44)',async()=>{
 const b=createMockBackend();const partial=await b.skill({ref:'migration-guard'});if(!partial.ok)throw new Error(partial.error);
 expect(partial.value.project).toBe('mrf');
 expect(partial.value.skillRef).toBe('terum/team-skills/migration-guard');
 expect(partial.value.shareCommand).toContain('install terum/team-skills/migration-guard@');
 const inbox=await b.inbox();if(!inbox.ok)throw new Error(inbox.error);
 expect(inbox.value.find(it=>it.name==='secret-scan')?.category).toBe('security');
 for(const item of inbox.value)expect(item.skillRef).toBe(`${item.repo||design.TEAM_REPO}/${item.name}`);
});


it('writes identity in memory, returns the CLI shape and notifies only config',async()=>{
 const b=createMockBackend();const listener=vi.fn();b.subscribe(listener);
 const notice='This changes the author line (Ryan Liu <ryan@example.com>) that the next sync writes into the skills you have connected on this machine; skills you authored elsewhere keep their recorded author.';
 expect(await b.setIdentity({name:'Ryan Liu',email:'ryan@example.com',defaultHandle:' Ryan '}).done).toEqual({ok:true,value:{updated:[{key:'name',value:'Ryan Liu'},{key:'email',value:'ryan@example.com'},{key:'default-handle',value:'ryan'}],notice}});
 const settings=await b.settings();if(!settings.ok)throw new Error(settings.error);
 expect(settings.value.ME).toEqual({...design.ME,initials:'TZ',footerLabel:design.MACHINE.gh_login,name:'Ryan Liu',email:'ryan@example.com',default_handle:'ryan'});
 const status=await b.status();if(!status.ok)throw new Error(status.error);expect(status.value.me).toEqual(settings.value.ME);
 expect(listener.mock.calls).toEqual([['config']]);expect(localStorage.length).toBe(0);
 expect((await createMockBackend().status()).value?.me).toEqual({...design.ME,initials:'TZ',footerLabel:design.MACHINE.gh_login});
});
it('rejects invalid mock identity atomically',async()=>{
 const b=createMockBackend();const before=await b.settings();const listener=vi.fn();b.subscribe(listener);
 expect((await b.setIdentity({name:'Changed',email:''}).done).ok).toBe(false);
 expect(await b.settings()).toEqual(before);expect(listener).not.toHaveBeenCalled();
});
it('returns CLI fixture versions and the complete update report', async () => {
  const advice = ['Cache request recorded as: terum-skills@latest', "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'];
  expect(await createMockBackend().update()).toEqual({ ok: true, value: { running: design.CLI_VERSION, latest: design.CLI_LATEST, observation: 'newer', launch: 'npx', description: `${design.CLI_VERSION} installed · ${design.CLI_LATEST} available`, advice, lines: [`terum-skills ${design.CLI_VERSION}`, `Latest advertised release: ${design.CLI_LATEST}`, ...advice] } });
});
it('keeps a declined prune on the cancellation path and emits the CLI line', async()=>{
 const run=createMockBackend().prune();
 expect(await answerAll(run,()=>false)).toEqual({ok:false,error:'Prune was cancelled.',cancelled:true});
 const frames=[];for await(const frame of run.frames)frames.push(frame);
 expect(frames).toContainEqual({t:'print',line:'Prune cancelled; nothing deleted.'});
 expect(frames.at(-1)).toEqual({t:'result',ok:false,error:'Prune was cancelled.',declined:true});
});
it('has no launch target in the mock',async()=>{expect(await createMockBackend().launchContext()).toBeNull();});

it('accepts only local editor paths, never CLI commands',async()=>{
 const backend=createMockBackend();
 expect(await backend.openInEditor('npx -y terum-skills@latest status')).toEqual({ok:false,error:'An editor path is required.'});
 for(const path of ['~/.claude/skills/x','/abs','~'])expect(await backend.openInEditor(path)).toEqual({ok:true,value:undefined});
});
it('prints diagnostics from the fixture and reports status read failures',async()=>{
 const backend=createMockBackend(),run=backend.diagnostics(),lines:string[]=[];
 for await(const frame of run.frames)if(frame.t==='print')lines.push(frame.line);
 expect(await run.done).toEqual({ok:true,value:undefined});
 expect(lines).toHaveLength(design.TEAMS.length+1);expect(lines[0]).toContain(design.CLI_VERSION);
 for(const [index,team] of design.TEAMS.entries())for(const fact of [team.name,team.remote,team.handle,String(team.members),String(team.skills),team.last_sync])expect(lines[index+1]).toContain(fact);
 location.hash='#/settings/advanced?__mock=error';
 expect(await backend.diagnostics().done).toEqual({ok:false,error:'Could not read ~/.terum/skills/config.json.'});
});


it.each([false,true])('models machine removal with CLI consent and team keys (accept=%s)',async accepted=>{
 const run=createMockBackend().uninstallMachine({});
 const ask=vi.fn((frame:Extract<Frame,{t:'ask'}>)=>{expect(frame).toMatchObject({kind:'confirm',question:'Remove terum-skills from this machine?',detail:MOCK_REMOVE_DETAIL});return accepted;});
 const result=await answerAll(run,ask);expect(ask).toHaveBeenCalledOnce();
 if(accepted)expect(result).toEqual({ok:true,value:{removed:design.TEAMS.map(t=>t.key),removedPlacements:design.PLACEMENTS_N,hookRemoved:true,wrapperRemoved:true,configRemoved:true,kept:['~/.terum/skills/backups'],record:'~/.terum/skills/backups/uninstall.2026-09-09T12-00-00-000Z.json',advice:MOCK_REMOVE_ADVICE}});
 else expect(result).toEqual({ok:false,cancelled:true,error:'Uninstall was cancelled.'});
});
it('flips the fixture installed state after a successful install and notifies placed',async()=>{
 const b=createMockBackend();const listener=vi.fn();b.subscribe(listener);
 const before=await b.catalog();if(!before.ok)throw new Error(before.error);
 expect(before.value.skills.find(s=>s.name==='a11y-audit')?.installed).toBe('absent');
 expect(await answerAll(b.install({ref:'a11y-audit'}),()=>true)).toMatchObject({ok:true});
 expect(listener.mock.calls).toContainEqual(['placed']);
 const after=await b.catalog();if(!after.ok)throw new Error(after.error);
 expect(after.value.skills.find(s=>s.name==='a11y-audit')?.installed).toBe('placed');
 const library=await b.library({scope:{kind:'global'}});if(!library.ok)throw new Error(library.error);
 for(const skill of library.value.skills.filter(s=>s.name==='a11y-audit'))expect(skill.installed).toBe('placed');
});
it('records a mock quit request and closes the window',async()=>{
 const backend=createMockBackend(),close=vi.spyOn(window,'close').mockImplementation(()=>{});
 expect(backend.quitRequested).toBe(false);await backend.quit();
 expect(backend.quitRequested).toBe(true);expect(close).toHaveBeenCalledOnce();
});

it('returns the fetch outcome from the fixture names',async()=>{
 const b=createMockBackend();
 expect(await b.sync({team:'terum'}).done).toEqual({ok:true,value:{notices:[],changed:true,teams:[{team:'terum',state:'refreshed'}]}});
});

it('models the projects and evals questions and reports both step outcomes',async()=>{
 const b=createMockBackend();
 for(const accepted of [true,false]){
  const questions:string[]=[];
  const result=await answerAll(b.setup({}),frame=>{questions.push(frame.question);return frame.kind==='confirm'?accepted:frame.kind==='select'?(frame.question.startsWith('Evaluate the ')?accepted?'Now':'Skip':'Join an existing team'):'';});
  expect(result).toMatchObject({ok:true,value:{steps:{projects:accepted?'done':'skipped',evals:accepted?'done':'skipped'}}});
  expect(questions).toContain('Add a project?');
  expect(questions).toContain('Evaluate the 2 shared skills that have no receipt yet? This runs Claude on each one and commits each receipt to the team repo.');
  // D13: the folder question is asked only after the confirm, and it is the only follow-up.
  expect(questions.includes('Which folder?')).toBe(accepted);
 }
});

// §5.3 / D72: PublishResult has no prUrl/compareUrl/branch/policy and the mock mints no PR link. The key list is written
// out on purpose: a new field on the DTO must be added here deliberately, and a stray extra key (the old fake URL) fails.
it("returns exactly the PublishResult keys on a project publish and mints no PR link (§5.3, D72)",async()=>{
 const b=createMockBackend();const result=await b.publish({ref:"deploy-check",project:"mrf"}).done;
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(Object.keys(result.value).sort()).toEqual(["attachedEvals","created","evalAssets","identicalTo","name","profileAdded","project","projectAdded","version"]);
 expect(result.value).not.toHaveProperty("legacyPrUrl");
 expect(result.value).toMatchObject({name:"deploy-check",project:"mrf",projectAdded:true});
 // The endorsement side effect survives the deletion: catalog() still counts the skill under the project.
 const catalog=await b.catalog();if(!catalog.ok)throw new Error(catalog.error);
 expect(catalog.value.projects.find(p=>p.key==="mrf")?.skillsIn).toContain("deploy-check");
});
// D64 (2026-09-13 ledger, option A): spec §8.5's two person buckets are distinct on the demo backend — "On their
// profile" is what the person authored, "Installed" the subset the fixture marks on this machine — and
// `installable` stays the full authored list the bulk Install/Remove button and marketplace.test pin.
// §8.5 (amended 2026-09-13): ONE bucket. The second — "Installed", the on-disk subset — is gone with the
// spec that asked for it, and the surviving list is what `installable` and the header count both read,
// so a person can no longer be described by two lists that disagree.
it('fills a person\'s single profile bucket with their authored skills',async()=>{
 const catalog=await createMockBackend().catalog();if(!catalog.ok)throw new Error(catalog.error);
 const authors:Record<string,string>=design.AUTHOR_OF,authored=(handle:string)=>design.CATALOG.filter(s=>authors[s.name]===handle).map(s=>s.name);
 const ajay=catalog.value.people.find(p=>p.handle==='ajay'),lena=catalog.value.people.find(p=>p.handle==='lena');
 if(!ajay||!lena)throw new Error('Fixture roster is missing ajay or lena.');
 // ajay authored two placed skills and one (secret-scan, installed:false) not on this machine; none of
 // lena's three is placed. Neither fact splits the page any more — placement shows on the cards.
 expect(ajay.buckets).toEqual([['On their profile',['deploy-check','env-audit','secret-scan']]]);
 expect(lena.buckets).toEqual([['On their profile',['a11y-audit','storybook-sync','bundle-budget']]]);
 for(const person of [ajay,lena])expect(person.buckets[0]?.[1]).toEqual(person.installable);
 for(const person of [ajay,lena])expect(person.installable).toEqual(authored(person.handle));
});
// D65 (2026-09-13 ledger): under __mock=stale-eval, "you have Version 2" follows this session's installs and removals, not the page-load fixture flag.
it('updates the stale-eval installedVersion after a mid-session install and removal',async()=>{
 const b=createMockBackend();location.hash='#/marketplace?__mock=stale-eval';
 const versionOf=async(name:string)=>{const catalog=await b.catalog();if(!catalog.ok)throw new Error(catalog.error);const skill=catalog.value.skills.find(s=>s.name===name);if(!skill)throw new Error('No catalog skill named '+name);return [skill.installedVersion,skill.latestVersion,skill.placed] as const;};
 expect(await versionOf('a11y-audit')).toEqual([null,'v5',false]);
 expect(await versionOf('deploy-check')).toEqual(['v2','v5',true]);
 expect(await answerAll(b.install({ref:'a11y-audit'}),()=>true)).toMatchObject({ok:true});
 expect(await versionOf('a11y-audit')).toEqual(['v2','v5',true]);
 expect(await answerAll(b.uninstallSkill({ref:'deploy-check'}),()=>true)).toMatchObject({ok:true});
 expect(await versionOf('deploy-check')).toEqual([null,'v5',false]);
});
// Cross-mirror overlays spec §5 M1.7: `?__mock=overlays` puts the first five Library cards into §3.1 states 1–5 by
// position and the Marketplace's placed cards into states 3 / 3b / 2; `on-disk-only` is the Marketplace's state 4.
it('produces every overlay card state under __mock=overlays and state 4 under __mock=on-disk-only',async()=>{
 const b=createMockBackend();location.hash='#/library/global?__mock=overlays';
 const library=await b.library({scope:{kind:'global'}});if(!library.ok)throw new Error(library.error);
 expect(library.value.skills.slice(0,5).map(s=>[s.installedVersion,s.localMatch,s.placed,s.edited,s.knownToTeam])).toEqual([
  ['v3','identical',true,false,true],['v3','differs',true,true,true],[null,'differs',true,true,true],[null,'differs',false,false,true],[null,'none',false,false,false],
 ]);
 expect(library.value.skills[0]?.localEval).toMatchObject({runnerHandle:'ajayw36',version:'v3'});
 location.hash='#/marketplace?__mock=overlays';
 const catalog=await b.catalog();if(!catalog.ok)throw new Error(catalog.error);
 const placed=catalog.value.skills.filter(s=>s.placed),absent=catalog.value.skills.filter(s=>!s.placed);
 expect(placed.slice(0,3).map(s=>[s.latestVersion,s.installedVersion,s.localMatch])).toEqual([['v5','v2','differs'],['v5','v5','identical'],['v5','v2','identical']]);
 expect(absent.length).toBeGreaterThan(0);for(const s of absent)expect([s.latestVersion,s.installedVersion,s.localMatch]).toEqual(['v5',null,null]);
 location.hash='#/marketplace?__mock=on-disk-only';
 const onDisk=await b.catalog();if(!onDisk.ok)throw new Error(onDisk.error);
 expect(onDisk.value.skills.find(s=>s.name==='deploy-check')).toMatchObject({installed:'placed',placed:false,onDiskOnly:true,latestVersion:'v5',installedVersion:null,localMatch:'differs',path:'~/.claude/skills/deploy-check'});
});
