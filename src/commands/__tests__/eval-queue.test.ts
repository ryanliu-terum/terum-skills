import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { enqueueEvals, readEvalQueue, withEvalQueueLock, type EvalQueueItem } from '../../lib/evals/queue.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { failure, success } from '../../lib/result.js';
import { measuredReceipt } from './pending-eval-fixtures.js';
import { runQueue, type EvalArgs, type EvalResult } from '../eval.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { skillContentDigest } from '../../lib/skills.js';
import { sourceFiles } from '../../lib/skill-source.js';

const SKILL = `---\nname: alpha\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;
/** §6.3: eval targets a folder in the LIBRARY, so every real-engine drain needs one on disk. */
async function libraryFolder(name = 'alpha', source = SKILL): Promise<{ home: string; path: string; digest: string }> {
  const home = await temporaryDirectory();
  const path = join(home, '.claude', 'skills', name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), source);
  return { home, path, digest: skillContentDigest((await sourceFiles(path)).files) };
}

/** §6.6: a queued item names the BYTES it was queued against, and its team is optional. */
const DIGEST_A = 'sha256:' + 'a'.repeat(64);
const DIGEST_B = 'sha256:' + 'b'.repeat(64);
const item = (skill = 'alpha', window: EvalQueueItem['window'] = 'overnight', contentHash = DIGEST_A): EvalQueueItem => ({ team: 'team', skill, path: '/library/' + skill, contentHash, requestedAt: '2026-09-10T00:00:00Z', window });
const result: EvalResult = { team: 'team', id: 'id', name: 'alpha', runDir: '/runs/alpha', ccVersion: 'test', executionStatus: 'complete' };
async function fixture() { const config = createConfigStore(await temporaryDirectory()); return { config, io: new ScriptedPrompter() }; }
it('enqueues uniquely by skill and content hash and writes private atomic JSON', async () => {
  const { config } = await fixture();
  await Promise.all([enqueueEvals(config.root, [item(), item()]), enqueueEvals(config.root, [item('beta')])]);
  await enqueueEvals(config.root, [{ ...item(), window: 'later' }, item('alpha', 'overnight', DIGEST_B)]);
  const queue = await readEvalQueue(config.root); expect(queue.items).toHaveLength(3);
  expect(queue.items.find(i => i.skill === 'alpha' && i.contentHash === DIGEST_A)?.window).toBe('later');
  expect(queue.schema).toBe(2);
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
it('drains with pinned versions and one shared probe', async () => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item(), item('beta')]);
  const preflight = vi.fn(async () => success({ ccVersion: 'test' }));
  const evaluate = vi.fn(async (args: EvalArgs) => {
    expect(args.lockWaitMs).toBe(300_000); expect(args.expectedVersion).toBe(item().contentHash); expect(args.team).toBe('team');
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
it.each(['declined', 'thrown'] as const)('keeps an item after %s evaluation', async mode => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item()]);
  const evaluate = async () => {
    if (mode === 'thrown') throw new Error('interrupted');
    return mode === 'declined' ? failure('evaluation declined') : success({ ...result, executionStatus: 'complete' as const });
  };
  expect(await runQueue({ config, drain: true, evaluate }, io)).toMatchObject({ ok: false, value: { completed: 0 } });
  expect((await readEvalQueue(config.root)).items[0]?.lastError).toBeTruthy();
});
it('filters overnight items and dequeue removes all versions of only the named skill', async () => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item('later', 'later'), item(), item('alpha', 'overnight', DIGEST_B)]);
  const evaluate = vi.fn(async () => success(result));
  expect(await runQueue({ config, drain: true, window: 'overnight', max: 1, evaluate }, io)).toMatchObject({ ok: true, value: { attempted: 1, completed: 1 } });
  expect(evaluate.mock.calls).toHaveLength(1);
  expect(await runQueue({ config, dequeue: 'team/alpha' }, io)).toEqual(success({ items: [item('later', 'later')] }));
});
it('refuses concurrent drains instead of evaluating an item twice', async () => {
  const { config, io } = await fixture(); await enqueueEvals(config.root, [item()]);
  await withEvalQueueLock(config.root, 'drain', async () => {
    expect(await runQueue({ config, drain: true }, io)).toMatchObject({ ok: false, error: 'Another terum-skills drain is already running; wait for it to finish or stop it.' });
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
  await expect(enqueueEvals(config.root, [{ ...item(), contentHash: 'bad' }])).rejects.toThrow();
});
it('§6.6: a schema-1 queue of 40-hex items reads back EMPTY and the next enqueue writes schema 2', async () => {
  const { config, io } = await fixture(); await mkdir(join(config.root, 'run'), { recursive: true });
  const path = join(config.root, 'run/eval-queue.json');
  await writeFile(path, JSON.stringify({ schema: 1, items: [
    { team: 'team', skill: 'alpha', version: 'a'.repeat(40), requestedAt: '2026-09-10T00:00:00Z', window: 'overnight' },
    { team: 'team', skill: 'beta', version: 'b'.repeat(40), requestedAt: '2026-09-10T00:00:00Z', window: 'later' },
  ] }));
  // A stale queue is a list of intentions to spend money, not data: dropping it beats the old rethrow,
  // which took the whole drainer down on the first read after an upgrade.
  expect((await readEvalQueue(config.root)).items).toEqual([]);
  expect(await runQueue({ config, queueList: true }, io)).toEqual(success({ items: [] }));
  await enqueueEvals(config.root, [item()]);
  const written = JSON.parse(await readFile(path, 'utf8'));
  expect(written.schema).toBe(2);
  expect(written.items).toEqual([item()]);
});

it('§6.6: --dequeue accepts a bare skill name, so a teamless queued run can be cancelled at all', async () => {
  const { config, io } = await fixture();
  const teamless: EvalQueueItem = { skill: 'solo', path: '/library/solo', contentHash: DIGEST_A, requestedAt: '2026-09-10T00:00:00Z', window: 'overnight' };
  await enqueueEvals(config.root, [teamless, item()]);
  expect(await runQueue({ config, dequeue: 'team/solo' }, io)).toEqual(success({ items: [teamless, item()] }));
  expect(await runQueue({ config, dequeue: 'solo' }, io)).toEqual(success({ items: [item()] }));
  expect(io.lines.join('\n')).toContain('solo@' + DIGEST_A);
});

it.each([
  {}, { drain: true, queueList: true }, { max: 1 }, { window: 'overnight' }, { drain: true, max: 0 }, { drain: true, max: 1.5 },
  { drain: true, max: Infinity }, { drain: true, window: 'later' }, { dequeue: 'a/b/c' }, { drain: true, ref: 'alpha' },
])('rejects invalid queue options %j', async args => {
  const { config, io } = await fixture(); expect(await runQueue({ config, ...args }, io)).toMatchObject({ ok: false });
});

it('§6.6: the real engine refuses queued bytes that are no longer what is on disk, before any paid probe', async () => {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/alpha/v1/SKILL.md', SKILL);
  const config = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, config.teamClone('team'));
  await config.update(state => { state.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const library = await libraryFolder();
  // The queued hash is DIGEST_A, which is nobody's bytes — exactly the "someone edited the folder
  // after queueing it" case the guard exists for.
  await enqueueEvals(config.root, [item()]); const preflight = vi.fn(async () => success({ ccVersion: 'test' }));
  const outcome = await runQueue({ config, home: library.home, drain: true, preflight }, new ScriptedPrompter());
  expect(outcome).toMatchObject({ ok: false, value: { attempted: 1, completed: 0 } });
  expect((await readEvalQueue(config.root)).items[0]?.lastError).toContain('no longer what is on disk');
  expect(preflight).not.toHaveBeenCalled();
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

it.each(['partial','failed'] as const)('removes a completed %s eval and never bills it on the next drain',async executionStatus=>{
 const {config,io}=await fixture();await enqueueEvals(config.root,[item()]);const evaluate=vi.fn(async()=>success({...result,executionStatus}));
 expect(await runQueue({config,drain:true,evaluate},io)).toMatchObject({ok:true,value:{completed:1,items:[]}});
 expect(io.lines).toContain(`Eval completed with ${executionStatus} results.`);
 expect(await runQueue({config,drain:true,evaluate},io)).toMatchObject({ok:true,value:{attempted:0,completed:0,items:[]}});expect(evaluate).toHaveBeenCalledTimes(1);expect(io.lines.at(-1)).toBe('No queued evals.');
});

it('§6.2/§6.6: bytes that already carry a LOCAL receipt are dropped before probing or creating a paid run', async () => {
  const f = await bareTeam();
  await pushFromSeed(f.seed, 'skills/alpha/v1/SKILL.md', SKILL);
  const config = createConfigStore(join(f.root, 'state'));
  await cloneWithIdentity(f.bare, config.teamClone('team'));
  await config.update(state => { state.teams.team = { remote: f.bare, handle: 'seed' }; });
  const library = await libraryFolder();
  // §6.2: the local store is keyed on the CONTENT DIGEST, not on team/skill-id — which is what lets a
  // receipt for a folder belonging to no team stop a paid rerun at all.
  const receipt = receiptSchema.parse({ ...measuredReceipt(1, 1000), schema_version: 2, version: null, content_digest: library.digest, execution_status: 'partial' });
  const runDir = join(config.root, 'evals', 'local', library.digest.replace(/^sha256:/, ''), receipt.run_id);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'receipt.json'), JSON.stringify(receipt));
  await enqueueEvals(config.root, [item('alpha', 'overnight', library.digest)]);
  const preflight = vi.fn(async () => failure('Unexpected preflight: this receipt must prevent all paid work.')), io = new ScriptedPrompter();
  expect(await runQueue({ config, home: library.home, drain: true, preflight }, io)).toMatchObject({ ok: true, value: { completed: 1, items: [] } });
  expect(preflight).not.toHaveBeenCalled();
  expect(io.lines.join('\n')).toContain('Already evaluated these exact bytes of alpha.');
  expect(await runQueue({ config, home: library.home, drain: true, preflight }, io)).toMatchObject({ ok: true, value: { attempted: 0 } });
  expect(preflight).not.toHaveBeenCalled();
});
it('an empty window selection preserves other queued items and prints no zero-size batch',async()=>{
 const {config,io}=await fixture();await enqueueEvals(config.root,[item('later','later')]);const evaluate=vi.fn();
 expect(await runQueue({config,drain:true,window:'overnight',evaluate},io)).toEqual(success({items:[item('later','later')],attempted:0,completed:0,failures:[]}));expect(io.lines).toEqual(['No queued evals.']);expect(evaluate).not.toHaveBeenCalled();
});
