import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { enqueueEvals, readEvalQueue, withEvalQueueLock, type EvalQueueItem } from '../../lib/evals/queue.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { failure, success } from '../../lib/result.js';
import { runQueue, type EvalArgs, type EvalResult } from '../eval.js';

const item = (skill = 'alpha', window: EvalQueueItem['window'] = 'overnight'): EvalQueueItem => ({ team: 'team', skill, version: 'a'.repeat(40), requestedAt: '2026-09-10T00:00:00Z', window });
const result: EvalResult = { team: 'team', id: 'id', name: 'alpha', runDir: '/runs/alpha', ccVersion: 'test', executionStatus: 'complete', commit: { ok: true, receiptPath: 'evals/receipt.json' } };
async function fixture() { const config = createConfigStore(await temporaryDirectory()); return { config, io: new ScriptedPrompter() }; }
it('enqueues uniquely by team, skill and version and writes private atomic JSON', async () => {
  const { config } = await fixture();
  await Promise.all([enqueueEvals(config.root, [item(), item()]), enqueueEvals(config.root, [item('beta')])]);
  await enqueueEvals(config.root, [{ ...item(), window: 'later' }, { ...item(), version: 'b'.repeat(40) }]);
  const queue = await readEvalQueue(config.root); expect(queue.items).toHaveLength(3);
  expect(queue.items.find(i => i.skill === 'alpha' && i.version === item().version)?.window).toBe('later');
  expect(JSON.parse(await readFile(join(config.root, 'run/eval-queue.json'), 'utf8'))).toEqual(queue);
  if (process.platform !== 'win32') expect((await stat(join(config.root, 'run/eval-queue.json'))).mode & 0o777).toBe(0o600);
});
it('list is empty before any write and exposes items and errors without probing an agent', async () => {
  const { config, io } = await fixture();
  expect(await runQueue({ config, queueList: true }, io)).toEqual(success({ items: [] }));
  await enqueueEvals(config.root, [{ ...item(), lastError: 'not signed in' }]);
  expect(await runQueue({ config, queueList: true }, io)).toEqual(success({ items: [{ ...item(), lastError: 'not signed in' }] }));
  expect(io.lines.at(-1)).toContain('team/alpha@'); expect(io.lines.at(-1)).toContain('not signed in');
});
it('drains with pinned versions, commit intent, and one shared probe', async () => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item(), item('beta')]);
  const preflight = vi.fn(async () => success({ ccVersion: 'test' }));
  const evaluate = vi.fn(async (args: EvalArgs) => {
    expect(args.lockWaitMs).toBe(300_000); expect(args.expectedVersion).toBe(item().version); expect(args.commit).toBe(true); expect(args.team).toBe('team');
    expect(await args.preflight?.()).toEqual(success({ ccVersion: 'test' }));
    await Promise.resolve(); return success(result);
  });
  expect(await runQueue({ config, drain: true, preflight, evaluate }, io)).toEqual(success({ items: [], attempted: 2, completed: 2, failures: [] }));
  expect(evaluate).toHaveBeenCalledTimes(2); expect(preflight).toHaveBeenCalledTimes(1); expect((await readEvalQueue(config.root)).items).toEqual([]);
});
it('retains failures with lastError, continues to the next item, and counts attempts toward max', async () => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item(), item('beta'), item('gamma')]);
  const evaluate = vi.fn(async (args: EvalArgs) => args.ref === 'alpha' ? failure('probe failed') : success(result));
  const outcome = await runQueue({ config, drain: true, max: 2, evaluate }, io);
  expect(outcome).toMatchObject({ ok: false, value: { attempted: 2, completed: 1, items: [{ ...item(), lastError: 'probe failed' }, item('gamma')] } });
  expect(evaluate).toHaveBeenCalledTimes(2);
});
it.each(['partial', 'failed', 'declined', 'thrown'] as const)('keeps an item after %s evaluation', async mode => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item()]);
  const evaluate = async () => {
    if (mode === 'thrown') throw new Error('interrupted');
    return success({ ...result, executionStatus: mode === 'declined' ? 'complete' as const : mode, commit: mode === 'declined' ? null : result.commit });
  };
  expect(await runQueue({ config, drain: true, evaluate }, io)).toMatchObject({ ok: false, value: { completed: 0 } });
  expect((await readEvalQueue(config.root)).items[0]?.lastError).toBeTruthy();
});
it('filters overnight items and dequeue removes all versions of only the named skill', async () => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item('later', 'later'), item(), { ...item(), version: 'b'.repeat(40) }]);
  const evaluate = vi.fn(async () => success(result));
  expect(await runQueue({ config, drain: true, window: 'overnight', max: 1, evaluate }, io)).toMatchObject({ ok: true, value: { attempted: 1, completed: 1 } });
  expect(evaluate.mock.calls).toHaveLength(1);
  expect(await runQueue({ config, dequeue: 'team/alpha' }, io)).toEqual(success({ items: [item('later', 'later')] }));
});
it('refuses concurrent drains instead of evaluating an item twice', async () => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item()]);
  await withEvalQueueLock(config.root, 'drain', async () => {
    expect(await runQueue({ config, drain: true }, io)).toMatchObject({ ok: false });
  });
});
it('does not resurrect a dequeued item or lose a concurrent enqueue during a run', async () => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item()]);
  const evaluate = async () => {
    await runQueue({ config, dequeue: 'team/alpha' }, io); await enqueueEvals(config.root, [item('beta')]); return failure('old run failed');
  };
  await runQueue({ config, drain: true, evaluate }, io);
  expect((await readEvalQueue(config.root)).items).toEqual([item('beta')]);
});
it('fails closed on malformed queue state and invalid items', async () => {
  const { config, io } = await fixture(); await mkdir(join(config.root, 'run'));
  const path = join(config.root, 'run/eval-queue.json'); await writeFile(path, '{broken');
  expect(await runQueue({ config, drain: true }, io)).toMatchObject({ ok: false });
  await expect(enqueueEvals(config.root, [item()])).rejects.toThrow(); expect(await readFile(path, 'utf8')).toBe('{broken');
  await expect(enqueueEvals(config.root, [{ ...item(), version: 'bad' }])).rejects.toThrow();
});
it.each([
  {}, { drain: true, queueList: true }, { max: 1 }, { window: 'overnight' }, { drain: true, max: 0 }, { drain: true, max: 1.5 },
  { drain: true, max: Infinity }, { drain: true, window: 'later' }, { dequeue: 'alpha' }, { drain: true, ref: 'alpha' }, { drain: true, working: true },
])('rejects invalid queue options %j', async args => {
  const { config, io } = await fixture(); expect(await runQueue({ config, ...args }, io)).toMatchObject({ ok: false });
});

