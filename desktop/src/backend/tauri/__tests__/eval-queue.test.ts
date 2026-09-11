import { expect, it, vi } from 'vitest';
import { evalQueueFor } from '../../eval-queue';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

const item = { team: 'team', skill: 'alpha', version: 'a'.repeat(40), requestedAt: '2026-09-10T00:00:00Z', window: 'overnight' };
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
