import type { Design } from '../fixtures/schema';
export type Result<T> = {ok:true;value:T}|{ok:false;error:string;cancelled?:true;refused?:true;reason?:'no-team'|'ambiguous-team'|'not-in-library'|'not-found'|'ambiguous-ref'|'unreadable'|'invalid-config';value?:T};
export interface LaunchContext { writtenAt: string; target?: string; intent?: 'setup' }
export class PromptCancelledError extends Error { readonly cancelled = true as const; }
export interface AskOptions {detail?:readonly string[]}
export interface Prompter {readonly interactive:boolean;confirm(question:string,options?:AskOptions):Promise<boolean>;text(question:string,defaultValue?:string,options?:AskOptions):Promise<string>;select(question:string,choices:readonly string[],options?:AskOptions):Promise<string>;print(line:string):void}
export type AskKind='confirm'|'text'|'select';
export interface PromptQuestion {kind:AskKind;question:string;choices?:readonly string[];default?:string;detail?:readonly string[]}
export type Frame={t:'print';line:string}|{t:'ask';id:string;kind:AskKind;question:string;default?:string;choices?:readonly string[];detail?:readonly string[]}|{t:'progress';done:number;total:number;label?:string}|{t:'result';ok:boolean;error?:string;declined?:boolean;refused?:boolean};
export interface Run<T>{readonly frames:AsyncIterable<Frame>;answer(id:string,value:string|boolean):void;cancel():Promise<void>;readonly done:Promise<Result<T>>}
export interface Capabilities {appVersion:string;windowChrome:'mac-overlay'|'native'|'cosmetic';disablePerMachine:boolean;inboxEventLog:boolean;offtargetKind:boolean;machineRegistry:boolean;perCaseEvalTables:boolean;evalCommitChoice:boolean;openInEditor:boolean;clipboard:boolean}
export const FEATURE_KEYS = ['favorites','follow','roles','lastSeen','installScope','inviteScoping','disablePerMachine','projectMembers','liftOnCards','runEvalInApp','perCase','progress','memberRole','localIdentity','checkouts','projects','refresh','discover','appUpdate'] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];
export type Features = Readonly<Record<FeatureKey, boolean>>;
export interface Surfaces {checkouts:boolean;divergence:boolean;status:boolean;settings:boolean;onboarding:boolean;library:boolean;skill:boolean;receipts:boolean;inbox:boolean;catalog:boolean;roster:boolean;update:boolean;appUpdate:boolean}
export interface ReadOptions {signal?:AbortSignal}
export type Theme='dark'|'light'|'system';
export type Scope=string;
export type TokenKey=keyof Design['TOKENS'];
export type IndicatorKey='update'|'local'|'broken';
export interface ReceiptSummary {w:number;l:number;t:number;n:number;lift:number;verdict:'PASS'|'NEUTRAL'|'FAIL';partial:[number,number]|null;signP:string}
/** Where a skill stands with the team, which decides whether Publish can run: `endorsed` is
 *  listed in team.json, `shared` is in the team repo but not endorsed, `unshared` is a folder
 *  the team repo does not hold, `unknown` is a team the CLI could not read. */
export type TeamState='endorsed'|'shared'|'unshared'|'unknown';/** 'placed': this machine has the skill (a ledger placement — including one only the unfiltered status ledger sees — or an identified on-disk copy). 'recorded': the team people file says this user installed it, but nothing is on this machine — the truthful in-between state (per ryanliu, 2026-09-09). 'absent': neither. The booleans `placed`/`onDiskOnly` keep the finer disk-provenance split (ledger-tracked vs user's own copy) within the 'placed' state. */
export type InstallState='placed'|'recorded'|'absent';/** Which detail backend can describe this card. A team card is addressed by name through
 *  `skill({ref})`; a folder that belongs to no team exists only on this machine and must be
 *  addressed by `path` through `localSkill({path})`, because the team inventory has no row for
 *  it. Never infer this from `project` — that field carries the root a folder lives in ('Global'
 *  or a checkout's basename), which no longer distinguishes the two. */
