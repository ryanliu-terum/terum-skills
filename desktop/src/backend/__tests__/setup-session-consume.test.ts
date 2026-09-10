import { afterEach, expect, it, vi } from 'vitest';
import { setupSession } from '../setup-session';
import { createTauriBackend } from '../tauri';
import { browserPrefs } from '../prefs';
import { fakeBridge, STATE } from '../tauri/__tests__/fake-bridge';
import { decide } from '../../app/launch-decision';
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});
function failedSetup(){
 const fake=fakeBridge((_args,emit)=>{emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'setup',ok:false,exitCode:1,error:'Setup failed.'})});},{...STATE,intent:'setup'});
 return {fake,backend:{...createTauriBackend(fake.bridge),prefs:browserPrefs()}};
}
it('consumes a hard failure so the same launch does not restart, but Retry does',async()=>{
 const {backend,fake}=failedSetup(),launch=await backend.launchContext();if(!launch)throw new Error('Missing launch');
 const session=setupSession(backend,launch);await session.start(async()=>true);
 expect(session.snapshot()).toMatchObject({outcome:'failed',result:{ok:false,error:'Setup failed.'}});
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe(STATE.writtenAt);
 expect(decide(await backend.launchContext(),backend.prefs.get('launch:consumedWrittenAt',''),undefined)).toBe('none');
 await session.start(async()=>true);expect(fake.spawns).toHaveLength(1);
 await session.retry();expect(fake.spawns).toHaveLength(2);expect(session.snapshot().attempt).toBe(2);
});
it('consumes a thrown setup failure',async()=>{
 const {backend}=failedSetup();vi.spyOn(backend,'setup').mockImplementation(()=>{throw new Error('Spawn failed.');});
 const session=setupSession(backend,{writtenAt:STATE.writtenAt,intent:'setup'});await session.start(async()=>true);
 expect(session.snapshot()).toMatchObject({outcome:'failed',result:{ok:false,error:'Spawn failed.'}});
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe(STATE.writtenAt);
});
it('does not consume a manual setup',async()=>{
 const {backend}=failedSetup();await setupSession(backend,{writtenAt:'manual:retry',intent:'setup'}).start(async()=>true);
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe('');
});
it('preserves the setup failure while reporting a persistence failure',async()=>{
 const {backend}=failedSetup();vi.spyOn(backend.prefs,'set').mockImplementation(()=>{throw new Error('Preferences denied.');});
 const session=setupSession(backend,{writtenAt:STATE.writtenAt,intent:'setup'});await session.start(async()=>true);
 expect(session.snapshot()).toMatchObject({outcome:'failed',result:{ok:false,error:'Setup failed.'},persistenceError:'Preferences denied.'});
});

it('records a rejected preferences load as a consumed terminal failure',async()=>{
 const {backend}=failedSetup();const ready=Promise.reject(new Error('Preferences unavailable.'));
 const withReady={...backend,prefs:{...backend.prefs,ready}};
 const session=setupSession(withReady,{writtenAt:STATE.writtenAt,intent:'setup'});await session.start(async()=>true);
 expect(session.snapshot()).toMatchObject({outcome:'failed',result:{ok:false,error:'Preferences unavailable.'}});
 expect(backend.prefs.get('launch:consumedWrittenAt','')).toBe(STATE.writtenAt);
});
it('preserves the terminal result if preference flushing rejects',async()=>{
 const {backend}=failedSetup();const withFlush={...backend,prefs:{...backend.prefs,flush:async()=>{throw new Error('Flush failed.');}}};
 const session=setupSession(withFlush,{writtenAt:STATE.writtenAt,intent:'setup'});await session.start(async()=>true);
 expect(session.snapshot()).toMatchObject({outcome:'failed',result:{ok:false,error:'Setup failed.'},persistenceError:'Flush failed.'});
});
