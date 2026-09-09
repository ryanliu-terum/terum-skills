import type { Design } from '../fixtures/schema';
export type Result<T> = {ok:true;value:T}|{ok:false;error:string;cancelled?:true;value?:T};
export interface Prompter {readonly interactive:boolean;confirm(question:string):Promise<boolean>;text(question:string,defaultValue?:string):Promise<string>;select(question:string,choices:readonly string[]):Promise<string>;print(line:string):void}
export type AskKind='confirm'|'text'|'select';
export interface PromptQuestion {kind:AskKind;question:string;choices?:readonly string[];default?:string}
export type Frame={t:'print';line:string}|{t:'ask';id:string;kind:AskKind;question:string;default?:string;choices?:readonly string[]}|{t:'progress';done:number;total:number;label?:string}|{t:'result';ok:boolean;error?:string;declined?:boolean};
export interface Run<T>{readonly frames:AsyncIterable<Frame>;answer(id:string,value:string|boolean):void;cancel():Promise<void>;readonly done:Promise<Result<T>>}
export interface Capabilities {windowChrome:'mac-overlay'|'native'|'cosmetic';disablePerMachine:boolean;inboxEventLog:boolean;offtargetKind:boolean;machineRegistry:boolean;perCaseEvalTables:boolean;openInEditor:boolean;clipboard:boolean}
export const FEATURE_KEYS = ['favorites','follow','roles','lastSeen','installScope','inviteScoping','disablePerMachine','projectMembers','liftOnCards','runEvalInApp','perCase','progress','memberRole'] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];
export type Features = Readonly<Record<FeatureKey, boolean>>;
export interface Surfaces {status:boolean;settings:boolean;onboarding:boolean;library:boolean;skill:boolean;receipts:boolean;inbox:boolean;catalog:boolean;roster:boolean;update:boolean}
export interface ReadOptions {signal?:AbortSignal}
export type Theme='dark'|'light'|'system';
export type Scope=string;
export type TokenKey=keyof Design['TOKENS'];
export type IndicatorKey='update'|'local'|'broken';
export interface ReceiptSummary {w:number;l:number;t:number;n:number;lift:number;verdict:'PASS'|'NEUTRAL'|'FAIL';partial:[number,number]|null;signP:string}
export interface SkillCard {updated:string|null;favorites?:number|null;grants:string[]|null;normalizedGrants:string|null;grantsHash:string|null;project:string;category:string;name:string;desc:string;size:string;installs:string;favorite:boolean;flags:IndicatorKey[];flagText:Partial<Record<IndicatorKey,string>>;enabled:boolean;installed:boolean;wlt:[number,number,number]|null;cases?:number|undefined;partial?:[number,number]|null|undefined;summary:ReceiptSummary|null;installsN:number;tokensK:number;indicators:Record<IndicatorKey,{icon:string;token:TokenKey;text:string}>}
export type Receipt=NonNullable<Design['DETAIL']['receipt']>;
export interface SkillMdBlock {kind:'h2'|'p'|'ol'|'code';content:string|string[]}
export interface ReportNumbers {holes:number;nRounds:number;triggerTotal:number;precisionObserved?:string}
export interface EvalEstimate {cases:number;k:number;arms:number;runs:number;minutes:number;dollars:number;model:string}
export type SkillDetail=Omit<Design['DETAIL'],keyof SkillCard|'root'|'history'|'lines'|'version_full'|'repo'> & SkillCard & {repo:string|null;version_full:string|null;team:string|null;installScopes:[string,string][];projectNames:string[]|null;favorites:number|null;lines:number|null;hygieneCaption:string|null;skillRef:string;root:'Global'|'Marketplace';history:(Design['DETAIL']['history'][number]&{summary:ReceiptSummary|null})[];skillMd:{frontmatter:string;body:SkillMdBlock[];markdown?:string|null};evalEstimate:EvalEstimate|null;evalEstimateText:string;evalEstimateTip:string;evalCommand:string;shareCommand:string;incumbentLift:[number,string]|null;reportNumbers:ReportNumbers|null;scoreFractions:{routesExpected:number|null;roi:[number,number]|null;quality:[number,number]|null};method:string};
export type InboxKind='share'|'update'|'alert'|'eval'|'review'|'author'|'team';
export type InboxItem=Omit<Design['INBOX'][number],'kind'> & {id:string;skillRef:string;kind:InboxKind;summary:ReceiptSummary|null;incumbentLift:[number,string]|null;reportNumbers?:ReportNumbers};
export type Person=Design['ROSTER'][number] & {lastPublish:string;skills:string[];adoption:number;publishLine:string;teamsLine:string;buckets:[string,string[]][];placeNote:string;onDisk:[number,number]};
export type Project=Design['PROJECTS'][number] & {memberHandles:string[];memberInitials:string[];skillsIn:string[]};
export interface Catalog {repository:string|null;skills:SkillCard[];extras:SkillCard[];people:Person[];projects:Project[];categories:Design['CATEGORIES'];categoryRemaining:Record<string,number>;topRated:string[];peopleByAdoption:string[];projectsByMembers:string[];categorySkills:Record<string,string[]>;filterDefault:Design['FILTER_DEFAULT'];filterCount:number;verdictCounts:Record<'PASS'|'NEUTRAL'|'FAIL'|'Not evaluated',number>;catalogN:number;teamN:number;bulkInstall:Record<string,{total:number;asking:number}>}
export type Member=Design['ROSTER'][number] & {status:string;projects:string[];lastSeen:string;lastPublish:string};
export interface Roster {members:Member[];invited:Design['INVITED'];member:Record<string,{status:string;projects:string[];lastSeen:string}>;byAdoption:string[]}
export interface Library {skills:SkillCard[];overview:Design['LIBRARY_OVERVIEW'];title:string;provenance?:string|null;projects?:readonly {name:string;skills:readonly string[];remotes:readonly string[];[key:string]:unknown}[];problems?:readonly {source:string;message:string}[]}
/** attention = failingEvals + updatesAvailable + notEvaluated; counts.Alerts = attention, counts.Updates = updatesAvailable. Absent CLI counters are omitted. */
export type CloneState = {state:'absent'} | {state:'incomplete';reason:'not-a-repository'|'no-team-json'|'unverifiable';error?:string} | {state:'foreign'|'ok';origin:string};
export type TeamStatus = Design['TEAMS'][number] & {cloneState?:CloneState|null;readable?:boolean|null};
export interface StatusResult {machine:Design['MACHINE'];me:Design['ME'];teams:TeamStatus[];counts:Record<string,string>}
export interface SearchArgs {q:string;kinds?:readonly ('skill'|'member'|'project')[]}
export interface SearchHit {kind:'skill'|'member'|'project';ref:string;name:string;description:string;team:string|null;category:string|null;author:string|null;installs:number|null;latest:string|null;endorsed:string|null;unresolved:boolean|null}
export interface InstallArgs {team?:string;ref:string;scope?:Scope;kind?:'skill'|'member'|'project';member?:string;project?:string;force?:boolean}
export interface InstalledResult {id:string;name:string;scope:Scope}
export interface UninstallArgs {team?:string;ref:string}
export interface UninstalledResult {id:string;name:string}
export interface MachineUninstallResult {removed:string[]}
export interface ConnectArgs {path?:string;home?:string;cwd?:string;team?:string;keepSource?:boolean;keepRepo?:boolean;relocate?:boolean;forget?:boolean;allowPrivileged?:boolean}
export interface ConnectResult {id:string;name:string;reconciled?:boolean}
export interface ConnectBatch {kind:'batch';shared:ConnectResult[];declined:string[];refused:{name:string;reason:string}[]}
export type ConnectOutcome=ConnectResult|ConnectBatch;
export interface PublishArgs {team?:string;ref:string;message?:string}
export interface PublishResult {name:string;version:string|null;changed:boolean}
export interface SyncArgs {team?:string;prune?:boolean;hook?:boolean}
export interface SyncResult {placed:string[];removed:string[]}
export interface InviteArgs {team?:string;logins:string[];scope?:Scope;role?:string}
export interface InviteResult {invited:string[]}
export interface TeamArgs {kind:'create'|'join'|'remove'|'leave';name?:string;team?:string;remote?:string;handle?:string}
export interface TeamResult {name:string;kind:TeamArgs['kind']}
export interface SetupArgs {target?:string;offerConnect?:boolean}
export interface SetupResult {team:string;role:'creator'|'joiner';connected?:ConnectOutcome}
export interface EvalArgs {team?:string;ref:string;commit?:boolean;cases?:number}
export interface EvalResult {name:string;receipt:Receipt|null}
export interface ValidateArgs {team?:string;ref?:string;cwd?:string}
export interface ValidateResult {name:string;findings:number;warnings:number}
export interface UpdateAdvice {current:string;latest:string;available:boolean}
export interface PrefStore {get<T>(key:string,fallback:T):T;set(key:string,value:unknown):void}
export type Subscription=()=>void;
export type ChangeSource='config'|'clone'|'placed'|'stamp';

