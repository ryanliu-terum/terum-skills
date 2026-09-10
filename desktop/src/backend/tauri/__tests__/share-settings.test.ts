import { expect, it, vi } from 'vitest';
import { createTauriBackend } from '../index';
import { fakeBridge, STATE } from './fake-bridge';
import { shareSettingsReplay, type LocalValue, type StatusValue } from './share-settings-fixture';

it('serves only reported Settings, status and roster data from the 0.1.7 recordings', async () => {
 const f=shareSettingsReplay(), backend=createTauriBackend(f.bridge);
 const settings=await backend.settings();
 expect(settings.ok).toBe(true);
 expect(settings.value).toMatchObject({PLACEMENTS:[['~/.claude/skills/deploy-check','deploy-check','Global',null,'2026-09-01T00:00:00Z','edited locally · update available']],PINNED_N:0,SHARED:[['tdd','~/code/seed/skills/tdd','acme','—']],LOCAL_UNSHARED:[],HOOK:null,QUARANTINE:null,STORAGE:{cache_n:null,evals_n:null},CLI_LATEST:null,TEAM_POLICY:{projects:['terum']}});
 expect(settings.value?.SHORTCUTS).toEqual([['Search','⌘K'],['Settings','⌘,'],['Sync now','⌘R'],['Back · forward','⌘[ · ⌘]']]);
 const status=await backend.status();
 expect(status).toMatchObject({ok:true,value:{teams:[{clone:'~/.terum/skills/teams/acme',cloneState:{state:'ok',origin:'github.com/acme/team'},readable:true}]}});
 const roster=await backend.roster();
 expect(roster.ok).toBe(true);expect(roster.value?.invited).toBeNull();
 expect(roster.value?.members.map(member=>member.role)).toEqual([null,null,null]);
 expect(f.spawns.some(spawn=>spawn.args.join(' ')==='ls --team acme')).toBe(true);
});

it('lists only unplaced unconnected authoring folders, and joins shared names and presence',async()=>{
 const backend=createTauriBackend(shareSettingsReplay((frame,name)=>{
  if(frame.t!=='result'||name!=='ls-local')return;
  const value=frame.value as LocalValue, row=value.local[0]!.rows[0]!;
  value.skills.push({id:'22222222-2222-4222-8222-222222222222',name:'local-tdd',grantsHash:null,grants:null});
  value.local[0]!.rows.push({...row,name:'scratch',path:'/Users/teddy/.claude/skills/scratch',placement:null,placed:false}, {...row,name:'connected',path:'/connected',placement:null,connected:true}, {...row,name:'shared',path:'/Users/teddy/code/seed/skills/tdd',placement:null,shared:[{id:'shared',team:'acme'}],health:'local-changed'});
 }).bridge);
 expect(await backend.settings()).toMatchObject({ok:true,value:{LOCAL_UNSHARED:['scratch'],SHARED:[['shared','~/code/seed/skills/tdd','acme','Present']]}});
});

it.each([['tracked',true,false,0],['pinned',false,false,1],['missing row',true,true,1]] as const)('counts %s copies without mistaking a placed SHA for a pin',async(_name,tracked,missing,pinned)=>{
 const backend=createTauriBackend(shareSettingsReplay((frame,name)=>{
  if(frame.t==='result'&&name==='ls-local') {const value=frame.value as LocalValue;value.local[0]!.rows[0]!.tracked=tracked;if(missing)value.local[0]!.rows=[];}
 }).bridge);
 const settings=await backend.settings();expect(settings.ok).toBe(true);
 expect(settings.value?.PINNED_N).toBe(pinned);
 expect(settings.value?.PLACEMENTS[0]?.[3]).toBe(pinned?'43bf7396d9ed':null);
});

it.each([
 [{state:'absent'},{state:'absent'}],
 [{state:'foreign',origin:'github.com/other/repo'},{state:'foreign',origin:'github.com/other/repo'}],
 [{state:'incomplete',reason:'not-a-repository'},{state:'incomplete',reason:'not-a-repository'}],
 [{state:'incomplete',reason:'no-team-json',error:'missing'},{state:'incomplete',reason:'no-team-json',error:'missing'}],
 [{state:'incomplete',reason:'new-reason',error:'cannot inspect'},{state:'incomplete',reason:'unverifiable',error:'cannot inspect'}],
 [{state:'ok'},null],
])('maps clone state %j without inventing origin or reason',async(clone,expected)=>{
 const backend=createTauriBackend(shareSettingsReplay((frame,name)=>{if(frame.t==='result'&&name==='status'){const value=frame.value as StatusValue;value.teams[0]!.clone=clone!;value.teams[0]!.readable=false;}}).bridge);
 expect((await backend.status()).value?.teams[0]).toMatchObject({cloneState:expected,readable:false});
});

