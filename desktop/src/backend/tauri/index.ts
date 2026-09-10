import { z } from 'zod';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { nativePrefs } from './prefs';
import { SETUP_STEP_KEYS, FEATURE_KEYS } from '../types';
import type { Features } from '../types';
import type { CliFrame } from './frames';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeText, writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { Image } from '@tauri-apps/api/image';
import type { Backend } from '../Backend';
import type { Root, LibraryTeam, IdentityWrite, Catalog, Roster, Person, Library, SkillCard, SkillDetail, UpdateAdvice, StatusResult, Settings, Capabilities, Surfaces, ReadOptions, ChangeSource, ConnectArgs, ConnectOutcome, EvalArgs, EvalResult, InstallArgs, InstalledResult, InviteArgs, InviteResult, MachineUninstallResult, PublishArgs, PublishResult, Result, Run, SearchArgs, SearchHit, SetupArgs, SetupResult, Subscription, SyncArgs, SyncResult, TeamArgs, TeamResult, UninstallArgs, UninstalledResult, ValidateArgs, ValidateResult } from '../types';
import { tauriBridge, type AppState, type Bridge } from './bridge';
import { cliRun } from './run';
import { prepareRun } from './prepare-run';
import { cliEvalReport, mapEvalReport } from './eval-report';
import { relativeTime } from '../../lib/relative-time';
import { personPlaceNote } from '../../screens/marketplace/market-data';
import { abbreviateHome, stripRemote } from '../paths';
import { scannedRoots } from './scanned-roots';
import { overviewCopy } from '../../lib/overview-copy';

/**
 * The real adapter: every long verb is one `terum-skills --frames <verb>` process (run.ts). What the CLI has
 * no verb for yet is answered honestly with a failing Result that names GAPS.md, so the screens render their
 * drawn error states instead of fixture data pretending to be real. Mappings between the CLI's result shapes
 * (src/commands/*.ts) and the seam's DTOs (../types) are here and nowhere else.
 */

// The CLI's result shapes, as of terum-skills 0.1.5 (src/commands/*.ts). Validated loosely: only the fields the seam reads.
const cliProfile = z.object({ handle: z.string(), changed: z.array(z.string()) });
const cliDecline = z.object({ handle: z.string(), id: z.string(), declined: z.literal(true) });
const memberMetadata = { role: z.string().nullish().transform(value => value ?? null), projects: z.array(z.string()).nullish().transform(value => value ?? []), admin: z.boolean().nullish().transform(v => v ?? null) };
const cliLogin = z.object({ updated: z.array(z.object({ key: z.string(), value: z.string() })), notice: z.string().nullish() });
const cliInstalled = z.array(z.object({ id: z.string(), team: z.string() }).passthrough());
const cliUninstalled = z.array(z.object({ id: z.string(), team: z.string(), removed: z.number() }).passthrough());
const cliMachine = z.object({ teams: z.array(z.string()), removedPlacements: z.number(), hookRemoved: z.boolean(), wrapperRemoved: z.boolean(), configRemoved: z.boolean(), kept: z.array(z.string()), record: z.string(), advice: z.array(z.string()) }).passthrough();
const cliConnectResult = z.object({ id: z.string(), name: z.string(), reconciled: z.boolean().optional(), adopted: z.boolean().optional() }).passthrough();
const cliConnect = z.union([z.object({ kind: z.literal('batch'), shared: z.array(cliConnectResult), declined: z.array(z.string()), refused: z.array(z.object({ name: z.string(), reason: z.string() })) }).passthrough(), cliConnectResult]).optional();
const cliPublish = z.object({ name: z.string(), branch: z.string().nullable(), prUrl: z.string().nullable(), changed: z.boolean().optional() }).passthrough();
const cliSync = z.object({ placed: z.number(), deferred: z.array(z.string()) }).passthrough();
const cliInvite = z.object({ team: z.string(), invited: z.array(z.string()), already: z.array(z.string()).default([]), failed: z.array(z.object({ login: z.string(), error: z.string() })).default([]) }).passthrough();
const cliTeam = z.object({ team: z.string() }).passthrough();
const cliSetup = z.object({ role: z.enum(['creator', 'joiner']), team: z.string(), steps: z.partialRecord(z.enum(SETUP_STEP_KEYS), z.enum(['done','skipped','printed'])).nullish().transform(value => value ?? null) });
const cliEval = z.object({ name:z.string(),runDir:z.string(),executionStatus:z.enum(['complete','partial','failed']),commit:z.union([z.object({ok:z.literal(true),receiptPath:z.string()}),z.object({ok:z.literal(false),error:z.string()})]).nullable() }).passthrough();
const cliValidate = z.object({ name: z.string(), findings: z.number(), warnings: z.number() });
const cliSearch = z.array(z.object({ team: z.string().optional(), endorsed: z.string().optional(), id: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), unresolved: z.boolean(), description: z.string(), grants: z.string().nullable(), grantsHash: z.string().nullable(), updated: z.string() }));

const cliScope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('global') }), z.object({ kind: z.literal('project'), project: z.string() })]);
const cliLsSkill = z.object({ id: z.string(), name: z.string(), author: z.string(), category: z.string(), characters: z.number().nullish().transform(value => value ?? null), installs: z.number(), latest: z.string(), endorsement: z.string(), unresolved: z.boolean(), description: z.string(), grants: z.string().nullable(), grantsHash: z.string().nullable(), updated: z.string(), body: z.string().nullable(), installedBy: z.array(z.object({ handle: z.string(), displayName: z.string(), scope: cliScope, since: z.string().nullish() })) });
const cliProject = z.object({ name: z.string(), skills: z.array(z.string()), remotes: z.array(z.string()), description: z.string().optional() }).catchall(z.unknown());
// S7g: every `ls --local` row carries typed provenance and a read-only health; the prose `state` is never parsed.
const cliLocalHealth = z.enum(['up-to-date', 'update-available', 'local-changed', 'both', 'gone-from-repo', 'untracked', 'unknown']);
const cliLocalRow = z.object({ name: z.string(), path: z.string(), state: z.string(), tracked: z.boolean(), shared: z.array(z.strictObject({ id: z.string(), team: z.string() })), placement: z.strictObject({ id: z.string(), team: z.string(), version: z.string().length(40).nullable() }).nullable(), health: cliLocalHealth, description: z.string().nullish().transform(value => value ?? null), characters: z.number().nullish().transform(value => value ?? null), problem: z.string().optional(), skillId: z.string().nullable().optional(), placed: z.boolean().optional(), connected: z.boolean().optional() }).strict();
const cliLocalSection = z.object({ root:z.string(), scope:z.enum(['global','project']), repoRoot:z.string().optional(), remote:z.object({url:z.string(),slug:z.string().nullable()}).nullish(), registered:z.boolean().optional(), detected:z.boolean().optional(), rootState:z.enum(['scanned','absent','unreadable']).optional(), label:z.string().optional(), counts:z.object({skillFolders:z.number(),connectable:z.number()}).optional(), rows:z.array(cliLocalRow), notOffered:z.array(z.object({skillId:z.string().nullable().optional(),name:z.string(),path:z.string(),reason:z.string(),detail:z.string().optional(),description:z.string().nullish().transform(value=>value??null),characters:z.number().nullish().transform(value=>value??null)})).optional(), problems:z.array(z.object({path:z.string(),reason:z.string()})) });
const cliCheckoutAdded = z.object({path:z.string(),registered:z.boolean()});
const cliCheckoutRemoved = z.object({path:z.string(),placementsRemaining:z.number()});
const cliLs = z.object({
  roster: z.array(z.object({ handle: z.string(), active: z.boolean(), ...memberMetadata })), skills: z.array(cliLsSkill), problems: z.array(z.object({ source: z.string(), message: z.string() })), projects: z.array(cliProject).optional(), member: z.object({ installed: z.array(z.object({ id: z.string(), scope: cliScope, since: z.string() })).optional(), handle: z.string(), declined: z.array(z.string()), ...memberMetadata }).optional(),
  local: z.array(cliLocalSection).optional(),
});
const cliStatusTeams = z.object({ version: z.string().nullable(), teams: z.array(z.object({ team: z.string(), handle: z.string(), repository: z.string().nullable(), readable: z.boolean(), sharedSkills: z.number().nullable(), memberCount: z.number().nullable(), members: z.array(z.object({ handle: z.string(), displayName: z.string() })).optional() })) });
type Inventory = z.infer<typeof cliLs>;
type InventorySkill = z.infer<typeof cliLsSkill>;
type InventoryTeam = z.infer<typeof cliStatusTeams>['teams'][number];