export type Settings = Pick<Design, 'MACHINE'|'ME'|'TEAMS'|'TEAM_POLICY'|'PLACEMENTS'|'PLACEMENTS_N'|'PINNED_N'|'APPROVALS'|'QUARANTINE'|'SHARED'|'LOCAL_UNSHARED'|'HOOK'|'APP_VERSION'|'AGENT_CLI'|'COMMUNITY'|'STORAGE'|'SETTINGS_NAV'|'SHORTCUTS'|'INBOX_KIND_TEXT'|'THEME_OPTIONS'|'CLI_VERSION'|'CLI_LATEST'|'FOLLOWING'|'SHARED_SPECIMEN'>;
export type Onboarding = Pick<Design, 'ONBOARD_STEPS'|'ONBOARD_BASICS'|'GLOBAL_SET'|'BOOT_STEPS'|'ONBOARD_LATER'|'ONBOARD_COMMUNITY'|'ONBOARD_FETCH_ERROR'|'WELCOME_LINES'|'BASICS_COPY'|'BASICS_HINT'|'THEME_OPTIONS'|'LIBRARY_OVERVIEW'|'INVITEE'|'TEAM_REPO'|'INVITE_TIP'|'JOIN_BLOCK_NOTE'> & {skill:SkillCard;summary:ReceiptSummary|null;arm:Receipt['arm'];used_by:string[];installs_n:number;shareCommand:string;rosterInitials:string[];team:Design['TEAMS'][number];me:Design['ME'];teamN:number;searchResults:{kind:'skill'|'person'|'project';name:string;meta:string;initials?:string}[];joinBlock:string;bootRows:[string,string,string][];failedBootRows:[string,string,string][]};
