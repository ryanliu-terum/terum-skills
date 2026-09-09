import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createTauriBackend, read } from '../index';
import { cliRun } from '../run';
import { fakeBridge, STATE } from './fake-bridge';

const directory = resolve('../.planning/codex-runs/m7-S7f/frames');
function recorded(name: string) {
  return readFileSync(resolve(directory, name + '.jsonl'), 'utf8').trim().split('\n');
}
function replay(lines: string[]) {
  return fakeBridge((_args, emit) => {
    for (const line of lines) emit({ kind: 'stdout', line });
  });
}
const status = z.object({ version: z.string(), teams: z.array(z.object({ team: z.string() }).passthrough()) }).passthrough();

it('replays older status through the generic read driver but rejects it as an incomplete served schema', async () => {
  const f = replay(recorded('status'));
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
it('replays the rebuilt fixture through Library, project and installed scopes and Skill detail',async()=>{
  const backend=createTauriBackend(inventoryReplay().bridge);
  const library=await backend.library({scope:'Global',team:'acme'});
  expect(library).toMatchObject({ok:true,value:{title:'3 of 3 skills',projects:[{name:'terum',skills:['22222222-2222-4222-8222-222222222222'],remotes:['github.com/acme/terum']}],skills:expect.arrayContaining([expect.objectContaining({name:'deploy-check',desc:'a deploy needs a pre-flight checklist.',normalizedGrants:'none',installed:true,installsN:2})])}});
  const detail=await backend.skill({ref:'deploy-check'});if(!detail.ok)throw new Error(detail.error);
  const resultFrame=recorded('ls').map(line=>JSON.parse(line) as {t:string;value?:{skills:{name:string;updated:string;grantsHash:string}[]}}).find(frame=>frame.t==='result');
  const row=resultFrame?.value?.skills.find(row=>row.name==='deploy-check');
  expect(detail.value.updated).toBe(row?.updated);expect(detail.value.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(detail.value.grantsHash).toBe(row?.grantsHash);
  expect(detail.value).toMatchObject({desc:'a deploy needs a pre-flight checklist.',grants:['none'],users:[['seed','S','Global · since 2026-08-20T00:00:00Z'],['mira','MC','Global · since 2026-08-25T00:00:00Z']],skillMd:{markdown:'# deploy-check\n\nUse this skill when a deploy needs a pre-flight checklist.\n\n1. Step one.\n2. Step two.\n'},receipt:null,lines:null,favorites:null});
  const project=await backend.library({scope:'terum',team:'acme'});expect(project).toMatchObject({ok:true,value:{title:'1 of 3 skills',skills:[{name:'tdd',project:'terum'}]}});
  expect(await backend.library({scope:'installed',team:'acme'})).toMatchObject({ok:true,value:{skills:[{name:'deploy-check'}]}});
  const member=recorded('ls-member-mira').map(line=>JSON.parse(line) as {t:string;value?:unknown}).find(frame=>frame.t==='result');
  expect(member?.value).toMatchObject({member:{handle:'mira',declined:[]},projects:[{name:'terum'}]});
});