it('the real eval engine refuses a changed queued version before any paid probe', async () => {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/alpha/SKILL.md', `---\nname: alpha\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
  const config = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, config.teamClone('team'));
  await config.update(state => { state.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  await enqueueEvals(config.root, [item()]); const preflight = vi.fn(async () => success({ ccVersion: 'test' }));
  const outcome = await runQueue({ config, drain: true, preflight }, new ScriptedPrompter());
  expect(outcome).toMatchObject({ ok: false, value: { attempted: 1, completed: 0 } });
  expect((await readEvalQueue(config.root)).items[0]?.lastError).toContain('is no longer current'); expect(preflight).not.toHaveBeenCalled();
});
it.each([undefined,2])('drains at the requested parallelism %s (default four)',async parallel=>{
 const {config,io}=await fixture();await enqueueEvals(config.root,Array.from({length:6},(_,i)=>item(`skill-${i}`)));
 let active=0,peak=0;const gates:(()=>void)[]=[];const width=parallel??4;
 const evaluate=vi.fn(async(args:EvalArgs)=>{expect(args.lockWaitMs).toBe(300_000);peak=Math.max(peak,++active);await new Promise<void>(resolve=>gates.push(resolve));active--;return success(result);});
 const running=runQueue({config,drain:true,parallel,evaluate},io);
 await vi.waitFor(()=>expect(gates).toHaveLength(width));for(const release of gates.splice(0))release();
 await vi.waitFor(()=>expect(gates).toHaveLength(Math.min(width,6-width)));for(const release of gates.splice(0))release();
 if(width===2){await vi.waitFor(()=>expect(gates).toHaveLength(2));for(const release of gates.splice(0))release();}
 expect(await running).toMatchObject({ok:true,value:{completed:6,items:[]}});expect(peak).toBe(width);
});
