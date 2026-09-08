import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '../bridge';
import type { Backend } from '../../Backend';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

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
  ['install skill', b => b.install({ ref: 'a', force: true, team: 'acme' }).done, ['install', 'a', '--force', '--team', 'acme']],
  ['install member', b => b.install({ ref: '', kind: 'member', member: 'mira', team: 'acme' }).done, ['install', 'member', 'mira', '--team', 'acme']],
  ['install project', b => b.install({ ref: '', kind: 'project', project: 'ops', team: 'acme' }).done, ['install', 'project', 'ops', '--team', 'acme']],
  ['uninstallSkill', b => b.uninstallSkill({ ref: 'a', team: 'acme' }).done, ['uninstall-skill', 'a', '--team', 'acme']],
  ['connect', b => b.connect({ path: '/a', team: 'acme', allowPrivileged: true }).done, ['connect', '/a', '--team', 'acme', '--allow-privileged']],
  ['publish', b => b.publish({ ref: 'a', team: 'acme' }).done, ['publish', 'a', '--team', 'acme']],
  ['sync', b => b.sync({ prune: true, team: 'acme' }).done, ['sync', '--prune', '--team', 'acme']],
  ['invite', b => b.invite({ logins: ['mira', 'ravi'], team: 'acme' }).done, ['invite', 'mira', 'ravi', '--team', 'acme']],
  ['eval', b => b.eval({ ref: 'a', commit: true, team: 'acme' }).done, ['eval', 'a', '--commit', '--team', 'acme']],
  ['validate', b => b.validate({ ref: 'a', cwd: '/checkout', team: 'acme' }), ['validate', 'a', '--cwd', '/checkout', '--team', 'acme']],
  ['team remove', b => b.team({ kind: 'remove', handle: 'mira', team: 'acme' }).done, ['team', 'remove', 'mira', '--team', 'acme']],
];
it.each(teamCases)('forwards --team on %s without reordering existing arguments', async (_name, call, argv) => {
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
  expect(f.spawns[0]?.args).toEqual(['validate', '/checkout']);
});

it.each([true, false])('maps every search field including its real description (optional metadata=%s)', async metadata => {
  const hit = { description: 'Real description', grants: null, grantsHash: null, updated: '—', id: 'id', name: 'a', author: 'Mira <mira@example.com>', category: 'ops', installs: 0, latest: 'abc', unresolved: false, ...(metadata ? { team: 'acme', endorsed: 'global' } : {}) };
  const result = await createTauriBackend(replay([hit]).bridge).search({ q: 'a' });
  expect(result).toEqual({ ok: true, value: [{ kind: 'skill', ref: metadata ? 'acme/a' : 'a', name: 'a', description: 'Real description', team: metadata ? 'acme' : null, author: hit.author, category: 'ops', installs: 0, latest: 'abc', unresolved: false, endorsed: metadata ? 'global' : null }] });
});

