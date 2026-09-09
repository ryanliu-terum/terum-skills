import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { version as releaseVersion } from '../../../../../package.json' with { type: 'json' };
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '../bridge';
import type { Backend } from '../../Backend';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';
import { installedReplay } from './installed-fixture';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

function replay(value: unknown, ok = true, prints: string[] = []) {
  return fakeBridge((args, emit) => {
    for (const line of prints) emit({ kind: 'stdout', line: JSON.stringify({ t: 'print', level: 'info', line }) });
    emit({ kind: 'stdout', line: JSON.stringify({ t: 'result', verb: args[0], ok, exitCode: ok ? 0 : 1, value, ...(!ok ? { error: 'CLI failure.' } : {}) }) });
  });
}

it('appends read diagnostics after the error and preserves a parsed partial value', async () => {
  const f = replay({ name: 'a', findings: 2, warnings: 1 }, false, ['First finding.', 'Second finding.']);
  expect(await createTauriBackend(f.bridge).validate({ ref: 'a' })).toEqual({ ok: false, error: 'CLI failure.\nFirst finding.\nSecond finding.', value: { name: 'a', findings: 2, warnings: 1 } });
});

it('keeps successful reads unchanged despite print frames', async () => {
  const value = { name: 'a', findings: 0, warnings: 1 };
  expect(await createTauriBackend(replay(value, true, ['Warning.']).bridge).validate({ ref: 'a' })).toEqual({ ok: true, value });
});

it('keeps errors without value when the failing value cannot be parsed', async () => {
  expect(await createTauriBackend(replay('invalid', false).bridge).validate({ ref: 'a' })).toEqual({ ok: false, error: 'CLI failure.' });
});

const teamCases: [string, (backend: Backend) => Promise<unknown>, string[]][] = [
  ['profile', b => b.profile({ name: 'A B', bio: '', role: 'Platform', projects: ['terum', 'second'] }).done, ['profile', '--name', 'A B', '--bio', '', '--role', 'Platform', '--project', 'terum', '--project', 'second']],
  ['decline', b => b.decline({ ref: '-x' }).done, ['decline', '--', '-x']],
  ['leading-dash install', b => b.install({ ref: '-x', team: 'acme' }).done, ['install', '--team', 'acme', '--', '-x']],
  ['team create', b => b.team({ kind: 'create', name: '-x', remote: '/repo' }).done, ['team', 'create', '--remote', '/repo', '--', '-x']],
  ['team create without name', b => b.team({ kind: 'create', remote: '/repo' }).done, ['team', 'create', '--remote', '/repo']],
  ['team join', b => b.team({ kind: 'join', remote: '-x', name: 'acme' }).done, ['team', 'join', '--as', 'acme', '--', '-x']],
  ['team leave', b => b.team({ kind: 'leave', team: '-x' }).done, ['team', 'leave', '--', '-x']],
  ['setup', b => b.setup({ target: '-x' }).done, ['setup', '--', '-x']],
  ['bare setup', b => b.setup({}).done, ['setup']],
  ['search', b => b.search({ q: '--frames' }), ['search', '--', '--frames']],
  ['empty search', b => b.search({ q: '' }), ['search', '--', '']],
  ['empty invite', b => b.invite({ logins: [], team: 'acme' }).done, ['invite', '--team', 'acme']],
  ['uninstall machine', b => b.uninstallMachine({}).done, ['uninstall']],
  ['install skill', b => b.install({ ref: 'a', force: true, team: 'acme' }).done, ['install', '--force', '--team', 'acme', '--', 'a']],
  ['install member', b => b.install({ ref: '', kind: 'member', member: 'mira', team: 'acme' }).done, ['install', '--team', 'acme', '--', 'member', 'mira']],
  ['install project', b => b.install({ ref: '', kind: 'project', project: 'ops', team: 'acme' }).done, ['install', '--team', 'acme', '--', 'project', 'ops']],
  ['uninstallSkill', b => b.uninstallSkill({ ref: 'a', team: 'acme' }).done, ['uninstall-skill', '--team', 'acme', '--', 'a']],
  ['connect', b => b.connect({ path: '/a', team: 'acme', allowPrivileged: true }).done, ['connect', '--team', 'acme', '--allow-privileged', '--', '/a']],
  ['publish', b => b.publish({ ref: 'a', team: 'acme' }).done, ['publish', '--team', 'acme', '--', 'a']],
  ['sync', b => b.sync({ prune: true, team: 'acme' }).done, ['sync', '--prune', '--team', 'acme']],
  ['invite', b => b.invite({ logins: ['mira', 'ravi'], team: 'acme' }).done, ['invite', '--team', 'acme', '--', 'mira', 'ravi']],
  ['eval', b => b.eval({ ref: 'a', commit: true, team: 'acme' }).done, ['eval', '--commit', '--team', 'acme', '--', 'a']],
  ['validate', b => b.validate({ ref: 'a', cwd: '/checkout', team: 'acme' }), ['validate', '--cwd', '/checkout', '--team', 'acme', '--', 'a']],
  ['team remove', b => b.team({ kind: 'remove', handle: 'mira', team: 'acme' }).done, ['team', 'remove', '--team', 'acme', '--', 'mira']],
];
it.each(teamCases)('orders %s as verb, flags, separator, positionals', async (_name, call, argv) => {
  const f = replay(undefined, false);
  await call(createTauriBackend(f.bridge));
  expect(f.spawns.map(s => s.args)).toEqual([argv]);
});

it('accepts bare connect with no value in its successful frame', async () => {
  const f = replay(undefined);
  expect(await createTauriBackend(f.bridge).connect({}).done).toEqual({ ok: true, value: undefined });
  expect(f.spawns[0]?.args).toEqual(['connect']);
});

it.each([undefined, false, true])('maps push-policy publish with changed=%s and no invented version', async changed => {
  const f = replay({ name: 'a', branch: null, prUrl: null, changed });
  expect(await createTauriBackend(f.bridge).publish({ ref: 'a' }).done).toEqual({ ok: true, value: { name: 'a', version: null, changed: changed ?? true } });
});

it.each([
  ['https://github.com/acme/team/pull/1', 'publish/a', 'https://github.com/acme/team/pull/1'],
  [null, 'publish/a', 'publish/a'],
])('prefers the PR URL over the branch: %s', async (prUrl, branch, version) => {
  const f = replay({ name: 'a', branch, prUrl, changed: true });
  expect(await createTauriBackend(f.bridge).publish({ ref: 'a' }).done).toEqual({ ok: true, value: { name: 'a', version, changed: true } });
});

