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
 const h = harness(); expect(await h.update.check()).toMatchObject({ ok: true, value: { lastApply: { reason: 'on-close' } } });
 expect(await h.update.check({ force: true })).toMatchObject({ ok: true, value: { lastApply: { version: '0.12.2' } } });
 expect(await createAppUpdate(h.deps).check()).toMatchObject({ ok: true, value: { lastApply: null } });
});
it('retains failed markers across launches', async () => {
 const h = harness('failed'); await h.update.check(); expect(await createAppUpdate(h.deps).check()).toMatchObject({ ok: true, value: { lastApply: { phase: 'failed' } } });
});
it('reports a failure to persist acknowledgement as a retryable check error', async () => {
 const h = harness(); h.deps.prefs.set = () => { throw new Error('read only'); };
 expect(await h.update.check()).toMatchObject({ ok: false, error: expect.stringContaining('read only') });
 expect(h.results).toContainEqual({ ok: false, error: expect.stringContaining('read only') });
});
it('records the native failure as a Result and never rejects the caller', async () => {
 const h = harness(); h.deps.invoke = async () => { throw new Error('no shell'); };
 await expect(h.update.armOnClose('0.12.2')).resolves.toEqual({ ok: false, error: 'no shell' });
 expect(h.results).toEqual([{ ok: false, error: 'no shell' }]);
});
