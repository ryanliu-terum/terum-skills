import { registerEvalQueue } from '../eval-queue';
import { createEvalQueue } from './eval-queue';
import { z } from 'zod';
import { createAppUpdate } from './app-update';
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
import type { Root, LibraryScope, LibraryTeam, IdentityWrite, Catalog, Roster, Person, Library, SkillCard, SkillDetail, UpdateAdvice, StatusResult, Settings, Capabilities, Surfaces, ReadOptions, ChangeSource, EvalArgs, EvalResult, InstallArgs, InstalledResult, InviteArgs, InviteResult, MachineUninstallResult, PublishArgs, PublishResult, Result, Run, SearchArgs, SearchHit, SetupArgs, SetupResult, Subscription, SyncArgs, SyncResult, TeamArgs, TeamResult, UninstallArgs, UninstalledResult, ValidateArgs, ValidateResult } from '../types';
import { tauriBridge, type AppState, type Bridge } from './bridge';
import { cliRun } from './run';
import { createReadSession } from './session.js';
import { prepareRun } from './prepare-run';
import { cliEvalReport, mapEvalReport } from './eval-report';
import { receiptSummary } from '../receipt-summary';
import { relativeTime } from '../../lib/relative-time';
import { personPlaceNote, plural } from '../../screens/marketplace/market-data';
import { SHORTCUTS } from '../../lib/shortcuts';
import { abbreviateHome, stripRemote } from '../paths';
import { scannedRoots } from './scanned-roots';
import { cliRefresh, createRefreshPolicy, createWorkflowGate } from './refresh';
// §3.2: the version vocabulary exists once. This leaf imports nothing at all, which is the only
// shape `cli-tree-imports.test.ts` admits across the tree boundary.
import { parseVersionFolder, versionLabel } from '../../../../src/lib/versions.js';
import { overviewCopy } from '../../lib/overview-copy';
import { bodyExcerpt } from '../../lib/body-excerpt';
import { samePath } from '../../lib/skill-path';

/**
 * The real adapter: every long verb is one `terum-skills --frames <verb>` process (run.ts). What the CLI has
 * no verb for yet is answered honestly with a failing Result that names GAPS.md, so the screens render their
 * drawn error states instead of fixture data pretending to be real. Mappings between the CLI's result shapes
 * (src/commands/*.ts) and the seam's DTOs (../types) are here and nowhere else.
 */

// The CLI's result shapes, as of terum-skills 0.1.5 (src/commands/*.ts). Validated loosely: only the fields the seam reads.
const cliProfile = z.object({ handle: z.string(), changed: z.array(z.string()) });
const memberMetadata = { role: z.string().nullish().transform(value => value ?? null), projects: z.array(z.string()).nullish().transform(value => value ?? []), admin: z.boolean().nullish().transform(v => v ?? null) };
const cliLogin = z.object({ updated: z.array(z.object({ key: z.string(), value: z.string() })), notice: z.string().nullish() });
export const cliInstalled = z.array(z.object({ id: z.string(), team: z.string() }).passthrough());
export const cliUninstalled = z.array(z.object({ id: z.string(), team: z.string(), removed: z.number() }).passthrough());
export const cliMachine = z.object({ teams: z.array(z.string()), removedPlacements: z.number(), hookRemoved: z.boolean(), wrapperRemoved: z.boolean(), configRemoved: z.boolean(), kept: z.array(z.string()), record: z.string(), advice: z.array(z.string()) }).passthrough();
// §5.3: publish mints an immutable version on main. There is no branch and no pull request any
// more, so `version` is the `v<N>` it minted — or null when the bytes were identical to one that
// already exists, which `identicalTo` then names.
export const cliPublish = z.object({ team: z.string(), id: z.string(), name: z.string(), project: z.string(), version: z.string().nullable(), created: z.boolean(), identicalTo: z.string().nullable(), attachedEvals: z.number(), profileAdded: z.boolean(), projectAdded: z.boolean() }).passthrough();
const cliInvite = z.object({ team: z.string(), invited: z.array(z.string()), already: z.array(z.string()).default([]), failed: z.array(z.object({ login: z.string(), error: z.string() })).default([]) }).passthrough();
const cliTeam = z.object({ team: z.string() }).passthrough();
export const cliSetup = z.object({ role: z.enum(['creator', 'joiner']), team: z.string(), steps: z.partialRecord(z.enum(SETUP_STEP_KEYS), z.enum(['done','skipped','printed','queued','batched'])).nullish().transform(value => value ?? null) });
// §6.3: a local eval runs against a folder in the Library, which may belong to no team at all —
// hence the nullable `team` and `id`. `shareHint` is the caller's cue to offer publishing.
export const cliEval = z.object({ name:z.string(),runDir:z.string(),executionStatus:z.enum(['complete','partial','failed']),team:z.string().nullish().transform(v=>v??null),id:z.string().nullish().transform(v=>v??null),shareHint:z.literal(true).optional(),alreadyEvaluated:z.boolean().optional() }).passthrough();
const cliValidate = z.object({ name: z.string(), findings: z.number(), warnings: z.number() });
export const cliSearch = z.array(z.object({ team: z.string().optional(), endorsed: z.string().optional(), id: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), description: z.string(), grants: z.string().nullable(), grantsHash: z.string().nullable(), updated: z.string() }));

const cliScope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('global') }), z.object({ kind: z.literal('project'), project: z.string() })]);
const cliCardComparison = z.object({ win: z.number(), loss: z.number(), tie: z.number(), net_lift: z.number(), sign_p: z.number() }).passthrough();
// S7?/card-lift: the newest receipt at this skill's current version, or null. A CLI that predates the
// limb omits it, and the card falls back to the honest '—' exactly as it did before.
export const cliCardReceipt = z.object({ version: z.string().nullish().transform(v => v ?? null), content_digest: z.string().nullish().transform(v => v ?? null), run_id: z.string(), verdict: z.enum(['PASS','NEUTRAL','FAIL']), execution_status: z.enum(['complete','partial','failed']), expected_rows: z.number(), scored_rows: z.number(), comparisons: z.record(z.string(), cliCardComparison), arm_scores: z.record(z.string(), z.number().nullable()), provenance: z.object({ model: z.string(), k: z.number(), cc_version: z.string(), timestamp: z.string(), runner_handle: z.string() }).passthrough() }).passthrough();
export const cliLsSkill = z.object({ id: z.string(), name: z.string(), author: z.string(), category: z.string(), characters: z.number().nullish().transform(value => value ?? null), installs: z.number(), latest: z.string(), versionCount: z.number().nullish().transform(value => value ?? null), endorsement: z.string(), description: z.string(), grants: z.string().nullable(), grantsHash: z.string().nullable(), updated: z.string(), body: z.string().nullable(), frontmatter: z.string().nullish(), receipt: cliCardReceipt.nullish().transform(value => value ?? null), installedBy: z.array(z.object({ handle: z.string(), displayName: z.string(), scope: cliScope, since: z.string().nullish() })) });
/**
 * §8.4 — the whole roster in one read. This limb is what replaced the marketplace's per-member
 * fan-out: `catalog()` used to spawn `status` + `ls --local` + N × `ls member`, and is now two
 * processes regardless of team size. `.passthrough()` per convention.
 */
