import { z } from 'zod';
import appPackage from '../../../package.json';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { nativePrefs } from './prefs';
import { SETUP_STEP_KEYS, FEATURE_KEYS } from '../types';
import type { Features } from '../types';
import type { CliFrame } from './frames';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { writeText, writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { Image } from '@tauri-apps/api/image';
import type { Backend } from '../Backend';
import type { IdentityWrite, Catalog, Roster, Person, Library, SkillCard, SkillDetail, UpdateAdvice, StatusResult, Settings, Capabilities, Surfaces, ReadOptions, ChangeSource, ConnectArgs, ConnectOutcome, EvalArgs, EvalResult, InstallArgs, InstalledResult, InviteArgs, InviteResult, MachineUninstallResult, PublishArgs, PublishResult, Result, Run, SearchArgs, SearchHit, SetupArgs, SetupResult, Subscription, SyncArgs, SyncResult, TeamArgs, TeamResult, UninstallArgs, UninstalledResult, ValidateArgs, ValidateResult } from '../types';
import { tauriBridge, type AppState, type Bridge } from './bridge';
import { cliRun } from './run';
import { cliEvalReport, mapEvalReport } from './eval-report';
import { abbreviateHome } from '../paths';

/**
 * The real adapter: every long verb is one `terum-skills --frames <verb>` process (run.ts). What the CLI has
 * no verb for yet is answered honestly with a failing Result that names GAPS.md, so the screens render their
 * drawn error states instead of fixture data pretending to be real. Mappings between the CLI's result shapes
 * (src/commands/*.ts) and the seam's DTOs (../types) are here and nowhere else.
 */

// The CLI's result shapes, as of terum-skills 0.1.5 (src/commands/*.ts). Validated loosely: only the fields the seam reads.
const cliProfile = z.object({ handle: z.string(), changed: z.array(z.string()) });
const cliDecline = z.object({ handle: z.string(), id: z.string(), declined: z.literal(true) });
const memberMetadata = { role: z.string().nullish().transform(value => value ?? null), projects: z.array(z.string()).nullish().transform(value => value ?? []) };
const cliLogin = z.object({ updated: z.array(z.object({ key: z.string(), value: z.string() })), notice: z.string().nullish() });
const cliInstalled = z.array(z.object({ id: z.string(), team: z.string() }).passthrough());
const cliUninstalled = z.array(z.object({ id: z.string(), team: z.string(), removed: z.number() }).passthrough());
const cliMachine = z.object({ teams: z.array(z.string()), removedPlacements: z.number(), hookRemoved: z.boolean(), wrapperRemoved: z.boolean(), configRemoved: z.boolean(), kept: z.array(z.string()), record: z.string(), advice: z.array(z.string()) }).passthrough();
const cliConnectResult = z.object({ id: z.string(), name: z.string(), reconciled: z.boolean().optional(), adopted: z.boolean().optional() }).passthrough();
const cliConnect = z.union([z.object({ kind: z.literal('batch'), shared: z.array(cliConnectResult), declined: z.array(z.string()), refused: z.array(z.object({ name: z.string(), reason: z.string() })) }).passthrough(), cliConnectResult]).optional();
const cliPublish = z.object({ name: z.string(), branch: z.string().nullable(), prUrl: z.string().nullable(), changed: z.boolean().optional() }).passthrough();
const cliSync = z.object({ placed: z.number(), deferred: z.array(z.string()) }).passthrough();
const cliInvite = z.object({ team: z.string(), invited: z.array(z.string()) }).passthrough();
const cliTeam = z.object({ team: z.string() }).passthrough();
const cliSetup = z.object({ role: z.enum(['creator', 'joiner']), team: z.string(), steps: z.partialRecord(z.enum(SETUP_STEP_KEYS), z.enum(['done','skipped','printed'])).nullish().transform(value => value ?? null) });
const cliEval = z.object({ name:z.string(),runDir:z.string(),executionStatus:z.enum(['complete','partial','failed']),commit:z.union([z.object({ok:z.literal(true),receiptPath:z.string()}),z.object({ok:z.literal(false),error:z.string()})]).nullable() }).passthrough();
const cliValidate = z.object({ name: z.string(), findings: z.number(), warnings: z.number() });
const cliSearch = z.array(z.object({ team: z.string().optional(), endorsed: z.string().optional(), id: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), unresolved: z.boolean(), description: z.string(), grants: z.string().nullable(), grantsHash: z.string().nullable(), updated: z.string() }));

