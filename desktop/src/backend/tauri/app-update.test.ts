import { afterEach, expect, it, vi } from 'vitest';
import { createAppUpdate, type AppUpdateDeps } from './app-update';
import { browserPrefs } from '../prefs';
import { createRun } from '../mock/run';
import type { Result } from '../types';
afterEach(() => { localStorage.clear(); });
function harness(phase = 'launched') {
 const marker = { schema: 1, version: '0.12.2', phase, at: '2026-09-10T01:30:00Z', error: null, reason: 'on-close' };
 const payload = { mode: 'check', platform: 'win32-x64', supported: true, cliVersion: '0.12.2', latest: '0.12.2', latestAt: null, probe: 'cached', probeError: null, staged: null, installed: ['0.12.2'], lastApply: marker, ppid: 42 };
 const results: Result<unknown>[] = [];
 const deps: AppUpdateDeps = {
  appVersion: '0.12.2', prefs: browserPrefs(), invoke: vi.fn(async () => {}),
  run: (_argv, schema, map) => createRun(async () => ({ ok: true, value: map(schema.parse(payload)) })),
  read: job => job.done,
  result: async value => { results.push(value); return value; },
 };
 return { deps, results, update: createAppUpdate(deps) };
}
it('shows a successful marker throughout one session and acknowledges it for later launches', async () => {
 const h = harness(); expect(await h.update.check()).toMatchObject({ ok: true, value: { reason: 'on-close', lastApply: { version: '0.12.2' } } });
 expect(await h.update.check({ force: true })).toMatchObject({ ok: true, value: { lastApply: { version: '0.12.2' } } });
 expect(await createAppUpdate(h.deps).check()).toMatchObject({ ok: true, value: { lastApply: null } });
});
it('retains failed markers across launches', async () => {
 const h = harness('failed'); await h.update.check(); expect(await createAppUpdate(h.deps).check()).toMatchObject({ ok: true, value: { lastApply: { phase: 'failed' } } });
});
it('keeps the successful observation and notice when acknowledgement cannot be saved', async () => {
 const h = harness(); const set = vi.fn(() => { throw new Error('read only'); }); h.deps.prefs.set = set;
 h.deps.prefs.flush = vi.fn(async () => { throw new Error('sticky failure'); });
 for (let i=0;i<2;i++) expect(await h.update.check()).toMatchObject({ok:true,value:{lastApply:{version:'0.12.2'},acknowledgementError:expect.stringContaining('read only')}});
 expect(set).toHaveBeenCalledOnce();expect(h.deps.prefs.flush).not.toHaveBeenCalled();expect(h.results.every(result=>result.ok)).toBe(true);
});
it('records the native failure as a Result and never rejects the caller', async () => {
 const h = harness(); h.deps.invoke = async () => { throw new Error('no shell'); };
 await expect(h.update.armOnClose('0.12.2')).resolves.toEqual({ ok: false, error: 'no shell' });
 expect(h.results).toEqual([{ ok: false, error: 'no shell' }]);
});

it.each(['result','throw'] as const)('restores the arm after a failed manual apply (%s)',async mode=>{
 const h=harness();await h.update.armOnClose('0.12.2');
 h.deps.run=()=>{if(mode==='throw')throw new Error('apply failed');return createRun(async()=>({ok:false,error:'apply failed'}));};
 expect(await h.update.apply('0.12.2','manual')).toMatchObject({ok:false,error:expect.stringContaining('apply failed')});
 expect(vi.mocked(h.deps.invoke!).mock.calls).toEqual([['app_update_on_close',{version:'0.12.2'}],['app_update_on_close',{version:null}],['app_update_on_close',{version:'0.12.2'}]]);
});
it('a policy change during failed apply wins over restoring the previous arm',async()=>{
 const h=harness();await h.update.armOnClose('0.12.2');let fail!:(result:Result<never>)=>void;
 h.deps.run=()=>({...createRun(async()=>({ok:false,error:'unused'})),done:new Promise(resolve=>{fail=resolve;})});
 const applying=h.update.apply('0.12.2','manual');await vi.waitFor(()=>expect(fail).toBeDefined());
 await h.update.disarmOnClose();fail({ok:false,error:'apply failed'});await applying;
 expect(vi.mocked(h.deps.invoke!).mock.calls.map(call=>call[1].version)).toEqual(['0.12.2',null,null]);
});
it('reports both apply and restore failures',async()=>{
 const h=harness();await h.update.armOnClose('0.12.2');
 h.deps.run=()=>createRun(async()=>({ok:false,error:'apply failed'}));
 vi.mocked(h.deps.invoke!).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('restore failed'));
 expect(await h.update.apply('0.12.2')).toEqual({ok:false,error:'apply failed Could not restore install-on-close: restore failed'});
});

it('an unreadable acknowledgement also preserves the successful check',async()=>{
 const h=harness();h.deps.prefs.get=()=>{throw new Error('read failed');};
 expect(await h.update.check()).toMatchObject({ok:true,value:{lastApply:{version:'0.12.2'},acknowledgementError:expect.stringContaining('read failed')}});
});