/** §8.4: a CLI too old to report the roster in one read. Named so the message is not buried in a branch. */
const STALE_CLI_ROSTER = 'This terum-skills version does not report the team roster in one read; update it with `npx -y terum-skills@latest update`.';
export const cliPerson = z.object({ handle: z.string(), display_name: z.string(), email: z.string(), authored: z.array(z.string()).nullish().transform(v => v ?? []), role: z.string().nullish().transform(v => v ?? null), projects: z.array(z.string()).nullish().transform(v => v ?? []), installed: z.array(z.object({ id: z.string(), version: z.string().nullish().transform(v => v ?? null), scope: cliScope, since: z.string() }).passthrough()), profile: z.array(z.object({ id: z.string(), name: z.string(), version: z.string(), added: z.string(), via: z.enum(['publish', 'install']) }).passthrough()).nullish().transform(v => v ?? []), local_skills: z.number().nullish().transform(v => v ?? null) }).passthrough();
export const cliProject = z.object({ name: z.string(), skills: z.array(z.string()), remotes: z.array(z.string()), description: z.string().optional() }).catchall(z.unknown());
// S7g: every `ls --local` row carries typed provenance and a read-only health; the prose `state` is never parsed.
const cliLocalHealth = z.enum(['up-to-date', 'update-available', 'local-changed', 'both', 'gone-from-repo', 'untracked', 'unknown']);
export const cliLocalRow = z.object({ frontmatter: z.string().nullish(), name: z.string(), path: z.string(), state: z.string(), tracked: z.boolean(), placement: z.strictObject({ id: z.string(), team: z.string(), version: z.string().nullable() }).nullable(), health: cliLocalHealth, category: z.string().nullish().transform(v=>v??null), description: z.string().nullish().transform(value => value ?? null), characters: z.number().nullish().transform(value => value ?? null), problem: z.string().optional(), skillId: z.string().nullable().optional(), placed: z.boolean().optional() }).strict();
export const cliLocalSection = z.object({ root:z.string(), scope:z.enum(['global','project']), repoRoot:z.string().optional(), remote:z.object({url:z.string(),slug:z.string().nullable()}).nullish(), registered:z.boolean().optional(), rootState:z.enum(['scanned','absent','unreadable']).optional(), label:z.string().optional(), counts:z.object({skillFolders:z.number(),connectable:z.number()}).optional(), rows:z.array(cliLocalRow), notOffered:z.array(z.object({frontmatter:z.string().nullish(),skillId:z.string().nullable().optional(),name:z.string(),path:z.string(),reason:z.string(),detail:z.string().optional(),category:z.string().nullish().transform(v=>v??null),description:z.string().nullish().transform(value=>value??null),characters:z.number().nullish().transform(value=>value??null)})).optional(), problems:z.array(z.object({path:z.string(),reason:z.string()})) });
export const cliProjectAdded = z.object({path:z.string(),label:z.string(),added:z.boolean()});
export const cliProjectCreated = z.object({team:z.string(),name:z.string(),remotes:z.array(z.string()),skills:z.number()});
export const cliProjectRemoved = z.object({path:z.string(),placementsRemaining:z.number()});
export const cliLs = z.object({
  roster: z.array(z.object({ handle: z.string(), active: z.boolean(), ...memberMetadata })), skills: z.array(cliLsSkill), problems: z.array(z.object({ source: z.string(), message: z.string() })), projects: z.array(cliProject).optional(), member: z.object({ installed: z.array(z.object({ id: z.string(), scope: cliScope, since: z.string() })).optional(), handle: z.string(), declined: z.array(z.string()), ...memberMetadata }).optional(),
  local: z.array(cliLocalSection).optional(),
  // §8.4: emitted on the `kind:'all'` team read. Optional so a CLI that predates the limb parses.
  people: z.array(cliPerson).optional(),
});
export const cliStatusTeams = z.object({ version: z.string().nullable(), teams: z.array(z.object({ team: z.string(), handle: z.string(), repository: z.string().nullable(), readable: z.boolean(), sharedSkills: z.number().nullable(), memberCount: z.number().nullable(), members: z.array(z.object({ handle: z.string(), displayName: z.string() })).optional() })), ledger: z.object({ placements: z.array(z.object({ id: z.string(), team: z.string() }).passthrough()) }).nullish() });
type Inventory = z.infer<typeof cliLs>;
type InventorySkill = z.infer<typeof cliLsSkill>;
type InventoryTeam = z.infer<typeof cliStatusTeams>['teams'][number];
/** The unfiltered status ledger's placements: a fallback presence source that still sees project-scope placements `ls --local` cannot scan (no registered checkout). */
type LedgerPlacements = readonly { id: string; team: string }[];

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
  return {id:global?'global':repoRoot,kind:global?'global':'checkout',label:labelOf(section),root:global?(home?abbreviateHome(section.root,home):'~/.claude/skills'):repoRoot,rootState:section.rootState,registered:section.registered??false,count:section.counts?String(visibleSkillFolders(section)):undefined,remote:section.remote??null};
}
/** The root a detail was resolved in, in the sidebar's own terms. The checkout id comes from rootOf
 *  so it is byte-identical to the id Sidebar.tsx compares against; the global root uses the literal
 *  'Global' because Sidebar.tsx:31 matches that, not rootOf's lowercase 'global'. */
function owningRootOf(section:LocalSection):{id:string;label:string}{
  return section.scope==='global'?{id:'Global',label:'Global'}:{id:rootOf(section).id,label:labelOf(section)};
}
/** The one `ls --local` section a scoped read is anchored to. The comparison is separator- and
 *  trailing-separator-insensitive because the value arrives from a URL, and library() uses the same
 *  predicate, so any root that opens a checkout Library also opens a scoped detail. */
function sectionFor(local:Inventory,at:LibraryScope):LocalSection|undefined{
  return (local.local??[]).find(section=>at.kind==='global'?section.scope==='global':section.scope==='project'&&samePath(section.repoRoot??section.root,at.root));
}
/** Presence evidence narrowed to one root. Destinations are NOT narrowed — see inventoryDetail. */
function restrictLocal(local:Inventory,section:LocalSection):Inventory{return {...local,local:[section]};}
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
  const placed=row.placed??row.placement!==null,local=!placed;
  // A folder nobody has shared genuinely has no installs; 0 is the fact, and the 'local' flag beside
  // it says why. A placed row only reaches here when its team could not be read (the screen says so
  // above the grid), and there 0 would be a claim we cannot back, so it stays a dash.
  // The identity line names the root the folder lives in, never the word 'local'.
  return {teamed:false,path:row.path,name:row.name,desc:row.description??'',project:labelOf(section),category:row.category??'—',installs:local?'0 installs':'—',installsN:0,installed:'placed',placed,onDiskOnly:!placed,teamState:'unknown',paths:[[abbreviateHome(row.path,home),section.scope]],flags:row.problem!==undefined?['broken']:local?['local']:[],flagText:row.problem!==undefined?{broken:row.problem}:local?{local:'Local'}:{},grants:null,normalizedGrants:null,grantsHash:null,...tokenLabel(row.characters),wlt:null,summary:null,favorite:false,favorites:null,enabled:true,updated:null,indicators:{broken:{icon:'alert',token:'bad',text:'The skill version could not be resolved.'},update:{icon:'arrow-up-circle',token:'warn',text:''},local:{icon:'pencil',token:'text3',text:''}}};}
function notOfferedCard(entry:NotOffered,section:LocalSection,home:string):SkillCard {
  return localCard({name:entry.name,path:entry.path,state:'',tracked:false,placement:null,health:'unknown',category:entry.category,description:entry.description,characters:entry.characters,problem:'Not connectable · '+(entry.detail??entry.reason)},section,home);
}
function localDetail(card:SkillCard,section:LocalSection,path:string,home:string):SkillDetail {
  const pathLabel=abbreviateHome(path,home);
  return {...card,desc_long:card.desc,size_bytes:'—',team:null,skillRef:'local:'+path,root:'Global',owningRoot:owningRootOf(section),installScopes:[],projectNames:null,favorites:null,lines:null,hygieneCaption:null,hygieneStatus:null,hygieneWhen:null,path,pathLabel,repo:null,repoPath:pathLabel,version:'—',version_full:null,scope:section.scope==='global'?'Global':labelOf(section),installs_n:0,used_by:[],users:[],author:{name:'',handle:'',role:'',initials:''},files:null,grants_approved:'',receipt:null,history:[],activity:[],hygiene:[],skillMd:{frontmatter:(section.rows.find(row=>samePath(row.path,path))??section.notOffered?.find(row=>samePath(row.path,path)))?.frontmatter??'',body:[],markdown:null},evalEstimate:null,evalEstimateText:'',evalEstimateTip:'',evalCommand:'npx -y terum-skills@latest eval '+card.name,shareCommand:'npx -y terum-skills@latest publish '+card.name,incumbentLift:null,reportNumbers:null,scoreFractions:{routesExpected:null,roi:null,quality:null},method:'',versions:null,latestState:'none',invalidReceiptFile:null,evalReportError:null,localRuns:[],unidentifiedLocal:null,viewerHandle:null};
}
/** A bare name that is not in the team may still name a folder on this machine — one nobody has
 *  shared, or one whose frontmatter the CLI could not parse. Deep links, bookmarks and hand-typed
 *  URLs all arrive as a bare name with no path, so the name route resolves them against the local
 *  roots before it reports the name as unknown. Global wins over a checkout because a bare name
 *  carries no root to disambiguate with. */
function localDetailByName(local:Inventory,name:string,home:string):SkillDetail|undefined {
  const sections=[...(local.local??[])].sort((a,b)=>Number(b.scope==='global')-Number(a.scope==='global'));
  for(const section of sections) {
    const row=section.rows.find(row=>row.name===name);
    if(row)return localDetail(localCard(row,section,home),section,row.path,home);
    const entry=section.notOffered?.find(entry=>countable(entry)&&entry.name===name);
    if(entry)return localDetail(notOfferedCard(entry,section,home),section,entry.path,home);
  }
  return undefined;
}

