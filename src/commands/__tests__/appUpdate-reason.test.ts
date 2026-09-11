import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { writeJsonPrivate } from '../../lib/fs.js';
import type { Exec } from '../../lib/runner.js';
import { ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { run, type AppUpdateArgs } from '../appUpdate.js';
async function fixture() {
  const config = createConfigStore(await temporaryDirectory());
  await writeJsonPrivate(join(config.root, 'app', '0.12.2', 'staged.json'), { installer: 'app.exe' });
  const exec = vi.fn<Exec>(async () => ({ code: 0, stdout: '', stderr: '' }));
  const args: AppUpdateArgs = { config, exec, release: '0.12.2', evidence: { platform: 'win32', arch: 'x64' } };
  return { args, exec, marker: join(config.root, 'run', 'app-update.json') };
}
it.each(['manual', 'overnight', 'on-close'])('round trips %s through handoff, marker, and check', async reason => {
  const h = await fixture(), io = new ScriptedPrompter();
  expect((await run({ ...h.args, apply: true, reason, node: '/node', entry: '/cli', awaitPid: 123 }, io)).ok).toBe(true);
  expect(h.exec).toHaveBeenCalledExactlyOnceWith('/node', ['/cli', 'app-update', '--apply-now', '--release', '0.12.2', '--reason', reason, '--await-pid', '123'], { detach: true });
  await run({ ...h.args, applyNow: true, reason }, io);
  expect(JSON.parse(await readFile(h.marker, 'utf8'))).toMatchObject({ phase: 'launched', reason });
  expect(await run({ ...h.args, check: true }, io)).toMatchObject({ ok: true, value: { lastApply: { phase: 'launched', reason } } });
});
it('rejects an invalid reason before doing any work', async () => {
  const h = await fixture(); expect(await run({ ...h.args, applyNow: true, reason: 'whenever' }, new ScriptedPrompter())).toEqual({ ok: false, error: '--reason must be on-close, overnight or manual.' }); expect(h.exec).not.toHaveBeenCalled();
});
it('keeps old markers readable and rejects a corrupt reason', async () => {
  const h = await fixture(), marker = { schema: 1, version: '0.12.2', phase: 'launched', at: new Date().toISOString(), error: null };
  await writeJsonPrivate(h.marker, marker); expect(await run({ ...h.args, check: true }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { lastApply: marker } });
  for (const reason of ['invalid', ['manual'], null, 7]) {
    await writeJsonPrivate(h.marker, { ...marker, reason }); expect(await run({ ...h.args, check: true }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { lastApply: null } });
  }
});
it('waits for the closing Windows shell before invoking its installer', async () => {
  const h = await fixture(), alive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  h.exec.mockImplementation(async () => { expect(alive).toHaveBeenCalledTimes(2); return { code: 0, stdout: '', stderr: '' }; });
  expect(await run({ ...h.args, applyNow: true, reason: 'on-close', awaitPid: 123, alive, pollMs: 1 }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { phase: 'launched' } });
  expect(JSON.parse(await readFile(h.marker, 'utf8'))).toMatchObject({ reason: 'on-close' });
});
it('retains the reason on an installer failure', async () => {
  const h = await fixture(); h.exec.mockResolvedValue({ code: 7, stdout: '', stderr: 'installer failed' });
  await run({ ...h.args, applyNow: true, reason: 'overnight' }, new ScriptedPrompter());
  expect(JSON.parse(await readFile(h.marker, 'utf8'))).toMatchObject({ phase: 'failed', reason: 'overnight', error: expect.stringContaining('installer failed') });
});

it.each(['missing-stage','unsupported','invalid-version','invalid-pid'] as const)('records early apply-now failure: %s',async mode=>{
 const h=await fixture();
 if(mode==='missing-stage')await rm(join(h.args.config!.root,'app'),{recursive:true});
 const patch:Partial<AppUpdateArgs>=mode==='unsupported'?{evidence:{platform:'linux',arch:'x64'}}:mode==='invalid-version'?{release:'not-a-release'}:mode==='invalid-pid'?{awaitPid:'bad'}:{};
 const result=await run({...h.args,...patch,applyNow:true,reason:'on-close'},new ScriptedPrompter());
 expect(result).toMatchObject({ok:true,value:{phase:'failed',error:expect.any(String)}});expect(h.exec).not.toHaveBeenCalled();
 expect(JSON.parse(await readFile(h.marker,'utf8'))).toMatchObject({schema:1,phase:'failed',reason:'on-close',error:expect.any(String)});
});
it('reads the exact native pending marker after an installer dies before running',async()=>{
 const h=await fixture();const pending={schema:1,version:'0.12.2',phase:'waiting',at:'1970-01-01T00:00:00.000Z',error:null,reason:'on-close'};
 await writeJsonPrivate(h.marker,pending);
 expect(await run({...h.args,check:true},new ScriptedPrompter())).toMatchObject({ok:true,value:{lastApply:pending}});
});
