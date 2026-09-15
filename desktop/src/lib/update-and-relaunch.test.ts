import { expect, it } from 'vitest';
import type { AppUpdateStaged, AppUpdateStatus } from '../backend/types';
import { concludeDownload, planUpdate } from './update-and-relaunch';

const base:AppUpdateStatus={appVersion:'0.18.0',supported:true,cliVersion:'0.18.0',latest:'0.19.0',latestAt:'2026-09-14T21:00:00Z',probe:'ok',probeError:null,staged:null,installed:[],lastApply:null,newer:true,ppid:42,platform:'win32-arm64'};

it.each<[string,Partial<AppUpdateStatus>,ReturnType<typeof planUpdate>]>([
 ['no desktop build for this machine',{supported:false,platform:'wsl'},{kind:'unsupported'}],
 // No team on the machine lives on GitHub, so the CLI never reads release tags; --force cannot change that.
 ['release advertisements are not probed here',{probe:'skipped',latest:null,latestAt:null,newer:false},{kind:'not-checked'}],
 ['nothing has ever been read from GitHub',{probe:'failed',probeError:'dial tcp: connection refused',latest:null,latestAt:null,newer:false},{kind:'unreachable',error:'dial tcp: connection refused'}],
 // A failed probe cannot vouch for a stale cache: "up to date" is a claim about github.com, not about the cache.
 ['the probe failed and the cache is not newer',{probe:'failed',probeError:null,newer:false},{kind:'unreachable',error:null}],
 ['the probe failed but the cache already advertises a newer build',{probe:'failed',probeError:'offline'},{kind:'download',version:'0.19.0'}],
 ['the running build is the newest',{latest:'0.18.0',newer:false},{kind:'up-to-date'}],
 ['the newest build is installed but this window still runs the old one',{installed:['0.19.0'],staged:'0.19.0'},{kind:'installed',version:'0.19.0'}],
 ['the newest build is downloaded and verified',{staged:'0.19.0'},{kind:'ready',version:'0.19.0'}],
 ['an older download is staged, not the newest',{staged:'0.18.5'},{kind:'download',version:'0.19.0'}],
 ['a newer build is advertised and nothing is staged',{},{kind:'download',version:'0.19.0'}],
])('plans the one-shot when %s',(_name,patch,plan)=>{
 expect(planUpdate({...base,...patch})).toEqual(plan);
});

const staged:AppUpdateStaged={version:'0.19.0',staged:true,notPublished:false,alreadyStaged:false};
it.each<[string,Partial<AppUpdateStaged>,ReturnType<typeof concludeDownload>]>([
 ['the download verified',{},{kind:'ready',version:'0.19.0'}],
 ['the CLI found it already staged',{alreadyStaged:true},{kind:'ready',version:'0.19.0'}],
 ['the tag exists without assets',{staged:false,notPublished:true},{kind:'not-published',version:'0.19.0'}],
 // The CLI's contract has no fourth state; an unstaged, published answer is still reported as a failure, never as ready.
 ['the CLI reported neither staged nor unpublished',{staged:false},{kind:'failed',version:'0.19.0',error:'The download did not complete; nothing was staged for 0.19.0.'}],
])('concludes the download when %s',(_name,patch,outcome)=>{
 expect(concludeDownload({...staged,...patch})).toEqual(outcome);
});
