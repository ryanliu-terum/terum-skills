import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTauriBackend, read } from '../index';
import { cliRun } from '../run';
import { fakeBridge, STATE } from './fake-bridge';

import { inventoryReplay, marketplaceRecorded } from './inventory-replay';
import { relativeTime } from '../../../lib/relative-time';
afterEach(() => vi.restoreAllMocks());

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


// The S7g recording holds one member and one project frame, so every `ls member`/`ls project` replays them.
function s7gReplay() {
  return fakeBridge((args,emit)=>{
    const name=args[0]==='ls'?args.includes('--local')?'ls-local':args[1]==='project'?'ls-project-terum':args[1]==='member'?'ls-member-mira':'ls':args[0]==='validate'?'validate-deploy-check':args[0]!;
    for(const line of recorded(name))emit({kind:'stdout',line});
  });
}
it('replays the rebuilt fixture through Global and checkout scopes and Skill detail',async()=>{
  const backend=createTauriBackend(s7gReplay().bridge);
  const library=await backend.library({scope:{kind:'global'},team:'acme'});
  expect(library).toMatchObject({ok:true,value:{title:'1 skill folder in Global · 1 shared with acme',root:{id:'global',kind:'global',count:undefined},team:{kind:'ok',team:'acme'},skills:expect.arrayContaining([expect.objectContaining({name:'deploy-check',desc:'Use this skill when a deploy needs a pre-flight checklist.',normalizedGrants:'none',installed:'placed',installsN:2})])}});
  const detail=await backend.skill({ref:'deploy-check'});if(!detail.ok)throw new Error(detail.error);
  const resultFrame=recorded('ls').map(line=>JSON.parse(line) as {t:string;value?:{skills:{name:string;updated:string;grantsHash:string}[]}}).find(frame=>frame.t==='result');
  const row=resultFrame?.value?.skills.find(row=>row.name==='deploy-check');
  expect(detail.value.updated).toBe(row?.updated);expect(detail.value.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(detail.value.grantsHash).toBe(row?.grantsHash);
  expect(detail.value).toMatchObject({desc:'Use this skill when a deploy needs a pre-flight checklist.',grants:[],users:[['seed','S','Global · since 2026-08-20'],['mira','MC','Global · since 2026-08-25']],skillMd:{markdown:'# deploy-check\n\nUse this skill when a deploy needs a pre-flight checklist.\n\n1. Step one.\n2. Step two.\n'},receipt:null,lines:6,favorites:null});
  const project=await backend.library({scope:{kind:'checkout',root:'/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed'},team:'acme'});expect(project).toMatchObject({ok:true,value:{title:'0 skill folders in seed',skills:[],root:{id:'/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed',kind:'checkout'}}});
  expect(await backend.library({scope:{kind:'global'},team:'acme'})).toMatchObject({ok:true,value:{skills:[{name:'deploy-check'}]}});
  const member=recorded('ls-member-mira').map(line=>JSON.parse(line) as {t:string;value?:unknown}).find(frame=>frame.t==='result');
  expect(member?.value).toMatchObject({member:{handle:'mira',declined:[]},projects:[{name:'terum'}]});
});

it('replays S7g local frames through settings: the real placement path, name, 12-character version and drawn state',async()=>{
  const result=await createTauriBackend(inventoryReplay(recorded).bridge).settings();
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
 const backend=createTauriBackend(s7gReplay().bridge);
 const global=await backend.library({scope:{kind:'global'},team:'acme'});
 const project=await backend.library({scope:{kind:'checkout',root:'/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed'},team:'acme'});
 expect(global).toMatchObject({ok:true,value:{title:'1 skill folder in Global · 1 shared with acme',team:{kind:'ok',team:'acme'},overview:{skills_note:'—',installs:'2',evaluated:'—',attention:'—'}}});
 expect(project).toMatchObject({ok:true,value:{title:'0 skill folders in seed',team:{kind:'ok',team:'acme'},overview:{skills_note:'—',installs:'0',evaluated:'—',attention:'—'}}});
});
it('serves no default eval k from the real backend',async()=>{
 expect(await createTauriBackend(inventoryReplay(recorded).bridge).settings()).toMatchObject({ok:true,value:{K:null}});
});


it('derives Marketplace metadata and counts from the 0.1.7 recordings', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T08:33:11Z'));
  const f = inventoryReplay(), backend = createTauriBackend(f.bridge);
  const result = await backend.catalog();
  if (!result.ok) throw new Error(result.error);
  const c = result.value;
  expect(c.repository).toBe('acme/team');
  expect(c.scanned).toEqual(['~/.claude/skills']);
  expect(c.verdictCounts).toEqual({ PASS: 0, NEUTRAL: 0, FAIL: 0, 'Not evaluated': 3 });
  expect(c.bulkInstall.terum).toEqual({ total: 1, asking: 0 });
  expect(c.projects[0]).toMatchObject({ admin: null, desc: '', evaluated: null, updated: '1 day ago', path: null });
  expect(c.projects[0]?.updated).toBe(relativeTime(c.skills.find(s => s.name === 'tdd')!.updated));
  expect(c.people.find(p => p.handle === 'mira')).toMatchObject({ publishLine: 'Published deploy-check · 1 day ago', lastPublish: '1 day ago · deploy-check', placeNote: '1 of 2 on this machine · install places the other 1', skills: ['deploy-check'], installable: ['deploy-check', 'tdd'], onDisk: [1, 2] });
  expect(c.people.find(p => p.handle === 'ravi')).toMatchObject({ publishLine: 'Published diagnose · 1 day ago', lastPublish: '1 day ago · diagnose' });
  for (const person of c.people) expect(person).toMatchObject({ role: null, organization: null, teamsLine: 'On no project yet' });
  for (const skill of c.skills) expect(skill.installs).toMatch(/^\d+ installs?$/);
  expect(c.skills.find(s => s.name === 'tdd')?.installs).toBe('1 install');
  for (const h of ['mira', 'ravi', 'seed']) expect(f.spawns.some(s => s.args.join(' ') === `ls member --team acme -- ${h}`)).toBe(true);
  const roster = await backend.roster();
  if (!roster.ok) throw new Error(roster.error);
  expect(roster.value.members.every(m => m.role === null)).toBe(true);
});

