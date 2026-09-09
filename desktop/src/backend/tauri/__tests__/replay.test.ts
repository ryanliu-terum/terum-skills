import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createTauriBackend, read } from '../index';
import { cliRun } from '../run';
import { fakeBridge, STATE } from './fake-bridge';

const directory = resolve('../.planning/codex-runs/m7-S7g/frames');
const s7dDirectory = resolve('../.planning/codex-runs/m7-S7d/frames');
function recorded(name: string) {
  return readFileSync(resolve(name === 'usage-error' || name === 'decline' ? s7dDirectory : directory, name + '.jsonl'), 'utf8').trim().split('\n');
}
// S7f's recording predates the S7k status payload (no ledger, identity or tools): the older schema the served surface must refuse.
function olderStatus() {
  return readFileSync(resolve('../.planning/codex-runs/m7-S7f/frames/status.jsonl'), 'utf8').trim().split('\n');
}
function replay(lines: string[]) {
  return fakeBridge((_args, emit) => {
    for (const line of lines) emit({ kind: 'stdout', line });
  });
}
const status = z.object({ version: z.string(), teams: z.array(z.object({ team: z.string() }).passthrough()) }).passthrough();

it('replays older status through the generic read driver but rejects it as an incomplete served schema', async () => {
  const f = replay(olderStatus());
  const result = await read(cliRun(f.bridge, Promise.resolve(STATE), ['status'], { map: value => status.parse(value) }));
  expect(result.ok).toBe(true);
  expect(result.value?.teams.map(team => team.team)).toEqual(['acme']);
  const served = await createTauriBackend(f.bridge).status();
  expect(served.ok).toBe(false);
  expect(served.value).toBeUndefined();
  if (!served.ok) expect(served.error).toContain('ledger');
  expect(f.spawns).toHaveLength(3);
});

it('retains the recorded status payload when its result frame fails', async () => {
  // The recording is healthy. Change only its result envelope to exercise failure-with-value.
  const lines = recorded('status').map(line => {
    const frame = z.object({ t: z.string() }).passthrough().parse(JSON.parse(line));
    return frame.t === 'result' ? JSON.stringify({ ...frame, ok: false, exitCode: 1, error: 'Unreadable team clone.' }) : line;
  });
  const f = replay(lines);
  const result = await read(cliRun(f.bridge, Promise.resolve(STATE), ['status'], { map: value => status.parse(value) }));
  expect(result.ok).toBe(false);
  expect(result.value?.teams).toHaveLength(1);
  expect(result.value?.teams[0]?.team).toBe('acme');
  if (result.ok) throw new Error('Expected failed status');
  expect(result.error).toMatch(/^Unreadable team clone\.\nterum-skills/);
});

it('serves all three recorded search hits with real metadata and no fabricated descriptions', async () => {
  const lines = recorded('search');
  const resultFrame = lines.map(line => z.object({ t: z.string(), value: z.unknown().optional() }).parse(JSON.parse(line))).find(frame => frame.t === 'result');
  const hits = z.array(z.object({ description: z.string(), team: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), endorsed: z.string(), unresolved: z.boolean() })).parse(resultFrame?.value);
  expect(hits).toHaveLength(3);
  expect(hits.map(hit => hit.team)).toEqual(['acme', 'acme', 'acme']);
  const result = await createTauriBackend(replay(lines).bridge).search({ q: '' });
  expect(result).toEqual({ ok: true, value: hits.map(hit => ({ ...hit, kind: 'skill', ref: `${hit.team}/${hit.name}` })) });
});


