import { it, expect, afterEach, vi } from 'vitest';
import { createMockBackend, MOCK_REMOVE_DETAIL, MOCK_REMOVE_ADVICE } from '../mock';
import { design } from '../mock/data';
import type { Run, Frame } from '../types';
afterEach(()=>{location.hash='';localStorage.clear();vi.useRealTimers();vi.restoreAllMocks();});
async function answerAll<T>(run:Run<T>,answer:(frame:Extract<Frame,{t:'ask'}>)=>string|boolean){for await(const frame of run.frames){if(frame.t==='ask')run.answer(frame.id,answer(frame));}return run.done;}
it('advertises all mock capabilities and reads current scenarios on every call',async()=>{const b=createMockBackend();expect(await b.capabilities()).toEqual({appVersion:design.APP_VERSION,windowChrome:'cosmetic',disablePerMachine:true,inboxEventLog:true,offtargetKind:true,machineRegistry:true,perCaseEvalTables:true,evalCommitChoice:false,openInEditor:true,clipboard:true});expect(await b.surfaces()).toEqual({divergence:true,status:true,settings:true,onboarding:true,library:true,skill:true,receipts:true,inbox:true,catalog:true,roster:true,update:true});expect((await b.library({scope:'Global'})).ok).toBe(true);location.hash='#/library/global?__mock=empty';const emptyLibrary=await b.library({scope:'Global'});expect(emptyLibrary.ok&&emptyLibrary.value.skills).toEqual([]);expect(emptyLibrary.ok&&emptyLibrary.value.title).toBe('0 skills');const status=await b.status();expect(status.ok&&status.value.counts.Global).toBe('0');expect(await b.inbox()).toEqual({ok:true,value:[]});const roster=await b.roster();expect(roster.ok&&roster.value.members.map(m=>m.handle)).toEqual(['teddy']);});
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
 const reads={library:()=>b.library({scope:'Global'}),skill:()=>b.skill({ref:'deploy-check'}),inbox:()=>b.inbox(),marketplace:()=>b.catalog(),share:()=>b.roster(),settings:()=>b.settings(),onboarding:()=>b.onboarding()};
 expect(await reads[family]()).toEqual({ok:false,error,...(family==='onboarding'&&onboarding.ok?{value:onboarding.value}:{})});
 if(family==='marketplace')expect(await b.search({q:'deploy'})).toEqual({ok:false,error});
 if(family==='settings')expect(await b.update()).toEqual({ok:false,error});
 if(family==='onboarding')expect(await b.sync({}).done).toEqual({ok:false,error});
 if(family==='skill')expect(await b.skill({ref:'migration-guard'})).toEqual({ok:false,error:"ENOENT: no such file or directory, open '~/.claude/skills/migration-guard/SKILL.md'"});
});
it('returns disabled and not-installed details without changing fixture data',async()=>{const b=createMockBackend();location.hash='#/skill/deploy-check?__mock=disabled';const off=await b.skill({ref:'deploy-check'});expect(off.ok).toBe(true);if(!off.ok)throw new Error(off.error);expect(off.value.enabled).toBe(false);location.hash='#/skill/deploy-check?__mock=not-installed';const absent=await b.skill({ref:'deploy-check'});expect(absent.ok&&absent.value.root).toBe('Marketplace');expect(absent.ok&&absent.value.installed).toBe(false);});
it('treats any requested skill as not installed under the not-installed scenario',async()=>{const b=createMockBackend();location.hash='#/skill/a11y-audit?__mock=not-installed&dialog=install&root=marketplace';const absent=await b.skill({ref:'a11y-audit'});expect(absent.ok).toBe(true);if(!absent.ok)throw new Error(absent.error);expect(absent.value).toMatchObject({name:'a11y-audit',installed:false,placed:false,onDiskOnly:false,root:'Marketplace',flags:[]});location.hash='#/skill/a11y-audit';const present=await b.skill({ref:'a11y-audit'});expect(present.ok&&present.value.installed).toBe(true);});
it('honours latency, slow, and deliberately pending loading reads',async()=>{vi.useFakeTimers();const b=createMockBackend({latencyMs:50});const resolved=vi.fn();void b.inbox().then(resolved);await vi.advanceTimersByTimeAsync(49);expect(resolved).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(resolved).toHaveBeenCalledOnce();location.hash='#/inbox?__mock=slow';const slow=vi.fn();void b.inbox().then(slow);await vi.advanceTimersByTimeAsync(1999);expect(slow).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(slow).toHaveBeenCalledOnce();location.hash='#/inbox?__mock=loading';const loading=vi.fn();void b.inbox().then(loading);await vi.advanceTimersByTimeAsync(10000);expect(loading).not.toHaveBeenCalled();});
it('models connect selection, a declined skill, an accepted skill and Done',async()=>{const run=createMockBackend().connect({});let selected=0;const result=await answerAll(run,frame=>frame.kind==='select'?(selected++===0?'api-docs':selected===2?'handoff-note':'Done'):frame.question==='Connect handoff-note?');expect(result).toEqual({ok:true,value:{kind:'batch',shared:[{id:'handoff-note',name:'handoff-note'}],declined:['api-docs'],refused:[]}});});
it('returns the required decline for Skip and a single result for path connect',async()=>{const b=createMockBackend();expect(await answerAll(b.connect({}),()=> 'Skip')).toEqual({ok:false,error:'Connect was declined.',cancelled:true});expect(await answerAll(b.connect({path:'/skills/api-docs'}),()=>true)).toEqual({ok:true,value:{id:'api-docs',name:'api-docs'}});});
it('marks declines for install, removal and team leave',async()=>{const b=createMockBackend();for(const run of [b.install({ref:'deploy-check'}),b.uninstallSkill({ref:'deploy-check'}),b.uninstallMachine({}),b.team({kind:'leave'})]){expect(await answerAll<unknown>(run,()=>false)).toMatchObject({ok:false,cancelled:true});}});
it('returns fixture-shaped results for successful verbs',async()=>{const b=createMockBackend();expect((await answerAll(b.install({ref:'deploy-check',scope:'Terum'}),()=>true))).toEqual({ok:true,value:[{id:'deploy-check',name:'deploy-check',scope:'Terum'}]});expect((await b.invite({logins:['sam']}).done)).toEqual({ok:true,value:{invited:['sam']}});expect((await b.publish({ref:'deploy-check'}).done).ok).toBe(true);expect((await b.eval({ref:'deploy-check'}).done).ok).toBe(true);expect(await b.validate({ref:'deploy-check'})).toEqual({ok:true,value:{name:'deploy-check',findings:0,warnings:0}});expect((await answerAll(b.setup({offerConnect:false}),()=> 'Join an existing team')).ok).toBe(true);});
it('handles unknown refs, invalid preferences, storage corruption and unavailable clipboard',async()=>{const b=createMockBackend();expect((await b.install({ref:'missing'}).done).ok).toBe(false);b.prefs.set('theme','light');expect(b.prefs.get('theme','dark')).toBe('light');localStorage.setItem('terum-skills-app:pref:bad','{broken');expect(b.prefs.get('bad',42)).toBe(42);expect(()=>b.prefs.set('bad',undefined)).toThrow();expect(()=>b.prefs.set('bad',NaN)).toThrow();expect(await b.copyToClipboard('text')).toEqual({ok:false,error:'Clipboard unavailable.'});expect(await b.copyImage(new Blob(['x'],{type:'text/plain'}))).toEqual({ok:false,error:'Expected a PNG image.'});});