type LocalSection=z.infer<typeof cliLocalSection>;
type LocalRow=z.infer<typeof cliLocalRow>;
type NotOffered=NonNullable<LocalSection['notOffered']>[number];
function normalizePath(path:string):string{return path.replace(/[\\/]+$/,'');}
function basename(path:string):string{return normalizePath(path).split(/[\\/]/).at(-1)??'';}
function labelOf(section:LocalSection):string{return section.label??(section.scope==='global'?'Global':basename(section.repoRoot??section.root));}
/**
 * The card's context weight. There is no tokenizer in the CLI, so this is the same arithmetic the
 * CLI itself prints in HYG6 ("20,000 characters … ~5k tokens"): four characters to a token. The
 * tilde is load-bearing — the number is an estimate, and the card must not read as a measurement.
 */
function tokenLabel(characters:number|null):{size:string;tokensK:number}{
  if(characters===null)return {size:'—',tokensK:0};
  const tokens=Math.round(characters/4);
  return {size:tokens<1000?`~${tokens} tokens`:`~${(tokens/1000).toFixed(1)}k tokens`,tokensK:tokens/1000};
}
function rootOf(section:LocalSection,home=''):Root {
  const global=section.scope==='global',repoRoot=section.repoRoot??section.root;
  return {id:global?'global':repoRoot,kind:global?'global':'checkout',label:labelOf(section),root:global?(home?abbreviateHome(section.root,home):'~/.claude/skills'):repoRoot,rootState:section.rootState,registered:section.registered??false,detected:section.detected??false,count:section.counts?String(visibleSkillFolders(section)):undefined,remote:section.remote??null};
}
// D2: only these frontmatter failures still describe folders holding SKILL.md. 'managed-wrapper' is
// deliberately absent: the bundled /terum-skills skill is counted as a folder by the CLI, but it is
// our own placed component, so the Library neither draws it as a card nor counts it anywhere.
function countable(entry:NotOffered):boolean{return ['no-frontmatter','invalid-yaml','illegal-name','name-mismatch','description-missing','unsupported-field','malformed-allowed-tools'].includes(entry.reason);}
// The grid's own arithmetic — rows plus the countable omissions, deduplicated by path exactly as
// library() draws its cards. Every count the app prints (sidebar, Skills tile, Library title, search
// placeholder) comes from here, so a folder countable() hides — the managed /terum-skills wrapper —
// is absent from the numbers too. The CLI's counts.skillFolders keeps counting it, and must: the
// terminal lists the wrapper under "Cannot be connected", so its total stays true for that output.
function visibleSkillFolders(section:LocalSection):number{
  const seen=new Set<string>(section.rows.map(row=>row.path));
  let n=seen.size;
  for(const entry of section.notOffered??[])if(countable(entry)&&!seen.has(entry.path)){seen.add(entry.path);n++;}
  return n;
}
function joinedSkill(row:LocalRow,inventory:Inventory,team:string,features:Pick<Features,'localIdentity'>):InventorySkill|undefined {
  return inventory.skills.find(skill=>features.localIdentity&&row.skillId!=null?row.skillId===skill.id:row.placement?.id===skill.id&&row.placement.team===team);
}
function localCard(row:LocalRow,section:LocalSection,home:string):SkillCard {
  const placed=row.placed??row.placement!==null,local=!row.connected&&!row.shared.length&&!placed;
  // A folder nobody has shared genuinely has no installs; 0 is the fact, and the 'local' flag beside
  // it says why. A placed row only reaches here when its team could not be read (the screen says so
  // above the grid), and there 0 would be a claim we cannot back, so it stays a dash.
  // The identity line names the root the folder lives in, never the word 'local'.
  return {path:row.path,name:row.name,desc:row.description??'',project:labelOf(section),category:'—',installs:local?'0 installs':'—',installsN:0,installed:true,placed,onDiskOnly:!placed,paths:[[abbreviateHome(row.path,home),section.scope]],connectedSources:row.connected||row.shared.length?[row.path]:[],flags:row.problem!==undefined?['broken']:local?['local']:[],flagText:row.problem!==undefined?{broken:row.problem}:local?{local:'Local · not shared with a team'}:{},grants:null,normalizedGrants:null,grantsHash:null,...tokenLabel(row.characters),wlt:null,summary:null,favorite:false,favorites:null,enabled:true,updated:null,indicators:{broken:{icon:'alert',token:'bad',text:'The skill version could not be resolved.'},update:{icon:'arrow-up-circle',token:'warn',text:''},local:{icon:'pencil',token:'text3',text:''}}};
}
function notOfferedCard(entry:NotOffered,section:LocalSection,home:string):SkillCard {
  return localCard({name:entry.name,path:entry.path,state:'',tracked:false,shared:[],placement:null,health:'unknown',description:entry.description,characters:entry.characters,problem:'Not connectable · '+(entry.detail??entry.reason)},section,home);
}
function localDetail(card:SkillCard,section:LocalSection,path:string,home:string):SkillDetail {
  const pathLabel=abbreviateHome(path,home);
  return {...card,desc_long:card.desc,size_bytes:'—',team:null,skillRef:'local:'+path,root:'Global',installScopes:[],projectNames:null,favorites:null,lines:null,hygieneCaption:null,hygieneStatus:null,hygieneWhen:null,path,pathLabel,repo:null,repoPath:pathLabel,version:'—',version_full:null,scope:section.scope==='global'?'Global':labelOf(section),installs_n:0,used_by:[],users:[],author:{name:'',handle:'',role:'',initials:''},files:null,grants_approved:'',receipt:null,history:[],activity:[],hygiene:[],skillMd:{frontmatter:'',body:[],markdown:null},evalEstimate:null,evalEstimateText:'',evalEstimateTip:'',evalCommand:'npx -y terum-skills@latest eval '+card.name,shareCommand:'npx -y terum-skills@latest connect '+pathLabel,incumbentLift:null,reportNumbers:null,scoreFractions:{routesExpected:null,roi:null,quality:null},method:'',versions:null,latestState:'none',invalidReceiptFile:null,evalReportError:null,localRuns:[],unidentifiedLocal:null,viewerHandle:null};
}