export interface SkillCard {teamed:boolean;path:string|null;updated:string|null;favorites?:number|null;grants:string[]|null;normalizedGrants:string|null;grantsHash:string|null;project:string;category:string;name:string;desc:string;size:string;installs:string;favorite:boolean;flags:IndicatorKey[];flagText:Partial<Record<IndicatorKey,string>>;enabled:boolean;installed:InstallState;placed:boolean;onDiskOnly:boolean;teamState:TeamState;paths:[string,string][];projectRoots?:string[];connectedSources?:string[];wlt:[number,number,number]|null;cases?:number|undefined;partial?:[number,number]|null|undefined;summary:ReceiptSummary|null;installsN:number;tokensK:number;indicators:Record<IndicatorKey,{icon:string;token:TokenKey;text:string}>}
export type Receipt=NonNullable<Design['DETAIL']['receipt']>;
export interface SkillMdBlock {kind:'h2'|'p'|'ol'|'code';content:string|string[]}
export interface ReportNumbers {holes:number;nRounds:number;triggerTotal:number;precisionObserved?:string}
export interface EvalEstimate {cases:number;k:number;arms:number;runs:number;minutes:number;dollars:number;model:string}
export type SkillDetail=Omit<Design['DETAIL'],keyof SkillCard|'root'|'history'|'lines'|'version_full'|'repo'|'path'|'files'> & SkillCard & {path:string|null;repoPath:string;files:string[]|null;pathLabel:string;repo:string|null;version_full:string|null;team:string|null;installScopes:[string,string][];installScopePaths?:Record<string,string>;projectNames:string[]|null;favorites:number|null;lines:number|null;hygieneCaption:string|null;hygieneStatus:'pass'|'fail'|null;hygieneWhen:string|null;skillRef:string;root:'Global'|'Marketplace';history:(Design['DETAIL']['history'][number]&{summary:ReceiptSummary|null;local?:true})[];skillMd:{frontmatter:string;body:SkillMdBlock[];markdown?:string|null};evalEstimate:EvalEstimate|null;evalEstimateText:string;evalEstimateTip:string;evalCommand:string;shareCommand:string;incumbentLift:[number,string]|null;reportNumbers:ReportNumbers|null;scoreFractions:{routesExpected:number|null;roi:[number,number]|null;quality:[number,number]|null};method:string;
 versions:{placed:string|null;teamCurrent:string|null;evaluated:string|null}|null;
 latestState:'ok'|'none'|'invalid';invalidReceiptFile:string|null;evalReportError:string|null;
 /** A same-named local folder the driving CLI is too old to identify: presence is unknown, so the
  *  page must not claim "Not installed" nor offer an Install that would collide with it. */
 unidentifiedLocal:{path:string;pathLabel:string}|null;
 /** The Library root this detail describes, as the backend resolved it: `id` is the sidebar's root
  *  id — the literal 'Global', or a checkout's repo root — and `label` is the crumb's first part.
  *  Null when the read was not anchored to one root (a bare-name deep link answered machine-wide,
  *  or the marketplace), and the screen then falls back to `root`. A page must never derive this
  *  from a path: root membership is the backend's to decide (desktop/AGENTS.md invariant 1). */
 owningRoot:{id:string;label:string}|null;
 /** The viewer's own handle in this team, so the page describes the viewer's install as theirs
  *  instead of a teammate's. Null when the detail is not team-scoped, as for a local folder that
  *  belongs to no team and therefore has no per-team handle to compare against.
  *  This is the per-team handle, never the machine's default identity — they can differ. */
 viewerHandle:string|null;
 localRuns:{runId:string;runDir:string;executionStatus:'complete'|'partial'|'failed'|'unknown';committed:boolean;receipt:Receipt|null;summary:ReceiptSummary|null}[];
};
export type EvalReportModel=Pick<SkillDetail,'receipt'|'summary'|'incumbentLift'|'reportNumbers'|'history'|'versions'|'latestState'|'invalidReceiptFile'|'localRuns'|'evalEstimate'|'evalEstimateText'|'evalEstimateTip'|'scoreFractions'|'wlt'>;
export type InboxKind='share'|'update'|'alert'|'eval'|'review'|'author'|'team';
export type InboxItem=Omit<Design['INBOX'][number],'kind'> & {id:string;skillRef:string;kind:InboxKind;summary:ReceiptSummary|null;incumbentLift:[number,string]|null;reportNumbers?:ReportNumbers};
export type Person=Omit<Design['ROSTER'][number], 'followers'|'role'> & {role:string|null;followers:number|null;projects:string[];declined:string[];organization:string|null;lastPublish:string;skills:string[];installable:string[];adoption:number;publishLine:string;teamsLine:string;buckets:[string,string[]][];placeNote:string;onDisk:[number,number]};
export type Project=Omit<Design['PROJECTS'][number], 'evaluated'|'favorites'|'admin'|'updated'> & {admin:Design['PROJECTS'][number]['admin']|null;updated:string|null;evaluated:number|null;favorites:number|null;memberHandles:string[];memberInitials:string[];skillsIn:string[]};
export interface Catalog {scanned:string[]|null;repository:string|null;skills:SkillCard[];extras:SkillCard[];people:Person[];projects:Project[];categories:Design['CATEGORIES'];categoryRemaining:Record<string,number>;topRated:string[];peopleByAdoption:string[];projectsByMembers:string[];categorySkills:Record<string,string[]>;filterDefault:Design['FILTER_DEFAULT'];filterCount:number;verdictCounts:Record<'PASS'|'NEUTRAL'|'FAIL'|'Not evaluated',number|null>;catalogN:number;teamN:number;bulkInstall:Record<string,{total:number;asking:number}>}
/** `skillsTotal` is how many skills that member's own machine last reported having (their people file's `local_skills`) — a self-report about them, not a fact about this machine; null when nobody has reported one. */
export type Member=Omit<Design['ROSTER'][number], 'followers'|'role'|'joined'> & {role:string|null;followers:number|null;joined:string|null;skillsTotal:number|null;status:string;projects:string[];lastSeen:string;lastPublish:string};
/** `invited`, `joined` and `skillsTotal` are null when the source does not report them — the screen omits the claim rather than asserting zero or a date. */
export interface Roster {members:Member[];invited:Design['INVITED']|null;member:Record<string,{status:string;projects:string[];lastSeen:string}>;byAdoption:string[]}
/** `slug` is owner/repo on GitHub and null on every other host; `remote` is null when the folder has no origin at all. */
export interface RootRemote {url:string;slug:string|null}
export interface Root {id:string;kind:'global'|'checkout';label:string;root:string;rootState?:'scanned'|'absent'|'unreadable'|undefined;registered:boolean;detected:boolean;count?:string|undefined;remote?:RootRemote|null|undefined}
export type LibraryScope={kind:'global'}|{kind:'checkout';root:string};
export type LibraryTeam={kind:'ok';team:string}|{kind:'none'}|{kind:'unreadable';message:string};
export interface DiscoverCandidate {path:string;skillFolders:number;registered:boolean;repoRoot:boolean}
export interface DiscoverResult {candidates:DiscoverCandidate[];scanned:number;truncated:boolean;problems:{path:string;reason:string}[]}
export interface DiscoverArgs {under?:string[];register?:boolean}
export interface CheckoutAdded {path:string;registered:boolean}
/** `project create`: the team project as team.json now holds it. A new project is always born with no skills. */
export interface ProjectCreated {team:string;name:string;remotes:string[];skills:number}
export interface CheckoutRemoved {path:string;placementsRemaining:number}
export interface Library {scanned:string[]|null;skills:SkillCard[];overview:Design['LIBRARY_OVERVIEW'];title:string;provenance?:string|null;root:Root;team:LibraryTeam;problems?:readonly {source:string;message:string}[]}
/** attention = failingEvals + updatesAvailable + notEvaluated; counts.Alerts = attention, counts.Updates = updatesAvailable. Absent CLI counters are omitted. */
export type CloneState = {state:'absent'} | {state:'incomplete';reason:'not-a-repository'|'no-team-json'|'unverifiable';error?:string} | {state:'foreign'|'ok';origin:string};
/** name comes from team.json via status; key is the config identifier. They may differ; there is no label. */
export interface TeamStatus {
 name:string;key:string;remote:string|null;handle:string;clone:string|null;members:number|null;skills:number|null;
 last_sync:string|null;stamp:string|null;policy:{publish:string;license:string}|null;categories:string[]|null;
 pending:{op:'install'|'uninstall';id:string;scope:{kind:'global'}|{kind:'project';project:string};version:string|null;started:string}[];
 joinCommand:string|null;joinBlock:readonly string[]|null;
 cloneState?:CloneState|null;readable?:boolean|null;
}
export type Machine=Design['MACHINE'] & {hostname:string};
export type Identity=Design['ME'] & {initials:string;footerLabel:string};
export interface StatusLedger {
 placements:{path:string;id:string;team:string;version:string|null;scope:{kind:'global'}|{kind:'project';project:string};placed_at:string}[];
 approvals:{id:string;grants:string;approved_at:string}[];
 shared:{id:string;source:string;team:string}[];
}
export interface StatusResult {ledger?:StatusLedger|null;machine:Machine;me:Identity;teams:TeamStatus[];counts:Record<string,string>;tools:{git:boolean;gh:boolean};roots:Root[]}
export interface SearchArgs {q:string;kinds?:readonly ('skill'|'member'|'project')[]}
export interface SearchHit {kind:'skill'|'member'|'project';ref:string;name:string;description:string;team:string|null;category:string|null;author:string|null;installs:number|null;latest:string|null;endorsed:string|null;unresolved:boolean|null}
export interface IdentityArgs {name?:string;email?:string;defaultHandle?:string}
export interface IdentityWrite {updated:{key:string;value:string}[];notice:string|null}
export interface InstallArgs {team?:string;ref:string;scope?:Scope;kind?:'skill'|'member'|'project';member?:string;project?:string;force?:boolean}
export interface InstalledResult {id:string;name:string;scope:Scope}
export interface UninstallArgs {from?:string;team?:string;ref:string;kind?:'skill'|'member'|'project';member?:string;project?:string}
export interface UninstalledResult {id:string;name:string}
export interface MachineUninstallResult {removed:string[];removedPlacements:number;hookRemoved:boolean;wrapperRemoved:boolean;configRemoved:boolean;kept:string[];record:string;advice:string[]}
export interface ConnectArgs {path?:string;home?:string;cwd?:string;team?:string;keepSource?:string;keepRepo?:string;relocate?:string;forget?:string;allowPrivileged?:boolean}
export interface ConnectResult {id:string;name:string;reconciled?:boolean;adopted?:boolean}
export interface ConnectBatch {kind:'batch';shared:ConnectResult[];declined:string[];refused:{name:string;reason:string}[]}
export type ConnectOutcome=ConnectResult|ConnectBatch;
export interface PublishArgs {team?:string;ref:string;message?:string;/** Endorse into `team.json projects[<project>].skills` instead of the global list. */project?:string}
/** `prUrl` is set only under `policy.publish: 'pr'`, where team.json does not change until that pull request merges. */
export interface PublishResult {name:string;version:string|null;changed:boolean;prUrl:string|null}
export interface SyncArgs {team?:string;prune?:boolean;hook?:boolean}
export interface SyncResult {placed:number;deferred:string[];notices:string[];changed:boolean;teams:{team:string;state:string;message?:string}[]}
export interface InviteArgs {team?:string;logins:string[];scope?:Scope;role?:string}
export interface InviteResult {invited:string[];already:string[];failed:{login:string;error:string}[]}
export interface TeamArgs {kind:'create'|'join'|'remove'|'leave';name?:string;team?:string;remote?:string;handle?:string}
export interface TeamResult {name:string;kind:TeamArgs['kind']}
export interface SetupArgs {target?:string;offerConnect?:boolean}
export const SETUP_STEP_KEYS = ['welcome','app','role','github','team','actions','invite','discover','evals','community','hook','wrapper','done'] as const;
export type SetupStep = typeof SETUP_STEP_KEYS[number];
export interface SetupResult {team:string;role:'creator'|'joiner';connected?:ConnectOutcome;steps?:Partial<Record<SetupStep,'done'|'skipped'|'printed'>>|null}
export interface EvalArgs {team?:string;ref:string;commit?:boolean;cases?:number}
export interface EvalResult {name:string;runDir:string;executionStatus:'complete'|'partial'|'failed';commit:{ok:true;receiptPath:string}|{ok:false;error:string}|null}
export interface ValidateArgs {team?:string;ref?:string;cwd?:string}
export interface ValidateResult {name:string;findings:number;warnings:number}
export interface UpdateAdvice {running:string|null;latest:string|null;observation:'newer'|'same'|'older'|'unknown';launch:'global'|'local'|'npx'|'source'|'unknown';description:string;advice:string[];lines:string[]}
export type AppUpdatePhase='waiting'|'installing'|'launched'|'failed';
export type AppUpdateReason='on-close'|'overnight'|'manual';
export interface AppUpdateMarker {reason?:AppUpdateReason;version:string;phase:AppUpdatePhase;at:string;error:string|null}
/** The app's own update state. `newer` is computed in the adapter from `latest` vs the running build. */
export interface AppUpdateStatus {reason?:AppUpdateReason;appVersion:string;supported:boolean;cliVersion:string|null;latest:string|null;latestAt:string|null;probe:'ok'|'skipped'|'cached'|'failed';probeError:string|null;staged:string|null;installed:string[];lastApply:AppUpdateMarker|null;newer:boolean;ppid:number}
export interface AppUpdateStaged {version:string;staged:boolean;notPublished:boolean;alreadyStaged:boolean}
export interface PrefStore {get<T>(key:string,fallback:T):T;set(key:string,value:unknown):void;readonly ready?:Promise<void>;flush?():Promise<void>;subscribe?(listener:()=>void):Subscription}
export type Subscription=()=>void;
export type ChangeSource='config'|'clone'|'placed'|'stamp';

