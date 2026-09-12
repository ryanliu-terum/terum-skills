import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import type { Frame } from '../../types';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async()=>undefined)}));
const check = {mode:'check',platform:'win32-x64',supported:true,cliVersion:'0.1.10',latest:'0.1.12',latestAt:null,probe:'cached',probeError:null,staged:null,installed:[],lastApply:null,ppid:42};
const stage = {mode:'stage',version:'0.1.12',platform:'win32-x64',staged:true,notPublished:false,alreadyStaged:false,asset:'app.exe',bytes:16,path:'/app/0.1.12'};
const apply = {mode:'apply',version:'0.1.12',platform:'win32-x64',awaitPid:42,handedOff:true};
function harness(value:unknown=check,features:Record<string,boolean>={appUpdate:true}) {
 const fake=fakeBridge((args,emit)=>{
  emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,version:'0.1.10',verbs:['status','app-update'],features})});
  emit({kind:'stdout',line:JSON.stringify({t:'result',verb:args[0],ok:true,exitCode:0,value})});emit({kind:'exit',code:0});
 });
 return {...fake,backend:createTauriBackend(fake.bridge)};
}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it('sends the exact argv per mode and never --version',async()=>{
 for(const [mode,value,argv] of [['check',check,['app-update','--check']],['force',check,['app-update','--check','--force']],['stage',stage,['app-update','--stage','--release','0.1.12']],['apply',apply,['app-update','--apply','--release','0.1.12']]] as const){
  const h=harness(value);const result=mode==='check'?await h.backend.appUpdate.check():mode==='force'?await h.backend.appUpdate.check({force:true}):mode==='stage'?await h.backend.appUpdate.stage('0.1.12').done:await h.backend.appUpdate.apply('0.1.12');
  expect(result.ok).toBe(true);expect(h.spawns.map(s=>s.args)).toEqual([argv]);expect(argv).not.toContain('--version');expect(argv).not.toContain('--frames');
 }
});
it.each([
 ['0.1.12','0.1.10',true],['0.1.10','0.1.10',false],['0.1.9','0.1.10',false],[null,'0.1.10',false],['0.1.0 (build 12)','0.1.10',false],['0.1.12','0.1.0 (build 12)',false],['1.0.0-rc1','0.1.10',false],
] as const)('computes newer in the adapter: %s vs %s',async(latest,appVersion,newer)=>{
 vi.stubEnv('VITE_APP_VERSION',appVersion);const h=harness({...check,latest});expect(await h.backend.appUpdate.check()).toMatchObject({ok:true,value:{newer,appVersion}});
});
it('rejects an unknown field from the CLI rather than passing it through',async()=>{
 const h=harness({...check,unexpectedField:42});expect(await h.backend.appUpdate.check()).toMatchObject({ok:false,error:expect.stringContaining('unexpectedField')});
});
it('reports the CLI error verbatim when the driving CLI has no such verb',async()=>{
 const fake=fakeBridge((_args,emit)=>{emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'app-update',ok:false,exitCode:1,error:"error: unknown command 'app-update'"})});emit({kind:'exit',code:1});});
 expect(await createTauriBackend(fake.bridge).appUpdate.check()).toEqual({ok:false,error:"error: unknown command 'app-update'"});
});
it('surfaces appUpdate true on the real adapter and capabilities are unchanged',async()=>{
 const h=harness();expect((await h.backend.surfaces()).appUpdate).toBe(true);
 expect(await h.backend.capabilities()).toEqual({appVersion:import.meta.env.VITE_APP_VERSION,windowChrome:'mac-overlay',disablePerMachine:false,inboxEventLog:false,offtargetKind:false,machineRegistry:false,perCaseEvalTables:false,openInEditor:true,clipboard:true});
});
it('reads features.appUpdate from the hello frame and defaults a missing key to false',async()=>{
 expect((await harness(check,{appUpdate:true}).backend.features()).appUpdate).toBe(true);expect((await harness(check,{}).backend.features()).appUpdate).toBe(false);
});
it('stage is a cancellable Run whose print frames reach the caller',async()=>{
 const fake=fakeBridge((_args,emit)=>{
  for(const line of ['Downloading…','Verified.'])emit({kind:'stdout',line:JSON.stringify({t:'print',level:'info',line})});
 });
 const job=createTauriBackend(fake.bridge).appUpdate.stage('0.1.12'),frames:Frame[]=[];
 const read=(async()=>{for await(const frame of job.frames)frames.push(frame);})();
 await vi.waitFor(()=>expect(frames).toHaveLength(2));await job.cancel();await read;
 expect(frames.slice(0,2)).toEqual([{t:'print',line:'Downloading…'},{t:'print',line:'Verified.'}]);expect(fake.kills).toEqual([fake.spawns[0]!.id]);expect((await job.done).ok).toBe(false);
 const completed=harness(stage);expect(await completed.backend.appUpdate.stage('0.1.12').done).toEqual({ok:true,value:{version:'0.1.12',staged:true,notPublished:false,alreadyStaged:false}});
});
it('apply resolves to ok undefined and touches no read model',async()=>{
 const h=harness(apply),listener=vi.fn();h.backend.subscribe(listener);expect(await h.backend.appUpdate.apply('0.1.12')).toEqual({ok:true,value:undefined});expect(listener).not.toHaveBeenCalled();
});
it('maps the apply marker without its wire schema and check touches no read model',async()=>{
 const lastApply={schema:1,version:'0.1.12',phase:'failed',at:'2026-09-10T00:00:00Z',error:'install failed'};
 const h=harness({...check,lastApply}),listener=vi.fn();h.backend.subscribe(listener);
 const result=await h.backend.appUpdate.check();expect(result).toMatchObject({ok:true,value:{lastApply:{version:lastApply.version,phase:'failed',at:lastApply.at,error:lastApply.error}}});
 if(result.ok)expect(result.value.lastApply).not.toHaveProperty('schema');expect(listener).not.toHaveBeenCalled();
});
it('arms and disarms through the native command with exact payloads',async()=>{
 const h=harness();vi.mocked(invoke).mockClear();
 expect(await h.backend.appUpdate.armOnClose('0.1.12')).toEqual({ok:true,value:undefined});expect(await h.backend.appUpdate.disarmOnClose()).toEqual({ok:true,value:undefined});
 expect(vi.mocked(invoke).mock.calls).toEqual([['app_update_on_close',{version:'0.1.12'}],['app_update_on_close',{version:null}]]);expect(h.spawns).toEqual([]);
});
it('returns a recorded failure when arming fails and allows a later disarm',async()=>{
 const h=harness();vi.mocked(invoke).mockRejectedValueOnce(new Error('shell refused'));
 await expect(h.backend.appUpdate.armOnClose('0.1.12')).resolves.toEqual({ok:false,error:'shell refused'});
 await expect(h.backend.appUpdate.disarmOnClose()).resolves.toEqual({ok:true,value:undefined});
});
it('serializes arming and disarming and disarms before applying overnight',async()=>{
 const h=harness(apply);let finish!:()=>void;vi.mocked(invoke).mockClear().mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const arm=h.backend.appUpdate.armOnClose('0.1.12'),install=h.backend.appUpdate.apply('0.1.12','overnight');
 await vi.waitFor(()=>expect(invoke).toHaveBeenCalledOnce());expect(h.spawns).toEqual([]);finish();await arm;expect((await install).ok).toBe(true);
 expect(vi.mocked(invoke).mock.calls).toEqual([['app_update_on_close',{version:'0.1.12'}],['app_update_on_close',{version:null}]]);
 expect(h.spawns[0]?.args).toEqual(['app-update','--apply','--release','0.1.12','--reason','overnight']);
});
it('does not hand off a second installer if disarming fails',async()=>{
 const h=harness(apply);vi.mocked(invoke).mockRejectedValueOnce(new Error('cannot disarm'));expect(await h.backend.appUpdate.apply('0.1.12')).toEqual({ok:false,error:'cannot disarm'});expect(h.spawns).toEqual([]);
});
it.each(['on-close','overnight','manual'] as const)('maps marker reason %s to its single DTO home',async reason=>{
 const h=harness({...check,lastApply:{schema:1,version:'0.1.12',phase:'failed',at:'2026-09-10T00:00:00Z',error:'failed',reason}});
 const result=await h.backend.appUpdate.check();expect(result).toMatchObject({ok:true,value:{reason}});if(result.ok)expect(result.value.lastApply).not.toHaveProperty('reason');
});

it('sends the explicit manual reason to the CLI',async()=>{
 const h=harness(apply);expect((await h.backend.appUpdate.apply('0.1.12','manual')).ok).toBe(true);
 expect(h.spawns[0]?.args).toEqual(['app-update','--apply','--release','0.1.12','--reason','manual']);
});
it('accepts the exact native pending marker contract',async()=>{
 const h=harness({...check,lastApply:{schema:1,version:'0.12.2',phase:'waiting',at:'1970-01-01T00:00:00.000Z',error:null,reason:'on-close'}});
 expect(await h.backend.appUpdate.check()).toMatchObject({ok:true,value:{reason:'on-close',lastApply:{phase:'waiting',error:null}}});
});