it('refuses empty validate targets and uses cwd when ref is empty', async () => {
  const f = replay({ name: 'a', findings: 0, warnings: 0 });
  const b = createTauriBackend(f.bridge);
  expect(await b.validate({ ref: '', cwd: '' })).toEqual({ ok: false, error: 'validate needs a skill name or a folder.' });
  expect(f.spawns).toHaveLength(0);
  expect((await b.validate({ ref: '', cwd: '/checkout' })).ok).toBe(true);
  expect(f.spawns[0]?.args).toEqual(['validate', '--', '/checkout']);
});

it.each([true, false])('maps every search field including its real description (optional metadata=%s)', async metadata => {
  const hit = { description: 'Real description', grants: null, grantsHash: null, updated: '—', id: 'id', name: 'a', author: 'Mira <mira@example.com>', category: 'ops', installs: 0, latest: 'abc', unresolved: false, ...(metadata ? { team: 'acme', endorsed: 'global' } : {}) };
  const result = await createTauriBackend(replay([hit]).bridge).search({ q: 'a' });
  expect(result).toEqual({ ok: true, value: [{ kind: 'skill', ref: metadata ? 'acme/a' : 'a', name: 'a', description: 'Real description', team: metadata ? 'acme' : null, author: hit.author, category: 'ops', installs: 0, latest: 'abc', unresolved: false, endorsed: metadata ? 'global' : null }] });
});

it('serves status, settings, library, skill, update, roster and catalog while the other three surfaces stay typed gaps', async () => {
  const f = replay(undefined);
  const b = createTauriBackend(f.bridge);
  expect(await b.surfaces()).toEqual({ divergence: false, status: true, settings: true, onboarding: false, library: true, skill: true, receipts: true, inbox: false, catalog: true, roster: true, update: true, checkouts: true });
  for (const result of await Promise.all([b.onboarding(), b.inbox()])) {
    expect(result).toEqual({ ok: false, error: expect.stringContaining('(desktop/GAPS.md)') });
  }
  expect(f.spawns).toHaveLength(0);
});