function inventoryReplay() {
  return fakeBridge((args,emit)=>{
    const name=args[0]==='ls'?args.includes('--local')?'ls-local':args[1]==='project'?'ls-project-terum':args[1]==='member'?'ls-member-mira':'ls':args[0]==='validate'?'validate-deploy-check':args[0]!;
    for(const line of recorded(name))emit({kind:'stdout',line});
  });
}
it('replays the rebuilt fixture through Global and checkout scopes and Skill detail',async()=>{
  const backend=createTauriBackend(inventoryReplay().bridge);
  const library=await backend.library({scope:{kind:'global'},team:'acme'});
  expect(library).toMatchObject({ok:true,value:{title:'1 skill folder in Global · 1 shared with acme',root:{id:'global',kind:'global',count:undefined},team:{kind:'ok',team:'acme'},skills:expect.arrayContaining([expect.objectContaining({name:'deploy-check',desc:'a deploy needs a pre-flight checklist.',normalizedGrants:'none',installed:true,installsN:2})])}});
  const detail=await backend.skill({ref:'deploy-check'});if(!detail.ok)throw new Error(detail.error);
  const resultFrame=recorded('ls').map(line=>JSON.parse(line) as {t:string;value?:{skills:{name:string;updated:string;grantsHash:string}[]}}).find(frame=>frame.t==='result');
  const row=resultFrame?.value?.skills.find(row=>row.name==='deploy-check');
  expect(detail.value.updated).toBe(row?.updated);expect(detail.value.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(detail.value.grantsHash).toBe(row?.grantsHash);
  expect(detail.value).toMatchObject({desc:'a deploy needs a pre-flight checklist.',grants:['none'],users:[['seed','S','Global · since 2026-08-20T00:00:00Z'],['mira','MC','Global · since 2026-08-25T00:00:00Z']],skillMd:{markdown:'# deploy-check\n\nUse this skill when a deploy needs a pre-flight checklist.\n\n1. Step one.\n2. Step two.\n'},receipt:null,lines:null,favorites:null});
  const project=await backend.library({scope:{kind:'checkout',root:'/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed'},team:'acme'});expect(project).toMatchObject({ok:true,value:{title:'0 skill folders in seed',skills:[],root:{id:'/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed',kind:'checkout'}}});
  expect(await backend.library({scope:{kind:'global'},team:'acme'})).toMatchObject({ok:true,value:{skills:[{name:'deploy-check'}]}});
  const member=recorded('ls-member-mira').map(line=>JSON.parse(line) as {t:string;value?:unknown}).find(frame=>frame.t==='result');
  expect(member?.value).toMatchObject({member:{handle:'mira',declined:[]},projects:[{name:'terum'}]});
});

it('replays S7g local frames through settings: the real placement path, name, 12-character version and drawn state',async()=>{
  const result=await createTauriBackend(inventoryReplay().bridge).settings();
  const frame=recorded('ls-local').map(line=>JSON.parse(line) as {t:string;value?:{local:{rows:{name:string;path:string;health:string;placement:{id:string;team:string;version:string}}[]}[]}}).find(frame=>frame.t==='result');
  const row=frame?.value?.local.flatMap(section=>section.rows).find(row=>row.name==='deploy-check');
  expect(row?.health).toBe('up-to-date');expect(row?.placement.team).toBe('acme');
  expect(result).toMatchObject({ok:true,value:{PLACEMENTS:[[row?.path,'deploy-check','Global',row?.placement.version.slice(0,12),'2026-09-01T00:00:00Z','up to date']],PLACEMENTS_N:1,PINNED_N:1}});
  expect(result.value?.SHARED).toEqual([['22222222-2222-4222-8222-222222222222',expect.stringContaining('/skills/tdd'),'acme','—']]);
});
it.each([
  ['usage-error', false, "error: unknown option '-x'"],
  ['decline', true, 'Connect was declined.'],
])('replays the rebuilt CLI %s result without inferring cancellation', async (name, cancelled, error) => {
  const f = replay(recorded(name));
  const run = cliRun(f.bridge, Promise.resolve(STATE), [name], { map: value => value });
  expect(await run.done).toEqual({ ok: false, error, ...(cancelled ? { cancelled: true } : {}) });
  const frames = []; for await (const frame of run.frames) frames.push(frame);
  expect(frames.at(-1)).toEqual({ t: 'result', ok: false, error, ...(cancelled ? { declined: true } : {}) });
});
it('replays the rebuilt ls recording through the read consumer', async () => {
  const f = replay(recorded('ls'));
  const result = await read(cliRun(f.bridge, Promise.resolve(STATE), ['ls'], { map: value => value }));
  expect(result.ok).toBe(true);
  expect(result.value).toBeDefined();
});


it('serves scoped folder titles and best-effort team enrichment',async()=>{
 const backend=createTauriBackend(inventoryReplay().bridge);
 const global=await backend.library({scope:{kind:'global'},team:'acme'});
 const project=await backend.library({scope:{kind:'checkout',root:'/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed'},team:'acme'});
 expect(global).toMatchObject({ok:true,value:{title:'1 skill folder in Global · 1 shared with acme',team:{kind:'ok',team:'acme'},overview:{skills_note:'—',installs:'2',evaluated:'—',attention:'—'}}});
 expect(project).toMatchObject({ok:true,value:{title:'0 skill folders in seed',team:{kind:'ok',team:'acme'},overview:{skills_note:'—',installs:'0',evaluated:'—',attention:'—'}}});
});
it('serves no default eval k from the real backend',async()=>{
 expect(await createTauriBackend(inventoryReplay().bridge).settings()).toMatchObject({ok:true,value:{K:null}});
});