const cliScope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('global') }), z.object({ kind: z.literal('project'), project: z.string() })]);
const cliLsSkill = z.object({ id: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), endorsement: z.string(), unresolved: z.boolean(), description: z.string(), grants: z.string().nullable(), grantsHash: z.string().nullable(), updated: z.string(), body: z.string().nullable(), installedBy: z.array(z.object({ handle: z.string(), displayName: z.string(), scope: cliScope, since: z.string() })) });
const cliProject = z.object({ name: z.string(), skills: z.array(z.string()), remotes: z.array(z.string()), description: z.string().optional() }).catchall(z.unknown());
// S7g: every `ls --local` row carries typed provenance and a read-only health; the prose `state` is never parsed.
const cliLocalHealth = z.enum(['up-to-date', 'update-available', 'local-changed', 'both', 'gone-from-repo', 'untracked', 'unknown']);
const cliLocalRow = z.object({ name: z.string(), path: z.string(), state: z.string(), tracked: z.boolean(), shared: z.array(z.strictObject({ id: z.string(), team: z.string() })), placement: z.strictObject({ id: z.string(), team: z.string(), version: z.string().length(40).nullable() }).nullable(), health: cliLocalHealth, problem: z.string().optional(), skillId: z.string().nullable().optional(), placed: z.boolean().optional(), connected: z.boolean().optional() }).strict();
const cliLs = z.object({
  roster: z.array(z.object({ handle: z.string(), active: z.boolean(), ...memberMetadata })), skills: z.array(cliLsSkill), problems: z.array(z.object({ source: z.string(), message: z.string() })), projects: z.array(cliProject).optional(), member: z.object({ installed: z.array(z.object({ id: z.string(), scope: cliScope, since: z.string() })).optional(), handle: z.string(), declined: z.array(z.string()), ...memberMetadata }).optional(),
  local: z.array(z.object({ root: z.string(), scope: z.enum(['global', 'project']), repoRoot: z.string().optional(), rows: z.array(cliLocalRow), notOffered: z.array(z.object({ skillId: z.string().nullable().optional(), name: z.string(), path: z.string(), reason: z.string() })), problems: z.array(z.object({ path: z.string(), reason: z.string() })) })).optional(),
});
const cliStatusTeams = z.object({ version: z.string().nullable(), teams: z.array(z.object({ team: z.string(), handle: z.string(), repository: z.string().nullable(), readable: z.boolean(), sharedSkills: z.number().nullable(), memberCount: z.number().nullable() })) });
type Inventory = z.infer<typeof cliLs>;
type InventorySkill = z.infer<typeof cliLsSkill>;
type InventoryTeam = z.infer<typeof cliStatusTeams>['teams'][number];

// Join provenance by team and ID, including relocated or conflicting tracked folders.
function onDisk(local: Inventory, team: string, id: string, features: Pick<Features, 'localIdentity'>) {
  return local.local?.flatMap(section => section.rows.map(row => ({ ...row, scope: section.scope, root: section.root, repoRoot: section.repoRoot }))).filter(row => (row.placement?.id === id && row.placement.team === team) || (features.localIdentity && row.skillId === id)) ?? [];
}
function inventoryCard(row: InventorySkill, local: Inventory, team: string, features: Pick<Features, 'localIdentity'>, home: string): SkillCard {
  const rows = onDisk(local, team, row.id, features);
  const placements = rows.filter(r => r.placement?.id === row.id && r.placement.team === team);
  const placed = placements.length > 0, installed = rows.length > 0;
  const problem = placements.find(r => r.problem !== undefined || r.health === 'unknown' || r.health === 'gone-from-repo');
  return { name: row.name, category: row.category, project: row.endorsement === 'global' ? 'Global' : row.endorsement.replace(/^project: /, ''), installs: `${row.installs} installs`, installsN: row.installs, installed, placed, onDiskOnly: installed && !placed, paths: rows.map(r => [abbreviateHome(r.path, home), r.scope]), projectRoots: rows.flatMap(r => r.repoRoot ? [r.repoRoot] : []), connectedSources: rows.filter(r => r.shared.length > 0).map(r => r.path), desc: row.description, grants: row.grants?.split('\n') ?? null, normalizedGrants: row.grants ?? null, grantsHash: row.grantsHash ?? null, size: '—', tokensK: 0, wlt: null, summary: null, favorite: false, favorites: null, enabled: true, flags: problem || row.unresolved ? ['broken'] : [], flagText: problem ? { broken: problem.problem ?? 'placed copy could not be inspected' } : {}, updated: row.updated === '—' ? null : row.updated ?? null, indicators: { broken: { icon: 'alert', token: 'bad', text: 'The skill version could not be resolved.' }, update: { icon: 'arrow-up-circle', token: 'warn', text: '' }, local: { icon: 'pencil', token: 'text3', text: '' } } };
}
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
function inventoryDetail(row: InventorySkill, local: Inventory, team: InventoryTeam, validation: Result<ValidateResult>, inventory: Inventory, features: Pick<Features, 'localIdentity'>, home: string): SkillDetail {
  const card = inventoryCard(row, local, team.team, features, home), rows = onDisk(local, team.team, row.id, features), placed = rows.find(r => r.placement?.id === row.id && r.placement.team === team.team);
  const path = placed?.path ?? rows[0]?.path ?? `skills/${row.name}`;
  const name = row.author.replace(/\s*<[^>]*>$/, '');
  const installers = row.installedBy;
  return { ...card, team: team.team, installScopes: [], projectNames: inventory.projects?.map(project => project.name) ?? null, favorites: null, lines: null, skillRef: `${team.team}/${row.name}`, root: 'Global', desc_long: row.description, files: ['SKILL.md'], size_bytes: '—', version: placed?.placement?.version?.slice(0, 12) ?? '—', version_full: placed?.placement?.version ?? null, scope: placed?.scope === 'global' ? 'Global' : placed?.scope ?? null, installs_n: row.installs, installed: card.installed,
    used_by: [...new Map(installers.map(person => [person.handle, initials(person.displayName)])).values()], users: installers.map(person => [person.handle, initials(person.displayName), `${person.scope.kind === 'global' ? 'Global' : person.scope.project} · since ${person.since}`]),
    author: { name, handle: '', role: '', initials: initials(name) }, repo: team.repository ?? null, path, pathLabel: abbreviateHome(path, home), grants_approved: '', versions:null,latestState:'none',invalidReceiptFile:null,localRuns:[],evalReportError:null, receipt: null, history: [], activity: [], hygiene: [], hygieneCaption: validation.value === undefined ? null : `Hygiene checks · ${validation.ok && validation.value.findings === 0 ? 'pass' : 'fail'} on connect`,
    skillMd: { frontmatter: '', body: [], markdown: row.body ?? null }, evalEstimate: null, evalEstimateText: '', evalEstimateTip: '', evalCommand: `npx -y terum-skills@latest eval ${row.name}`, shareCommand: `npx -y terum-skills@latest install ${team.team}/${row.name}`, incumbentLift: null, reportNumbers: null, scoreFractions: { routesExpected: null, roi: null, quality: null }, method: '',
  };
}

