import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { exists, writeJsonPrivate } from '../../lib/fs.js';
import * as pkg from '../../lib/package.js';
import * as platformModule from '../../lib/platform.js';
import { createReleaseState } from '../../lib/update.js';
import type { CommandResult, Exec, Runner, RunOptions } from '../../lib/runner.js';
import { ScriptedPrompter, ghOnlyRunner, noGhRunner, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { APP_PRODUCT, APP_REPOSITORY, APP_SLUG } from '../app.js';
import { run, type AppUpdateArgs } from '../appUpdate.js';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rm: vi.fn(original.rm) };
});
afterEach(() => vi.restoreAllMocks());
const ok: CommandResult = { code: 0, stdout: '', stderr: '' };
const V = '0.1.12', ASSET = `${APP_SLUG}_${V}_aarch64.app.tar.gz`, WIN = `${APP_SLUG}_${V}_x64-setup.exe`;
const mac = { platform: 'darwin' as const, arch: 'arm64' }, windows = { platform: 'win32' as const, arch: 'x64' };
const io = () => new ScriptedPrompter();
function downloader(mode = 'ok') {
  return ghOnlyRunner(async args => {
    if (args[0] === '--version' || args[0] === 'auth') return ok;
    if (mode === 'missing') return ok;
    if (['release not found', 'Not Found (HTTP 404)', 'no assets match', 'dial tcp: lookup api.github.com: no such host'].includes(mode)) return { ...ok, code: 1, stderr: mode };
    if (mode === 'timeout') return { ...ok, code: 124, stderr: 'terum-skills: gh release exceeded 600 s' };
    const dir = args[args.indexOf('--dir') + 1]!, asset = args[args.indexOf('--pattern') + 1]!, bytes = Buffer.from('verified payload');
    await fs.writeFile(join(dir, asset), bytes);
    if (mode !== 'no-checksum') await fs.writeFile(join(dir, `${asset}.sha256`), `${mode === 'corrupt' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`);
    return ok;
  });
}
function recorder(outcome = ok) {
  const calls: { command: string; args: readonly string[]; options?: RunOptions }[] = [];
  const exec: Exec = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'tar' && outcome.code === 0) await fs.mkdir(join(args[args.indexOf('-C') + 1]!, `${APP_PRODUCT}.app`));
    return outcome;
  };
  return { exec, calls };
}
async function setup() {
  const config = createConfigStore(await temporaryDirectory()), runner = downloader(), execution = recorder();
  const args: AppUpdateArgs = { config, runner, exec: execution.exec, evidence: mac, release: V };
  return { config, root: config.root, runner, ...execution, args };
}
async function stageFixture(windowsMode = false) {
  const h = await setup();
  if (windowsMode) h.args.evidence = windows;
  expect((await run({ ...h.args, stage: true }, io())).ok).toBe(true);
  if (windowsMode) expect(h.calls).toEqual([]);
  h.calls.length = 0;
  await writeJsonPrivate(join(h.root, 'run', 'app.json'), { writtenAt: 'unchanged', version: '0.1.9' });
  return h;
}
async function githubTeam(config: ReturnType<typeof createConfigStore>) {
  await config.update(c => { c.teams.test = { remote: 'https://github.com/acme/skills.git', handle: 'teddy' }; });
}
const marker = (root: string) => fs.readFile(join(root, 'run', 'app-update.json'), 'utf8').then(JSON.parse);