export type Settings = Pick<Design, 'PLACEMENTS'|'PLACEMENTS_N'|'PINNED_N'|'APPROVALS'|'LOCAL_UNSHARED'|'APP_VERSION'|'AGENT_CLI'|'COMMUNITY'|'SETTINGS_NAV'|'SHORTCUTS'|'INBOX_KIND_TEXT'|'THEME_OPTIONS'|'CLI_VERSION'|'FOLLOWING'|'INVITE_TIP'|'JOIN_BLOCK_NOTE' > & {
HOOK:Design['HOOK']|null;QUARANTINE:Design['QUARANTINE']|null;CLI_LATEST:string|null;STORAGE:Omit<Design['STORAGE'],'cache_n'|'evals_n'>&{cache_n:number|null;evals_n:number|null};
// mock-only: the drawn specimen login (design INVITEE); the real adapter never sets it
INVITEE?:string;K:number|null;AGENT_CLI_AUTH:'signed-in'|'unknown';MACHINE:Machine;ME:Identity;TEAMS:TeamStatus[];TEAM_POLICY:{publish:string|null;license:string|null;categories:string[]|null;categoriesNote:string;projects:string[]|null};SHARED:[string,string,string,string][];SHARED_SPECIMEN:[string,string,string,string]|null;tools:{git:boolean;gh:boolean};syncNote:string|null};
export type Onboarding = Pick<Design, 'ONBOARD_STEPS'|'ONBOARD_BASICS'|'GLOBAL_SET'|'BOOT_STEPS'|'ONBOARD_LATER'|'ONBOARD_COMMUNITY'|'ONBOARD_FETCH_ERROR'|'WELCOME_LINES'|'BASICS_COPY'|'BASICS_HINT'|'THEME_OPTIONS'|'LIBRARY_OVERVIEW'|'INVITEE'|'TEAM_REPO'|'INVITE_TIP'|'JOIN_BLOCK_NOTE'> & {skill:SkillCard;summary:ReceiptSummary|null;arm:Receipt['arm'];used_by:string[];installs_n:number;shareCommand:string;rosterInitials:string[];team:Design['TEAMS'][number];me:Design['ME'];teamN:number;searchResults:{kind:'skill'|'person'|'project';name:string;meta:string;initials?:string}[];joinBlock:string;bootRows:[string,string,string][];failedBootRows:[string,string,string][]};