const cliUpdate = z.strictObject({ running: z.string().nullable(), latest: z.string().nullable(), observation: z.enum(['newer', 'same', 'older', 'unknown']), launch: z.enum(['global', 'local', 'npx', 'source', 'unknown']), description: z.string(), advice: z.array(z.string()), lines: z.array(z.string()) });

// S7k: explicitly declare every status field; an older payload must not look like unset data.
const cliStatus = z.object({
 version:z.string().nullable(),
 teams:z.array(z.object({
  team:z.string(),handle:z.string(),repository:z.string().nullable(),
  clone:z.discriminatedUnion('state',[
   z.object({state:z.literal('ok')}),z.object({state:z.literal('absent')}),
   z.object({state:z.literal('foreign'),origin:z.string()}),
   z.object({state:z.literal('incomplete'),reason:z.string(),error:z.string().optional()}),
  ]),readable:z.boolean(),
  members:z.array(z.object({handle:z.string(),displayName:z.string(),...memberMetadata})),memberCount:z.number().nullable(),unreadableMembers:z.number().nullable(),sharedSkills:z.number().nullable(),unreadableSkills:z.number().nullable(),membership:z.enum(['active','inactive','missing']).nullable(),stale:z.boolean(),
  pending:z.array(z.object({op:z.enum(['install','uninstall']),id:z.string(),scope:cliScope,version:z.string().nullable(),started:z.string()})),
  syncedAt:z.string().nullable(),policy:z.object({publish:z.enum(['pr','push']),skill_license:z.string()}).nullable(),categories:z.array(z.string()).nullable(),clonePath:z.string().nullable(),joinCommand:z.string().nullable(),joinBlock:z.array(z.string()).nullable(),
 })),
 ledger:z.object({
  placements:z.array(z.object({path:z.string(),id:z.string(),team:z.string(),version:z.string().nullable(),scope:cliScope,placed_at:z.string()})),
  approvals:z.array(z.object({id:z.string(),grants:z.string(),approved_at:z.string()})),
  shared:z.array(z.object({id:z.string(),source:z.string(),team:z.string()})),
 }),
 identity:z.object({default_handle:z.string().nullable(),email:z.string().nullable(),display_name:z.string().nullable(),github:z.string().nullable()}).nullable(),
 tools:z.object({git:z.boolean(),gh:z.boolean()}),
});
const cliLocal=z.object({local:z.array(z.object({root:z.string(),scope:z.enum(['global','project']),repoRoot:z.string().optional(),rows:z.array(cliLocalRow),problems:z.array(z.object({path:z.string(),reason:z.string()}))})),skills:z.array(z.object({id:z.string(),name:z.string(),grantsHash:z.string().nullish().transform(v=>v??null),grants:z.string().nullish().transform(v=>v??null)}))});
type CliStatus=z.infer<typeof cliStatus>;
type CliLocal=z.infer<typeof cliLocal>;