it('filters project scopes and isolates returned data from the source fixtures',async()=>{const b=createMockBackend();const mrf=await b.library({scope:'MRF'});expect(mrf.ok&&mrf.value.skills.every(s=>['migration-guard','csv-profiler'].includes(s.name))).toBe(true);expect(mrf.ok&&mrf.value.skills.length).toBeGreaterThan(0);const first=await b.library({scope:'Global'});if(!first.ok)throw new Error(first.error);const n=first.value.skills.length;first.value.skills.pop();const next=await b.library({scope:'Global'});expect(next.ok&&next.value.skills.length).toBe(n);});

const expectedMachine={...design.MACHINE,hostname:design.MACHINE.name};
const expectedMe={...design.ME,initials:'TZ',footerLabel:design.MACHINE.gh_login};
const expectedTeams=design.TEAMS.map(team=>({...team,policy:design.TEAM_POLICY,categories:design.CATEGORIES.map(([name])=>name),pending:[],joinCommand:null,joinBlock:null}));
it.each(['loading','error','slow','disabled','not-installed','default'])('status resolves immediately with identity during %s',async scenario=>{
 location.hash='#/library/global?__mock='+scenario;vi.useFakeTimers();
 const status=await createMockBackend({latencyMs:500}).status();
 expect(status).toEqual({ok:true,value:{machine:expectedMachine,me:expectedMe,teams:expectedTeams,counts:design.COUNTS,tools:{git:true,gh:true},projects:['Terum','SSM','MRF']}});
 expect(status.ok&&status.value.machine.gh_login).toBe('teniroo');
 expect(vi.getTimerCount()).toBe(0);
});
it('clones status and successful long results, including nested commit outcomes',async()=>{
 const b=createMockBackend();const first=await b.eval({ref:'deploy-check',commit:true}).done;
 if(!first.ok||!first.value.commit)throw new Error('Expected commit');
 const original=structuredClone(first.value.commit);
 Reflect.set(first.value.commit,'receiptPath','mutated');
 const next=await b.eval({ref:'deploy-check',commit:true}).done;
 expect(next.ok&&next.value.commit).toEqual(original);
 const status=await b.status();if(!status.ok)throw new Error(status.error);status.value.machine.gh_login='mutated';
 const fresh=await b.status();expect(fresh.ok&&fresh.value.machine.gh_login).toBe('teniroo');
});
it('returns isolated Settings DTO additions while preserving drawn fixture constants',async()=>{
 const b=createMockBackend();const settings=await b.settings();const onboarding=await b.onboarding();
 expect(settings.ok).toBe(true);expect(onboarding.ok).toBe(true);
 if(!settings.ok||!onboarding.ok)throw new Error('Expected fixture reads');
 const additions={AGENT_CLI_AUTH:'signed-in',MACHINE:expectedMachine,ME:expectedMe,TEAMS:expectedTeams,TEAM_POLICY:{...design.TEAM_POLICY,categories:design.CATEGORIES.map(([name])=>name),projects:design.PROJECTS.map(project=>project.name),categoriesNote:'From SKILL.md frontmatter; the list is admin-extendable.'},tools:{git:true,gh:true},syncNote:null};
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
it('keeps a declined prune on the success path and emits the CLI line', async()=>{
 const run=createMockBackend().sync({prune:true});
 expect(await answerAll(run,()=>false)).toEqual({ok:true,value:{placed:[],removed:[]}});
 const frames=[];for await(const frame of run.frames)frames.push(frame);
 expect(frames).toContainEqual({t:'print',line:'Prune cancelled; nothing deleted.'});
 expect(frames.at(-1)).toEqual({t:'result',ok:true});
});
it('marks a mock connect decline on both the result and the terminal frame',async()=>{
 const run=createMockBackend().connect({path:'/skills/api-docs'});
 expect(await answerAll(run,()=>false)).toEqual({ok:false,error:'Connect was declined.',cancelled:true});
 const frames=[];for await(const frame of run.frames)frames.push(frame);
 expect(frames.at(-1)).toEqual({t:'result',ok:false,error:'Connect was declined.',declined:true});
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
it('records a mock quit request and closes the window',async()=>{
 const backend=createMockBackend(),close=vi.spyOn(window,'close').mockImplementation(()=>{});
 expect(backend.quitRequested).toBe(false);await backend.quit();
 expect(backend.quitRequested).toBe(true);expect(close).toHaveBeenCalledOnce();
});