function localRows(local: Inventory) {
  return local.local?.flatMap(section => section.rows.map(row => ({ ...row, scope: section.scope, root: section.root, repoRoot: section.repoRoot, label: section.label }))) ?? [];
}
// Join provenance by team and ID, including relocated or conflicting tracked folders. Every clause
// is an id the CLI itself reported: a ledger placement, a connected source, or identity read from
// the folder. A ref carrying a team is matched with it; `skillId` is a uuid and needs none.
function onDisk(local: Inventory, team: string, id: string, features: Pick<Features, 'localIdentity'>) {
  return localRows(local).filter(row => (row.placement?.id === id && row.placement.team === team) || row.shared.some(source => source.id === id && source.team === team) || (features.localIdentity && row.skillId === id));
}
/**
 * `skillId` reaches `ls --local` rows only from CLI 0.1.8 (the `localIdentity` feature). An older
 * CLI reports an untracked folder with no id at all, so a same-named one is not evidence of
 * absence — presence is unknowable. Name spots that ambiguity and never infers presence: the
 * caller reports "unknown" and the skill still does not count as installed.
 */
function unidentifiedLocal(local: Inventory, name: string, features: Pick<Features, 'localIdentity'>, home: string) {
  if (features.localIdentity) return null;
  const row = localRows(local).find(row => row.name === name && row.placement === null && row.shared.length === 0);
  return row ? { path: row.path, pathLabel: abbreviateHome(row.path, home) } : null;
}
function inventoryCard(row: InventorySkill, local: Inventory, team: string, features: Pick<Features, 'localIdentity'>, home: string): SkillCard {
  const rows = onDisk(local, team, row.id, features);
  const placements = rows.filter(r => r.placement?.id === row.id && r.placement.team === team);
  const placed = placements.length > 0, installed = rows.length > 0;
  const problem = placements.find(r => r.problem !== undefined || r.health === 'unknown' || r.health === 'gone-from-repo');
  return { path:null, name: row.name, category: row.category, project: row.endorsement === 'global' ? 'Global' : row.endorsement.replace(/^project: /, ''), installs: `${row.installs} install${row.installs === 1 ? '' : 's'}`, installsN: row.installs, installed, placed, onDiskOnly: installed && !placed, paths: rows.map(r => [abbreviateHome(r.path, home), r.scope]), projectRoots: rows.flatMap(r => r.repoRoot ? [r.repoRoot] : []), connectedSources: rows.filter(r => r.shared.length > 0).map(r => r.path), desc: row.description, grants: row.grants === null ? null : row.grants === 'none' ? [] : row.grants.split('\n'), normalizedGrants: row.grants ?? null, grantsHash: row.grantsHash ?? null, ...tokenLabel(row.characters), wlt: null, summary: null, favorite: false, favorites: null, enabled: true, flags: problem || row.unresolved ? ['broken'] : [], flagText: problem ? { broken: problem.problem ?? 'placed copy could not be inspected' } : {}, updated: row.updated === '—' ? null : row.updated ?? null, indicators: { broken: { icon: 'alert', token: 'bad', text: 'The skill version could not be resolved.' }, update: { icon: 'arrow-up-circle', token: 'warn', text: '' }, local: { icon: 'pencil', token: 'text3', text: '' } } };
}
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
/** `owner/repo` as the team remote spells it (case kept; any host); null when the team has no remote. */
function repoSlug(remote: string | null | undefined): string | null {
  return remote ? stripRemote(remote.trim()).replace(/^github\.com\//, '') : null;
}
function detailVersionFields(repo: string | null, name: string, version: string | null): Pick<SkillDetail, 'version' | 'version_full' | 'shareCommand'> {
  return { version: version?.slice(0, 12) ?? '—', version_full: version, shareCommand: repo ? `npx -y terum-skills@latest install ${repo}/${name}${version ? '@' + version.slice(0, 12) : ''}` : '—' };
}
function inventoryDetail(row: InventorySkill, local: Inventory, team: InventoryTeam, validation: Result<ValidateResult>, inventory: Inventory, features: Pick<Features, 'localIdentity'>, home: string): SkillDetail {
  const card = inventoryCard(row, local, team.team, features, home), rows = onDisk(local, team.team, row.id, features), placed = rows.find(r => r.placement?.id === row.id && r.placement.team === team.team);
  const path = placed?.path ?? rows[0]?.path ?? null;
  const name = row.author.replace(/\s*<[^>]*>$/, '');
  const installers = row.installedBy;
  const repo = repoSlug(team.repository);
  const version = placed?.placement?.version ?? (row.latest === '—' ? null : row.latest || null);
  const emailHandle = row.author.match(/<([^@<>]+)@[^>]+>$/)?.[1];
  const handle = team.members?.find(member => member.displayName === name)?.handle ?? team.members?.find(member => member.handle === emailHandle)?.handle ?? '';
  const projects = (local.local ?? []).filter(section => section.scope === 'project' && section.rootState !== 'absent' && section.label);
  const installScopes: [string, string][] = [['Global', 'every session · ~/.claude/skills'], ...projects.map((section): [string, string] => [section.label!, `project · ${abbreviateHome(section.repoRoot ?? section.root, home)}`])];
  // Captions stay display-only; removal needs the original absolute destination.
  const installScopePaths = Object.fromEntries(projects.flatMap(section => section.repoRoot && projects.filter(other => other.label === section.label).length === 1 ? [[section.label!, section.repoRoot]] : []));
  return { ...card, team: team.team, installScopes, installScopePaths, projectNames: inventory.projects?.map(project => project.name) ?? null, favorites: null, lines: typeof row.body === 'string' ? row.body.replace(/\n$/, '').split('\n').length : null, skillRef: `${team.team}/${row.name}`, root: 'Global', desc_long: row.description, files: null, size_bytes: '—', ...detailVersionFields(repo, row.name, version), scope: placed?.scope === 'global' ? 'Global' : placed?.label ?? placed?.scope ?? null, installs_n: row.installs, installed: card.installed,
    unidentifiedLocal: card.installed ? null : unidentifiedLocal(local, row.name, features, home), viewerHandle: team.handle,
    used_by: [...new Map(installers.map(person => [person.handle, initials(person.displayName)])).values()], users: installers.map(person => [person.handle, initials(person.displayName), `${person.scope.kind === 'global' ? 'Global' : person.scope.project}${person.since ? ` · since ${person.since.slice(0, 10)}` : ''}`]),
    author: { name, handle, role: '', initials: initials(name) }, repo, repoPath: `skills/${row.name}`, path, pathLabel: path === null ? '—' : abbreviateHome(path, home), grants_approved: '', versions:null,latestState:'none',invalidReceiptFile:null,localRuns:[],evalReportError:null, receipt: null, history: [], activity: [], hygiene: [], hygieneCaption: null, hygieneStatus: validation.value === undefined ? null : validation.ok && validation.value.findings === 0 ? 'pass' : 'fail', hygieneWhen: null,
    skillMd: { frontmatter: '', body: [], markdown: row.body ?? null }, evalEstimate: null, evalEstimateText: '', evalEstimateTip: '', evalCommand: `npx -y terum-skills@latest eval ${row.name}`, incumbentLift: null, reportNumbers: null, scoreFractions: { routesExpected: null, roi: null, quality: null }, method: '',
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
const cliLocal=z.object({local:z.array(cliLocalSection),skills:z.array(z.object({id:z.string(),name:z.string(),grantsHash:z.string().nullish().transform(v=>v??null),grants:z.string().nullish().transform(v=>v??null)}))});
type CliStatus=z.infer<typeof cliStatus>;
type CliLocal=z.infer<typeof cliLocal>;

function statusModel(value:CliStatus, local:CliLocal|null, platform:string):StatusResult {
 const name=value.identity?.display_name??'';
 const handle=value.teams[0]?.handle??''; // one team per machine — legacy 2+ shows a hint, not a projection
 return {
  ledger:value.ledger??null,
  machine:{os:platform,name:'',hostname:'',gh_login:'',gh_version:''},
  me:{handle,name,email:value.identity?.email??'',default_handle:value.identity?.default_handle??'',initials:name.split(/\s+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase(),footerLabel:[value.identity?.github,handle,value.identity?.default_handle].find(v=>v)??''},
  teams:value.teams.map(team=>({name:team.team,key:team.team,handle:team.handle,remote:team.repository??null,members:team.memberCount??null,skills:team.sharedSkills??null,clone:team.clonePath??null,last_sync:team.syncedAt??null,stamp:team.syncedAt??null,policy:team.policy===null?null:{publish:team.policy.publish==='pr'?'Pull request':'Push',license:team.policy.skill_license},categories:team.categories??null,pending:team.pending,joinCommand:team.joinCommand??null,joinBlock:team.joinBlock??null})),
  counts:local?.local.find(section=>section.scope==='global')?.counts ? {Global:String(visibleSkillFolders(local.local.find(section=>section.scope==='global')!))} : {},tools:value.tools,roots:local===null?[]:local.local.map(section=>rootOf(section)),
 };
}
// AD-23: the drawn placement states (design fixture PLACEMENTS: 'up to date', 'update available', 'edited locally', 'pinned'); a health the board has no word for is '—'.
const PLACEMENT_STATE:Record<z.infer<typeof cliLocalHealth>,string>={'up-to-date':'up to date','update-available':'update available','local-changed':'edited locally',both:'edited locally · update available','gone-from-repo':'removed from the team',unknown:'—',untracked:'—'};
function settingsModel(value:CliStatus, local:CliLocal|null, status:StatusResult, home:string):Settings {
 const rows=local?.local.flatMap(root=>root.rows)??[];
 const policy=status.teams.length===1?status.teams[0]?.policy??null:null; // one team per machine — legacy 2+ shows a hint, not a projection
 return {
  K:null,MACHINE:status.machine,ME:status.me,TEAMS:status.teams,tools:status.tools,
  INVITE_TIP:"GitHub emails the invitation; the block runs the joiner&#39;s wizard",
  JOIN_BLOCK_NOTE:"GitHub emails the invitation. The block runs the joiner&#39;s wizard: with gh signed in it accepts the pending invitation, otherwise it asks them to accept it in the browser, and git must have access to this repository.",
  TEAM_POLICY:{publish:policy?.publish??null,license:policy?.license??null,categories:status.teams.length===1?status.teams[0]?.categories??null:null,projects:null,categoriesNote:'From team.json; an admin extends it by pull request.'}, // one team per machine — legacy 2+ shows a hint, not a projection
  PLACEMENTS:value.ledger.placements.map(p=>{const row=rows.find(row=>row.path===p.path);const missing=local?.local.some(root=>root.problems.some(problem=>problem.path===p.path))??false;return [p.path,row?.name??p.id,p.scope.kind==='global'?'Global':p.scope.project,p.version?.slice(0,12)??null,p.placed_at??null,row?PLACEMENT_STATE[row.health]:missing?'folder missing':'—'];}),PLACEMENTS_N:value.ledger.placements.length,
  APPROVALS:value.ledger.approvals.flatMap(approval=>{const skill=local?.skills.find(skill=>skill.id===approval.id&&skill.grantsHash!==null&&skill.grantsHash===approval.grants&&skill.grants!==null);return skill?[[skill.name,skill.grants==='none'?[]:skill.grants!.split('\n'),approval.approved_at]]:[];}),
  // Sharing rows join the ledger's shared record to its scanned local row: the title is the skill name
  // (the raw id only when no scanned folder matches), and the state claims only what the scan can back —
  // Present when the connected source is on disk, Missing when a scanned root no longer holds it, '—'
  // when the source lives outside every scanned root. Sync words (In sync / Local edit / Diverged) wait
  // for a CLI health computed against the share baseline; `health` describes placements only.
  SHARED:value.ledger.shared.map(item=>{
   const row=rows.find(row=>row.shared.some(source=>source.id===item.id&&source.team===item.team))??rows.find(row=>normalizePath(row.path)===normalizePath(item.source));
   const scanned=local?.local.some(section=>(section.rootState??'scanned')==='scanned'&&normalizePath(item.source).startsWith(normalizePath(section.root)+'/'))??false;
   return [row?.name??item.id,abbreviateHome(item.source,home),item.team,row!==undefined?'Present':scanned?'Missing':'—'];
  }),
  // HOOK: the CLI does not report the session hook's state yet (S7l ships the real toggle); the Sync
  // section renders a read-only row and never reads `installed`, so this stays a typed placeholder.
  QUARANTINE:[],HOOK:{installed:false,file:'',timeout:0},
  // Connectable global folders the ledger has no shared record for; the Sharing screen offers Share on each.
  LOCAL_UNSHARED:local?.local.filter(section=>section.scope==='global').flatMap(section=>section.rows.filter(row=>row.shared.length===0&&row.placement===null&&row.problem===undefined).map(row=>row.name))??[],
  APP_VERSION:import.meta.env.VITE_APP_VERSION,AGENT_CLI:'—',AGENT_CLI_AUTH:'unknown',COMMUNITY:'github.com/ryanliu-terum/terum-skills/issues',
  STORAGE:{cache:'—',cache_n:0,evals:'—',evals_n:0,quarantine:'—'},PINNED_N:value.ledger.placements.filter(p=>p.version!==null).length,
  CLI_VERSION:value.version??'—',CLI_LATEST:'—',FOLLOWING:[],SHARED_SPECIMEN:null,
  SETTINGS_NAV:[],SHORTCUTS:[],INBOX_KIND_TEXT:{share:'Shared with you',update:'Update',alert:'Alert',eval:'Eval finished',review:'Review request',author:'Your skill',team:'Team'},THEME_OPTIONS:['System','Light','Dark'],
  syncNote:'The recorded timestamp is shown without clock-skew correction. No sync recorded on this machine does not mean never synced: leaving a team removes its stamp. Work left undone beside an old timestamp means run sync, not an error.',
 };
}

function newestUpdated(skills: InventorySkill[]): InventorySkill | undefined {
  return skills.filter(skill => /^\d{4}-\d{2}-\d{2}T/.test(skill.updated) && Number.isFinite(Date.parse(skill.updated))).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0];
}
// `status` is the permission chip: host truth from the CLI's per-member `admin` (gh collaborator permission); 'unknown' when gh could not answer — never a defaulted 'member'.
function rosterModel(team: CliStatus['teams'][number]): Roster {
  const members = team.members.map(member => ({ handle: member.handle, name: member.displayName, initials: initials(member.displayName), role: member.role ?? null, projects: member.projects ?? [], followers: null, joined: '—', last_publish: '—', lastPublish: '—', lastSeen: '—', status: member.admin === true ? 'admin' : member.admin === false ? 'member' : 'unknown' }));
  return { members, invited: [], member: Object.fromEntries(members.map(member => [member.handle, { status: member.status, projects: member.projects, lastSeen: member.lastSeen }])), byAdoption: [] };
}
function catalogModel(team: CliStatus['teams'][number], inventory: Inventory, local: Inventory, people: Person[], features: Pick<Features, 'localIdentity'>, home: string, query?: string): Catalog {
  const skills = inventory.skills.map(row => inventoryCard(row, local, team.team, features, home));
  const categorySkills: Record<string, string[]> = {};
  for (const skill of skills) (categorySkills[skill.category] ??= []).push(skill.name);
  const projects = (inventory.projects ?? []).map(project => {
    const rows = inventory.skills.filter(skill => project.skills.includes(skill.id));
    const members = people.filter(person => person.projects.includes(project.name));
    const updated = newestUpdated(rows);
    const placement = project.skills.length > 0 ? local.local?.find(section => section.scope === 'project' && section.repoRoot && project.skills.every(id => section.rows.some(row => row.placement?.id === id && row.placement.team === team.team))) : undefined;
    return { name: project.name, key: project.name, ico: 'folder', desc: project.description ?? '', skills: project.skills.length, members: members.length, remote: project.remotes[0] ?? '—', installed: project.skills.length > 0 && rows.length === project.skills.length && rows.every(row => onDisk(local, team.team, row.id, features).some(r => r.scope === 'project' && r.placement?.id === row.id && r.placement.team === team.team)), favorites: null, updated: updated ? relativeTime(updated.updated) : null, path: placement?.repoRoot ?? null, admin: null, evaluated: null, memberHandles: members.map(member => member.handle), memberInitials: members.map(member => member.initials), skillsIn: rows.map(row => row.name) };
  });
  const verdictCounts = { PASS: 0, NEUTRAL: 0, FAIL: 0, 'Not evaluated': 0 };
  for (const skill of skills) verdictCounts[skill.summary?.verdict ?? 'Not evaluated']++;
  return { scanned: scannedRoots(local, home), repository: repoSlug(team.repository), skills: skills.filter(skill => !query || `${skill.name} ${skill.desc}`.toLowerCase().includes(query.toLowerCase())), extras: [], people, projects, categories: Object.entries(categorySkills).map(([name, rows]) => [name, 'tag', rows.length]), categoryRemaining: {}, topRated: [...skills].sort((a, b) => b.installsN - a.installsN).map(skill => skill.name), peopleByAdoption: [...people].sort((a, b) => b.adoption - a.adoption).map(person => person.handle), projectsByMembers: [...projects].sort((a, b) => b.members - a.members).map(project => project.name), categorySkills, filterDefault: { verdicts: [], lift_min: 0, tokens_max: 0, installs_min: 0 }, filterCount: skills.length, verdictCounts, catalogN: skills.length, teamN: people.length, bulkInstall: Object.fromEntries(projects.map(project => [project.key, { total: project.skills, asking: skills.filter(skill => project.skillsIn.includes(skill.name) && skill.normalizedGrants !== null && skill.normalizedGrants !== 'none').length }])) };
}

/**
 * How long a read verb's answer is shared across callers (BUGS.md L18/M24). One Library render used to spawn six CLI
 * processes (three `status`, two `ls --local`, one `ls --team`); every read now goes through one process per argv per
 * window. The window is short and cleared early on any mutation the app makes and whenever the window regains focus,
 * so a change made in a terminal shows on the next look.
 */
export const READ_CACHE_TTL_MS = 15_000;

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
  // App-config-dir storage, with one-time migration from the old webview keys. Hoisted so eval reads the stored defaults.
  const prefs = nativePrefs();
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
  const reads = new Map<string, { promise: Promise<{ result: Result<unknown>; lines: string[] }>; at: number }>();
  const clearReads = () => { reads.clear(); };
  if (typeof window !== 'undefined') window.addEventListener('focus', clearReads);
  const notify = (...sources: ChangeSource[]) => { if (sources.length === 0) return; clearReads(); for (const source of sources) for (const listener of listeners) listener(source); };
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

  /** One CLI process per read argv per READ_CACHE_TTL_MS; failures and questions are never kept. Signal-free: a caller's abort must not kill a process other callers share. */
  function sharedRead(argv: readonly string[]): Promise<{ result: Result<unknown>; lines: string[] }> {
    const key = argv.join('\u0000');
    const now = Date.now();
    const hit = reads.get(key);
    if (hit && now - hit.at < READ_CACHE_TTL_MS) return hit.promise;
    const lines: string[] = [];
    const promise = read(run(argv, z.unknown(), value => value, []), undefined, lines).then(result => ({ result, lines }));
    const entry = { promise, at: now };
    reads.set(key, entry);
    void promise.then(({ result }) => { if (!result.ok && reads.get(key) === entry) reads.delete(key); }, () => { if (reads.get(key) === entry) reads.delete(key); });
    return promise;
  }
  /** A read verb through the shared cache, parsed for this caller. Aborting returns Cancelled for this caller only. */
  async function cached<TIn>(argv: readonly string[], schema: z.ZodType<TIn>, options?: ReadOptions, lines?: string[]): Promise<Result<TIn>> {
    const signal = options?.signal;
    if (signal?.aborted) return { ok: false, error: 'Cancelled.' };
    const shared = sharedRead(argv);
    let onAbort: (() => void) | undefined;
    const outcome = signal
      ? await Promise.race([shared, new Promise<null>(resolve => { onAbort = () => resolve(null); signal.addEventListener('abort', onAbort, { once: true }); })]).finally(() => { if (onAbort) signal.removeEventListener('abort', onAbort); })
      : await shared;
    if (outcome === null) return { ok: false, error: 'Cancelled.' };
    if (lines) lines.push(...outcome.lines);
    const raw = outcome.result;
    if (raw.ok) {
      try { return { ok: true, value: schema.parse(raw.value) }; }
      catch (error) { return { ok: false, error: `terum-skills answered, but the desktop app could not read the result: ${error instanceof Error ? error.message : String(error)}` }; }
    }
    let value: TIn | undefined;
    if (raw.value !== undefined) { try { value = schema.parse(raw.value); } catch { value = undefined; } }
    const failure: Result<TIn> = { ok: false, error: raw.error, ...(raw.refused ? { refused: true } : {}), ...(raw.cancelled ? { cancelled: true } : {}), ...(raw.reason ? { reason: raw.reason } : {}) };
    return value === undefined ? failure : { ...failure, value };
  }

  async function readModels<T>(options:ReadOptions|undefined, map:(value:CliStatus,local:CliLocal|null,platform:string,home:string)=>T):Promise<Result<T>> {
    const [status,local,platform,directory]=await Promise.all([
      cached(['status'], cliStatus, options),
      cached(['ls','--local'], cliLocal, options),
      bridge.hostPlatform().then(value=>({ok:true as const,value})).catch((error:unknown)=>({ok:false as const,error:error instanceof Error?error.message:String(error),value:''})),
      home(),
    ]);
    if (status.value===undefined) return result({ok:false,error:status.ok?'Status returned no data.':status.error});
    const value=map(status.value,local.ok?local.value:null,platform.value,directory);
    const errors=[status,local,platform].flatMap(outcome=>outcome.ok?[]:[outcome.error]);
    return result(errors.length?{ok:false,error:errors.join('\n'),value}:{ok:true,value});
  }

  function teamSelectionFailure(teams:readonly {team:string}[]):Result<never> {
    return teams.length===0
      ? {ok:false,error:'No team is configured on this machine.',reason:'no-team'}
      : {ok:false,error:`This machine is configured for teams ${teams.map(team=>team.team).join(', ')}; Terum Skills keeps one team per machine. Leave the ones you no longer want in Settings ▸ Team.`,reason:'ambiguous-team'};
  }

  async function inventoryTeam(team: string | undefined, options?: ReadOptions): Promise<Result<InventoryTeam>> {
    const status = await cached(['status', ...(team ? ['--team', team] : [])], cliStatusTeams, options);
    if (!status.ok) return { ok: false, error: status.error };
    if (!team && status.value.teams.length !== 1) return teamSelectionFailure(status.value.teams);
    const selected = team ? status.value.teams.find(value => value.team === team) : status.value.teams.length === 1 ? status.value.teams[0] : undefined;
    if (!selected) return { ok: false, error: 'Select a team explicitly to read its skills.', reason: 'ambiguous-team' };
    if (!selected.readable) return fail(`Team ${selected.team} could not be read.`);
    return { ok: true, value: selected };
  }
  async function libraryTeam(team:string|undefined,options?:ReadOptions):Promise<{team:LibraryTeam;inventory?:Inventory;selected?:InventoryTeam}> {
    const selected=await inventoryTeam(team,options);
    if(!selected.ok)return {team:selected.reason==='no-team'?{kind:'none'}:{kind:'unreadable',message:selected.error}};
    const inventory=await cached(['ls','--team',selected.value.team], cliLs, options);
    if(!inventory.ok)return {team:{kind:'unreadable',message:inventory.error}};
    return {team:{kind:'ok',team:selected.value.team},selected:selected.value,inventory:inventory.value};
  }
  async function peopleInventory(options?: ReadOptions) {
    const status = await cached(['status'], cliStatus, options);
    if (!status.ok) return status;
    if (status.value.teams.length !== 1) return teamSelectionFailure(status.value.teams);
    const team = status.value.teams[0]!;
    if (!team.readable) return { ok: false as const, error: `Team ${team.team} could not be read.` };
    const inventory = await cached(['ls', '--team', team.team], cliLs, options);
    return inventory.ok ? { ok: true as const, value: { team, inventory: inventory.value } } : inventory;
  }
  async function readEvalReport(ref:string,team:string|undefined,options?:ReadOptions) {
    const lines:string[]=[];
    const report=await cached(['eval-report',...(team?['--team',team]:[]),'--',ref],cliEvalReport,options,lines);
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
      clearReads();
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
      if (!hello) await (featuresOnce ??= cached(['status'], z.unknown()).then(() => undefined));
      return Object.fromEntries(FEATURE_KEYS.map(key => [key, hello?.features[key] ?? false])) as Features;
    },
    async capabilities(): Promise<Capabilities> {
      const [platform, features] = await Promise.all([bridge.hostPlatform().catch(() => 'unknown'), backend.features()]);
      return { appVersion: import.meta.env.VITE_APP_VERSION, windowChrome: platform === 'macos' ? 'mac-overlay' : 'native', disablePerMachine: features.disablePerMachine, inboxEventLog: false, offtargetKind: false, machineRegistry: false, perCaseEvalTables: features.perCase, evalCommitChoice: features.runEvalInApp, openInEditor: true, clipboard: true };
    },
    async surfaces(): Promise<Surfaces> {
      return { divergence: false, status: true, settings: true, onboarding: false, library: true, skill: true, receipts: true, inbox: false, catalog: true, roster: true, update: true, checkouts:true };
    },
    // Status and Settings are offline reads; the remaining surfaces retain their explicit gaps.
    status: (_, options) => readModels(options, (value, local, platform) => statusModel(value, local, platform)),
    settings: (_, options) => readModels(options, (value, local, platform, directory) => settingsModel(value, local, statusModel(value, local, platform), directory)),
    onboarding: async () => gap('Onboarding data'),
    async library({ scope, team }, options) {
      const local = await cached(['ls', '--local'], cliLs, options);
      if (!local.ok) return fail(local.error);
      const section = local.value.local?.find(section => scope.kind==='global' ? section.scope==='global' : section.scope==='project' && normalizePath(section.repoRoot??section.root)===normalizePath(scope.root));
      if (!section) return fail('No such checkout: '+(scope.kind==='checkout'?scope.root:'global')+' · Register it under Settings ▸ This machine ▸ Checkouts.');
      const features = {localIdentity:hello?.features.localIdentity??false};
      const enrichment = await libraryTeam(team, options);
      const directory = await home(), root = rootOf(section, directory);
      const skills:SkillCard[] = [], seen=new Set<string>();let joined=0;
      for (const row of section.rows) {
        if(seen.has(row.path))continue;seen.add(row.path);
        const skill = enrichment.team.kind==='ok' ? joinedSkill(row,enrichment.inventory!,enrichment.team.team,features) : undefined;
        if(skill && enrichment.team.kind==='ok') {joined++;skills.push({...inventoryCard(skill,{...local.value,local:[{...section,rows:[row]}]},enrichment.team.team,features,directory),path:row.path});}
        else skills.push(localCard(row,section,directory));
      }
      for(const entry of section.notOffered??[]) {
        if(!countable(entry)||seen.has(entry.path))continue;seen.add(entry.path);
        skills.push(notOfferedCard(entry,section,directory));
      }
      const n=skills.length; // the grid itself — title, tile and placeholder never count a card the grid does not draw
      const value:Library={root,team:enrichment.team,scanned:scannedRoots(local.value,directory),skills,problems:enrichment.inventory?.problems??[],provenance:null,
        title:`${n} skill folder${n===1?'':'s'} in ${root.label}`+(enrichment.team.kind==='ok'&&joined>0?` · ${joined} shared with ${enrichment.team.team}`:''),
        overview:{skills:String(n),skills_note:'—',evaluated:'—',meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:'',installs:String(skills.reduce((sum,row)=>sum+row.installsN,0)),installs_note:'—',attention:'—',attention_lines:[],attention_link:'',zero:overviewCopy}};
      return {ok:true,value};
    },
    async localSkill({path},options) {
      const local=await cached(['ls','--local'], cliLs, options);
      if(!local.ok)return fail(local.error);
      const directory=await home(),features={localIdentity:hello?.features.localIdentity??false};
      for(const section of local.value.local??[]) {
        const row=section.rows.find(row=>normalizePath(row.path)===normalizePath(path));
        const entry=row?undefined:section.notOffered?.find(entry=>countable(entry)&&normalizePath(entry.path)===normalizePath(path));
        if(!row&&!entry)continue;
        const enrichment=await libraryTeam(undefined,options);
        const skill=row&&enrichment.team.kind==='ok'?joinedSkill(row,enrichment.inventory!,enrichment.team.team,features):undefined;
        if(row&&skill&&enrichment.selected&&enrichment.inventory) {
          const team=enrichment.selected.team;
          const validation=await backend.validate({ref:skill.name,team},options);
          if(!validation.ok&&validation.value===undefined)return fail(validation.error);
          const detail=inventoryDetail(skill,{...local.value,local:[{...section,rows:[row]}]},enrichment.selected,validation,enrichment.inventory,features,directory);
          const report=await backend.evalReport({ref:skill.name,team},options);
          return {ok:true,value:report.ok?{...detail,...report.value}:{...detail,evalReportError:report.error}};
        }
        const card=row?localCard(row,section,directory):notOfferedCard(entry!,section,directory);
        return {ok:true,value:localDetail(card,section,row?.path??entry!.path,directory)};
      }
      return {ok:false,error:abbreviateHome(path,directory)+' is not in any Library root (Global or a registered checkout), or no longer holds a SKILL.md.',reason:'not-in-library'};
    },
    checkouts:{add:path=>run(['checkout','add','--',path],cliCheckoutAdded,v=>v,['config']),remove:path=>run(['checkout','remove','--',path],cliCheckoutRemoved,v=>v,['config'])},
    async skill({ ref, team }, options) {
      const parts = ref.split('/');
      const explicitTeam = team ?? (parts.length === 2 ? parts[0] : undefined);
      const name = parts.length === 2 ? parts[1]! : ref;
      const selected = await inventoryTeam(explicitTeam, options);
      if (!selected.ok) return { ok: false, error: selected.error, reason: selected.reason ?? 'unreadable' };
      const inventory = await cached(['ls', '--team', selected.value.team], cliLs, options);
      if (!inventory.ok) return { ok: false, error: inventory.error, reason: 'unreadable' };
      const matches = inventory.value.skills.filter(row => row.name === name || row.id.startsWith(name));
      const row = inventory.value.skills.find(row => row.name === name) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!row) return { ok: false, error: `No unambiguous skill ${name} in team ${selected.value.team}.`, reason: matches.length === 0 ? 'not-found' : 'unreadable' };
      const local = await cached(['ls', '--local'], cliLs, options);
      if (!local.ok) return { ok: false, error: local.error, reason: 'unreadable' };
      const validation = await backend.validate({ ref: row.name, team: selected.value.team }, options);
      // A hygiene failure has a parsed value; an unreadable/cancelled validation is a read failure.
      if (!validation.ok && validation.value === undefined) return { ok: false, error: validation.error, reason: 'unreadable' };
      const detail = inventoryDetail(row, local.value, selected.value, validation, inventory.value, { localIdentity: hello?.features.localIdentity ?? false }, await home());
      const report = await backend.evalReport({ref:row.name,team:selected.value.team},options);
      const merged = report.ok ? {...detail, ...report.value} : {...detail, evalReportError: report.error};
      const placementVersion = onDisk(local.value, selected.value.team, row.id, {localIdentity: hello?.features.localIdentity ?? false}).find(item => item.placement?.id === row.id && item.placement.team === selected.value.team)?.placement?.version;
      const version = placementVersion ?? merged.versions?.teamCurrent ?? detail.version_full;
      return {ok:true,value:{...merged,...detailVersionFields(detail.repo, row.name, version)}};
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
      const { team } = data.value;
      return { ok: true, value: rosterModel(team) };
    },
    async catalog(query, options) {
      const data = await peopleInventory(options);
      if (!data.ok) return {ok:false,error:data.error,...(data.reason?{reason:data.reason}:{})};
      const { team, inventory } = data.value;
      const local = await cached(['ls', '--local'], cliLs, options);
      if (!local.ok) return fail(local.error);
      const people: Person[] = [];
      for (const member of rosterModel(team).members) {
        const detail = await cached(['ls', 'member', '--team', team.team, '--', member.handle], cliLs, options);
        if (!detail.ok) return fail(detail.error);
        if (!detail.value.member) return fail(`No member data for ${member.handle}.`);
        const authored = detail.value.skills;
        const names = authored.map(skill => skill.name);
        const installedIds = new Set((detail.value.member.installed ?? []).map(item => item.id));
        const installable = inventory.skills.filter(skill => installedIds.has(skill.id));
        const latest = newestUpdated(authored);
        const lastPublish = latest ? `${relativeTime(latest.updated)} · ${latest.name}` : '—';
        const disk: Person['onDisk'] = [installable.filter(skill => onDisk(local.value, team.team, skill.id, { localIdentity: hello?.features.localIdentity ?? false }).length > 0).length, installable.length];
        people.push({ ...member, role: detail.value.member.role, lastPublish, last_publish: lastPublish, organization: null, declined: detail.value.member.declined, skills: names, installable: installable.map(skill => skill.name), adoption: authored.reduce((sum, skill) => sum + skill.installs, 0), publishLine: latest ? `Published ${latest.name} · ${relativeTime(latest.updated)}` : authored.length === 0 ? 'Nothing shared yet' : '—', teamsLine: member.projects.join(' · ') || 'On no project yet', buckets: names.length ? [['Authored', names]] : [], placeNote: personPlaceNote(disk), onDisk: disk });
      }
      return { ok: true, value: catalogModel(team, inventory, local.value, people, { localIdentity: hello?.features.localIdentity ?? false }, await home(), query?.q) };
    },
    search: (args: SearchArgs, options?: ReadOptions) => read(run(['search', '--', args.q], cliSearch, (hits): SearchHit[] => hits.map((hit) => ({ kind: 'skill', ref: hit.team === undefined ? hit.name : `${hit.team}/${hit.name}`, name: hit.name, description: hit.description, team: hit.team ?? null, category: hit.category ?? null, author: hit.author ?? null, installs: hit.installs ?? null, latest: hit.latest ?? null, endorsed: hit.endorsed ?? null, unresolved: hit.unresolved ?? null })), []), options).then(result),
    // Long verbs: one process each, questions become dialogs, the CLI's own decline messages come back as `ok:false`.
    setIdentity: (args) => {
      const pairs = [args.name === undefined ? [] : [`name=${args.name}`], args.email === undefined ? [] : [`email=${args.email}`], args.defaultHandle === undefined ? [] : [`default-handle=${args.defaultHandle}`]].flat();
      return run(['login', ...pairs.flatMap(pair => ['--set', pair])], cliLogin, (value): IdentityWrite => ({ updated: value.updated, notice: value.notice ?? null }), ['config']);
    },
    install: (args: InstallArgs) => prepareRun(async signal => {
      let into = 'global';
      if (args.scope !== undefined && args.scope !== 'Global') {
        const local = await read(run(['ls', '--local'], cliLs, value => value, []), {signal});
        if (!local.ok) return {ok:false,error:local.error};
        const matches = local.value.local?.filter(section => section.scope === 'project' && section.rootState !== 'absent' && section.label === args.scope) ?? [];
        if (matches.length !== 1 || !matches[0]?.repoRoot) return {ok:false,error:`Unknown install destination ${args.scope}.`};
        into = matches[0].repoRoot;
      }
      return {ok:true,value:into};
    }, into => run(['install', ...(!(args.kind === 'member' && args.member || args.kind === 'project' && args.project) && args.force ? ['--force'] : []), ...(args.team ? ['--team', args.team] : []), '--into', into, '--', ...(args.kind === 'member' && args.member ? ['member', args.member] : args.kind === 'project' && args.project ? ['project', args.project] : [args.ref])], cliInstalled, (installed): InstalledResult[] => installed.map((item) => ({ id: item.id, name: item.id, scope: args.scope ?? 'Global' })))), // desktop-bug-skill-detail S14: CLI does not return scope yet.
    uninstallSkill: (args: UninstallArgs) => run(['uninstall-skill', ...(args.team ? ['--team', args.team] : []), ...(args.from ? ['--from', args.from] : []), '--', ...(args.kind === 'member' && args.member ? ['member', args.member] : args.kind === 'project' && args.project ? ['project', args.project] : [args.ref])], cliUninstalled, (removed): UninstalledResult[] => removed.map((item) => ({ id: item.id, name: item.id }))),
    quit: () => bridge.quit(),
    uninstallMachine: () => run(['uninstall'], cliMachine, (value): MachineUninstallResult => ({ removed: value.teams, removedPlacements: value.removedPlacements, hookRemoved: value.hookRemoved, wrapperRemoved: value.wrapperRemoved, configRemoved: value.configRemoved, kept: value.kept, record: value.record, advice: value.advice })),
    connect: (args: ConnectArgs) => run<z.infer<typeof cliConnect>, ConnectOutcome | undefined>(['connect', ...(args.team ? ['--team', args.team] : []), ...(args.allowPrivileged ? ['--allow-privileged'] : []), ...(args.path ? ['--', args.path] : [])], cliConnect, (value) => value as ConnectOutcome | undefined, ['config', 'clone']),
    profile: args => run(['profile', ...(args.name === undefined ? [] : ['--name', args.name]), ...(args.bio === undefined ? [] : ['--bio', args.bio]), ...(args.role === undefined ? [] : ['--role', args.role]), ...(args.projects ?? []).flatMap(project => ['--project', project])], cliProfile, value => value, ['clone']),
    decline: args => run(['decline', '--', args.ref], cliDecline, value => ({ id: value.id }), ['clone']),
    publish: (args: PublishArgs) => run(['publish', ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliPublish, (value): PublishResult => ({ name: value.name, version: value.prUrl ?? value.branch ?? null, changed: value.changed ?? true }), ['clone']),
    // Never `--hook` from the app: its stdout is the reload directive (frame mode refuses it anyway).
    sync: (args: SyncArgs) => run(['sync', ...(args.prune ? ['--prune'] : []), ...(args.team ? ['--team', args.team] : [])], cliSync, (value): SyncResult => ({ placed: value.deferred.length || value.placed ? [] : [], removed: [] }), ['clone', 'placed', 'stamp']),
    invite: (args: InviteArgs) => run(['invite', ...(args.team ? ['--team', args.team] : []), ...(args.logins.length ? ['--', ...args.logins] : [])], cliInvite, (value): InviteResult => ({ invited: [...value.invited], already: [...value.already], failed: value.failed.map(f => ({ login: f.login, error: f.error })) }), ['clone']),
    team: (args: TeamArgs) => run(teamArgv(args), cliTeam, (value): TeamResult => ({ name: value.team, kind: args.kind }), ['config', 'clone', 'placed']),
    setup: (args: SetupArgs) => run(['setup', ...(args.target ? ['--', args.target] : [])], cliSetup, (value): SetupResult => ({ team: value.team, role: value.role, steps: value.steps ?? null }), ['config', 'clone', 'placed']),
    // Settings ▸ Evals defaults reach every run as explicit flags ("the flags the app passes"); an unset pref (or the k '—' sentinel) passes nothing and the CLI keeps no defaults of its own.
    eval: (args: EvalArgs) => { const k = prefs.get('eval:k', ''), model = prefs.get('eval:model', ''), judge = prefs.get('eval:judge', ''); return run(['eval', ...(k && k !== '—' ? ['--k', k] : []), ...(model ? ['--model', model] : []), ...(judge ? ['--judge-model', judge] : []), ...(args.commit ? ['--commit'] : []), ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliEval, (value): EvalResult => ({ name:value.name,runDir:value.runDir,executionStatus:value.executionStatus,commit:value.commit }), ['clone']); },
    validate: (args: ValidateArgs, options?: ReadOptions) => args.ref || args.cwd ? cached<ValidateResult>(['validate', ...(args.cwd && args.ref ? ['--cwd', args.cwd] : []), ...(args.team ? ['--team', args.team] : []), '--', args.ref || args.cwd || ''], cliValidate, options).then(result) : fail('validate needs a skill name or a folder.'),
    update: (_args, options) => read(run(['update'], cliUpdate, (value): UpdateAdvice => ({ ...value, running: value.running ?? null, latest: value.latest ?? null }), []), options).then(result),
    diagnostics: () => run(['status'], z.unknown(), () => undefined, []),
    async windowAction(action) { try { const window = getCurrentWindow(); if (action === 'toggle-maximize') await window.toggleMaximize(); else await window.startDragging(); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async openUrl(url) { try { await openUrl(url); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async revealPath(path) { try { await revealItemInDir(await localPath(path)); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async pickFolder() { try { const chosen = await openDialog({ directory: true, multiple: false, title: 'Choose a project folder' }); return { ok: true, value: typeof chosen === 'string' ? chosen : null }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async openInEditor(path) { try { await openPath(await localPath(path)); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async copyToClipboard(text) { try { await writeText(text); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async copyImage(png) { try { await writeImage(await Image.fromBytes(new Uint8Array(await png.arrayBuffer()))); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    prefs,
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
