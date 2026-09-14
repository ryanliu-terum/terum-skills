import { expect, it, vi } from 'vitest';
import { evalQueueFor } from '../../eval-queue';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

const item = { team: 'team', skill: 'alpha', path: '/library/alpha', contentHash: `sha256:${'a'.repeat(64)}`, requestedAt: '2026-09-10T00:00:00Z', window: 'overnight' };
function harness(value: unknown) {
  const fake = fakeBridge((args, emit) => {
    emit({ kind: 'stdout', line: JSON.stringify({ t: 'result', verb: args[0], ok: true, exitCode: 0, value }) });
    emit({ kind: 'exit', code: 0 });
  });
  const backend = createTauriBackend(fake.bridge);
  return { ...fake, backend, queue: evalQueueFor(backend)! };
}
it('lists the queue through frames without invalidating read models', async () => {
  const h = harness({ items: [item] }), changed = vi.fn(); h.backend.subscribe(changed);
  expect(await h.queue.list()).toEqual({ ok: true, value: { items: [item] } });
  expect(h.spawns.map(spawn => spawn.args)).toEqual([['eval', '--queue-list']]); expect(changed).not.toHaveBeenCalled();
});
it('drains a parallel batch and invalidates committed receipt reads', async () => {
  const value = { items: [], attempted: 1, completed: 1, failures: [] };
  const h = harness(value), changed = vi.fn(); h.backend.subscribe(changed);
  expect(await h.queue.drain().done).toEqual({ ok: true, value });
  expect(h.spawns.map(spawn => spawn.args)).toEqual([['eval', '--drain', '--parallel', '4']]);
  expect(changed).toHaveBeenCalledWith('clone');
});
it('preserves failed items and partial results from the CLI', async () => {
  const value = { items: [{ ...item, lastError: 'failed' }], attempted: 1, completed: 0, failures: [{ item, error: 'failed' }] };
  const fake = fakeBridge((_args, emit) => {
    emit({ kind: 'stdout', line: JSON.stringify({ t: 'result', verb: 'eval', ok: false, exitCode: 1, value, error: 'failed' }) });
    emit({ kind: 'exit', code: 1 });
  });
  expect(await evalQueueFor(createTauriBackend(fake.bridge))!.drain().done).toEqual({ ok: false, value, error: 'failed' });
});
it('fails malformed queue data at the seam', async () => {
  expect(await harness({ items: [{ ...item, window: 'tomorrow' }] }).queue.list()).toMatchObject({ ok: false });
});
it.each(['queued', 'batched'])('accepts the setup %s outcome at the real adapter boundary', async outcome => {
  expect(await harness({ role: 'creator', team: 'team', steps: { evals: outcome } }).backend.setup({}).done).toMatchObject({ ok: true, value: { steps: { evals: outcome } } });
});

it('lists and drains an item with team omitted through the real seam',async()=>{
 const {team: omitted,...teamless}=item;expect(omitted).toBe('team');
 const fake=fakeBridge((args,emit)=>{const value=args.includes('--queue-list')?{items:[teamless]}:{items:[],attempted:1,completed:1};emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'eval',ok:true,exitCode:0,value})});emit({kind:'exit',code:0});});
 const queue=evalQueueFor(createTauriBackend(fake.bridge))!;
 expect(await queue.list()).toEqual({ok:true,value:{items:[teamless]}});expect(await queue.drain().done).toMatchObject({ok:true,value:{completed:1}});
 expect(fake.spawns.map(s=>s.args)).toEqual([['eval','--queue-list'],['eval','--drain','--parallel','4']]);
});

it('drains with the Settings ▸ Evals defaults, so the overnight receipt is the one the person configured', async () => {
  const h = harness({ items: [], attempted: 1, completed: 1 });
  h.backend.prefs.set('eval:k', '3'); h.backend.prefs.set('eval:model', 'sonnet'); h.backend.prefs.set('eval:judge', '');
  await h.queue.drain().done;
  expect(h.spawns.map(spawn => spawn.args)).toEqual([['eval', '--k', '3', '--model', 'sonnet', '--drain', '--parallel', '4']]);
});