it('cancels an active read and removes its abort listener', async () => {
  let spawned!: () => void;
  const started = new Promise<void>(resolve => { spawned = resolve; });
  const f = fakeBridge(() => { spawned(); });
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = createTauriBackend(f.bridge).search({ q: 'a' }, { signal: controller.signal });
  await started;
  controller.abort();
  expect(await pending).toEqual({ ok: false, error: 'Cancelled.' });
  expect(f.kills).toHaveLength(1);
  expect(f.writes.map(line => JSON.parse(line))).toEqual([{ t: 'cancel' }]);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('does not spawn an already-aborted read', async () => {
  const f = replay([]);
  const controller = new AbortController();
  controller.abort();
  expect(await createTauriBackend(f.bridge).search({ q: 'a' }, { signal: controller.signal })).toEqual({ ok: false, error: 'Cancelled.' });
  expect(f.spawns).toHaveLength(0);
});

it('detaches the signal after a successful read', async () => {
  const f = replay([]);
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  expect(await createTauriBackend(f.bridge).search({ q: 'a' }, { signal: controller.signal })).toEqual({ ok: true, value: [] });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  controller.abort();
  expect(f.kills).toHaveLength(0);
});

describe('read-only calls preserve spawn rejection', () => {
  const message = 'too many pending terum-skills processes (8); wait for one to finish';

  it.each([message, new Error(message)])('surfaces the bridge message without retrying (%s)', async (error) => {
    const spawn = vi.fn<Bridge['spawn']>().mockRejectedValue(error);
    const bridge: Bridge = {
      spawn,
      quit: vi.fn(async () => {}),
      onLaunchRequest: async () => () => {},
      write: vi.fn<Bridge['write']>(),
      kill: vi.fn<Bridge['kill']>(),
      readAppState: async () => ({ schema: 1, node: '/usr/local/bin/node', entry: '/cli/index.js', version: '0.1.6', writtenAt: '2026-09-08T00:00:00Z' }),
      hostPlatform: async () => 'macos',
      homeDirectory: async () => '/Users/teddy',
    };
    const backend = createTauriBackend(bridge);

    expect(await backend.search({ q: 'deploy' })).toEqual({ ok: false, error: `Could not start terum-skills: ${message}` });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(bridge.write).not.toHaveBeenCalled();
    expect(bridge.kill).not.toHaveBeenCalled();
  });
});

const updateReport = { running: '0.1.6', latest: '0.2.0', observation: 'newer', launch: 'local', description: 'Observed release 0.2.0', advice: ['If managed with npm, run in /work:', '  npm install --save-dev terum-skills@latest'], lines: ['terum-skills 0.1.6', '  npm install --save-dev terum-skills@latest'] };
it('maps the complete update report and preserves advice verbatim', async () => {
  const f = replay(updateReport, true, updateReport.lines);
  expect(await createTauriBackend(f.bridge).update()).toEqual({ ok: true, value: updateReport });
  expect(f.spawns[0]?.args).toEqual(['update']);
});
it('preserves null versions for an unprobed update', async () => {
  const report = { ...updateReport, running: null, latest: null, observation: 'unknown' };
  expect(await createTauriBackend(replay(report).bridge).update()).toEqual({ ok: true, value: report });
});
it.each([{ ...updateReport, unexpected: true }, { ...updateReport, advice: undefined }, { ...updateReport, launch: 'invented' }])('rejects an invalid or widened update payload', async report => {
  expect((await createTauriBackend(replay(report).bridge).update()).ok).toBe(false);
});


const framesDirectory=resolve('../.planning/codex-runs/m7-S7g/frames');
function statusReplay(failed=false, change?:(frame:Record<string,unknown>,verb:string)=>void){
 return fakeBridge((args,emit)=>{
  const name=args[0]==='status'?'status':'ls-local';
  for(const line of readFileSync(resolve(framesDirectory,name+'.jsonl'),'utf8').trim().split('\n')){
   const frame=JSON.parse(line) as Record<string,unknown>;
   if(frame.t==='result'){
    if(failed&&name==='status')Object.assign(frame,{ok:false,exitCode:1,error:'Unreadable team clone.'});
    change?.(frame,name);
   }
   emit({kind:'stdout',line:JSON.stringify(frame)});
  }
 });
}
it.each([false,true])('serves recorded status and settings with real team data (partial failure=%s)',async failed=>{
 const f=statusReplay(failed),backend=createTauriBackend(f.bridge);
 const status=await backend.status(),settings=await backend.settings();
 expect(status.ok).toBe(!failed);expect(settings.ok).toBe(!failed);
 expect(status.value).toMatchObject({machine:{os:'macos',hostname:'',gh_login:''},me:{handle:'seed',name:'Seed',email:'seed@example.com'},counts:{},roots:expect.arrayContaining([expect.objectContaining({id:'global',count:undefined})]),teams:[{name:'acme',key:'acme',handle:'seed',remote:'https://github.com/acme/team',members:3,skills:3,policy:{publish:'Pull request',license:'UNLICENSED'},categories:['ops','engineering','debugging'],pending:[],last_sync:null,stamp:null}]});
 expect(Object.keys(status.value?.counts??{})).toEqual([]);
 expect(status.value?.teams[0]?.clone).toContain('/fx/home/.terum/skills/teams/acme');
 expect(status.value?.teams[0]?.joinBlock?.join('\n')).toContain('npx -y terum-skills@latest setup acme/team');
 expect(settings.value).toMatchObject({ME:{handle:'seed',name:'Seed'},TEAM_POLICY:{publish:'Pull request',license:'UNLICENSED',categories:['ops','engineering','debugging']},PLACEMENTS_N:1,PINNED_N:1,APPROVALS:[],QUARANTINE:[],HOOK:{installed:false},APP_VERSION:releaseVersion,AGENT_CLI:'—',CLI_LATEST:'—'});
 expect(settings.value?.PLACEMENTS[0]).toEqual([expect.stringContaining('/.claude/skills/deploy-check'),'deploy-check','Global',expect.stringMatching(/^[a-f0-9]{12}$/),'2026-09-01T00:00:00Z','up to date']);
 expect(settings.value?.SHARED[0]).toEqual(['22222222-2222-4222-8222-222222222222',expect.stringContaining('/skills/tdd'),'acme','—']);
 expect(status.value?.tools).toEqual(settings.value?.tools);
 expect(status.value?.tools.git).toBe(true);
 if(failed){expect(status).toMatchObject({error:expect.stringContaining('Unreadable team clone.')});expect(settings).toMatchObject({error:expect.stringContaining('Unreadable team clone.')});}
 expect(f.spawns.map(s=>s.args)).toEqual([['status'],['ls','--local'],['status'],['ls','--local']]);expect(f.writes).toEqual([]);
});
it.each([null,'old','current'])('only displays approvals joined to current grants (hash=%s)',async hash=>{
 const f=statusReplay(false,(frame,verb)=>{
  const value=frame.value as {ledger?:{approvals:unknown[]};skills?:Record<string,unknown>[]};
  if(verb==='status')value.ledger!.approvals=[{id:'skill-id',grants:'current',approved_at:'2026-09-01'}];
  else value.skills=[{id:'skill-id',name:'deploy-check',grantsHash:hash,grants:'Bash\nRead'}];
 });
 const result=await createTauriBackend(f.bridge).settings();
 expect(result.ok).toBe(true);
 expect(result.value?.APPROVALS).toEqual(hash==='current'?[['deploy-check',['Bash','Read'],'2026-09-01']]:[]);
});
it('preserves a future stamp and null fields from an unreadable clone',async()=>{
 const stamp='2099-01-01T00:00:00.000Z';
 const f=statusReplay(true,(frame,verb)=>{
  if(verb!=='status')return;
  const value=frame.value as {teams:Record<string,unknown>[]};
  Object.assign(value.teams[0]!,{clone:{state:'absent'},readable:false,memberCount:null,sharedSkills:null,policy:null,categories:null,syncedAt:stamp});
 });
 const result=await createTauriBackend(f.bridge).status();
 expect(result.value?.teams[0]).toMatchObject({stamp,last_sync:stamp,members:null,skills:null,policy:null,categories:null});
});

const lsRow = { id: 'id-a', name: 'a', description: 'Live description', author: 'Mira Chen <mira@example.com>', category: 'ops', installs: 1, latest: 'abcd1234', endorsement: 'global', unresolved: false, grants: 'Bash\nRead', grantsHash: 'sha256:real', updated: '2026-08-20T00:00:00Z', body: '# Live body\n', installedBy: [{ handle: 'mira', displayName: 'Mira Chen', scope: {kind:'global'}, since: '2026-08-01' }, { handle: 'mira', displayName: 'Mira Chen', scope: {kind:'project',project:'ops'}, since: '2026-08-02' }] };
const lsValue = { roster: [{handle:'mira',active:true}], skills: [lsRow], projects: [{ name:'ops',skills:['id-a'],remotes:[],description:'Hand maintained' },{name:'empty',skills:[],remotes:[]}], problems: [] };
function inventoryBridge(overrides: { row?: Partial<typeof lsRow>; validation?: unknown; validateOk?: boolean; teams?: string[]; local?: unknown } = {}) {
  return fakeBridge((args, emit) => {
    const value = args[0] === 'status' ? {version:'0.1.6',teams:(overrides.teams??['acme']).map(team=>({team,handle:'mira',repository:'https://github.com/acme/team',readable:true,sharedSkills:3,memberCount:1}))} : args[0] === 'validate' ? overrides.validation??{name:'a',findings:0,warnings:0} : args.includes('--local') ? overrides.local??{roster:[],skills:[],problems:[],local:[{root:'/home/.claude/skills',scope:'global',rows:[{name:'a',path:'/home/.claude/skills/a',state:'prose is not provenance',tracked:true,shared:[],placement:{id:'id-a',team:'acme',version:'a'.repeat(40)},health:'up-to-date'}],notOffered:[],problems:[]}]} : {...lsValue,skills:[{...lsRow,...overrides.row}]};
    const ok = args[0]!=='validate'||overrides.validateOk!==false;
    emit({kind:'stdout',line:JSON.stringify({t:'result',verb:args[0],ok,exitCode:ok?0:1,value,...(ok?{}:{error:'Validation failed'})})});
  });
}
it.each(['global','checkout','trailing'] as const)('maps the %s library from local roots with local-first argv',async mode=>{
  const local={roster:[],skills:[],problems:[],local:[{root:'/home/.claude/skills',scope:'global',rows:[{name:'a',path:'/home/.claude/skills/a',state:'prose is not provenance',tracked:true,shared:[],placement:{id:'id-a',team:'acme',version:'a'.repeat(40)},health:'up-to-date'}],notOffered:[],problems:[]},{root:'/work/ops/.claude/skills',repoRoot:'/work/ops',scope:'project',rows:[],problems:[]}]};
  const scope=mode==='global'?{kind:'global' as const}:{kind:'checkout' as const,root:'/work/ops'+(mode==='trailing'?'/':'')};
  const f=inventoryBridge({local});const result=await createTauriBackend(f.bridge).library({scope,team:'acme'});
  expect(result).toMatchObject({ok:true,value:{title:mode==='global'?'1 skill folder in Global · 1 shared with acme':'0 skill folders in ops',root:{id:mode==='global'?'global':'/work/ops',kind:scope.kind,label:mode==='global'?'Global':'ops',count:undefined},team:{kind:'ok',team:'acme'},skills:mode==='global'?[{name:'a',desc:'Live description',project:'Global',installs:'1 install',installsN:1,installed:true,placed:true,path:'/home/.claude/skills/a',updated:lsRow.updated,normalizedGrants:lsRow.grants,grantsHash:lsRow.grantsHash,size:'—',tokensK:0,wlt:null,summary:null,favorite:false,favorites:null,enabled:true,flags:[]}]:[],overview:{skills:mode==='global'?'1':'0',installs:mode==='global'?'1':'0',evaluated:'—',attention:'—',meter:{pass_:0,neutral:0,fail:0,total:0},skills_note:'—',installs_note:'—'},provenance:null}});
  expect(f.spawns.map(s=>s.args)).toEqual([['ls','--local'],['status','--team','acme'],['ls','--team','acme']]);
});
it('maps the detail body, grants and all install records without fabricating missing values',async()=>{
  const f=inventoryBridge();const result=await createTauriBackend(f.bridge).skill({ref:'acme/a'});
  expect(result).toMatchObject({ok:true,value:{desc:'Live description',skillMd:{frontmatter:'',body:[],markdown:'# Live body\n'},favorites:null,lines:null,receipt:null,summary:null,wlt:null,evalEstimate:null,incumbentLift:null,reportNumbers:null,scoreFractions:{routesExpected:null,roi:null,quality:null},hygiene:[],hygieneCaption:'Hygiene checks · pass on connect',grants:['Bash','Read'],grants_approved:'',history:[],activity:[],files:['SKILL.md'],used_by:['MC'],users:[['mira','MC','Global · since 2026-08-01'],['mira','MC','ops · since 2026-08-02']],path:'/home/.claude/skills/a',repo:'https://github.com/acme/team'}});
  expect(f.spawns.map(s=>s.args)).toEqual([['status','--team','acme'],['ls','--team','acme'],['ls','--local'],['validate','--team','acme','--','a'],['eval-report','--team','acme','--','a']]);
});
it('retains null grants/body/date and marks unresolved skills broken, with a failed validation caption',async()=>{
  const f=inventoryBridge({row:{grants:null,grantsHash:null,body:null,updated:'—',unresolved:true} as unknown as Partial<typeof lsRow>,validation:{name:'a',findings:2,warnings:0},validateOk:false});
  expect(await createTauriBackend(f.bridge).skill({ref:'a',team:'acme'})).toMatchObject({ok:true,value:{normalizedGrants:null,grantsHash:null,skillMd:{markdown:null},updated:null,flags:['broken'],grants:null,hygieneCaption:'Hygiene checks · fail on connect'}});
});
it('shows unjoined folders locally without inferring team membership from name or prose',async()=>{
  for(const state of ['untracked locally','placement recorded from other @abc','connected source for acme; endorsed (global)']){
    const f=inventoryBridge({local:{roster:[],skills:[],problems:[],local:[{root:'/skills',scope:'global',rows:[{name:'a',path:'/skills/a',state,tracked:state!=='untracked locally',shared:state.startsWith('connected')?[{id:'id-a',team:'acme'}]:[],placement:state.includes('other')?{id:'id-a',team:'other',version:null}:null,health:'unknown'}],notOffered:[],problems:[]}]}});
    expect(await createTauriBackend(f.bridge).library({scope:{kind:'global'},team:'acme'})).toMatchObject({ok:true,value:{skills:[{name:'a',project:'local',path:'/skills/a',installed:true,placed:state.includes('other'),connectedSources:state.startsWith('connected')?['/skills/a']:[]}],title:'1 skill folder in Global'}});
  }
});
it('keeps Library local on ambiguous teams while team detail reports the typed failure',async()=>{
 const f=inventoryBridge({teams:['one','two']}),backend=createTauriBackend(f.bridge);
 const error='This machine is configured for teams one, two; Terum Skills keeps one team per machine. Leave the ones you no longer want in Settings ▸ Team.';
 expect(await backend.library({scope:{kind:'global'}})).toMatchObject({ok:true,value:{team:{kind:'unreadable',message:error},skills:[{project:'local'}]}});
 expect(f.spawns.map(s=>s.args)).toEqual([['ls','--local'],['status']]);
 expect(await backend.skill({ref:'a'})).toEqual({ok:false,error,reason:'ambiguous-team'});
 expect((await createTauriBackend(inventoryBridge().bridge).skill({ref:'a'})).ok).toBe(true);
});
it('does not turn unreadable validation into a passing caption',async()=>{
  const f=inventoryBridge({validation:'broken',validateOk:false});
  expect(await createTauriBackend(f.bridge).skill({ref:'a'})).toEqual({ok:false,error:'Validation failed'});
});

function peopleReplay(change?: (frame: Record<string, unknown>, name: string) => void) {
  return fakeBridge((args, emit) => {
    const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : args[1] === 'member' ? `ls-member-${args.at(-1)}` : 'ls' : args[0]!;
    const lines = readFileSync(resolve('../.planning/codex-runs/m7-S7b/frames', `${name}.jsonl`), 'utf8').trim().split('\n');
    for (const line of lines) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      change?.(frame, name);
      emit({ kind: 'stdout', line: JSON.stringify(frame) });
    }
  });
}
it('S7b replays rebuilt CLI roster/catalog with real handles, role, projects and installs', async () => {
  const f = peopleReplay(), backend = createTauriBackend(f.bridge);
  const roster = await backend.roster();
  expect(roster.ok).toBe(true);
  expect(roster.value?.members.map(member => member.handle)).toEqual(['mira', 'ravi', 'seed']);
  expect(roster.value?.members[0]).toMatchObject({ name: 'Mira Chen', role: 'Platform', projects: ['terum'], joined: '—', lastSeen: '—', status: 'active' });

  expect(await backend.features()).toMatchObject({ memberRole: true, roles: false, follow: false });
  const catalog = await backend.catalog();
  if (!catalog.ok) throw new Error(catalog.error);
  expect(catalog.value.topRated).toEqual(['deploy-check', 'tdd', 'diagnose']);
  expect(catalog.value.skills.find(skill => skill.name === 'deploy-check')).toMatchObject({ installed: true, installsN: 2 });
  expect(catalog.value.skills.find(skill => skill.name === 'tdd')).toMatchObject({ installed: false, installsN: 1 });
  expect(catalog.value.people[0]).toMatchObject({ handle: 'mira', role: 'Platform', projects: ['terum'], skills: ['deploy-check'], declined: [], installable: [], onDisk: [0, 0], adoption: 2 });
  expect(catalog.value.people.map(person => person.handle)).toEqual(['mira', 'ravi', 'seed']);
  expect(catalog.value.people.find(person => person.handle === 'seed')?.declined).toEqual(['33333333-3333-4333-8333-333333333333']);
  expect(catalog.value.categories).toEqual([['ops', 'tag', 1], ['debugging', 'tag', 1], ['engineering', 'tag', 1]]);
  expect(catalog.value.projects[0]).toMatchObject({ name: 'terum', skillsIn: ['tdd'], memberHandles: ['mira'], evaluated: null });
  expect(catalog.value.bulkInstall).toEqual({});
  expect(catalog.value.verdictCounts).toEqual({ PASS: null, NEUTRAL: null, FAIL: null, 'Not evaluated': null });
  expect(JSON.stringify(catalog)).not.toMatch(/Teddy|SSM|MRF|founder/);
  expect(f.spawns.some(spawn => JSON.stringify(spawn.args) === JSON.stringify(['ls', 'member', '--team', 'acme', '--', 'ravi']))).toBe(true);
});
it('S7b maps both recorded write results and emits clone invalidation only', async () => {
  const backend = createTauriBackend(peopleReplay().bridge), changed: string[] = [];
  backend.subscribe(source => changed.push(source));
  expect(await backend.profile({ role: 'Platform' }).done).toEqual({ ok: true, value: { handle: 'seed', changed: ['role'] } });
  expect(await backend.decline({ ref: '33333333-3333-4333-8333-333333333333' }).done).toEqual({ ok: true, value: { id: '33333333-3333-4333-8333-333333333333' } });
  expect(changed).toEqual(['clone', 'clone']);
});
it('S7b tolerates absent metadata but rejects malformed values and failed member reads', async () => {
  const backend = createTauriBackend(peopleReplay((frame, name) => {
    if (frame.t !== 'result') return;
    if (name === 'status') {
      const value = frame.value as { teams: { members: Record<string, unknown>[] }[] };
      for (const member of value.teams[0]!.members) { delete member.role; delete member.projects; }
    }
  }).bridge);
  expect((await backend.roster()).value?.members[0]).toMatchObject({ role: '', projects: [] });
  const failed = createTauriBackend(peopleReplay((frame, name) => {
    if (frame.t === 'result' && name === 'ls-member-ravi') Object.assign(frame, { ok: false, exitCode: 1, error: 'Unreadable member.' });
  }).bridge);
  expect(await failed.catalog()).toMatchObject({ ok: false, error: expect.stringContaining('Unreadable member.') });
  const malformed = createTauriBackend(peopleReplay((frame, name) => {
    if (frame.t === 'result' && name === 'status') {
      const value = frame.value as { teams: { members: Record<string, unknown>[] }[] };
      value.teams[0]!.members[0]!.role = 5;
    }
  }).bridge);
  expect((await malformed.roster()).ok).toBe(false);
});

it('sets identity with exact pairs, no team option, and config-only invalidation', async () => {
  const value = { updated: [{key:'name',value:'Ryan Liu'},{key:'email',value:'ryan@example.com'},{key:'default-handle',value:'ryan'}], notice: 'Author line notice.' };
  const f = replay(value); const backend = createTauriBackend(f.bridge); const listener = vi.fn(); backend.subscribe(listener);
  expect(await backend.setIdentity({name:'Ryan Liu',email:'ryan@example.com',defaultHandle:'ryan'}).done).toEqual({ok:true,value});
  expect(f.spawns.map(spawn=>spawn.args)).toEqual([['login','--set','name=Ryan Liu','--set','email=ryan@example.com','--set','default-handle=ryan']]);
  expect(listener.mock.calls).toEqual([['config']]);
});
it.each([undefined,null])('maps an absent identity notice to null (%s)', async notice => {
  const f = replay({updated:[{key:'name',value:'Ryan Liu'}],notice});
  expect(await createTauriBackend(f.bridge).setIdentity({name:'Ryan Liu'}).done).toEqual({ok:true,value:{updated:[{key:'name',value:'Ryan Liu'}],notice:null}});
  expect(f.spawns.map(spawn=>spawn.args)).toEqual([['login','--set','name=Ryan Liu']]);
});
it('passes empty identity values through for CLI validation and does not invalidate on failure', async () => {
  const f = replay(undefined,false); const backend=createTauriBackend(f.bridge);const listener=vi.fn();backend.subscribe(listener);
  expect(await backend.setIdentity({email:''}).done).toEqual({ok:false,error:'CLI failure.'});
  expect(f.spawns.map(spawn=>spawn.args)).toEqual([['login','--set','email=']]);expect(listener).not.toHaveBeenCalled();
});
// S7g: the placement state is the board's own vocabulary (design fixture PLACEMENTS), keyed by the CLI's typed health, never by the prose.
const healthCases = [
  ['up-to-date','up to date'], ['update-available','update available'], ['local-changed','edited locally'],
  ['both','edited locally · update available'], ['gone-from-repo','removed from the team'], ['unknown','—'], ['untracked','—'],
] as const;
it.each(healthCases)('maps local health %s onto the drawn placement state without reading the prose',async(health,state)=>{
 const f=statusReplay(false,(frame,verb)=>{if(verb!=='ls-local')return;const value=frame.value as {local:{rows:Record<string,unknown>[]}[]};Object.assign(value.local[0]!.rows[0]!,{health,state:'arbitrary prose'});});
 const settings=await createTauriBackend(f.bridge).settings();
 expect(settings.ok).toBe(true);
 expect(settings.value?.PLACEMENTS).toEqual([[expect.stringContaining('/.claude/skills/deploy-check'),'deploy-check','Global',expect.stringMatching(/^[a-f0-9]{12}$/),'2026-09-01T00:00:00Z',state]]);
 expect(settings.value?.PINNED_N).toBe(1);
});
it('joins Skill provenance by ledger team and id (a relocated folder), never by name or prose',async()=>{
  const local={roster:[],skills:[],problems:[],local:[{root:'/skills',scope:'global',rows:[{name:'relocated',path:'/skills/relocated',state:'arbitrary prose',tracked:true,shared:[{id:'shared-id',team:'other'}],placement:{id:'id-a',team:'acme',version:'1234567890abcdef'.repeat(2)+'12345678'},health:'up-to-date'}],notOffered:[],problems:[]}]};
  expect(await createTauriBackend(inventoryBridge({local}).bridge).skill({ref:'acme/a'})).toMatchObject({ok:true,value:{installed:true,path:'/skills/relocated',version:'1234567890ab',version_full:'1234567890abcdef'.repeat(2)+'12345678'}});
});
it('keeps a null tracking version and a missing placement folder honest',async()=>{
 const f=statusReplay(false,(frame,verb)=>{
  const value=frame.value as {ledger?:{placements:Record<string,unknown>[]};local?:{rows:Record<string,unknown>[];problems:{path:string;reason:string}[]}[]};
  if(verb==='status')value.ledger!.placements[0]!.version=null;
  else{const row=value.local![0]!.rows.shift()!;value.local![0]!.problems.push({path:row.path as string,reason:'placement recorded in the ledger but the folder is missing'});}
 });
 const settings=await createTauriBackend(f.bridge).settings();
 expect(settings.value?.PLACEMENTS).toEqual([[expect.stringContaining('/.claude/skills/deploy-check'),'11111111-1111-4111-8111-111111111111','Global',null,'2026-09-01T00:00:00Z','folder missing']]);
 expect(settings.value?.PINNED_N).toBe(0);
 const local={roster:[],skills:[],problems:[],local:[{root:'/skills',scope:'global',rows:[{name:'a',path:'/skills/a',state:'unrelated',tracked:true,shared:[],placement:{id:'id-a',team:'acme',version:null},health:'unknown',problem:'symbolic link'}],notOffered:[],problems:[]}]};
 expect(await createTauriBackend(inventoryBridge({local}).bridge).skill({ref:'a'})).toMatchObject({ok:true,value:{installed:true,version:'—',version_full:null}});
});
it('rejects undeclared local row keys and missing typed provenance',async()=>{
  for(const extra of [{sharedState:'in-sync'}, {placement:undefined}]) {
    const local={roster:[],skills:[],problems:[],local:[{root:'/skills',scope:'global',rows:[{name:'a',path:'/skills/a',state:'x',tracked:true,shared:[],placement:null,health:'unknown',...extra}],notOffered:[],problems:[]}]};
    expect((await createTauriBackend(inventoryBridge({local}).bridge).library({scope:{kind:'global'},team:'acme'})).ok).toBe(false);
  }
});

it('classifies zero-team inventory after the local scan without spawning team ls',async()=>{
 const f=inventoryBridge({teams:[]});
 expect(await createTauriBackend(f.bridge).library({scope:{kind:'global'}})).toMatchObject({ok:true,value:{team:{kind:'none'},skills:[{project:'local',path:'/home/.claude/skills/a'}]}});
 expect(f.spawns.map(spawn=>spawn.args)).toEqual([['ls','--local'],['status']]);
});
it.each(['octo',''])('uses GitHub login for the footer, falling back to the team handle (%s)',async github=>{
 const f=statusReplay(false,(frame,verb)=>{
  if(verb!=='status')return;
  const value=frame.value as {identity:{github:string};teams:{handle:string}[]};
  value.identity.github=github;value.teams[0]!.handle='mira';
 });
 const status=await createTauriBackend(f.bridge).status();
 expect(status.value?.me).toMatchObject({handle:'mira',footerLabel:github||'mira'});
});
it.each(['setup','team','uninstall'] as const)('invalidates every affected read model when %s fails',async verb=>{
 const f=fakeBridge((_args,emit)=>emit({kind:'stdout',line:JSON.stringify({t:'result',verb,ok:false,exitCode:1,error:'Stopped after a partial write.'})}));
 const b=createTauriBackend(f.bridge),notify=vi.fn();b.subscribe(notify);
 await (verb==='setup'?b.setup({offerConnect:true}):verb==='uninstall'?b.uninstallMachine({}):b.team({kind:'create',name:'acme'})).done;
 expect(notify.mock.calls).toEqual([['config'],['clone'],['placed']]);
});

// Installed-state replay fixtures deliberately cover presence separately from provenance.
it.each(['on-disk-only','placed','placed-problem','project'])('derives installed identity from the %s replay', async mode => {
 const backend=createTauriBackend(installedReplay(mode).bridge);
 const result=await backend.library({scope:mode==='project'?{kind:'checkout',root:'/work/project'}:{kind:'global'}});
 expect(result.ok).toBe(true);
 const skill=result.value?.skills[0];
 expect(skill).toMatchObject({name:'deploy-check',installed:true,placed:mode.startsWith('placed'),onDiskOnly:!mode.startsWith('placed')});
 expect(skill?.paths[0]?.[1]).toBe(mode==='project'?'project':'global');
 if(mode==='placed-problem')expect(skill).toMatchObject({flags:['broken'],flagText:{broken:'SKILL.md missing'}});
 const detail=await backend.skill({ref:'deploy-check'});
 expect(detail.value?.path).toBe(mode==='project'?'/work/project/.claude/skills/deploy-check':'/Users/teddy/.claude/skills/deploy-check');
 expect(detail.value?.pathLabel).toBe(skill?.paths[0]?.[0]);
});
it('keeps local rows closed while accepting the three declared additive keys',async()=>{
 expect((await createTauriBackend(installedReplay().bridge).library({scope:{kind:'global'}})).value?.skills[0]).toMatchObject({onDiskOnly:true});
 const f=installedReplay('on-disk-only','none',frame=>{
  if(frame.t==='result') (frame.value as {local:{rows:Record<string,unknown>[]}[]}).local[0]!.rows[0]!.surprise=true;
 });
 expect((await createTauriBackend(f.bridge).library({scope:{kind:'global'}})).ok).toBe(false);
});
it.each(['missing-id','old-cli'])('does not infer presence by name with %s',async mode=>{
 const present=await createTauriBackend(installedReplay().bridge).library({scope:{kind:'global'}});
 expect(present.value?.skills[0]).toMatchObject({onDiskOnly:true});
 const f=installedReplay('on-disk-only','none',frame=>{
  if(frame.t==='hello'&&mode==='old-cli')delete (frame.features as Record<string,unknown>).localIdentity;
  if(frame.t==='result'&&mode==='missing-id')delete (frame.value as {local:{rows:Record<string,unknown>[]}[]}).local[0]!.rows[0]!.skillId;
 });
 expect((await createTauriBackend(f.bridge).library({scope:{kind:'global'}})).value?.skills).toMatchObject([{name:'deploy-check',project:'local',installed:true,placed:false,onDiskOnly:true}]);
 expect((await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).value?.installed).toBe(false);
});
// A CLI without `localIdentity` cannot identify a folder, so a same-named one leaves presence
// unknown — never "absent", and never an Install that would collide with it.
it('reports an unidentifiable same-named folder as unknown rather than absent',async()=>{
 const old=installedReplay('on-disk-only','none',frame=>{
  if(frame.t==='hello')delete (frame.features as Record<string,unknown>).localIdentity;
 });
 const unknown=await createTauriBackend(old.bridge).skill({ref:'deploy-check'});
 expect(unknown.value).toMatchObject({installed:false,unidentifiedLocal:{path:'/Users/teddy/.claude/skills/deploy-check',pathLabel:'~/.claude/skills/deploy-check'}});
 // With the feature present the same scan is proof, so the skill reads installed and unambiguous.
 const current=await createTauriBackend(installedReplay().bridge).skill({ref:'deploy-check'});
 expect(current.value).toMatchObject({installed:true,unidentifiedLocal:null});
});
// A connected source carries {id,team} on every CLI that reaches the app, so it proves presence
// without `skillId` — the clause an old CLI otherwise had no way to satisfy.
it('accepts a connected source as identity on a CLI without localIdentity',async()=>{
 const shared=installedReplay('on-disk-only','none',frame=>{
  if(frame.t==='hello')delete (frame.features as Record<string,unknown>).localIdentity;
  if(frame.t==='result'){
   const row=(frame.value as {local:{rows:Record<string,unknown>[]}[]}).local[0]!.rows[0]!;
   row.shared=[{id:row.skillId,team:'acme'}];row.connected=true;row.tracked=true;
  }
 });
 const detail=await createTauriBackend(shared.bridge).skill({ref:'deploy-check'});
 expect(detail.value).toMatchObject({installed:true,placed:false,onDiskOnly:true,unidentifiedLocal:null,connectedSources:['/Users/teddy/.claude/skills/deploy-check']});
});
it('copies recorded member installs rather than authored skills',async()=>{
 const none=await createTauriBackend(installedReplay('on-disk-only','none').bridge).catalog();
 expect(none.value?.people[0]).toMatchObject({skills:['deploy-check'],installable:[],onDisk:[0,0]});
 const installed=await createTauriBackend(installedReplay('on-disk-only','installed').bridge).catalog();
 expect(installed.value?.people[0]).toMatchObject({skills:['deploy-check'],installable:['deploy-check','tdd'],onDisk:[1,2]});
});
it('retains every id occurrence while preferring a placed path and version over a connected source',async()=>{
 const f=installedReplay('project','none',frame=>{
  if(frame.t!=='result')return;
  const local=(frame.value as {local:{rows:Record<string,unknown>[]}[]}).local;
  const present=local[1]!.rows[0]!;
  present.shared=[{id:present.skillId,team:'acme'}];present.connected=true;
  local[0]!.rows=[{...present,path:'/Users/teddy/.claude/skills/relocated',name:'relocated',placed:true,tracked:true,shared:[],connected:false,placement:{id:present.skillId,team:'acme',version:'b'.repeat(40)},health:'up-to-date'}];
 });
 const detail=await createTauriBackend(f.bridge).skill({ref:'deploy-check'});
 expect(detail.value).toMatchObject({installed:true,placed:true,onDiskOnly:false,path:'/Users/teddy/.claude/skills/relocated',version:'bbbbbbbbbbbb',connectedSources:['/work/project/.claude/skills/deploy-check'],pathLabel:'~/.claude/skills/relocated',paths:[['~/.claude/skills/relocated','global'],['/work/project/.claude/skills/deploy-check','project']]});
});

// Sidebar counts describe scanned rows, independently of the placement ledger.
it.each(['identity','old-cli','missing-id','placed','placement'])('counts global scan rows with %s evidence and an empty ledger',async mode=>{
 const f=installedReplay('on-disk-only','none',frame=>{
  if(frame.t==='hello'&&mode==='old-cli')delete (frame.features as Record<string,unknown>).localIdentity;
  if(frame.t==='result'){
   const row=(frame.value as {local:{rows:Record<string,unknown>[]}[]}).local[0]!.rows[0]!;
   if(mode!=='identity')delete row.skillId;
   if(mode==='placed')row.placed=true;
   if(mode==='placement')row.placement={id:'11111111-1111-4111-8111-111111111111',team:'acme',version:null};
  }
 },frame=>{
  if(frame.t==='result')(frame.value as {ledger:{placements:unknown[]}}).ledger.placements=[];
 });
 const status=await createTauriBackend(f.bridge).status();
 expect(status.ok).toBe(true);
 expect(status.value?.ledger?.placements).toEqual([]);
 expect(status.value?.counts).toEqual({});
 expect(status.value?.roots).toMatchObject([{id:'global',kind:'global',count:undefined}]);
});
it.each(['failed','failed-with-value','unreadable'])('omits Global when the local scan is %s',async mode=>{
 const f=installedReplay('on-disk-only','none',frame=>{
  if(frame.t!=='result')return;
  if(mode==='failed')Object.assign(frame,{ok:false,exitCode:1,error:'Scan failed.',value:undefined});
  else if(mode==='failed-with-value')Object.assign(frame,{ok:false,exitCode:1,error:'Scan incomplete.'});
  else frame.value={local:'unreadable'};
 });
 const status=await createTauriBackend(f.bridge).status();
 expect(status.ok).toBe(false);
 expect(status.value).toBeDefined();
 expect(status.value?.counts).toEqual({});
 expect(status.value?.counts).not.toHaveProperty('Global');
});
it('does not derive per-project sidebar counts from placements or project scan rows',async()=>{
 const status=await createTauriBackend(installedReplay('project').bridge).status();
 expect(status.ok).toBe(true);
 expect(status.value?.counts).toEqual({});
 expect(status.value?.roots).toMatchObject([{id:'global',kind:'global',count:undefined},{id:'/work/project',kind:'checkout',label:'project',count:undefined}]);
});
it.each(['on-disk-only','project'])('includes only scanned roots and this library’s occurrence totals in the %s subtitle',async mode=>{
 const f=installedReplay(mode,'none',frame=>{
  if(frame.t!=='result'||mode!=='project')return;
  const sections=(frame.value as {local:{rows:Record<string,unknown>[]}[]}).local;
  const projectRow=sections[1]!.rows[0]!;
  // Every distinct folder counts, including an unrelated ID; team enrichment is per occurrence.
  sections[0]!.rows=[{...projectRow,path:'/Users/teddy/.claude/skills/deploy-check'},{...projectRow,path:'/Users/teddy/.claude/skills/duplicate'},{...projectRow,skillId:'99999999-9999-4999-8999-999999999999',path:'/Users/teddy/.claude/skills/other'}];
 });
 const library=await createTauriBackend(f.bridge).library({scope:{kind:'global'}});
 expect(library.ok).toBe(true);
 expect(library.value?.title).toBe(mode==='project'?'3 skill folders in Global · 2 shared with acme':'1 skill folder in Global · 1 shared with acme');
 expect(new Set(library.value?.skills.map(card=>card.path)).size).toBe(mode==='project'?3:1);
 expect(library.value?.scanned).toEqual(mode==='project'?['~/.claude/skills','/work/project']:['~/.claude/skills']);
});
it('abbreviates catalog card display paths',async()=>{
 const catalog=await createTauriBackend(installedReplay().bridge).catalog();
 expect(catalog.ok).toBe(true);
 expect(catalog.value?.skills[0]?.paths).toEqual([['~/.claude/skills/deploy-check','global']]);
});
it.each([[[]],[['one','two']]])('refuses people inventory before ls for teams %j',async teams=>{
 const f=peopleReplay((frame,name)=>{
  if(name==='status'&&frame.t==='result'){
   const value=frame.value as {teams:{team:string}[]};
   value.teams=teams.map(team=>({...value.teams[0]!,team}));
  }
 });
 expect(await createTauriBackend(f.bridge).roster()).toEqual(teams.length?{ok:false,error:'This machine is configured for teams one, two; Terum Skills keeps one team per machine. Leave the ones you no longer want in Settings ▸ Team.',reason:'ambiguous-team'}:{ok:false,error:'No team is configured on this machine.',reason:'no-team'});
 expect(f.spawns.map(spawn=>spawn.args)).toEqual([['status']]);
});
it('syncs with the bare CLI verb and leaves by the supplied team key',async()=>{
 const f=replay(undefined,false),backend=createTauriBackend(f.bridge);
 await backend.sync({}).done;await backend.team({kind:'leave',name:'acme-key'}).done;
 expect(f.spawns.map(spawn=>spawn.args)).toEqual([['sync'],['team','leave','--','acme-key']]);
});
it('streams diagnostics as a status run without a read-model projection',async()=>{
 const f=replay(undefined,true,['CLI version','Team state']),run=createTauriBackend(f.bridge).diagnostics(),lines:string[]=[];
 for await(const frame of run.frames)if(frame.t==='print')lines.push(frame.line);
 expect(lines).toEqual(['CLI version','Team state']);expect(await run.done).toEqual({ok:true,value:undefined});
 expect(f.spawns.map(spawn=>spawn.args)).toEqual([['status']]);
});


it('maps the entire machine cleanup result without leaking launch provenance', async () => {
 const { teams, ...outcome } = { teams:['acme','other'], removedPlacements:3, hookRemoved:true, wrapperRemoved:false, configRemoved:true, kept:['/state/backups'], record:'/state/backups/uninstall.json', advice:['Package advice.', 'App advice.'] };
 const f=replay({teams,...outcome,launch:{kind:'npx',path:'/cache/index.js'}});
 expect(await createTauriBackend(f.bridge).uninstallMachine({}).done).toEqual({ok:true,value:{removed:teams,...outcome}});
});
it('quits through the native bridge exactly once', async () => {
 const f=replay(undefined);await createTauriBackend(f.bridge).quit();
 expect(f.quit).toHaveBeenCalledExactlyOnceWith();expect(f.spawns).toEqual([]);
});
it('joins local detail by the on-disk path with validation and eval-report in order',async()=>{
 const f=inventoryBridge(),backend=createTauriBackend(f.bridge);
 expect(await backend.localSkill({path:'/home/.claude/skills/a/'})).toMatchObject({ok:true,value:{name:'a',path:'/home/.claude/skills/a',placed:true,team:'acme',skillMd:{markdown:'# Live body\n'},hygieneCaption:'Hygiene checks · pass on connect'}});
 expect(f.spawns.map(s=>s.args)).toEqual([['ls','--local'],['status'],['ls','--team','acme'],['validate','--team','acme','--','a'],['eval-report','--team','acme','--','a']]);
});
it('returns an empty Global only for an empty scan, even with a team inventory',async()=>{
 const f=inventoryBridge({local:{roster:[],skills:[],problems:[],local:[{root:'/home/.claude/skills',scope:'global',rows:[],problems:[]}]}});
 expect(await createTauriBackend(f.bridge).library({scope:{kind:'global'}})).toMatchObject({ok:true,value:{skills:[],root:{count:undefined},title:'0 skill folders in Global',team:{kind:'ok',team:'acme'}}});
});
it('deduplicates by path and includes only the D2 countable frontmatter reasons',async()=>{
 const reasons=['no-frontmatter','invalid-yaml','illegal-name','name-mismatch','description-missing','unsupported-field','malformed-allowed-tools','managed-wrapper'];
 const entry=(reason:string)=>({name:reason,path:'/skills/'+reason,reason});
 const local={roster:[],skills:[],problems:[],local:[{root:'/skills',scope:'global',rows:[],problems:[],notOffered:[...reasons.map(entry),entry('invalid-yaml'),...['symlink','inside-state-root','unreadable','other'].map(entry)]}]};
 const result=await createTauriBackend(inventoryBridge({local,teams:[]}).bridge).library({scope:{kind:'global'}});
 expect(result.value?.skills.map(s=>s.name)).toEqual(reasons);
 expect(result.value?.title).toBe('8 skill folders in Global');
 expect(result.value?.root.count).toBeUndefined();
});
it.each([false,true])('registration %s never changes connected, placed, or local flags',async registered=>{
 const local={roster:[],skills:[],problems:[],local:[{root:'/repo/.claude/skills',repoRoot:'/repo',scope:'project',registered,detected:!registered,rows:[{name:'local',path:'/repo/.claude/skills/local',state:'local',tracked:false,shared:[],placement:null,health:'untracked'}],problems:[]}]};
 const result=await createTauriBackend(inventoryBridge({local,teams:[]}).bridge).library({scope:{kind:'checkout',root:'/repo'}});
 expect(result.value?.skills).toMatchObject([{installed:true,placed:false,onDiskOnly:true,connectedSources:[],flags:['local'],flagText:{local:'Local · not shared with a team'}}]);
});
