import { expect, it, vi } from 'vitest';
import { createTauriBackend } from '../index';
import { evalManyArgv } from '../eval-many';
import { browserPrefs } from '../../prefs';
import { fakeBridge } from './fake-bridge';

const item = { skill: 'alpha', path: '/library/alpha', contentHash: `sha256:${'a'.repeat(64)}`, requestedAt: '2026-09-14T00:00:00Z', window: 'later' as const, team: 'team' };
function harness(value: unknown, ok = true) {
  const fake = fakeBridge((args, emit) => {
    emit({ kind: 'stdout', line: JSON.stringify({ t: 'result', verb: args[0], ok, exitCode: ok ? 0 : 1, value, ...(ok ? {} : { error: '1 of 2 evals failed.' }) }) });
    emit({ kind: 'exit', code: ok ? 0 : 1 });
  });
  const backend = createTauriBackend(fake.bridge), changed = vi.fn(); backend.subscribe(changed);
  return { ...fake, backend, changed };
}
const ran = { mode: 'ran', team: 'team', skills: ['alpha', 'beta'], ok: 2, failed: 0, queued: [] };

it.each([
  ['now', { refs: ['alpha', 'beta'], mode: 'now', team: 'team' }, ['eval', '--team', 'team', '--', 'alpha', 'beta']],
  ['batches', { refs: ['alpha', 'beta', 'gamma'], mode: 'batches', batch: 2 }, ['eval', '--batch', '2', '--', 'alpha', 'beta', 'gamma']],
  ['overnight', { refs: ['alpha'], mode: 'overnight' }, ['eval', '--window', 'overnight', '--', 'alpha']],
  ['later', { refs: ['alpha'], mode: 'later' }, ['eval', '--window', 'later', '--', 'alpha']],
  ['pending only', { refs: [], mode: 'now', pending: true }, ['eval', '--pending']],
  ['pending plus skills', { refs: ['alpha'], mode: 'overnight', pending: true, team: 'team' }, ['eval', '--team', 'team', '--window', 'overnight', '--pending', '--', 'alpha']],
] as const)('spawns the CLI line for %s', async (_name, args, argv) => {
  const h = harness(ran);
  expect(await h.backend.evalMany({ ...args, refs: [...args.refs] }).done).toEqual({ ok: true, value: ran });
  expect(h.spawns.map(spawn => spawn.args)).toEqual([argv]);
  expect(h.changed.mock.calls.map(call => call[0])).toEqual(['config', 'placed']);
});

it('carries the Settings ▸ Evals defaults exactly as a single eval does', async () => {
  const h = harness(ran);
  h.backend.prefs.set('eval:k', '3'); h.backend.prefs.set('eval:model', 'sonnet'); h.backend.prefs.set('eval:judge', 'opus');
  await h.backend.evalMany({ refs: ['alpha'], mode: 'now' }).done;
  await h.backend.eval({ ref: 'alpha' }).done;
  expect(h.spawns.map(spawn => spawn.args)).toEqual([['eval', '--k', '3', '--model', 'sonnet', '--judge-model', 'opus', '--', 'alpha'], ['eval', '--k', '3', '--model', 'sonnet', '--judge-model', 'opus', '--', 'alpha']]);
});

it.each([
  ['no skills and not pending', { refs: [], mode: 'now' }, 'Provide at least one skill, or --pending.'],
  ['a zero batch', { refs: ['alpha'], mode: 'batches', batch: 0 }, '--batch must be a positive integer.'],
  ['a fractional batch', { refs: ['alpha'], mode: 'batches', batch: 1.5 }, '--batch must be a positive integer.'],
  ['a missing batch', { refs: ['alpha'], mode: 'batches' }, '--batch must be a positive integer.'],
] as const)('refuses %s before any spawn, in the CLI\'s words', (_name, args, message) => {
  const h = harness(ran);
  expect(() => h.backend.evalMany({ ...args, refs: [...args.refs] })).toThrow(message);
  expect(evalManyArgv.bind(null, { ...args, refs: [...args.refs] }, browserPrefs())).toThrow(message);
  expect(h.spawns).toEqual([]);
});

it('keeps the queued remainder and stoppedAfter of a declined batch', async () => {
  const value = { mode: 'ran', team: 'team', skills: ['alpha', 'beta'], ok: 1, failed: 0, queued: [item], stoppedAfter: 1 };
  expect(await harness(value).backend.evalMany({ refs: ['alpha', 'beta'], mode: 'batches', batch: 1 }).done).toEqual({ ok: true, value });
});

it('keeps a queued outcome with a teamless item', async () => {
  const { team: omitted, ...teamless } = item; expect(omitted).toBe('team');
  const value = { mode: 'queued', team: null, skills: ['alpha'], ok: 0, failed: 0, queued: [{ ...teamless, window: 'overnight' }] };
  expect(await harness(value).backend.evalMany({ refs: ['alpha'], mode: 'overnight' }).done).toEqual({ ok: true, value });
});

it('preserves the partial value the CLI reports beside a failure', async () => {
  const value = { mode: 'ran', team: 'team', skills: ['alpha', 'beta'], ok: 1, failed: 1, queued: [] };
  expect(await harness(value, false).backend.evalMany({ refs: ['alpha', 'beta'], mode: 'now' }).done).toEqual({ ok: false, value, error: '1 of 2 evals failed.' });
});

it('fails malformed results at the seam', async () => {
  expect(await harness({ mode: 'ran', team: 'team', skills: 'alpha', ok: 1, failed: 0, queued: [] }).backend.evalMany({ refs: ['alpha'], mode: 'now' }).done).toMatchObject({ ok: false });
  expect(await harness({ ...ran, queued: [{ ...item, window: 'tomorrow' }] }).backend.evalMany({ refs: ['alpha'], mode: 'now' }).done).toMatchObject({ ok: false });
});