it.each([['project', 'No project named nope.'], ['member', 'No member named nope.']])('maps the recorded missing %s failure without catalog values', async (kind, error) => {
  const args = kind === 'project' ? ['ls', 'project', 'nope', '--team', 'acme'] : ['ls', 'member', '--team', 'acme', '--', 'nope'];
  const result = await read(cliRun(inventoryReplay().bridge, Promise.resolve(STATE), args, { map: value => value }));
  expect(result).toMatchObject({ ok: false, error });
  expect(result.value).toBeUndefined();
});

it('fails closed when a member detail read fails', async () => {
  const f = inventoryReplay(name => marketplaceRecorded(name === 'ls-member-mira' ? 'ls-member-nope' : name));
  const result = await createTauriBackend(f.bridge).catalog();
  expect(result).toMatchObject({ ok: false, error: 'No member named nope.' });
  expect(result.value).toBeUndefined();
});

// Change only evidence fields in recorded frames to exercise cases absent from the fixture.
const mutableInventory = z.object({
  skills: z.array(z.object({ id: z.string(), name: z.string(), updated: z.string(), grants: z.string().nullable() }).passthrough()),
  projects: z.array(z.object({ name: z.string(), skills: z.array(z.string()) }).passthrough()).optional(),
  local: z.array(z.object({ root: z.string(), scope: z.string(), repoRoot: z.string().optional(), rootState: z.string().optional(), rows: z.array(z.object({ placement: z.object({ id: z.string(), team: z.string() }).passthrough().nullable() }).passthrough()) }).passthrough()).optional(),
}).passthrough();
function changedInventory(change: (name: string, value: z.infer<typeof mutableInventory>) => void) {
  return inventoryReplay(name => marketplaceRecorded(name).map(line => {
    const frame = z.object({ t: z.string(), value: z.unknown().optional() }).passthrough().parse(JSON.parse(line));
    if (frame.t !== 'result' || !name.startsWith('ls')) return line;
    const value = mutableInventory.parse(frame.value);
    change(name, value);
    return JSON.stringify({ ...frame, value });
  }));
}
it('selects newest valid authored timestamps and leaves an empty project unknown', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T08:33:11Z'));
  const f = changedInventory((name, value) => {
    if (name === 'ls-member-mira') {
      const skill = value.skills[0]!;
      value.skills = [{ ...skill, name: 'older', updated: '2026-09-08T08:33:11Z' }, skill, { ...skill, name: 'invalid', updated: 'unknown' }];
    }
    if (name === 'ls-member-ravi') value.skills = [];
    if (name === 'ls') value.projects![0]!.skills = [];
  });
  const result = await createTauriBackend(f.bridge).catalog();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.people.find(p => p.handle === 'mira')?.publishLine).toBe('Published deploy-check · 1 day ago');
  expect(result.value.people.find(p => p.handle === 'ravi')).toMatchObject({ publishLine: 'Nothing shared yet', lastPublish: '—' });
  expect(result.value.projects[0]).toMatchObject({ updated: null, path: null, installed: false });
  expect(result.value.bulkInstall.terum).toEqual({ total: 0, asking: 0 });
});
it('counts grants once per project skill and derives the project update from its newest skill', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T08:33:11Z'));
  const f = changedInventory((name, value) => {
    if (name !== 'ls') return;
    value.projects![0]!.skills = value.skills.map(s => s.id);
    value.skills[0]!.grants = 'Read\nBash';
    value.skills[1]!.grants = null;
    value.skills[0]!.updated = '2026-09-10T07:33:11Z';
  });
  const result = await createTauriBackend(f.bridge).catalog();
  if (!result.ok) throw new Error(result.error);
  expect(result.value.bulkInstall.terum).toEqual({ total: 3, asking: 1 });
  expect(result.value.projects[0]?.updated).toBe('1 hour ago');
});
it('serves a project root only for matching team placements and abbreviates actual scan roots', async () => {
  for (const team of ['acme', 'other']) {
    const f = changedInventory((name, value) => {
      if (name !== 'ls-local') return;
      const global = value.local![0]!, project = value.local![1]!;
      global.root = '/Users/teddy/other-skills';
      project.rootState = 'scanned';
      project.rows = [{ ...global.rows[0]!, placement: { ...global.rows[0]!.placement!, id: '22222222-2222-4222-8222-222222222222', team } }];
    });
    const result = await createTauriBackend(f.bridge).catalog();
    if (!result.ok) throw new Error(result.error);
    expect(result.value.scanned).toEqual(['~/other-skills', '~/code/seed']);
    expect(result.value.projects[0]).toMatchObject({ installed: team === 'acme', path: team === 'acme' ? '/Users/teddy/code/seed' : null });
  }
});