it('serves library and skill while the remaining eight surfaces stay typed gaps', async () => {
  const f = replay(undefined);
  const b = createTauriBackend(f.bridge);
  expect(await b.surfaces()).toEqual({ status: false, settings: false, onboarding: false, library: true, skill: true, receipts: false, inbox: false, catalog: false, roster: false, update: false });
  for (const result of await Promise.all([b.status(), b.settings(), b.onboarding(), b.receipts({ skillId: 'a', version: 'abc' }), b.inbox(), b.catalog(), b.roster(), b.update()])) {
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
      write: vi.fn<Bridge['write']>(),
      kill: vi.fn<Bridge['kill']>(),
      readAppState: async () => ({ schema: 1, node: '/usr/local/bin/node', entry: '/cli/index.js', version: '0.1.6' }),
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


const lsRow = { id: 'id-a', name: 'a', description: 'Live description', author: 'Mira Chen <mira@example.com>', category: 'ops', installs: 1, latest: 'abcd1234', endorsement: 'global', unresolved: false, grants: 'Bash\nRead', grantsHash: 'sha256:real', updated: '2026-08-20T00:00:00Z', body: '# Live body\n', installedBy: [{ handle: 'mira', displayName: 'Mira Chen', scope: {kind:'global'}, since: '2026-08-01' }, { handle: 'mira', displayName: 'Mira Chen', scope: {kind:'project',project:'ops'}, since: '2026-08-02' }] };
const lsValue = { roster: [{handle:'mira',active:true}], skills: [lsRow], projects: [{ name:'ops',skills:['id-a'],remotes:[],description:'Hand maintained' },{name:'empty',skills:[],remotes:[]}], problems: [] };
function inventoryBridge(overrides: { row?: Partial<typeof lsRow>; validation?: unknown; validateOk?: boolean; teams?: string[]; local?: unknown } = {}) {
  return fakeBridge((args, emit) => {
    const value = args[0] === 'status' ? {version:'0.1.6',teams:(overrides.teams??['acme']).map(team=>({team,handle:'mira',repository:'https://github.com/acme/team',readable:true,sharedSkills:3,memberCount:1}))} : args[0] === 'validate' ? overrides.validation??{name:'a',findings:0,warnings:0} : args.includes('--local') ? overrides.local??{roster:[],skills:[],problems:[],local:[{root:'/home/.claude/skills',scope:'global',rows:[{name:'a',path:'/home/.claude/skills/a',state:'placement recorded from acme @abcdef'}],notOffered:[],problems:[]}]} : {...lsValue,skills:[{...lsRow,...overrides.row}]};
    const ok = args[0]!=='validate'||overrides.validateOk!==false;
    emit({kind:'stdout',line:JSON.stringify({t:'result',verb:args[0],ok,exitCode:ok?0:1,value,...(ok?{}:{error:'Validation failed'})})});
  });
}
it.each(['Global','ops','installed'])('maps the %s library from real counts and registry, with scoped argv',async scope=>{
  const f=inventoryBridge();const result=await createTauriBackend(f.bridge).library({scope,team:'acme'});
  expect(result).toMatchObject({ok:true,value:{title:'1 of 3 skills',projects:lsValue.projects,skills:[{name:'a',desc:'Live description',project:'Global',installs:'1 installs',installsN:1,installed:true,updated:lsRow.updated,normalizedGrants:lsRow.grants,grantsHash:lsRow.grantsHash,size:'—',tokensK:0,wlt:null,summary:null,favorite:false,favorites:null,enabled:true,flags:[]}],overview:{skills:'1',installs:'1',evaluated:'—',attention:'—',meter:{pass_:0,neutral:0,fail:0,total:0},skills_note:'1 endorsed to Global',installs_note:'across every readable people file · 1 active teammate'},provenance:null}});
  expect(f.spawns.map(s=>s.args)).toEqual([['status','--team','acme'],['ls',...(scope==='ops'?['project','ops']:[]),'--team','acme'],['ls','--local']]);
});
it('maps the detail body, grants and all install records without fabricating missing values',async()=>{
  const f=inventoryBridge();const result=await createTauriBackend(f.bridge).skill({ref:'acme/a'});
  expect(result).toMatchObject({ok:true,value:{desc:'Live description',skillMd:{frontmatter:'',body:[],markdown:'# Live body\n'},favorites:null,lines:null,receipt:null,summary:null,wlt:null,evalEstimate:null,incumbentLift:null,reportNumbers:null,scoreFractions:{routesExpected:null,roi:null,quality:null},hygiene:[],hygieneCaption:'Hygiene checks · pass on connect',grants:['Bash','Read'],grants_approved:'',history:[],activity:[],files:['SKILL.md'],used_by:['MC'],users:[['mira','MC','Global · since 2026-08-01'],['mira','MC','ops · since 2026-08-02']],path:'/home/.claude/skills/a',repo:'https://github.com/acme/team'}});
  expect(f.spawns.map(s=>s.args)).toEqual([['status','--team','acme'],['ls','--team','acme'],['ls','--local'],['validate','a','--team','acme']]);
});
it('retains null grants/body/date and marks unresolved skills broken, with a failed validation caption',async()=>{
  const f=inventoryBridge({row:{grants:null,grantsHash:null,body:null,updated:'—',unresolved:true} as unknown as Partial<typeof lsRow>,validation:{name:'a',findings:2,warnings:0},validateOk:false});
  expect(await createTauriBackend(f.bridge).skill({ref:'a',team:'acme'})).toMatchObject({ok:true,value:{normalizedGrants:null,grantsHash:null,skillMd:{markdown:null},updated:null,flags:['broken'],grants:null,hygieneCaption:'Hygiene checks · fail on connect'}});
});
it('does not infer installation from an untracked or other-team same-name folder',async()=>{
  for(const state of ['untracked locally','placement recorded from other @abc','connected source for acme; endorsed (global)']){
    const f=inventoryBridge({local:{roster:[],skills:[],problems:[],local:[{root:'/skills',scope:'global',rows:[{name:'a',path:'/skills/a',state}],notOffered:[],problems:[]}]}});
    expect(await createTauriBackend(f.bridge).library({scope:'installed',team:'acme'})).toMatchObject({ok:true,value:{skills:[],title:'0 of 3 skills'}});
  }
});
it('refuses multi-team ambiguity before ls and discovers a single configured team without a prompt',async()=>{
  const f=inventoryBridge({teams:['one','two']});
  expect(await createTauriBackend(f.bridge).library({scope:'Global'})).toEqual({ok:false,error:'Select a team explicitly to read its skills.'});
  expect(f.spawns.map(s=>s.args)).toEqual([['status']]);
  expect((await createTauriBackend(inventoryBridge().bridge).skill({ref:'a'})).ok).toBe(true);
});
it('does not turn unreadable validation into a passing caption',async()=>{
  const f=inventoryBridge({validation:'broken',validateOk:false});
  expect(await createTauriBackend(f.bridge).skill({ref:'a'})).toEqual({ok:false,error:'Validation failed'});
});