it.each(['ls','ls-local'])('retains partial Settings and reports a failing %s read',async(failing)=>{
 const backend=createTauriBackend(shareSettingsReplay((frame,name)=>{if(frame.t==='result'&&name===failing){Object.assign(frame,{ok:false,error:'Read denied.',exitCode:1});delete frame.value;}}).bridge);
 const settings=await backend.settings();expect(settings).toMatchObject({ok:false,error:expect.stringContaining('Read denied.'),reason:'unreadable'});
 expect(settings.value?.TEAM_POLICY.projects).toEqual(failing==='ls'?null:['terum']);
 if(failing==='ls-local')expect(settings.value?.PINNED_N).toBe(1);
});

it.each([0,2])('does not select a team inventory when %i teams are configured',async(count)=>{
 const f=shareSettingsReplay((frame,name)=>{if(frame.t==='result'&&name==='status'){const value=frame.value as StatusValue;value.teams=count===0?[]:[value.teams[0]!,{...value.teams[0]!,team:'other'}];}});
 expect((await createTauriBackend(f.bridge).settings()).value?.TEAM_POLICY.projects).toBeNull();
 expect(f.spawns.map(spawn=>spawn.args)).toEqual([['status'],['ls','--local']]);
});

it.each([['Invalid ~/.terum/skills/config.json: bad JSON','invalid-config'],['Permission denied','unreadable'],['Invalid team.json','unreadable']])('classifies status error %s',async(error,reason)=>{
 const backend=createTauriBackend(shareSettingsReplay((frame,name)=>{if(frame.t==='result'&&name==='status'){Object.assign(frame,{ok:false,error,exitCode:1});delete frame.value;}}).bridge);
 expect(await backend.settings()).toMatchObject({ok:false,reason});
});

it('round-trips sync counts, deferrals, notices, change and team outcomes',async()=>{
 const outcome={placed:2,deferred:['x'],notices:['n'],changed:true,teams:[{team:'acme',state:'skipped',message:'m'}]};
 const f=fakeBridge((_args,emit)=>emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'sync',ok:true,exitCode:0,value:{...outcome,hook:false}})}));
 expect(await createTauriBackend(f.bridge).sync({}).done).toEqual({ok:true,value:outcome});
});

it.each([['keepSource','--keep-source','id1'],['keepRepo','--keep-repo','id2'],['relocate','--relocate','id3:/a path'],['forget','--forget','id4']] as const)('passes the CLI %s string unchanged',async(key,flag,value)=>{
 const f=fakeBridge((_args,emit)=>emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'connect',ok:true,exitCode:0})}));
 expect((await createTauriBackend(f.bridge).connect({[key]:value}).done).ok).toBe(true);
 expect(f.spawns[0]?.args).toEqual(['connect',flag,value]);
});

it('expands a home path before spawning connect',async()=>{
 const f=fakeBridge((_args,emit)=>emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'connect',ok:true,exitCode:0})}));
 await createTauriBackend(f.bridge).connect({path:'~/.claude/skills/x'}).done;
 expect(f.spawns[0]?.args).toEqual(['connect','--','/Users/teddy/.claude/skills/x']);
});

it('fails connect without spawning when home expansion fails',async()=>{
 const f=fakeBridge(()=>{});f.bridge.homeDirectory=async()=>{throw new Error('Home unavailable');};
 expect(await createTauriBackend(f.bridge).connect({path:'~/x'}).done).toEqual({ok:false,error:'Could not determine the home directory.'});
 expect(f.spawns).toHaveLength(0);
});

it('cancels a pending home expansion without spawning later',async()=>{
 const f=fakeBridge(()=>{});let finish!:(home:string)=>void;f.bridge.homeDirectory=()=>new Promise(resolve=>{finish=resolve;});
 const run=createTauriBackend(f.bridge).connect({path:'~/x'});await run.cancel();finish('/Users/teddy');
 await Promise.resolve();expect(f.spawns).toHaveLength(0);expect(await run.done).toMatchObject({ok:false,error:'Cancelled.'});
});

it('recovers features after NO_STATE and a later launch refresh',async()=>{
 const f=shareSettingsReplay();f.bridge.readAppState=vi.fn().mockResolvedValueOnce(null).mockResolvedValue(STATE);
 const backend=createTauriBackend(f.bridge);expect((await backend.features()).memberRole).toBe(false);
 await backend.refreshLaunch();expect((await backend.features()).memberRole).toBe(true);
 expect((await backend.capabilities()).evalCommitChoice).toBe(true);
});
