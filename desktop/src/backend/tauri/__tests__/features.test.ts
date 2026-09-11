import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { FEATURE_KEYS } from '../../types';
import { createTauriBackend } from '../index';
import { cliRun } from '../run';
import { fakeBridge, STATE } from './fake-bridge';

const recording=readFileSync('../.planning/codex-runs/m7-S7q/frames/status.jsonl','utf8').trim().split('\n');
it('reads one recorded status hello for concurrent feature/capability requests, mapping every key',async()=>{
 const f=fakeBridge((_args,emit)=>{for(const line of recording)emit({kind:'stdout',line});emit({kind:'exit',code:0});});
 const b=createTauriBackend(f.bridge);
 const [features,again,caps]=await Promise.all([b.features(),b.features(),b.capabilities()]);
 expect(features).toEqual(Object.fromEntries(FEATURE_KEYS.map(key=>[key,false])));
 expect(again).toEqual(features);expect(features.memberRole).toBe(false);
 expect(caps.perCaseEvalTables).toBe(features.perCase);expect(caps.disablePerMachine).toBe(features.disablePerMachine);
 await b.features();expect(f.spawns.map(s=>s.args)).toEqual([['status']]);
});
it('caches the last hello from any verb, including failed runs, without an extra status',async()=>{
 let enabled=false;
 const f=fakeBridge((args,emit)=>{emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,verbs:[],features:Object.fromEntries(FEATURE_KEYS.map(key=>[key,enabled]))})});emit({kind:'stdout',line:JSON.stringify({t:'result',verb:args[0],ok:false,error:'declined'})});});
 const b=createTauriBackend(f.bridge);await b.sync({}).done;
 expect(Object.values(await b.features())).toEqual(FEATURE_KEYS.map(()=>false));
 enabled=true;await b.sync({}).done;
 expect(Object.values(await b.features())).toEqual(FEATURE_KEYS.map(()=>true));
 expect(await b.capabilities()).toMatchObject({disablePerMachine:true,perCaseEvalTables:true,inboxEventLog:false,offtargetKind:false,machineRegistry:false});
 expect(f.spawns.map(s=>s.args)).toEqual([['sync'],['sync'],['sync']]);
 expect(f.spawns.filter(s=>s.args[0]==='status')).toHaveLength(0);
});
it('falls back to false when hello is missing, without repeatedly spawning status',async()=>{
 const f=fakeBridge((_args,emit)=>emit({kind:'exit',code:1}));const b=createTauriBackend(f.bridge);
 expect(Object.values(await b.features())).toEqual(FEATURE_KEYS.map(()=>false));await b.features();expect(f.spawns).toHaveLength(1);
});
it('delivers hello to the adapter callback but never to the seam frame stream',async()=>{
 const frames:unknown[]=[];const hello:unknown[]=[];
 const f=fakeBridge((_args,emit)=>{for(const line of recording)emit({kind:'stdout',line});});
 const run=cliRun(f.bridge,Promise.resolve(STATE),['status'],{map:v=>v,onHello:frame=>hello.push(frame)});
 for await(const frame of run.frames)frames.push(frame);
 expect(hello).toHaveLength(1);expect(frames).not.toContainEqual(expect.objectContaining({t:'hello'}));expect(await run.done).toMatchObject({ok:true});
});
it.each(['windows','linux'])('uses native decorations on %s',async platform=>{
 const f=fakeBridge((_args,emit)=>emit({kind:'exit',code:1}));f.bridge.hostPlatform=async()=>platform;
 expect(await createTauriBackend(f.bridge).capabilities()).toMatchObject({windowChrome:'native'});
});