function localRows(local: Inventory) {
  return local.local?.flatMap(section => section.rows.map(row => ({ ...row, scope: section.scope, root: section.root, repoRoot: section.repoRoot, label: section.label }))) ?? [];
}
// Join provenance by team and ID, including relocated or conflicting tracked folders. Every clause
// is an id the CLI itself reported: a ledger placement, a connected source, or identity read from
// the folder. A ref carrying a team is matched with it; `skillId` is a uuid and needs none.
function onDisk(local: Inventory, team: string, id: string, features: Pick<Features, 'localIdentity'>) {
  return localRows(local).filter(row => (row.placement?.id === id && row.placement.team === team) || (features.localIdentity && row.skillId === id));
}
/**
 * `skillId` reaches `ls --local` rows only from CLI 0.1.8 (the `localIdentity` feature). An older
 * CLI reports an untracked folder with no id at all, so a same-named one is not evidence of
 * absence — presence is unknowable. Name spots that ambiguity and never infers presence: the
 * caller reports "unknown" and the skill still does not count as installed.
 */
function unidentifiedLocal(local: Inventory, name: string, features: Pick<Features, 'localIdentity'>, home: string) {
  if (features.localIdentity) return null;
  const row = localRows(local).find(row => row.name === name && row.placement === null);
  return row ? { path: row.path, pathLabel: abbreviateHome(row.path, home) } : null;
}
// Tri-state install truth from BOTH ledgers and the people file: identified on-disk provenance
// (`ls --local`), then — only for a skill the scan shows nothing for — the unfiltered status
// placements (which still see e.g. a project-scope placement in an unregistered checkout the scan
// never visits), then this user's people-file record. When the scan does cover the skill its richer
// verdict (placed / connected / on-disk-only, or the old-CLI unidentified ambiguity) wins over the
// ledger. 'recorded' = the people file says this user installed it, but nothing is on this machine.
function inventoryCard(row: InventorySkill, local: Inventory, team: string, features: Pick<Features, 'localIdentity'>, home: string, handle: string, ledger: LedgerPlacements): SkillCard {
  const rows = onDisk(local, team, row.id, features);
  const placements = rows.filter(r => r.placement?.id === row.id && r.placement.team === team);
  const present = rows.length > 0;
  const ledgerPlaced = !present && ledger.some(placement => placement.id === row.id && placement.team === team);
  const placed = placements.length > 0 || ledgerPlaced;
  const installed: SkillCard['installed'] = present || ledgerPlaced ? 'placed' : handle !== '' && row.installedBy.some(person => person.handle === handle) ? 'recorded' : 'absent';
  // The card's lift: this receipt's own candidate-vs-baseline comparison, never combined across
  // receipts, with the provenance the number must be read against (frame-protocol.md). A skill with
  // no receipt at its current version keeps summary null, which the card draws as '—'.
  const summary = receiptSummary(row.receipt);
  const provenance = row.receipt ? { model: row.receipt.provenance.model, k: row.receipt.provenance.k, ccVersion: row.receipt.provenance.cc_version, runner: row.receipt.provenance.runner_handle, when: row.receipt.provenance.timestamp.slice(0, 10) } : null;
  const problem = placements.find(r => r.problem !== undefined || r.health === 'unknown' || r.health === 'gone-from-repo');
  return { teamed:true, path:null, name: row.name, category: row.category, project: row.endorsement === 'global' ? 'Global' : row.endorsement.replace(/^project: /, ''), installs: `${row.installs} install${row.installs === 1 ? '' : 's'}`, installsN: row.installs, installed, placed, onDiskOnly: present && !placed, teamState: 'endorsed', paths: rows.map(r => [abbreviateHome(r.path, home), r.scope]), projectRoots: rows.flatMap(r => r.repoRoot ? [abbreviateHome(r.repoRoot, home)] : []), desc: bodyExcerpt(row.body) ?? row.description, grants: row.grants === null ? null : row.grants === 'none' ? [] : row.grants.split('\n'), normalizedGrants: row.grants ?? null, grantsHash: row.grantsHash ?? null, ...tokenLabel(row.characters), wlt: summary ? [summary.w, summary.l, summary.t] : null, summary, provenance, favorite: false, favorites: null, enabled: true, flags: problem ? ['broken'] : [], flagText: problem ? { broken: problem.problem ?? 'placed copy could not be inspected' } : {}, updated: row.updated === '—' ? null : row.updated ?? null, indicators: { broken: { icon: 'alert', token: 'bad', text: 'The placed copy could not be inspected.' }, update: { icon: 'arrow-up-circle', token: 'warn', text: '' }, local: { icon: 'pencil', token: 'text3', text: '' } } };}
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
/** `owner/repo` as the team remote spells it (case kept; any host); null when the team has no remote. */
function repoSlug(remote: string | null | undefined): string | null {
  return remote ? stripRemote(remote.trim()).replace(/^github\.com\//, '') : null;
}
/**
 * §8.6: the share command drops its `@<version>` suffix, because §9.1 REFUSES a versioned ref — the
 * command it produced would now fail on the machine it was pasted into. The version itself is still
 * shown; it is a label (`Version 3`) under D1, so it is never sliced to look like a hash.
 */
function detailVersionFields(repo: string | null, name: string, version: string | null): Pick<SkillDetail, 'version' | 'version_full' | 'shareCommand'> {
  // D1: what a PERSON reads is `Version 3`. `version_full` keeps the FOLDER, because §8.6 makes it a
  // path segment in the repository link — one is prose, the other is an address.
  const ordinal = version === null ? null : parseVersionFolder(version);
  return { version: ordinal === null ? version ?? '—' : versionLabel(ordinal), version_full: version, shareCommand: repo ? `npx -y terum-skills@latest install ${repo}/${name}` : '—' };
}
/** `local` is the presence evidence — restricted to one section for a scoped read. `scopes` is the
 *  full machine inventory the install destinations come from, so restricting presence never
 *  truncates the Install-to list. `at` names the root a scoped read was anchored to: non-null means
 *  the answer describes exactly that root, so the two root-blind fallbacks (the unfiltered status
 *  ledger and this user's people file) are not consulted — neither records WHICH root. */
function inventoryDetail(row: InventorySkill, local: Inventory, team: InventoryTeam, placements: LedgerPlacements, validation: Result<ValidateResult>, inventory: Inventory, features: Pick<Features, 'localIdentity'>, home: string, scopes: Inventory = local, at: {id:string;label:string} | null = null): SkillDetail {
  const card = inventoryCard(row, local, team.team, features, home, at ? '' : team.handle, at ? [] : placements), rows = onDisk(local, team.team, row.id, features);
  // Global first by rule, not by the CLI's emission order: a read that names no root answers with
  // the Global copy (the documented bare-name rule at :124-128), and a scoped read has one section.
  const ordered = [...rows].sort((a, b) => Number(b.scope === 'global') - Number(a.scope === 'global'));
  const placed = ordered.find(r => r.placement?.id === row.id && r.placement.team === team.team);
  const path = placed?.path ?? ordered[0]?.path ?? null;
  const name = row.author.replace(/\s*<[^>]*>$/, '');
  const installers = row.installedBy;
  const repo = repoSlug(team.repository);
  const version = placed?.placement?.version ?? (row.latest === '—' ? null : row.latest || null);
  const emailHandle = row.author.match(/<([^@<>]+)@[^>]+>$/)?.[1];
  const handle = team.members?.find(member => member.displayName === name)?.handle ?? team.members?.find(member => member.handle === emailHandle)?.handle ?? '';
  const projects = (scopes.local ?? []).filter(section => section.scope === 'project' && section.rootState !== 'absent' && section.label);
  const installScopes: [string, string][] = [['Global', 'every session · ~/.claude/skills'], ...projects.map((section): [string, string] => [section.label!, `project · ${abbreviateHome(section.repoRoot ?? section.root, home)}`])];
  // Captions stay display-only; removal needs the original absolute destination.
  const installScopePaths = Object.fromEntries(projects.flatMap(section => section.repoRoot && projects.filter(other => other.label === section.label).length === 1 ? [[section.label!, section.repoRoot]] : []));
  return { ...card, team: team.team, installScopes, installScopePaths, projectNames: inventory.projects?.map(project => project.name) ?? null, favorites: null, lines: typeof row.body === 'string' ? row.body.replace(/\n$/, '').split('\n').length : null, skillRef: `${team.team}/${row.name}`, root: 'Global', owningRoot: at, desc_long: bodyExcerpt(row.body) ?? row.description, files: null, size_bytes: '—', ...detailVersionFields(repo, row.name, version), scope: placed?.scope === 'global' ? 'Global' : placed?.label ?? placed?.scope ?? null, installs_n: row.installs, installed: card.installed,
    unidentifiedLocal: card.installed === 'placed' ? null : unidentifiedLocal(local, row.name, features, home), viewerHandle: team.handle,
    used_by: [...new Map(installers.map(person => [person.handle, initials(person.displayName)])).values()], users: installers.map(person => [person.handle, initials(person.displayName), `${person.scope.kind === 'global' ? 'Global' : person.scope.project}${person.since ? ` · since ${person.since.slice(0, 10)}` : ''}`]),
    author: { name, handle, role: '', initials: initials(name) }, repo, repoPath: `skills/${row.name}`, path, pathLabel: path === null ? '—' : abbreviateHome(path, home), grants_approved: '', versions:null,latestState:'none',invalidReceiptFile:null,localRuns:[],evalReportError:null, receipt: null, history: [], activity: [], hygiene: [], hygieneCaption: null, hygieneStatus: validation.value === undefined ? null : validation.ok && validation.value.findings === 0 ? 'pass' : 'fail', hygieneWhen: null,
    skillMd: { frontmatter: row.frontmatter ?? '', body: [], markdown: row.body ?? null }, evalEstimate: null, evalEstimateText: '', evalEstimateTip: '', evalCommand: `npx -y terum-skills@latest eval ${row.name}`, incumbentLift: null, reportNumbers: null, scoreFractions: { routesExpected: null, roi: null, quality: null }, method: '',
  };
}

const cliUpdate = z.strictObject({ running: z.string().nullable(), latest: z.string().nullable(), observation: z.enum(['newer', 'same', 'older', 'unknown']), launch: z.enum(['global', 'local', 'npx', 'source', 'unknown']), description: z.string(), advice: z.array(z.string()), lines: z.array(z.string()) });

// S7k: explicitly declare every status field; an older payload must not look like unset data.
export const cliStatus = z.object({
 version:z.string().nullable(),
 teams:z.array(z.object({
  team:z.string(),handle:z.string(),repository:z.string().nullable(),
  clone:z.discriminatedUnion('state',[
   z.object({state:z.literal('ok'),origin:z.string().optional()}),z.object({state:z.literal('absent')}),
   z.object({state:z.literal('foreign'),origin:z.string()}),
   z.object({state:z.literal('incomplete'),reason:z.string(),error:z.string().optional()}),
  ]),readable:z.boolean(),
  // `joined` (the day the people file first landed in the team repo) and `skillsTotal` (how many skills
  // that member's machine last reported having) are nullish-tolerant: a CLI older than this app reports
  // neither, and a member who has not synced since the field shipped has no total, so the roster shows
  // '—' rather than a zero nobody reported.
  members:z.array(z.object({handle:z.string(),displayName:z.string(),joined:z.string().nullish().transform(v=>v??null),skillsTotal:z.number().nullish().transform(v=>v??null),...memberMetadata})),memberCount:z.number().nullable(),unreadableMembers:z.number().nullable(),sharedSkills:z.number().nullable(),unreadableSkills:z.number().nullable(),membership:z.enum(['active','inactive','missing']).nullable(),stale:z.boolean(),
  pending:z.array(z.object({op:z.enum(['install','uninstall']),id:z.string(),scope:cliScope,version:z.string().nullable(),started:z.string()})),
  // §4.1/§11.5 deleted `policy.publish`. The mirror is NOT passthrough, so leaving it required would
  // fail the whole status parse and cost the app its Settings screen, not one row.
  syncedAt:z.string().nullable(),policy:z.object({skill_license:z.string()}).passthrough().nullable(),categories:z.array(z.string()).nullable(),clonePath:z.string().nullable(),joinCommand:z.string().nullable(),joinBlock:z.array(z.string()).nullable(),
 })),
 ledger:z.object({
  placements:z.array(z.object({path:z.string(),id:z.string(),team:z.string(),version:z.string().nullable(),scope:cliScope,placed_at:z.string()})),
  approvals:z.array(z.object({id:z.string(),grants:z.string(),approved_at:z.string()})),
 }),
 identity:z.object({default_handle:z.string().nullable(),email:z.string().nullable(),display_name:z.string().nullable(),github:z.string().nullable()}).nullable(),
 tools:z.object({git:z.boolean(),gh:z.boolean()}),
});
const cliLocal=z.object({local:z.array(cliLocalSection),skills:z.array(z.object({id:z.string(),name:z.string(),grantsHash:z.string().nullish().transform(v=>v??null),grants:z.string().nullish().transform(v=>v??null)}))});
type CliStatus=z.infer<typeof cliStatus>;
type CliLocal=z.infer<typeof cliLocal>;

function statusModel(value:CliStatus, local:CliLocal|null, platform:string, features:Pick<Features, 'localIdentity'>,home:string):StatusResult {
 const name=value.identity?.display_name??'';
 const handle=value.teams[0]?.handle??''; // one team per machine — legacy 2+ shows a hint, not a projection
 return {
  ledger:value.ledger??null,
  machine:{os:platform,name:'',hostname:'',gh_login:'',gh_version:''},
  me:{handle,name,email:value.identity?.email??'',default_handle:value.identity?.default_handle??'',initials:name.split(/\s+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase(),footerLabel:[value.identity?.github,handle,value.identity?.default_handle].find(v=>v)??''},
  teams:value.teams.map(team=>({name:team.team,key:team.team,handle:team.handle,remote:team.repository??null,members:team.memberCount??null,skills:team.sharedSkills??null,clone:team.clonePath===null?null:abbreviateHome(team.clonePath,home),cloneState:team.clone.state==='ok'?team.clone.origin===undefined?null:{state:'ok',origin:team.clone.origin}:team.clone.state==='incomplete'?{state:'incomplete',...(team.clone.error===undefined?{}:{error:team.clone.error}),reason:team.clone.reason==='not-a-repository'||team.clone.reason==='no-team-json'?team.clone.reason:'unverifiable'}:team.clone,readable:team.readable,last_sync:team.syncedAt??null,stamp:team.syncedAt??null,policy:team.policy===null?null:{license:team.policy.skill_license},categories:team.categories??null,pending:team.pending,joinCommand:team.joinCommand??null,joinBlock:team.joinBlock??null})),
  counts:local?.local.find(section=>section.scope==='global')?.counts ? {Global:String(visibleSkillFolders(local.local.find(section=>section.scope==='global')!))} : {},tools:value.tools,roots:local===null?[]:local.local.map(section=>rootOf(section)),
 };
}
// AD-23: the drawn placement states (design fixture PLACEMENTS: 'up to date', 'update available', 'edited locally', 'pinned'); a health the board has no word for is '—'.
const PLACEMENT_STATE:Record<z.infer<typeof cliLocalHealth>,string>={'up-to-date':'up to date','update-available':'update available','local-changed':'edited locally',both:'edited locally · update available','gone-from-repo':'removed from the team',unknown:'—',untracked:'—'};
function settingsModel(value:CliStatus, local:CliLocal|null, status:StatusResult,home:string):Settings {
 const rows=local?.local.flatMap(root=>root.rows)??[];
 const policy=status.teams.length===1?status.teams[0]?.policy??null:null; // one team per machine — legacy 2+ shows a hint, not a projection
 return {
  K:null,MACHINE:status.machine,ME:status.me,TEAMS:status.teams,tools:status.tools,
  INVITE_TIP:"GitHub emails the invitation; the block runs the joiner&#39;s wizard",
  JOIN_BLOCK_NOTE:"GitHub emails the invitation. The block runs the joiner&#39;s wizard: with gh signed in it accepts the pending invitation, otherwise it asks them to accept it in the browser, and git must have access to this repository.",
  TEAM_POLICY:{license:policy?.license??null,categories:status.teams.length===1?status.teams[0]?.categories??null:null,projects:null,categoriesNote:'From team.json; an admin extends it by pull request.'}, // one team per machine — legacy 2+ shows a hint, not a projection
  PLACEMENTS:value.ledger.placements.map(p=>{const row=rows.find(row=>row.path===p.path);const missing=local?.local.some(root=>root.problems.some(problem=>problem.path===p.path))??false;return [abbreviateHome(p.path,home),row?.name??p.id,p.scope.kind==='global'?'Global':p.scope.project,row?.tracked===true?null:p.version?.slice(0,12)??null,p.placed_at??null,row?PLACEMENT_STATE[row.health]:missing?'folder missing':'—'];}),PLACEMENTS_N:value.ledger.placements.length,
  APPROVALS:value.ledger.approvals.flatMap(approval=>{const skill=local?.skills.find(skill=>skill.id===approval.id&&skill.grantsHash!==null&&skill.grantsHash===approval.grants&&skill.grants!==null);return skill?[[skill.name,skill.grants==='none'?[]:skill.grants!.split('\n'),approval.approved_at]]:[];}),
  QUARANTINE:null,HOOK:null,
  APP_VERSION:import.meta.env.VITE_APP_VERSION,AGENT_CLI:'—',AGENT_CLI_AUTH:'unknown',COMMUNITY:'github.com/ryanliu-terum/terum-skills/issues',
  STORAGE:{cache:'—',cache_n:null,evals:'—',evals_n:null,quarantine:'—'},PINNED_N:value.ledger.placements.filter(p=>{const row=rows.find(row=>row.path===p.path);return row?row.tracked===false:p.version!==null;}).length,
  CLI_VERSION:value.version??'—',CLI_LATEST:null,FOLLOWING:[],SHARED_SPECIMEN:null,
  SETTINGS_NAV:[],SHORTCUTS:SHORTCUTS.map(pair=>[...pair]),INBOX_KIND_TEXT:{share:'Shared with you',alert:'Alert',eval:'Eval finished',author:'Your skill',team:'Team'},THEME_OPTIONS:['System','Light','Dark'],
  syncNote:'The recorded timestamp is shown without clock-skew correction. No fetch recorded on this machine does not mean never synced: leaving a team removes its stamp. Work left undone beside an old timestamp means run sync, not an error.',
 };
}

function newestUpdated(skills: InventorySkill[]): InventorySkill | undefined {
  return skills.filter(skill => /^\d{4}-\d{2}-\d{2}T/.test(skill.updated) && Number.isFinite(Date.parse(skill.updated))).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0];
}
// `status` is the permission chip: host truth from the CLI's per-member `admin` (gh collaborator permission); 'unknown' when gh could not answer — never a defaulted 'member'.
// `invited` is null, not []: this CLI reports no invitations, and the screen must not assert "0 invitations".
// `joined` and `skillsTotal` are the CLI's own values (the people file's first commit, and the skill total that person's machine last reported); null when it reported neither, which the screen draws as '—'.
function rosterModel(team: CliStatus['teams'][number]): Roster {
  const members = team.members.map(member => ({ handle: member.handle, name: member.displayName, initials: initials(member.displayName), role: member.role ?? null, projects: member.projects ?? [], followers: null, joined: member.joined, skillsTotal: member.skillsTotal, last_publish: '—', lastPublish: '—', lastSeen: '—', status: member.admin === true ? 'admin' : member.admin === false ? 'member' : 'unknown' }));
  return { members, invited: null, member: Object.fromEntries(members.map(member => [member.handle, { status: member.status, projects: member.projects, lastSeen: member.lastSeen }])), byAdoption: [] };
}
function catalogModel(team: CliStatus['teams'][number], inventory: Inventory, local: Inventory, placements: LedgerPlacements, people: Person[], features: Pick<Features, 'localIdentity'>, home: string, query?: string): Catalog {
  const skills = inventory.skills.map(row => inventoryCard(row, local, team.team, features, home, team.handle, placements));
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
 * window. Mutations clear it outright; focus marks it stale, serving the previously true board while refreshing
 * in the background. The TTL backs up terminal changes while focused and exceeds the QueryClient's 30 s staleTime,
 * so a tab switch does not turn into a cold chain (W-02).
 */
export const READ_CACHE_TTL_MS = 60_000;
/** Four member reads leave headroom under the bridge cap of eight. */
/** The Settings error board branches on this: a config.json the CLI refused to parse is repairable in place; anything else is a read failure. */
function readReason(error: string): 'invalid-config' | 'unreadable' {
  return error.includes('Invalid') && error.includes('config.json') ? 'invalid-config' : 'unreadable';
}
/** One app window, one adapter. A second instance (tests construct many) retires the first instance's window
 *  listeners, so a retired backend can never spawn a CLI child on a later focus event. */
let retireWindowListeners: (() => void) | undefined;


export function createTauriBackend(bridge: Bridge = tauriBridge()): Backend {
  // Share in-flight reads and cache success; a terminal launch can repair a missing or broken file.
  let hello: Extract<CliFrame, { t: 'hello' }> | null = null;
  let featuresOnce: Promise<void> | undefined;
  // The first hello tells the adapter whether this CLI can refresh clones. Scheduled as a microtask
  // so it never re-enters run()/cwd() from inside the frame loop.
  const onHello = (frame: Extract<CliFrame, { t: 'hello' }>) => { readSession.observe(frame); const first = hello === null; hello = frame; if (first && frame.features.refresh === true) void Promise.resolve().then(() => { if (!retired) refreshPolicy.trigger(); }); };
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
          if (value) readSession.bind(value);
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
  const reads = new Map<string, { promise: Promise<{ result: Result<unknown>; lines: string[] }>; at: number; stale: boolean; refreshing: boolean }>();
  // Every mutation evicts every cached read, and that is deliberate. A targeted map would have to know which
  // reads depend on which write, but a ChangeSource ('config' | 'clone' | 'marketplace' | 'placed' | 'stamp') labels what a verb
  // WROTE, not what a read consumed: `status` reads config and the clone roster, `ls` reads placements and the
  // clone, and nothing in the cache records that. Keeping a read alive because its family was not named would
  // serve a stale board the moment those sets overlap, so the cache clears whole until reads declare their own
  // dependencies. Cost is bounded: a read re-spawns lazily, and the shell caps concurrent children at eight.
  const clearReads = () => { reads.clear(); };
  /** Paint a previously true board immediately and replace it if the refresh differs. */
  const markStale = () => { for (const entry of reads.values()) entry.stale = true; };
  const broadcast = (...sources: ChangeSource[]) => { for (const source of sources) for (const listener of listeners) listener(source); };
  const notify = (...sources: ChangeSource[]) => { if (sources.length === 0) return; clearReads(); broadcast(...sources); };
  // W-08: reads never fetch (src/cli.ts eval-report, docs/frame-protocol.md), so a teammate's committed receipt
  // reaches this machine only when something runs the fetch-only `sync` (§10; the separate `refresh` verb is gone). Reads are invalidated only when a clone moved, and
  // only after the reads already in flight have settled: notify('clone') re-spawns seven query prefixes and the
  // shell caps concurrent CLI children at eight (src-tauri/src/lib.rs).
  const refreshPolicy = createRefreshPolicy({
    supported: () => hello?.features.refresh === true,
    run: () => read(run(['sync'], cliRefresh, value => value, [])),
    onChanged: async () => { await Promise.allSettled([...reads.values()].map(entry => entry.promise)); notify('marketplace'); },
  });
  const workflowGate = createWorkflowGate(() => { if (!retired) refreshPolicy.trigger(); });
  const onWindowFocus = () => { markStale(); refreshPolicy.trigger(); };
  retireWindowListeners?.();
  let retired = false; let unlistenNativeFocus: (() => void) | undefined;
  if (typeof window !== 'undefined') window.addEventListener('focus', onWindowFocus);
  // The shell's own focus event is authoritative: a WebView may not deliver a DOM `focus` to the page when the
  // app is re-activated. Outside the Tauri shell (browser dev, vitest) getCurrentWindow() throws or its IPC
  // rejects, and the DOM listener above is then the only trigger — which is correct there.
  try { void getCurrentWindow().onFocusChanged(({ payload }) => { if (payload && !retired) onWindowFocus(); }).then(stop => { if (retired) stop(); else unlistenNativeFocus = stop; }, () => undefined); }
  catch { /* Not inside the Tauri shell: there is no window event to subscribe to, and nothing to clean up. */ }
  retireWindowListeners = () => { retired = true; if (typeof window !== 'undefined') window.removeEventListener('focus', onWindowFocus); unlistenNativeFocus?.(); };
  const cwd = () => backend.prefs.get<string>('workspace', '') || undefined;

  function run<TIn, TOut>(argv: readonly (string | Promise<string>)[], schema: z.ZodType<TIn>, map: (value: TIn) => TOut, touches: ChangeSource[] = ['config', 'placed']): Run<TOut> {
    const finishWorkflow = workflowGate.start(argv);
    let job: Run<TOut>;
    try {
      job = cliRun<unknown, TOut>(bridge, state(), argv, { cwd: cwd(), onHello, map: (value) => map(schema.parse(value)), onSettled: (result) => { if (argv[0] === 'setup' || argv[0] === 'team' || argv[0] === 'uninstall') notify('config', 'clone', 'placed'); else if (result.ok || result.value !== undefined) notify(...touches); } });
    } catch (error) { finishWorkflow(); throw error; }
    return {
      done: job.done.then(result).finally(finishWorkflow),
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

  const readSession = createReadSession(bridge, {
    state, onHello,
    async read(job) {
      const lines: string[] = [];
      const outcome = await read(job, undefined, lines);
      const directory = await home();
      return { result: await result(outcome), lines: lines.map(line => abbreviateHome(line, directory)) };
    },
  });
  async function readThroughSession(argv: readonly string[]) {
    try {
      const shared = await readSession.request(argv, cwd());
      if (shared) return shared;
    } catch (error) {
      return { result: await fail(error instanceof Error ? error.message : String(error)), lines: [] };
    }
    const lines: string[] = [];
    return read(run(argv, z.unknown(), value => value, []), undefined, lines).then(result => ({ result, lines }));
  }

  /** Query families affected by a refreshed read, without clearing the newly replaced cache. */
  function sourceOf(argv: readonly string[]): ChangeSource {
    if (argv[0] === 'status') return 'config';
    if (argv[0] === 'ls' && argv[1] === '--local') return 'placed';
    return 'clone';
  }
  /** One CLI process per read argv per READ_CACHE_TTL_MS; failures and questions are never kept. Signal-free: a caller's abort must not kill a process other callers share. */
  function sharedRead(argv: readonly string[]): Promise<{ result: Result<unknown>; lines: string[] }> {
    const key = argv.join('\u0000');
    const now = Date.now();
    const hit = reads.get(key);
    if (hit && now - hit.at < READ_CACHE_TTL_MS) {
      if (hit.stale && !hit.refreshing) { hit.refreshing = true; void revalidate(key, argv, hit); }
      return hit.promise;
    }
    return start(key, argv, now);
  }
  function start(key: string, argv: readonly string[], at: number): Promise<{ result: Result<unknown>; lines: string[] }> {
    const promise = readThroughSession(argv);
    const entry = { promise, at, stale: false, refreshing: false };
    reads.set(key, entry);
    void promise.then(({ result }) => { if (!result.ok && reads.get(key) === entry) reads.delete(key); }, () => { if (reads.get(key) === entry) reads.delete(key); });
    return promise;
  }
  /** Failed refreshes drop the entry and broadcast; identical results reset the clock silently.
   * Compare only result: print lines are prose and may drift without a data change. */
  async function revalidate(key: string, argv: readonly string[], entry: { promise: Promise<{ result: Result<unknown>; lines: string[] }>; at: number; stale: boolean; refreshing: boolean }): Promise<void> {
    const previous = await entry.promise.then(value => value.result, () => undefined);
    let next: { result: Result<unknown>; lines: string[] } | undefined;
    try { next = await readThroughSession(argv); }
    catch { next = undefined; }
    if (reads.get(key) !== entry) return;
    entry.refreshing = false;
    entry.stale = false;
    if (next === undefined || !next.result.ok) { reads.delete(key); broadcast(sourceOf(argv)); return; }
    const changed = previous === undefined || JSON.stringify(previous) !== JSON.stringify(next.result);
    reads.set(key, { promise: Promise.resolve(next), at: Date.now(), stale: false, refreshing: false });
    if (changed) broadcast(sourceOf(argv));
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
    // A caller's abort is not a read failure: no reason, nothing else touched.
    if (status.value===undefined&&options?.signal?.aborted) return {ok:false,error:'Cancelled.'};
    if (status.value===undefined) return result({ok:false,error:status.ok?'Status returned no data.':status.error,...(!status.ok&&status.refused?{refused:true}:{}),...(!status.ok&&status.cancelled?{cancelled:true}:{}),reason:status.ok?'unreadable':readReason(status.error)});
    const value=map(status.value,local.ok?local.value:null,platform.value,directory);
    const errors=[status,local,platform].flatMap(outcome=>outcome.ok?[]:[outcome.error]);
    return result(errors.length?{ok:false,error:errors.join('\n'),value,reason:status.ok?'unreadable':readReason(status.error)}:{ok:true,value});
  }

  function teamSelectionFailure(teams:readonly {team:string}[]):Result<never> {
    return teams.length===0
      ? {ok:false,error:'No team is configured on this machine.',reason:'no-team'}
      : {ok:false,error:`This machine is configured for teams ${teams.map(team=>team.team).join(', ')}; Terum Skills keeps one team per machine. Leave the ones you no longer want in Settings ▸ Team.`,reason:'ambiguous-team'};
  }

  async function inventoryTeam(team: string | undefined, options?: ReadOptions): Promise<Result<InventoryTeam & { placements: LedgerPlacements }>> {
    const status = await cached(['status', ...(team ? ['--team', team] : [])], cliStatusTeams, options);
    if (!status.ok) return { ok: false, error: status.error };
    if (!team && status.value.teams.length !== 1) return teamSelectionFailure(status.value.teams);
    const selected = team ? status.value.teams.find(value => value.team === team) : status.value.teams.length === 1 ? status.value.teams[0] : undefined;
    if (!selected) return { ok: false, error: 'Select a team explicitly to read its skills.', reason: 'ambiguous-team' };
    if (!selected.readable) return fail(`Team ${selected.team} could not be read.`);
    return { ok: true, value: { ...selected, placements: status.value.ledger?.placements ?? [] } };
  }
  async function libraryTeam(team:string|undefined,options?:ReadOptions):Promise<{team:LibraryTeam;inventory?:Inventory;selected?:InventoryTeam & {placements:LedgerPlacements}}> {
    const selected=await inventoryTeam(team,options);
    if(!selected.ok)return {team:selected.reason==='no-team'?{kind:'none'}:{kind:'unreadable',message:selected.error}};
    const inventory=await cached(['ls','--team',selected.value.team], cliLs, options);
    if(!inventory.ok)return {team:{kind:'unreadable',message:inventory.error}};
    return {team:{kind:'ok',team:selected.value.team},selected:selected.value,inventory:inventory.value};
  }
  async function peopleInventory(options?: ReadOptions, permissions = false) {
    const status = await cached(['status', ...(permissions ? ['--permissions'] : [])], cliStatus, options);
    if (!status.ok) return status;
    if (status.value.teams.length !== 1) return teamSelectionFailure(status.value.teams);
    const team = status.value.teams[0]!;
    if (!team.readable) return { ok: false as const, error: `Team ${team.team} could not be read.` };
    const inventory = await cached(['ls', '--team', team.team], cliLs, options);
    return inventory.ok ? { ok: true as const, value: { team, inventory: inventory.value, placements: status.value.ledger.placements } } : inventory;
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
      if (hello === null) { featuresOnce = undefined; hello = null; }
      generation++;
      markStale();
      // A relaunch is a terminal action landing: the throttle must not hide what it just changed.
      refreshPolicy.reset();
      return backend.launchContext();
    },
    onLaunchRequest(listener) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      launchListenerReady = bridge.onLaunchRequest(() => { refreshPolicy.reset(); listener(); refreshPolicy.trigger(); }).then(stop => {
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
      return { appVersion: import.meta.env.VITE_APP_VERSION, windowChrome: platform === 'macos' ? 'mac-overlay' : 'native', disablePerMachine: features.disablePerMachine, inboxEventLog: false, offtargetKind: false, machineRegistry: false, perCaseEvalTables: features.perCase, openInEditor: true, clipboard: true };
    },
    async surfaces(): Promise<Surfaces> {
      return { divergence: false, status: true, settings: true, onboarding: false, library: true, skill: true, receipts: true, inbox: false, catalog: true, roster: true, update: true, libraryProjects:true, appUpdate:true };
    },
    // Status and Settings are offline reads; the remaining surfaces retain their explicit gaps.
    status: (_, options) => readModels(options, (value, local, platform, home) => statusModel(value, local, platform, { localIdentity: hello?.features.localIdentity ?? false }, home)),
    async settings(_, options) {
      const models = await readModels(options, (value, local, platform, home) => settingsModel(value, local, statusModel(value, local, platform, { localIdentity: hello?.features.localIdentity ?? false }, home), home));
      const team = models.value?.TEAMS.length === 1 ? models.value.TEAMS[0] : undefined;
      if (!team || !models.value) return models;
      const inventory = await cached(['ls', '--team', team.key], cliLs, options);
      if (!inventory.ok) return result({ ok:false, error:[...(models.ok?[]:[models.error]),inventory.error].join('\n'), reason:models.ok?'unreadable':models.reason??'unreadable', value:models.value });
      // Some CLI versions omit skill summaries from ls --local; the team inventory still reports their names.
      models.value.TEAM_POLICY.projects = inventory.value.projects?.map(project => project.name) ?? null;
      return models;
    },
    onboarding: async () => gap('Onboarding data'),
    async library({ scope, team }, options) {
      // Keep local first for recorded spawn order and failure precedence.
      const [local, enrichment] = await Promise.all([cached(['ls', '--local'], cliLs, options), libraryTeam(team, options)]);
      if (!local.ok) return fail(local.error);
      const section = local.value.local?.find(section => scope.kind==='global' ? section.scope==='global' : section.scope==='project' && samePath(section.repoRoot??section.root,scope.root));
      if (!section) return fail('No such checkout: '+(scope.kind==='checkout'?scope.root:'global')+' · Register it under Settings ▸ This machine ▸ Checkouts.');
      const features = {localIdentity:hello?.features.localIdentity??false};
      const directory = await home(), root = rootOf(section, directory);
      const skills:SkillCard[] = [], seen=new Set<string>();let joined=0,updatesAvailable=0;
      for (const row of section.rows) {
        if(seen.has(row.path))continue;seen.add(row.path);
        if(row.health==='update-available'||row.health==='both')updatesAvailable++;
        const skill = enrichment.team.kind==='ok' ? joinedSkill(row,enrichment.inventory!,enrichment.team.team,features) : undefined;
        if(skill && enrichment.team.kind==='ok') {joined++;skills.push({...inventoryCard(skill,{...local.value,local:[{...section,rows:[row]}]},enrichment.team.team,features,directory,enrichment.selected?.handle??'',enrichment.selected?.placements??[]),path:row.path});}
        else skills.push(localCard(row,section,directory));
      }
      for(const entry of section.notOffered??[]) {
        if(!countable(entry)||seen.has(entry.path))continue;seen.add(entry.path);
        skills.push(notOfferedCard(entry,section,directory));
      }
      const n=skills.length; // the grid itself — title, tile and placeholder never count a card the grid does not draw
      const broken=skills.filter(card=>card.flags.includes('broken')).length,attention_lines:string[]=[];
      if(updatesAvailable>0)attention_lines.push(`${plural(updatesAvailable,'update')} available`);
      if(broken>0)attention_lines.push(`${broken} broken`);
      const value:Library={root,team:enrichment.team,scanned:scannedRoots(local.value,directory),skills,problems:enrichment.inventory?.problems??[],provenance:null,
        // The ViewHeader title beside this subtitle is already root.label (LibraryScreen.tsx:30), so the
        // subtitle prints the count alone, in the board's shape ("15 skills") and the shape the mock and
        // the search placeholder already use (.planning/specs/desktop-scoped-stats-and-collapse.md:29).
        // plural() is the very helper that placeholder calls, so the two strings cannot drift apart again.
        // The team limb keeps the shared count beside the root's total.
        title:plural(n,'skill')+(enrichment.team.kind==='ok'&&joined>0?` · ${joined} shared with ${enrichment.team.team}`:''),
        overview:{skills:String(n),skills_note:enrichment.team.kind==='ok'&&joined>0?`${joined} shared with ${enrichment.team.team}`:'',evaluated:'—',meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:overviewCopy.evaluated,installs:String(skills.reduce((sum,row)=>sum+row.installsN,0)),installs_note:'',attention:String(updatesAvailable+broken),attention_lines,attention_link:'',zero:overviewCopy}};
      return {ok:true,value};
    },
    async localSkill({path},options) {
      const local=await cached(['ls','--local'], cliLs, options);
      if(!local.ok)return fail(local.error);
      const directory=await home(),features={localIdentity:hello?.features.localIdentity??false};
      for(const section of local.value.local??[]) {
        const row=section.rows.find(row=>samePath(row.path,path));
        const entry=row?undefined:section.notOffered?.find(entry=>countable(entry)&&samePath(entry.path,path));
        if(!row&&!entry)continue;
        const enrichment=await libraryTeam(undefined,options);
        const skill=row&&enrichment.team.kind==='ok'?joinedSkill(row,enrichment.inventory!,enrichment.team.team,features):undefined;
        if(row&&skill&&enrichment.selected&&enrichment.inventory) {
          const team=enrichment.selected.team;
          const [validation,report]=await Promise.all([backend.validate({ref:skill.name,team},options),backend.evalReport({ref:skill.name,team},options)]);
          if(!validation.ok&&validation.value===undefined)return fail(validation.error);
          const detail=inventoryDetail(skill,{...local.value,local:[{...section,rows:[row]}]},enrichment.selected,enrichment.selected.placements,validation,enrichment.inventory,features,directory,local.value,owningRootOf(section));
          return {ok:true,value:report.ok?{...detail,...report.value}:{...detail,evalReportError:report.error}};
        }
        const card=row?localCard(row,section,directory):notOfferedCard(entry!,section,directory);
        return {ok:true,value:localDetail(card,section,row?.path??entry!.path,directory)};
      }
      return {ok:false,error:abbreviateHome(path,directory)+' is not in any Library root (Global or a registered checkout), or no longer holds a SKILL.md.',reason:'not-in-library'};
    },
    projects:{add:path=>run(['project','add','--',path],cliProjectAdded,v=>v,['config']),remove:path=>run(['project','remove','--',path],cliProjectRemoved,v=>v,['config'])},
    teamProjects:{create:({name,remote})=>run(['team','project','create',...(remote?['--remote',remote]:[]),'--',name],cliProjectCreated,v=>v,['clone'])},
    async skill({ ref, team, at }, options) {
      const parts = ref.split('/');
      const explicitTeam = team ?? (parts.length === 2 ? parts[0] : undefined);
      const name = parts.length === 2 ? parts[1]! : ref;
      // Keep the local scan's feature evidence before later reads replace the shared hello.
      const [selected, { local, features }] = await Promise.all([inventoryTeam(explicitTeam, options), cached(['ls', '--local'], cliLs, options).then(local => ({ local, features: { localIdentity: hello?.features.localIdentity ?? false } }))]);
      if (!selected.ok) return { ok: false, error: selected.error, reason: selected.reason ?? 'unreadable' };
      const inventory = await cached(['ls', '--team', selected.value.team], cliLs, options);
      if (!inventory.ok) return { ok: false, error: inventory.error, reason: 'unreadable' };
      const matches = inventory.value.skills.filter(row => row.name === name || row.id.startsWith(name));
      const row = inventory.value.skills.find(row => row.name === name) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!local.ok) return { ok: false, error: local.error, reason: 'unreadable' };
      // A root the scan does not report (a stale bookmark, a forgotten checkout, a hand-typed URL)
      // is ignored rather than answered with a fabricated absence: the machine-wide answer is what
      // an unscoped URL gives today, and it never claims a root it did not resolve.
      const section = at === undefined ? undefined : sectionFor(local.value, at);
      const presence = section ? restrictLocal(local.value, section) : local.value;
      const owning = section ? owningRootOf(section) : null;
      if (!row) {
        // A bare name the team does not offer may still name a folder on this machine — one nobody
        // shared, or one whose frontmatter the CLI could not parse. Deep links and bookmarks arrive
        // as a bare name with no path, so the local roots answer before the name is reported
        // unknown. A scoped read searches only the root it names. An ambiguous team prefix is a
        // team-side ambiguity and is reported as such, with the count and the way out.
        const onThisMachine = matches.length === 0 ? localDetailByName(presence, name, await home()) : undefined;
        if (onThisMachine) return { ok: true, value: onThisMachine };
        if (matches.length === 0) return { ok: false, reason: 'not-found', error: `No skill named ${name} is shared in team ${selected.value.team}, and no readable folder of that name is in your Library roots.` };
        return { ok: false, reason: 'ambiguous-ref', error: `${matches.length} team skills in ${selected.value.team} have an ID starting with ${name}; open the one you want from the marketplace.` };
      }
      const [validation, report] = await Promise.all([backend.validate({ ref: row.name, team: selected.value.team }, options), backend.evalReport({ref:row.name,team:selected.value.team},options)]);
      // A hygiene failure has a parsed value; an unreadable/cancelled validation is a read failure.
      if (!validation.ok && validation.value === undefined) return { ok: false, error: validation.error, reason: 'unreadable' };
      const detail = inventoryDetail(row, presence, selected.value, selected.value.placements, validation, inventory.value, features, await home(), local.value, owning);
      const merged = report.ok ? {...detail, ...report.value} : {...detail, evalReportError: report.error};
      // The same captured snapshot inventoryDetail joined on: one skill() must not read localIdentity twice.
      // The version names the copy this page describes, so a scoped read reads the scoped placement.
      const placementVersion = onDisk(presence, selected.value.team, row.id, features).find(item => item.placement?.id === row.id && item.placement.team === selected.value.team)?.placement?.version;
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
      const data = await peopleInventory(options, true);
      if (!data.ok) return {ok:false,error:data.error,...(data.reason?{reason:data.reason}:{})};
      const { team } = data.value;
      return { ok: true, value: rosterModel(team) };
    },
    async catalog(query, options) {
      const data = await peopleInventory(options);
      if (!data.ok) return {ok:false,error:data.error,...(data.reason?{reason:data.reason}:{})};
      const { team, inventory, placements } = data.value;
      const local = await cached(['ls', '--local'], cliLs, options);
      if (!local.ok) return fail(local.error);
      const members = rosterModel(team).members;
      // §8.4: the per-member fan-out is deleted. `catalog()` spawned `status` + `ls --local` + N × `ls
      // member`; the team read now carries every member whole, so this is two processes regardless of
      // team size. A CLI that predates the `people[]` limb is REPORTED rather than silently drawn as a
      // team with no members — the only thing worse than a slow marketplace is a wrong one.
      const roster = new Map((inventory.people ?? []).map(person => [person.handle, person]));
      if (inventory.people === undefined && members.length) return fail(STALE_CLI_ROSTER);
      const people: Person[] = [];
      for (const member of members) {
        const detail = roster.get(member.handle);
        if (!detail) return fail(`No member data for ${member.handle}.`);
        // §8.4: the CLI resolved the authorship join, so this is an id lookup rather than a second
        // `normalizeAuthor` living on this side of the process boundary.
        const authoredIds = new Set(detail.authored);
        const authored = inventory.skills.filter(skill => authoredIds.has(skill.id));
        const names = authored.map(skill => skill.name);
        const installedIds = new Set(detail.installed.map(item => item.id));
        const installable = inventory.skills.filter(skill => installedIds.has(skill.id));
        const latest = newestUpdated(authored);
        const lastPublish = latest ? `${relativeTime(latest.updated)} · ${latest.name}` : '—';
        const disk: Person['onDisk'] = [installable.filter(skill => onDisk(local.value, team.team, skill.id, { localIdentity: hello?.features.localIdentity ?? false }).length > 0).length, installable.length];
        people.push({ ...member, joined: member.joined ?? '—', role: detail.role, lastPublish, last_publish: lastPublish, organization: null, declined: [], skills: names, installable: installable.map(skill => skill.name), adoption: authored.reduce((sum, skill) => sum + skill.installs, 0), publishLine: latest ? `Published ${latest.name} · ${relativeTime(latest.updated)}` : authored.length === 0 ? 'Nothing shared yet' : '—', teamsLine: member.projects.join(' · ') || 'On no project yet', buckets: names.length ? [['Authored', names]] : [], placeNote: personPlaceNote(disk), onDisk: disk });
      }
      return { ok: true, value: catalogModel(team, inventory, local.value, placements, people, { localIdentity: hello?.features.localIdentity ?? false }, await home(), query?.q) };
    },
    search: (args: SearchArgs, options?: ReadOptions) => read(run(['search', '--', args.q], cliSearch, (hits): SearchHit[] => hits.map((hit) => ({ kind: 'skill', ref: hit.team === undefined ? hit.name : `${hit.team}/${hit.name}`, name: hit.name, description: hit.description, team: hit.team ?? null, category: hit.category ?? null, author: hit.author ?? null, installs: hit.installs ?? null, latest: hit.latest ?? null, endorsed: hit.endorsed ?? null })), []), options).then(result),
    // Long verbs: one process each, questions become dialogs, the CLI's own decline messages come back as `ok:false`.
    setIdentity: (args) => {
      const pairs = [args.name === undefined ? [] : [`name=${args.name}`], args.email === undefined ? [] : [`email=${args.email}`], args.defaultHandle === undefined ? [] : [`default-handle=${args.defaultHandle}`]].flat();
      return run(['login', ...pairs.flatMap(pair => ['--set', pair])], cliLogin, (value): IdentityWrite => ({ updated: value.updated, notice: value.notice ?? null }), ['config']);
    },
    // install writes config pending/approvals/placements, places the folder, and safeWrites people/<handle>.json.
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
    }, into => run(['install', ...(!(args.kind === 'member' && args.member || args.kind === 'project' && args.project) && args.force ? ['--force'] : []), ...(args.team ? ['--team', args.team] : []), '--into', into, '--', ...(args.kind === 'member' && args.member ? ['member', args.member] : args.kind === 'project' && args.project ? ['project', args.project] : [args.ref])], cliInstalled, (installed): InstalledResult[] => installed.map((item) => ({ id: item.id, name: item.id, scope: args.scope ?? 'Global' })), ['config', 'placed', 'clone'])), // desktop-bug-skill-detail S14: CLI does not return scope yet.
    // uninstall-skill drops config placements/pending, removes placed folders, and rewrites the clone's people file.
    uninstallSkill: (args: UninstallArgs) => run(['uninstall-skill', ...(args.team ? ['--team', args.team] : []), ...(args.from ? ['--from', args.from] : []), '--', ...(args.kind === 'member' && args.member ? ['member', args.member] : args.kind === 'project' && args.project ? ['project', args.project] : [args.ref])], cliUninstalled, (removed): UninstalledResult[] => removed.map((item) => ({ id: item.id, name: item.id })), ['config', 'placed', 'clone']),
    quit: () => bridge.quit(),
    uninstallMachine: () => run(['uninstall'], cliMachine, (value): MachineUninstallResult => ({ removed: value.teams, removedPlacements: value.removedPlacements, hookRemoved: value.hookRemoved, wrapperRemoved: value.wrapperRemoved, configRemoved: value.configRemoved, kept: value.kept, record: value.record, advice: value.advice })),
    // profile writes the clone's people file and, for --name, config.display_name.
    profile: args => run(['profile', ...(args.name === undefined ? [] : ['--name', args.name]), ...(args.bio === undefined ? [] : ['--bio', args.bio]), ...(args.role === undefined ? [] : ['--role', args.role]), ...(args.projects ?? []).flatMap(project => ['--project', project])], cliProfile, value => value, args.name === undefined ? ['clone'] : ['config', 'clone']),
    // publish writes clone team.json/PR branches and registers the current checkout in config.
    publish: (args: PublishArgs) => run(['publish', ...(args.team ? ['--team', args.team] : []), ...(args.project ? ['--project', args.project] : []), '--', args.ref], cliPublish, (value): PublishResult => ({ name: value.name, project: value.project, version: value.version ?? value.identicalTo, created: value.created, identicalTo: value.identicalTo, attachedEvals: value.attachedEvals, profileAdded: value.profileAdded, projectAdded: value.projectAdded }), ['config', 'clone']),
    // Sync fetches team clones; it never changes the local Library or places a skill.
    sync: (args: SyncArgs) => run(['sync', ...(args.team ? ['--team', args.team] : [])], cliRefresh, (value): SyncResult => ({ notices:value.notices,changed:value.changed,teams:value.teams.map(team=>({team:team.team,state:team.state,...(team.detail===undefined?{}:{detail:team.detail})})) }), ['marketplace', 'stamp']),
    prune: () => run(['prune'], z.unknown(), () => undefined, ['placed']),
    invite: (args: InviteArgs) => run(['invite', ...(args.team ? ['--team', args.team] : []), ...(args.logins.length ? ['--', ...args.logins] : [])], cliInvite, (value): InviteResult => ({ invited: [...value.invited], already: [...value.already], failed: value.failed.map(f => ({ login: f.login, error: f.error })) }), ['clone']),
    team: (args: TeamArgs) => run(teamArgv(args), cliTeam, (value): TeamResult => ({ name: value.team, kind: args.kind }), ['config', 'clone', 'placed']),
    setup: (args: SetupArgs) => run(['setup', ...(args.target ? ['--', args.target] : [])], cliSetup, (value): SetupResult => ({ team: value.team, role: value.role, steps: value.steps ?? null }), ['config', 'clone', 'placed']),
    // Settings ▸ Evals defaults reach every run as explicit flags ("the flags the app passes"); an unset pref (or the k '—' sentinel) passes nothing and the CLI keeps no defaults of its own.
    eval: (args: EvalArgs) => { const k = prefs.get('eval:k', ''), model = prefs.get('eval:model', ''), judge = prefs.get('eval:judge', ''); return run(['eval', ...(k && k !== '—' ? ['--k', k] : []), ...(model ? ['--model', model] : []), ...(judge ? ['--judge-model', judge] : []), ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliEval, (value): EvalResult => ({ name:value.name,runDir:value.runDir,executionStatus:value.executionStatus,team:value.team,id:value.id,shareHint:value.shareHint===true }), ['config', 'placed']); },
    validate: (args: ValidateArgs, options?: ReadOptions) => args.ref || args.cwd ? cached<ValidateResult>(['validate', ...(args.cwd && args.ref ? ['--cwd', args.cwd] : []), ...(args.team ? ['--team', args.team] : []), '--', args.ref || args.cwd || ''], cliValidate, options).then(result) : fail('validate needs a skill name or a folder.'),
    update: (_args, options) => read(run(['update'], cliUpdate, (value): UpdateAdvice => ({ ...value, running: value.running ?? null, latest: value.latest ?? null }), []), options).then(result),
    appUpdate: createAppUpdate({ run, read, result, prefs, appVersion: import.meta.env.VITE_APP_VERSION }),
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
  registerEvalQueue(backend, createEvalQueue({ run, read, result }));
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