describe('app-update', () => {
  it('--check with a cached advertisement makes no git call and reports probe cached', async () => {
    const h = await setup(); await githubTeam(h.config); const state = createReleaseState(h.root), now = Date.now(), at = new Date(now).toISOString();
    await state.update(s => { s.advertisement = { version: V, at, source: 'git-tags' }; s.attempt = { at, ok: true, error: null }; });
    const before = await fs.readFile(join(h.root, 'run', 'latest-version.json'), 'utf8');
    const output = io(); expect(await run({ ...h.args, now: () => now }, output)).toMatchObject({ ok: true, value: { probe: 'cached', latest: V, latestAt: at } });
    expect(h.runner.calls).toEqual([]); expect(output.lines).toEqual([]); expect(await fs.readFile(join(h.root, 'run', 'latest-version.json'), 'utf8')).toBe(before);
  });
  it('--check --force runs exactly one git ls-remote and reports the highest stable tag', async () => {
    const h = await setup(); await githubTeam(h.config); const call = vi.fn<Runner['run']>().mockResolvedValue({ ...ok, stdout: ['0.1.9','0.1.12','0.1.13-rc1','0.2.0'].map(v => `${'a'.repeat(40)}\trefs/tags/v${v}`).join('\n') });
    expect(await run({ ...h.args, force: true, runner: { run: call } }, io())).toMatchObject({ ok: true, value: { probe: 'ok', latest: '0.2.0' } });
    expect(call).toHaveBeenCalledExactlyOnceWith('git', ['-c', `url.${pkg.APPROVED_UPSTREAM}.insteadOf=${pkg.APPROVED_UPSTREAM}`, 'ls-remote', '--tags', '--', pkg.APPROVED_UPSTREAM], { deadlineMs: 10000, maxOutputBytes: 65536 });
  });
  it('--check on a machine with no GitHub-hosted team reports probe skipped and still succeeds', async () => {
    const h = await setup(); expect(await run({ ...h.args, force: true }, io())).toMatchObject({ ok: true, value: { probe: 'skipped', latest: null } }); expect(h.runner.calls).toEqual([]);
  });
  it('--check reports probe failed with a sanitized reason and never fails the verb', async () => {
    const h = await setup(); await githubTeam(h.config);
    const result = await run({ ...h.args, force: true, runner: { run: async () => ({ ...ok, code: 1, stderr: 'cannot read https://user:secret@github.com/acme/repo' }) } }, io());
    expect(result).toMatchObject({ ok: true, value: { probe: 'failed', probeError: expect.any(String) } }); expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('--check lists installed and staged versions from disk, newest first', async () => {
    const h = await setup(); for (const v of ['0.1.9','0.1.10']) await writeJsonPrivate(join(h.root, 'app', v, 'installed.json'), {});
    for (const v of [V,'0.1.11']) await writeJsonPrivate(join(h.root, 'app', v, 'staged.json'), {});
    for (const v of ['.download-abc','not-a-version']) await fs.mkdir(join(h.root, 'app', v));
    expect(await run(h.args, io())).toMatchObject({ ok: true, value: { installed: ['0.1.10','0.1.9'], staged: V } });
  });
  it('--check with no app directory at all returns empty lists, not an error', async () => {
    const h = await setup(); expect(await run(h.args, io())).toMatchObject({ ok: true, value: { installed: [], staged: null, lastApply: null } });
  });
  it('--check reports the last apply marker and process.ppid', async () => {
    const h = await setup(), value = { schema: 1, version: V, phase: 'failed', at: '2026-09-10T00:00:00Z', error: 'boom' };
    await writeJsonPrivate(join(h.root, 'run', 'app-update.json'), value); expect(await run(h.args, io())).toMatchObject({ ok: true, value: { lastApply: value, ppid: process.ppid } });
  });
  it('--check ignores an unreadable or malformed apply marker', async () => {
    const h = await setup(); await fs.mkdir(join(h.root, 'run'));
    for (const content of ['{','{}','null']) { await fs.writeFile(join(h.root, 'run', 'app-update.json'), content); expect(await run(h.args, io())).toMatchObject({ ok: true, value: { lastApply: null } }); }
  });
  it('--stage on macOS downloads, verifies, unpacks and renames the version directory into place', async () => {
    const h = await setup(); expect(await run({ ...h.args, stage: true }, io())).toMatchObject({ ok: true, value: { staged: true, bytes: 16, path: join(h.root, 'app', V) } });
    const dir = h.runner.calls[0]!.args.at(-1)!;
    expect(h.runner.calls[0]!.args).toEqual(['release','download',`v${V}`,'--repo',APP_REPOSITORY,'--pattern',ASSET,'--pattern',ASSET+'.sha256','--dir',dir]);
    expect(h.calls).toEqual([{ command: 'tar', args: ['-xzf',join(dir,ASSET),'-C',dir], options: undefined }]);
    expect(JSON.parse(await fs.readFile(join(h.root,'app',V,'staged.json'),'utf8'))).toMatchObject({ bundle: `${APP_PRODUCT}.app`, installer: null });
    expect(await fs.readdir(join(h.root,'app'))).toEqual([V]); expect(await fs.readdir(join(h.root,'app',V))).toEqual([`${APP_PRODUCT}.app`,'staged.json']);
  });
  it('--stage twice is a no-op with zero gh calls the second time', async () => {
    const h = await stageFixture(); h.runner.calls.length = 0;
    expect(await run({ ...h.args, stage: true }, io())).toMatchObject({ ok: true, value: { staged: true, alreadyStaged: true, bytes: 0 } }); expect(h.runner.calls).toEqual([]);
  });
  it('--stage refuses a version that is not three numbers before touching the network', async () => {
    const h = await setup(); for (const release of ['0.1.12; rm -rf /','latest','']) expect(await run({ ...h.args, stage: true, release }, io())).toMatchObject({ ok: false, error: `\`${release}\` is not a released version; use three numbers, as in 0.1.11.` }); expect(h.runner.calls).toEqual([]);
  });
  it('--stage discards a checksum mismatch and leaves no version directory', async () => {
    const h = await setup(); expect(await run({ ...h.args, stage: true, runner: downloader('corrupt') }, io())).toMatchObject({ ok: false, error: expect.stringContaining('did not match its published checksum') }); expect(await fs.readdir(join(h.root,'app'))).toEqual([]);
  });
  it.each(['release not found','Not Found (HTTP 404)','no assets match','missing','no-checksum'])('--stage treats missing assets (%s) as notPublished, not a failure', async mode => {
    const h = await setup(); expect(await run({ ...h.args, stage: true, runner: downloader(mode) }, io())).toMatchObject({ ok: true, value: { notPublished: true, staged: false, path: null } }); expect(await fs.readdir(join(h.root,'app'))).toEqual([]);
  });
  it('--stage reports the offline sentence when gh cannot reach GitHub', async () => {
    const h = await setup(); expect(await run({ ...h.args, stage: true, runner: downloader('dial tcp: lookup api.github.com: no such host') }, io())).toMatchObject({ ok: false, error: expect.stringContaining('you appear to be offline or behind a proxy that blocks github.com') });
  });
  it('--stage reports the missing-gh sentence when gh is not installed', async () => {
    const h = await setup(); expect(await run({ ...h.args, stage: true, runner: noGhRunner }, io())).toMatchObject({ ok: false, error: expect.stringMatching(/^GitHub CLI \(gh\) is not installed/) });
  });
  it('--stage reports a ten-minute timeout distinctly', async () => {
    const h = await setup(); expect(await run({ ...h.args, stage: true, runner: downloader('timeout') }, io())).toMatchObject({ ok: false, error: expect.stringContaining('took longer than 10 minutes') });
  });
  it('--stage sweeps staging directories older than an hour and keeps recent ones', async () => {
    const h = await setup(), old = join(h.root,'app','.download-old'), recent = join(h.root,'app','.download-new');
    await fs.mkdir(old,{recursive:true}); await fs.mkdir(recent); await fs.utimes(old,new Date(0),new Date(Date.now()-7_200_000));
    await run({ ...h.args, stage: true }, io()); expect(await exists(old)).toBe(false); expect(await exists(recent)).toBe(true);
  });
  it.each([
    [{platform:'linux',arch:'x64',procVersion:'Microsoft WSL'},'The desktop app runs on the Windows side of this machine, not inside WSL; update it from a Windows terminal.'],
    [{platform:'linux',arch:'x64',procVersion:'Linux'},'There is no Linux desktop app yet, so there is nothing to update; everything works from the terminal.'],
    [{platform:'freebsd',arch:'x64'},'There is no desktop app for this machine, so there is nothing to update; everything works from the terminal.'],
  ] as const)('--stage on unsupported %j returns the platform sentence', async (evidence,error) => {
    const h = await setup(); expect(await run({ ...h.args, stage:true,evidence },io())).toMatchObject({ok:false,error}); expect(h.runner.calls).toEqual([]);
    expect(await run({...h.args,evidence},io())).toMatchObject({ok:true,value:{supported:false}});
  });
  it('--apply hands off exactly one detached child with --release and no --frames', async () => {
    const h = await stageFixture(), framed = Object.assign(io(),{channel:'frames' as const});
    expect(await run({...h.args,apply:true,entry:'/cli/index.js'},framed)).toMatchObject({ok:true,value:{mode:'apply',version:V,awaitPid:process.ppid,handedOff:true}});
    expect(h.calls).toEqual([{command:process.execPath,args:['/cli/index.js','app-update','--apply-now','--release',V,'--await-pid',String(process.ppid)],options:{detach:true}}]);
    expect(h.calls[0]!.args).not.toContain('--frames'); expect(h.calls[0]!.args).not.toContain('--version');
  });
  it('--apply from a terminal watches no pid', async () => {
    const h = await stageFixture(); expect(await run({...h.args,apply:true},io())).toMatchObject({ok:true,value:{awaitPid:null}}); expect(h.calls[0]!.args).not.toContain('--await-pid');
  });
  it('--apply honours an explicit --await-pid and rejects a bad one', async () => {
    const h = await stageFixture(); await run({...h.args,apply:true,awaitPid:'4242'},io()); expect(h.calls[0]!.args.slice(-2)).toEqual(['--await-pid','4242']); h.calls.length=0;
    for (const awaitPid of ['abc','-1','0','1e999','1.5']) expect(await run({...h.args,apply:true,awaitPid},io())).toMatchObject({ok:false,error:'--await-pid must be a process id.'}); expect(h.calls).toEqual([]);
  });
  it('--apply with nothing staged fails and spawns nothing', async () => {
    const h = await setup(); expect(await run({...h.args,apply:true},io())).toMatchObject({ok:false,error:`Nothing is staged for ${V}; download it first.`}); expect(h.calls).toEqual([]);
  });
  it('--apply-now on Windows waits for the pid, then runs the installer with /S /UPDATE /R', async () => {
    const h = await stageFixture(true), before=await fs.readFile(join(h.root,'run','app.json'),'utf8'), alive=vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    expect(await run({...h.args,applyNow:true,awaitPid:42,alive,pollMs:1},io())).toMatchObject({ok:true,value:{phase:'launched'}});
    expect(alive).toHaveBeenCalledTimes(3); expect(h.calls).toEqual([{command:join(h.root,'app',V,WIN),args:['/S','/UPDATE','/R'],options:undefined}]);
    expect(await exists(join(h.root,'app',V,'installed.json'))).toBe(true); expect(await marker(h.root)).toMatchObject({phase:'launched'}); expect(await fs.readFile(join(h.root,'run','app.json'),'utf8')).toBe(before);
  });
  it('--apply-now on macOS opens the bundle without -n', async () => {
    const h = await stageFixture(), before=await fs.readFile(join(h.root,'run','app.json'),'utf8'); await run({...h.args,applyNow:true},io());
    expect(h.calls).toEqual([{command:'open',args:[join(h.root,'app',V,`${APP_PRODUCT}.app`)],options:undefined}]); expect(await marker(h.root)).toMatchObject({phase:'launched'}); expect(await exists(join(h.root,'app',V,'installed.json'))).toBe(true); expect(await fs.readFile(join(h.root,'run','app.json'),'utf8')).toBe(before);
  });
  it('--apply-now relaunches the surviving exe exactly once when the installer exits non-zero', async () => {
    const h = await stageFixture(true), localAppData=join(h.root,'local'), exe=join(localAppData,APP_PRODUCT,`${APP_SLUG}.exe`), failure=recorder({...ok,code:1,stderr:'kill failed'});
    await fs.mkdir(join(localAppData,APP_PRODUCT),{recursive:true}); await fs.writeFile(exe,'');
    await run({...h.args,applyNow:true,exec:failure.exec,localAppData},io()); expect(await marker(h.root)).toMatchObject({phase:'failed',error:expect.stringContaining('exited with code 1')});
    expect(failure.calls).toHaveLength(2); expect(failure.calls[1]).toEqual({command:exe,args:[],options:{detach:true}});
  });
  it('--apply-now on macOS refuses to open when the watched process never exits', async () => {
    const h = await stageFixture(); expect(await run({...h.args,applyNow:true,awaitPid:42,alive:()=>true,waitMs:5,pollMs:1},io())).toMatchObject({ok:true,value:{phase:'failed',error:'The desktop app was still running after 30 seconds, so the new version was not opened.'}}); expect(h.calls).toEqual([]); expect(await marker(h.root)).toMatchObject({phase:'failed'});
  });
  it('--apply-now on Windows proceeds when the watched process never exits', async () => {
    const h = await stageFixture(true); expect(await run({...h.args,applyNow:true,awaitPid:42,alive:()=>true,waitMs:5,pollMs:1},io())).toMatchObject({ok:true,value:{phase:'launched'}}); expect(h.calls).toHaveLength(1);
  });
  it('--apply-now prunes to the two newest version directories and never the running or just-launched one', async () => {
    const h = await stageFixture(); vi.spyOn(pkg,'packageVersion').mockReturnValue('0.1.9');
    for(const v of ['0.1.7','0.1.8','0.1.9','0.1.11','.download-tmp','not-a-version'])await fs.mkdir(join(h.root,'app',v));
    await run({...h.args,applyNow:true},io()); expect(await fs.readdir(join(h.root,'app'))).toEqual(['.download-tmp','0.1.11',V,'0.1.9','not-a-version']);
  });
  it('--apply-now survives a prune failure', async () => {
    const h = await stageFixture(); for(const v of ['0.1.7','0.1.8'])await fs.mkdir(join(h.root,'app',v));
    vi.mocked(fs.rm).mockRejectedValueOnce(Object.assign(new Error('denied'),{code:'EACCES'}));
    expect(await run({...h.args,applyNow:true},io())).toMatchObject({ok:true,value:{phase:'launched'}}); expect(await marker(h.root)).toMatchObject({phase:'launched'});
  });
  it('rejects two modes at once', async () => {
    const h = await setup(); expect(await run({...h.args,check:true,stage:true},io())).toMatchObject({ok:false,error:'Choose one of --check, --stage or --apply.'});
  });
  it.skipIf(process.platform==='win32')('writes the apply marker with mode 0600 on POSIX', async () => {
    const h = await stageFixture(); await run({...h.args,applyNow:true},io()); expect((await fs.stat(join(h.root,'run','app-update.json'))).mode&0o777).toBe(0o600);
  });
  it('handles missing versions, entry points, and spawn failures explicitly', async () => {
    const h = await stageFixture(); expect(await run({...h.args,apply:true,entry:''},io())).toMatchObject({ok:false,error:'This copy cannot locate its own entry point, so it cannot hand the install off.'});
    expect(await run({...h.args,apply:true,exec:async()=>{throw new Error('spawn ENOENT');}},io())).toMatchObject({ok:false,error:'Could not start the installer: spawn ENOENT'});
    vi.spyOn(pkg,'packageVersion').mockReturnValue(null); expect(await run({...h.args,release:undefined,stage:true},io())).toMatchObject({ok:false,error:'This copy has no version, so it cannot say which desktop app to download.'});
  });
  it('reports unpack, missing bundle, disk and corrupt metadata failures', async () => {
    const h = await setup(); expect(await run({...h.args,stage:true,exec:recorder({...ok,code:1,stderr:'bad tar'}).exec},io())).toMatchObject({ok:false,error:expect.stringContaining('Could not unpack')});
    expect(await run({...h.args,stage:true,exec:async()=>ok},io())).toMatchObject({ok:false,error:expect.stringContaining('did not contain an application bundle')});
    expect(await run({...h.args,stage:true,config:{...h.config,ensureRoot:async()=>{throw new Error('ENOSPC');}}},io())).toMatchObject({ok:false,error:expect.stringContaining('ENOSPC')});
    await writeJsonPrivate(join(h.root,'app',V,'staged.json'),{}); expect(await run({...h.args,applyNow:true},io())).toMatchObject({ok:true,value:{phase:'failed'}});
  });
});

it('check absorbs unreadable config without probing or writing', async () => {
  const h = await setup(); await fs.writeFile(join(h.root,'config.json'),'{');
  expect(await run({...h.args,force:true},io())).toMatchObject({ok:true,value:{probe:'failed',latest:null}});
  expect(h.runner.calls).toEqual([]); expect(await fs.readFile(join(h.root,'config.json'),'utf8')).toBe('{');
});
it('stage on Windows ARM64 selects the ARM installer and never installs or records consent', async () => {
  const h = await setup(); const before = await h.config.read();
  expect(await run({...h.args,stage:true,evidence:{platform:'win32',arch:'arm64'}},io())).toMatchObject({ok:true,value:{asset:`${APP_SLUG}_${V}_arm64-setup.exe`,staged:true}});
  expect(h.calls).toEqual([]); expect(await h.config.read()).toEqual(before); expect(await exists(join(h.root,'run','app.json'))).toBe(false);
});
it('an installed release also makes stage a no-op', async () => {
  const h = await setup();await writeJsonPrivate(join(h.root,'app',V,'installed.json'),{});
  expect(await run({...h.args,stage:true},io())).toMatchObject({ok:true,value:{alreadyStaged:true}});expect(h.runner.calls).toEqual([]);expect(h.calls).toEqual([]);
});
it('macOS open failures persist the platform output and never prune', async () => {
  const h = await stageFixture();await fs.mkdir(join(h.root,'app','0.0.1'));
  expect(await run({...h.args,applyNow:true,exec:recorder({...ok,code:1,stderr:'open refused'}).exec},io())).toMatchObject({ok:true,value:{phase:'failed',error:'open refused'}});
  expect(await marker(h.root)).toMatchObject({phase:'failed',error:'open refused'});expect(await exists(join(h.root,'app','0.0.1'))).toBe(true);
});
it('keeps the just-launched version even when two newer directories exist', async () => {
  const h = await stageFixture();for(const v of ['0.1.13','0.1.14','0.1.8'])await fs.mkdir(join(h.root,'app',v));
  await run({...h.args,applyNow:true},io());expect(await exists(join(h.root,'app',V))).toBe(true);expect(await exists(join(h.root,'app','0.1.8'))).toBe(false);
});
it('names this copy own version when it is a prerelease and no --release was given', async () => {
  const h = await setup();vi.spyOn(pkg,'packageVersion').mockReturnValue('0.13.0-rc.1');
  expect(await run({...h.args,release:undefined,stage:true},io())).toMatchObject({ok:false,error:'`0.13.0-rc.1` is not a released version; use three numbers, as in 0.1.11.'});
  expect(h.runner.calls).toEqual([]);expect(h.calls).toEqual([]);
});
it('keeps the installer failure when the Windows fallback relaunch cannot spawn', async () => {
  const h = await stageFixture(true),localAppData=join(h.root,'local'),exe=join(localAppData,APP_PRODUCT,`${APP_SLUG}.exe`),installer=join(h.root,'app',V,WIN),calls:string[]=[];
  await fs.mkdir(join(localAppData,APP_PRODUCT),{recursive:true});await fs.writeFile(exe,'');
  const exec:Exec=async command=>{calls.push(command);if(command===exe)throw Object.assign(new Error('spawn EACCES'),{code:'EACCES'});return {...ok,code:1,stderr:'kill failed'};};
  const error='The desktop app installer exited with code 1. kill failed';
  expect(await run({...h.args,applyNow:true,exec,localAppData},io())).toMatchObject({ok:true,value:{phase:'failed',error}});
  expect(await marker(h.root)).toMatchObject({phase:'failed',error});expect(calls).toEqual([installer,exe]);
});


it('app-update stages the ARM64 installer for an emulated x64 Node', async () => {
  const h = await setup();
  const asset = `${APP_SLUG}_${V}_arm64-setup.exe`;
  expect(await run({ ...h.args, stage: true, evidence: { platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITEW6432: 'ARM64' } } }, io())).toMatchObject({ ok: true, value: { platform: 'win32-arm64', asset, staged: true } });
  expect(h.runner.calls.some(call => call.args.includes(asset))).toBe(true);
  expect(JSON.parse(await fs.readFile(join(h.root, 'app', V, 'staged.json'), 'utf8'))).toMatchObject({ platform: 'win32-arm64', installer: asset });
  expect(h.calls).toEqual([]);
});

it('app-update passes the live environment, but injected evidence still wins unchanged', async () => {
  const h = await setup();
  const detect = vi.spyOn(platformModule, 'detectPlatform').mockReturnValue('win32-arm64');
  expect(await run({ ...h.args, evidence: undefined }, io())).toMatchObject({ ok: true, value: { platform: 'win32-arm64' } });
  expect(detect.mock.calls[0]?.[0].env).toBe(process.env);
  await run(h.args, io());
  expect(detect.mock.calls[1]?.[0]).toBe(mac);
  expect(mac).not.toHaveProperty('env');
});