function statusModel(value:CliStatus, local:CliLocal|null, platform:string, features:Pick<Features, 'localIdentity'>):StatusResult {
 const name=value.identity?.display_name??'';
 const handle=value.teams[0]?.handle??''; // one team per machine — legacy 2+ shows a hint, not a projection
 return {
  ledger:value.ledger??null,
  machine:{os:platform,name:'',hostname:'',gh_login:'',gh_version:''},
  me:{handle,name,email:value.identity?.email??'',default_handle:value.identity?.default_handle??'',initials:name.split(/\s+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase(),footerLabel:[value.identity?.github,handle,value.identity?.default_handle].find(v=>v)??''},
  teams:value.teams.map(team=>({name:team.team,key:team.team,handle:team.handle,remote:team.repository??null,members:team.memberCount??null,skills:team.sharedSkills??null,clone:team.clonePath??null,last_sync:team.syncedAt??null,stamp:team.syncedAt??null,policy:team.policy===null?null:{publish:team.policy.publish==='pr'?'Pull request':'Push',license:team.policy.skill_license},categories:team.categories??null,pending:team.pending,joinCommand:team.joinCommand??null,joinBlock:team.joinBlock??null})),
  counts:local===null?{}:{Global:String(local.local.filter(section=>section.scope==='global').flatMap(section=>section.rows).filter(row=>row.placed===true||row.placement!==null||(features.localIdentity&&row.skillId!=null)).length)},tools:value.tools,projects:null,
 };
}
// AD-23: the drawn placement states (design fixture PLACEMENTS: 'up to date', 'update available', 'edited locally', 'pinned'); a health the board has no word for is '—'.
const PLACEMENT_STATE:Record<z.infer<typeof cliLocalHealth>,string>={'up-to-date':'up to date','update-available':'update available','local-changed':'edited locally',both:'edited locally · update available','gone-from-repo':'removed from the team',unknown:'—',untracked:'—'};
function settingsModel(value:CliStatus, local:CliLocal|null, status:StatusResult):Settings {
 const rows=local?.local.flatMap(root=>root.rows)??[];
 const policy=status.teams.length===1?status.teams[0]?.policy??null:null; // one team per machine — legacy 2+ shows a hint, not a projection
 return {
  K:null,MACHINE:status.machine,ME:status.me,TEAMS:status.teams,tools:status.tools,
  TEAM_POLICY:{publish:policy?.publish??null,license:policy?.license??null,categories:status.teams.length===1?status.teams[0]?.categories??null:null,projects:null,categoriesNote:'From team.json; an admin extends it by pull request.'}, // one team per machine — legacy 2+ shows a hint, not a projection
  PLACEMENTS:value.ledger.placements.map(p=>{const row=rows.find(row=>row.path===p.path);const missing=local?.local.some(root=>root.problems.some(problem=>problem.path===p.path))??false;return [p.path,row?.name??p.id,p.scope.kind==='global'?'Global':p.scope.project,p.version?.slice(0,12)??null,p.placed_at??null,row?PLACEMENT_STATE[row.health]:missing?'folder missing':'—'];}),PLACEMENTS_N:value.ledger.placements.length,
  APPROVALS:value.ledger.approvals.flatMap(approval=>{const skill=local?.skills.find(skill=>skill.id===approval.id&&skill.grantsHash!==null&&skill.grantsHash===approval.grants&&skill.grants!==null);return skill?[[skill.name,skill.grants==='none'?[]:skill.grants!.split('\n'),approval.approved_at]]:[];}),
  SHARED:value.ledger.shared.map(item=>[item.id,item.source,item.team,'—']),
  QUARANTINE:[],LOCAL_UNSHARED:[],HOOK:{installed:false,file:'',timeout:0},
  APP_VERSION:appPackage.version,AGENT_CLI:'—',AGENT_CLI_AUTH:'unknown',COMMUNITY:'github.com/ryanliu-terum/terum-skills/issues',
  STORAGE:{cache:'—',cache_n:0,evals:'—',evals_n:0,quarantine:'—'},PINNED_N:value.ledger.placements.filter(p=>p.version!==null).length,
  CLI_VERSION:value.version??'—',CLI_LATEST:'—',FOLLOWING:[],SHARED_SPECIMEN:null,
  SETTINGS_NAV:[],SHORTCUTS:[],INBOX_KIND_TEXT:{share:'Shared with you',update:'Update',alert:'Alert',eval:'Eval finished',review:'Review request',author:'Your skill',team:'Team'},THEME_OPTIONS:['System','Light','Dark'],
  syncNote:'The recorded timestamp is shown without clock-skew correction. No sync recorded on this machine does not mean never synced: leaving a team removes its stamp. Work left undone beside an old timestamp means run sync, not an error.',
 };
}

function rosterModel(team: CliStatus['teams'][number], inventory: Inventory): Roster {
  const members = team.members.map(member => ({ handle: member.handle, name: member.displayName, initials: initials(member.displayName), role: member.role ?? '', projects: member.projects ?? [], followers: null, joined: '—', last_publish: '—', lastPublish: '—', lastSeen: '—', status: inventory.roster.find(row => row.handle === member.handle)?.active ? 'active' : 'inactive' }));
  return { members, invited: [], member: Object.fromEntries(members.map(member => [member.handle, { status: member.status, projects: member.projects, lastSeen: member.lastSeen }])), byAdoption: [] };
}
function catalogModel(team: CliStatus['teams'][number], inventory: Inventory, local: Inventory, people: Person[], features: Pick<Features, 'localIdentity'>, home: string, query?: string): Catalog {
  const skills = inventory.skills.map(row => inventoryCard(row, local, team.team, features, home));
  const categorySkills: Record<string, string[]> = {};
  for (const skill of skills) (categorySkills[skill.category] ??= []).push(skill.name);
  const projects = (inventory.projects ?? []).map(project => {
    const rows = inventory.skills.filter(skill => project.skills.includes(skill.id));
    const members = people.filter(person => person.projects.includes(project.name));
    return { name: project.name, key: project.name, ico: 'folder', desc: project.description ?? '', skills: project.skills.length, members: members.length, remote: project.remotes[0] ?? '—', installed: project.skills.length > 0 && rows.length === project.skills.length && rows.every(row => inventoryCard(row, local, team.team, features, home).placed), favorites: null, updated: '—', path: null, admin: { handle: '', name: '—', role: '', initials: '' }, evaluated: null, memberHandles: members.map(member => member.handle), memberInitials: members.map(member => member.initials), skillsIn: rows.map(row => row.name) };
  });
  return { scanned: (local.local ?? []).map(section => section.scope === 'global' ? '~/.claude/skills' : section.repoRoot ?? section.root), repository: team.repository ?? null, skills: skills.filter(skill => !query || `${skill.name} ${skill.desc}`.toLowerCase().includes(query.toLowerCase())), extras: [], people, projects, categories: Object.entries(categorySkills).map(([name, rows]) => [name, 'tag', rows.length]), categoryRemaining: {}, topRated: [...skills].sort((a, b) => b.installsN - a.installsN).map(skill => skill.name), peopleByAdoption: [...people].sort((a, b) => b.adoption - a.adoption).map(person => person.handle), projectsByMembers: [...projects].sort((a, b) => b.members - a.members).map(project => project.name), categorySkills, filterDefault: { verdicts: [], lift_min: 0, tokens_max: 0, installs_min: 0 }, filterCount: skills.length, verdictCounts: { PASS: null, NEUTRAL: null, FAIL: null, 'Not evaluated': null }, catalogN: skills.length, teamN: people.length, bulkInstall: {} };
}

export function createTauriBackend(bridge: Bridge = tauriBridge()): Backend {
  // Share in-flight reads and cache success; a terminal launch can repair a missing or broken file.
  let hello: Extract<CliFrame, { t: 'hello' }> | null = null;
  let featuresOnce: Promise<void> | undefined;
  const onHello = (frame: Extract<CliFrame, { t: 'hello' }>) => { hello = frame; };
  let stateOnce: Promise<AppState | null> | undefined;
  let inFlight: Promise<AppState | null> | undefined;
  let generation = 0;
  let launchListenerReady: Promise<unknown> = Promise.resolve();
  const state = (): Promise<AppState | null> => {
    if (stateOnce) return stateOnce;
    if (inFlight) return stateOnce = inFlight;
    const request = (async () => {
      for (;;) {
        const readingGeneration = generation;
        try {
          const value = await bridge.readAppState();
          if (readingGeneration !== generation) continue;
          return value;
        } catch (error) {
          if (readingGeneration !== generation) continue;
          throw error;
        }
      }
    })();
    inFlight = stateOnce = request;
    void request.then(value => {
      if (inFlight === request) inFlight = undefined;
      if (value === null && stateOnce === request) stateOnce = undefined;
    }, () => {
      if (inFlight === request) inFlight = undefined;
      if (stateOnce === request) stateOnce = undefined;
    });
    return request;
  };
  let homeOnce: Promise<string> | undefined;
  const home = () => (homeOnce ??= bridge.homeDirectory().catch(() => ''));
  async function localPath(path:string):Promise<string> {
    if(path!=='~'&&!path.startsWith('~/'))return path;
    const directory=await home();
    if(!directory)throw new Error('Could not determine the home directory.');
    return directory+path.slice(1);
  }
  async function result<T>(value: Result<T>): Promise<Result<T>> {
    return value.ok ? value : { ...value, error: abbreviateHome(value.error, await home()) };
  }
  const fail = (error: string) => result<never>({ ok: false, error });
  const gap = (what: string) => fail(`${what} is not available from terum-skills yet: the CLI has no verb that returns it (desktop/GAPS.md). The terminal has everything the app shows here.`);
  const listeners = new Set<(source: ChangeSource) => void>();
  const notify = (...sources: ChangeSource[]) => { for (const source of sources) for (const listener of listeners) listener(source); };
  const cwd = () => backend.prefs.get<string>('workspace', '') || undefined;

  function run<TIn, TOut>(argv: readonly string[], schema: z.ZodType<TIn>, map: (value: TIn) => TOut, touches: ChangeSource[] = ['config', 'placed']): Run<TOut> {
    const job = cliRun<unknown, TOut>(bridge, state(), argv, { cwd: cwd(), onHello, map: (value) => map(schema.parse(value)), onSettled: (result) => { if (argv[0] === 'setup' || argv[0] === 'team' || argv[0] === 'uninstall') notify('config', 'clone', 'placed'); else if (result.ok || result.value !== undefined) notify(...touches); } });
    return {
      done: job.done.then(result),
      answer: (id, value) => job.answer(id, value),
      cancel: () => job.cancel(),
      frames: {
        async *[Symbol.asyncIterator]() {
          for await (const frame of job.frames) {
            const directory = await home();
            if (frame.t === 'print') yield { ...frame, line: abbreviateHome(frame.line, directory) };
            else if (frame.t === 'result' && frame.error !== undefined) yield { ...frame, error: abbreviateHome(frame.error, directory) };
            else yield frame;
          }
        },
      },
    };
  }

  async function readModels<T>(options:ReadOptions|undefined, map:(value:CliStatus,local:CliLocal|null,platform:string)=>T):Promise<Result<T>> {
    const [status,local,platform]=await Promise.all([
      read(run(['status'],cliStatus,value=>value,[]),options),
      read(run(['ls','--local'],cliLocal,value=>value,[]),options),
      bridge.hostPlatform().then(value=>({ok:true as const,value})).catch((error:unknown)=>({ok:false as const,error:error instanceof Error?error.message:String(error),value:''})),
    ]);
    if (status.value===undefined) return result({ok:false,error:status.ok?'Status returned no data.':status.error});
    const value=map(status.value,local.ok?local.value:null,platform.value);
    const errors=[status,local,platform].flatMap(outcome=>outcome.ok?[]:[outcome.error]);
    return result(errors.length?{ok:false,error:errors.join('\n'),value}:{ok:true,value});
  }

  function teamSelectionFailure(teams:readonly {team:string}[]):Result<never> {
    return teams.length===0
      ? {ok:false,error:'No team is configured on this machine.',reason:'no-team'}
      : {ok:false,error:`This machine is configured for teams ${teams.map(team=>team.team).join(', ')}; Terum Skills keeps one team per machine. Leave the ones you no longer want in Settings ▸ Team.`,reason:'ambiguous-team'};
  }

  async function inventoryTeam(team: string | undefined, options?: ReadOptions): Promise<Result<InventoryTeam>> {
    const status = await read(run(['status', ...(team ? ['--team', team] : [])], cliStatusTeams, value => value, []), options);
    if (!status.ok) return { ok: false, error: status.error };
    if (!team && status.value.teams.length !== 1) return teamSelectionFailure(status.value.teams);
    const selected = team ? status.value.teams.find(value => value.team === team) : status.value.teams.length === 1 ? status.value.teams[0] : undefined;
    if (!selected) return { ok: false, error: 'Select a team explicitly to read its skills.', reason: 'ambiguous-team' };
    if (!selected.readable) return fail(`Team ${selected.team} could not be read.`);
    return { ok: true, value: selected };
  }
  async function peopleInventory(options?: ReadOptions) {
    const status = await read(run(['status'], cliStatus, value => value, []), options);
    if (!status.ok) return status;
    if (status.value.teams.length !== 1) return teamSelectionFailure(status.value.teams);
    const team = status.value.teams[0]!;
    if (!team.readable) return { ok: false as const, error: `Team ${team.team} could not be read.` };
    const inventory = await read(run(['ls', '--team', team.team], cliLs, value => value, []), options);
    return inventory.ok ? { ok: true as const, value: { team, inventory: inventory.value } } : inventory;
  }
  async function readEvalReport(ref:string,team:string|undefined,options?:ReadOptions) {
    const lines:string[]=[];
    const report=await read(run(['eval-report',...(team?['--team',team]:[]),'--',ref],cliEvalReport,value=>value,[]),options,lines);
    return {report,lines};
  }
  const backend: Backend = {
    async setWindowBackground(color) { try { await getCurrentWindow().setBackgroundColor(color); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async launchContext() {
      const launch = await state();
      return launch ? { writtenAt: launch.writtenAt, ...(launch.target ? { target: launch.target } : {}), ...(launch.intent ? { intent: launch.intent } : {}) } : null;
    },
    async refreshLaunch() {
      await launchListenerReady;
      stateOnce = undefined;
      generation++;
      return backend.launchContext();
    },
    onLaunchRequest(listener) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      launchListenerReady = bridge.onLaunchRequest(listener).then(stop => {
        if (disposed) stop(); else unlisten = stop;
      });
      return () => { disposed = true; unlisten?.(); };
    },
    async features(): Promise<Features> {
      if (!hello) await (featuresOnce ??= read(run(['status'], z.unknown(), value => value, [])).then(() => undefined));
      return Object.fromEntries(FEATURE_KEYS.map(key => [key, hello?.features[key] ?? false])) as Features;
    },
    async capabilities(): Promise<Capabilities> {
      const [platform, features] = await Promise.all([bridge.hostPlatform().catch(() => 'unknown'), backend.features()]);
      return { appVersion: import.meta.env.VITE_APP_VERSION, windowChrome: platform === 'macos' ? 'mac-overlay' : 'native', disablePerMachine: features.disablePerMachine, inboxEventLog: false, offtargetKind: false, machineRegistry: false, perCaseEvalTables: features.perCase, evalCommitChoice: features.runEvalInApp, openInEditor: true, clipboard: true };
    },
    async surfaces(): Promise<Surfaces> {
      return { divergence: false, status: true, settings: true, onboarding: false, library: true, skill: true, receipts: true, inbox: false, catalog: true, roster: true, update: true };
    },
    // Status and Settings are offline reads; the remaining surfaces retain their explicit gaps.
    status: (_, options) => readModels(options, (value, local, platform) => statusModel(value, local, platform, { localIdentity: hello?.features.localIdentity ?? false })),
    settings: (_, options) => readModels(options, (value, local, platform) => settingsModel(value, local, statusModel(value, local, platform, { localIdentity: hello?.features.localIdentity ?? false }))),
    onboarding: async () => gap('Onboarding data'),
    async library({ scope, team }, options) {
      const selected = await inventoryTeam(team, options);
      if (!selected.ok) return { ok: false, error: selected.error, ...(selected.reason ? { reason: selected.reason } : {}) };
      const args = scope.toLowerCase() === 'global' || scope.toLowerCase() === 'installed' ? [] : ['project', scope];
      const inventory = await read(run(['ls', ...args, '--team', selected.value.team], cliLs, value => value, []), options);
      if (!inventory.ok) return fail(inventory.error);
      const local = await read(run(['ls', '--local'], cliLs, value => value, []), options);
      if (!local.ok) return fail(local.error);
      const directory = await home();
      const skills = inventory.value.skills.map(row => inventoryCard(row, local.value, selected.value.team, { localIdentity: hello?.features.localIdentity ?? false }, directory)).filter(row => scope.toLowerCase() !== 'installed' || row.installed);
      const installs = skills.reduce((sum, row) => sum + row.installsN, 0);
      const globalCount = skills.filter(skill => skill.paths.some(([, scope]) => scope === 'global')).length;
      const projectSection = local.value.local?.find(section => section.scope === 'project');
      const projectCount = skills.filter(skill => skill.paths.some(([, scope]) => scope === 'project')).length;
      const projectName = projectSection ? (projectSection.repoRoot ?? projectSection.root).split(/[\\/]/).filter(Boolean).at(-1) ?? '' : '';
      const value: Library = { scanned: (local.value.local ?? []).map(section => section.scope === 'global' ? '~/.claude/skills' : section.repoRoot ?? section.root), skills, title: `${skills.length} skills · ${globalCount} in ~/.claude/skills${projectSection ? ` · ${projectCount} in ${projectName}` : ''}`, projects: inventory.value.projects ?? [], problems: inventory.value.problems, provenance: null,
        overview: { skills: String(skills.length), skills_note: `${inventory.value.skills.filter(row => row.endorsement === 'global').length} ${args.length===0?'endorsed to Global':'also on Global'}`, evaluated: '—', meter: { pass_: 0, neutral: 0, fail: 0, total: 0 }, meter_text: '', installs: String(installs), installs_note: `across every readable people file · ${inventory.value.roster.filter(person => person.active).length} active teammate${inventory.value.roster.filter(person => person.active).length === 1 ? '' : 's'}`, attention: '—', attention_lines: [], attention_link: '', zero: { skills: '', evaluated: '', installs: '', attention: '' } },
      };
      return { ok: true, value };
    },
    async skill({ ref, team }, options) {
      const parts = ref.split('/');
      const explicitTeam = team ?? (parts.length === 2 ? parts[0] : undefined);
      const name = parts.length === 2 ? parts[1]! : ref;
      const selected = await inventoryTeam(explicitTeam, options);
      if (!selected.ok) return { ok: false, error: selected.error, ...(selected.reason ? { reason: selected.reason } : {}) };
      const inventory = await read(run(['ls', '--team', selected.value.team], cliLs, value => value, []), options);
      if (!inventory.ok) return fail(inventory.error);
      const matches = inventory.value.skills.filter(row => row.name === name || row.id.startsWith(name));
      const row = inventory.value.skills.find(row => row.name === name) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!row) return fail(`No unambiguous skill ${name} in team ${selected.value.team}.`);
      const local = await read(run(['ls', '--local'], cliLs, value => value, []), options);
      if (!local.ok) return fail(local.error);
      const validation = await backend.validate({ ref: row.name, team: selected.value.team }, options);
      // A hygiene failure has a parsed value; an unreadable/cancelled validation is a read failure.
      if (!validation.ok && validation.value === undefined) return fail(validation.error);
      const detail = inventoryDetail(row, local.value, selected.value, validation, inventory.value, { localIdentity: hello?.features.localIdentity ?? false }, await home());
      const report = await backend.evalReport({ref:row.name,team:selected.value.team},options);
      return {ok:true,value:report.ok?{...detail,...report.value}:{...detail,evalReportError:report.error}};
    },
    async evalReport({ref,team},options) {
      const {report,lines}=await readEvalReport(ref,team,options);
      return report.ok?{ok:true,value:mapEvalReport(report.value,lines)}:{ok:false,error:report.error};
    },
    async receipts({skillId,version},options) {
      const {report,lines}=await readEvalReport(skillId,undefined,options);
      if(!report.ok)return {ok:false,error:report.error};
      return {ok:true,value:report.value.latestState==='ok'&&report.value.latest?.version===version?mapEvalReport(report.value,lines).receipt:null};
    },
    inbox: async () => gap('The Inbox'),
    async roster(_, options) {
      const data = await peopleInventory(options);
      if (!data.ok) return {ok:false,error:data.error,...(data.reason?{reason:data.reason}:{})};
      const { team, inventory } = data.value;
      return { ok: true, value: rosterModel(team, inventory) };
    },
    async catalog(query, options) {
      const data = await peopleInventory(options);
      if (!data.ok) return {ok:false,error:data.error,...(data.reason?{reason:data.reason}:{})};
      const { team, inventory } = data.value;
      const local = await read(run(['ls', '--local'], cliLs, value => value, []), options);
      if (!local.ok) return fail(local.error);
      const people: Person[] = [];
      for (const member of rosterModel(team, inventory).members) {
        const detail = await read(run(['ls', 'member', '--team', team.team, '--', member.handle], cliLs, value => value, []), options);
        if (!detail.ok) return fail(detail.error);
        if (!detail.value.member) return fail(`No member data for ${member.handle}.`);
        const authored = detail.value.skills;
        const names = authored.map(skill => skill.name);
        const installedIds = new Set((detail.value.member.installed ?? []).map(item => item.id));
        const installable = inventory.skills.filter(skill => installedIds.has(skill.id));
        people.push({ ...member, organization: team.team, declined: detail.value.member.declined, skills: names, installable: installable.map(skill => skill.name), adoption: authored.reduce((sum, skill) => sum + skill.installs, 0), publishLine: '—', teamsLine: member.projects.join(' · '), buckets: names.length ? [['Authored', names]] : [], placeNote: '—', onDisk: [installable.filter(skill => onDisk(local.value, team.team, skill.id, { localIdentity: hello?.features.localIdentity ?? false }).length > 0).length, installable.length] });
      }
      return { ok: true, value: catalogModel(team, inventory, local.value, people, { localIdentity: hello?.features.localIdentity ?? false }, await home(), query?.q) };
    },
    search: (args: SearchArgs, options?: ReadOptions) => read(run(['search', '--', args.q], cliSearch, (hits): SearchHit[] => hits.map((hit) => ({ kind: 'skill', ref: hit.team === undefined ? hit.name : `${hit.team}/${hit.name}`, name: hit.name, description: hit.description, team: hit.team ?? null, category: hit.category ?? null, author: hit.author ?? null, installs: hit.installs ?? null, latest: hit.latest ?? null, endorsed: hit.endorsed ?? null, unresolved: hit.unresolved ?? null })), []), options).then(result),
    // Long verbs: one process each, questions become dialogs, the CLI's own decline messages come back as `ok:false`.
    setIdentity: (args) => {
      const pairs = [args.name === undefined ? [] : [`name=${args.name}`], args.email === undefined ? [] : [`email=${args.email}`], args.defaultHandle === undefined ? [] : [`default-handle=${args.defaultHandle}`]].flat();
      return run(['login', ...pairs.flatMap(pair => ['--set', pair])], cliLogin, (value): IdentityWrite => ({ updated: value.updated, notice: value.notice ?? null }), ['config']);
    },
    install: (args: InstallArgs) => run(['install', ...(!(args.kind === 'member' && args.member || args.kind === 'project' && args.project) && args.force ? ['--force'] : []), ...(args.team ? ['--team', args.team] : []), '--', ...(args.kind === 'member' && args.member ? ['member', args.member] : args.kind === 'project' && args.project ? ['project', args.project] : [args.ref])], cliInstalled, (installed): InstalledResult[] => installed.map((item) => ({ id: item.id, name: item.id, scope: args.scope ?? 'Global' }))),
    uninstallSkill: (args: UninstallArgs) => run(['uninstall-skill', ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliUninstalled, (removed): UninstalledResult[] => removed.map((item) => ({ id: item.id, name: item.id }))),
    quit: () => bridge.quit(),
    uninstallMachine: () => run(['uninstall'], cliMachine, (value): MachineUninstallResult => ({ removed: value.teams, removedPlacements: value.removedPlacements, hookRemoved: value.hookRemoved, wrapperRemoved: value.wrapperRemoved, configRemoved: value.configRemoved, kept: value.kept, record: value.record, advice: value.advice })),
    connect: (args: ConnectArgs) => run<z.infer<typeof cliConnect>, ConnectOutcome | undefined>(['connect', ...(args.team ? ['--team', args.team] : []), ...(args.allowPrivileged ? ['--allow-privileged'] : []), ...(args.path ? ['--', args.path] : [])], cliConnect, (value) => value as ConnectOutcome | undefined, ['config', 'clone']),
    profile: args => run(['profile', ...(args.name === undefined ? [] : ['--name', args.name]), ...(args.bio === undefined ? [] : ['--bio', args.bio]), ...(args.role === undefined ? [] : ['--role', args.role]), ...(args.projects ?? []).flatMap(project => ['--project', project])], cliProfile, value => value, ['clone']),
    decline: args => run(['decline', '--', args.ref], cliDecline, value => ({ id: value.id }), ['clone']),
    publish: (args: PublishArgs) => run(['publish', ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliPublish, (value): PublishResult => ({ name: value.name, version: value.prUrl ?? value.branch ?? null, changed: value.changed ?? true }), ['clone']),
    // Never `--hook` from the app: its stdout is the reload directive (frame mode refuses it anyway).
    sync: (args: SyncArgs) => run(['sync', ...(args.prune ? ['--prune'] : []), ...(args.team ? ['--team', args.team] : [])], cliSync, (value): SyncResult => ({ placed: value.deferred.length || value.placed ? [] : [], removed: [] }), ['clone', 'placed', 'stamp']),
    invite: (args: InviteArgs) => run(['invite', ...(args.team ? ['--team', args.team] : []), ...(args.logins.length ? ['--', ...args.logins] : [])], cliInvite, (value): InviteResult => ({ invited: [...value.invited] }), ['clone']),
    team: (args: TeamArgs) => run(teamArgv(args), cliTeam, (value): TeamResult => ({ name: value.team, kind: args.kind }), ['config', 'clone', 'placed']),
    setup: (args: SetupArgs) => run(['setup', ...(args.target ? ['--', args.target] : [])], cliSetup, (value): SetupResult => ({ team: value.team, role: value.role, steps: value.steps ?? null }), ['config', 'clone', 'placed']),
    eval: (args: EvalArgs) => run(['eval', ...(args.commit ? ['--commit'] : []), ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliEval, (value): EvalResult => ({ name:value.name,runDir:value.runDir,executionStatus:value.executionStatus,commit:value.commit }), ['clone']),
    validate: (args: ValidateArgs, options?: ReadOptions) => args.ref || args.cwd ? read(run(['validate', ...(args.cwd && args.ref ? ['--cwd', args.cwd] : []), ...(args.team ? ['--team', args.team] : []), '--', args.ref || args.cwd || ''], cliValidate, (value): ValidateResult => value, []), options).then(result) : fail('validate needs a skill name or a folder.'),
    update: (_args, options) => read(run(['update'], cliUpdate, (value): UpdateAdvice => ({ ...value, running: value.running ?? null, latest: value.latest ?? null }), []), options).then(result),
    diagnostics: () => run(['status'], z.unknown(), () => undefined, []),
    async windowAction(action) { try { const window = getCurrentWindow(); if (action === 'toggle-maximize') await window.toggleMaximize(); else await window.startDragging(); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async openUrl(url) { try { await openUrl(url); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async revealPath(path) { try { await revealItemInDir(await localPath(path)); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async openInEditor(path) { try { await openPath(await localPath(path)); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async copyToClipboard(text) { try { await writeText(text); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async copyImage(png) { try { await writeImage(await Image.fromBytes(new Uint8Array(await png.arrayBuffer()))); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    // App-config-dir storage, with one-time migration from the old webview keys.
    prefs: nativePrefs(),
    subscribe(listener): Subscription { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return backend;
}

function teamArgv(args: TeamArgs): string[] {
  switch (args.kind) {
    case 'create': return ['team', 'create', ...(args.remote ? ['--remote', args.remote] : []), ...(args.name ? ['--', args.name] : [])];
    case 'join': return ['team', 'join', ...(args.remote && args.name ? ['--as', args.name] : []), '--', args.remote ?? args.name ?? ''];
    case 'remove': return ['team', 'remove', ...(args.team ? ['--team', args.team] : []), '--', args.handle ?? ''];
    case 'leave': return ['team', 'leave', '--', args.name ?? args.team ?? ''];
  }
}

/** Drive a read-only run without answering questions, retaining diagnostics and partial values. */
export async function read<T>(job: Run<T>, options?: ReadOptions, lines: string[] = []): Promise<Result<T>> {
  const signal = options?.signal;
  const cancel = () => { void job.cancel(); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    for await (const frame of job.frames) {
      if (frame.t === 'print') lines.push(frame.line);
      if (frame.t === 'ask') {
        await job.cancel();
        return { ok: false, error: `terum-skills asked "${frame.question}" during a read-only call; the desktop app never answers questions on your behalf.` };
      }
    }
    const result = await job.done;
    return result.ok || !lines.length ? result : { ...result, error: [result.error, ...lines].join('\n') };
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
