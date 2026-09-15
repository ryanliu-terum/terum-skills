import type { FileDropEvent, SkillFileResult, SkillToggleResult } from './types';
import type { AppUpdateStaged, AppUpdateStatus, LaunchContext, IdentityArgs, IdentityWrite, Settings, Onboarding, Features, Capabilities, Surfaces, ReadOptions, Catalog, ChangeSource, EvalArgs, EvalManyArgs, EvalManyResult, EvalResult, EvalReportModel, InboxItem, InstallArgs, InstalledResult, InviteArgs, InviteResult, MachineUninstallResult, PrefStore, PublishArgs, PublishResult, UnpublishArgs, UnpublishResult, Receipt, ReconcileResult, Result, Roster, Run, LibraryScope, ProjectAdded, ProjectRemoved, ProjectCreated, SearchArgs, SearchHit, SetupArgs, SetupResult, Library, SkillDetail, StatusResult, Subscription, SyncArgs, SyncResult, TeamArgs, TeamResult, UninstallArgs, UninstalledResult, UpdateAdvice, ValidateArgs, ValidateResult } from './types';
export interface Backend {
  setWindowBackground(color: string): Promise<Result<void>>;
  quit(): Promise<void>;
  features(): Promise<Features>;
  windowAction(action: 'toggle-maximize' | 'start-drag'): Promise<Result<void>>;
  openUrl(url: string): Promise<Result<void>>;
  revealPath(path: string): Promise<Result<void>>;
  /** Native folder chooser. `null` is a cancelled dialog, not a failure. */
  pickFolder(): Promise<Result<string | null>>;
  capabilities(): Promise<Capabilities>;
  surfaces(): Promise<Surfaces>;
  launchContext(): Promise<LaunchContext | null>;
  refreshLaunch(): Promise<LaunchContext | null>;
  onLaunchRequest(listener: () => void): Subscription;
  /** Folders dragged from the OS onto the window. The Tauri shell forwards the webview's drag-drop events; the browser mock
   *  reads `text/plain` lines from an HTML5 drop (a browser never exposes a dropped folder's path). */
  onFileDrop(listener: (event: FileDropEvent) => void): Subscription;
  status(q?: undefined, options?: ReadOptions): Promise<Result<StatusResult>>;
  settings(q?: undefined, options?: ReadOptions): Promise<Result<Settings>>;
  onboarding(q?: undefined, options?: ReadOptions): Promise<Result<Onboarding>>;
  skillFile: {move(args:{path:string;to:string}):Run<SkillFileResult>;copy(args:{path:string;to:string}):Run<SkillFileResult>;rename(args:{path:string;to:string}):Run<SkillFileResult>;delete(args:{path:string}):Run<SkillFileResult>;fix(args:{path:string}):Run<SkillFileResult>;
   /** `skill category <path> --to <name>`: rewrites `metadata.terum-category` in that folder's SKILL.md and stops.
    *  It never publishes — a published category lives inside an immutable version — so the team keeps showing what its
    *  newest version declares until the user publishes again. The notices carry that sentence and the command. */
   category(args:{path:string;to:string}):Run<SkillFileResult>};
  /** The per-machine switch behind `capabilities().disablePerMachine`: `skill enable|disable <path>` writes Claude Code's own
   *  `skillOverrides` for the folder's root — the same key the `/skills` menu writes — and the next Library read shows the result. */
  setSkillEnabled(args: { path: string; enabled: boolean }): Run<SkillToggleResult>;
  library(q: { scope: LibraryScope; team?: string }, options?: ReadOptions): Promise<Result<Library>>;
  localSkill(q: { path: string }, options?: ReadOptions): Promise<Result<SkillDetail>>;
  /** §7.1 L-PROJ: the folders this machine reads local skills from. Nothing else adds one. */
  projects: { add(path:string):Run<ProjectAdded>; remove(path:string):Run<ProjectRemoved> };
  reconcile: { list():Promise<Result<ReconcileResult>> };
  /** Team projects (team.json), not the local folders above: `create` names one and commits it to the team's main. */
  teamProjects: { create(args:{name:string;remote?:string}):Run<ProjectCreated> };
  /** `at` restricts the answer to one Library root: presence, path, scope and version describe the
   *  copy in that root, while the install destinations still list every root on the machine.
   *  Omitted keeps the machine-wide answer a deep link, a bookmark or the marketplace needs. */
  skill(q: { ref: string; team?: string; at?: LibraryScope }, options?: ReadOptions): Promise<Result<SkillDetail>>;
  evalReport(q: { ref: string; team?: string }, options?: ReadOptions): Promise<Result<EvalReportModel>>;
  receipts(q: { skillId: string; version: string }, options?: ReadOptions): Promise<Result<Receipt | null>>;
  inbox(q?: undefined, options?: ReadOptions): Promise<Result<InboxItem[]>>;
  catalog(q?: { q?: string }, options?: ReadOptions): Promise<Result<Catalog>>;
  roster(q?: undefined, options?: ReadOptions): Promise<Result<Roster>>;
  search(args: SearchArgs, options?: ReadOptions): Promise<Result<SearchHit[]>>;
  profile(args: { name?: string; bio?: string; role?: string; projects?: string[] }): Run<{ handle: string; changed: string[] }>;
  setIdentity(args: IdentityArgs): Run<IdentityWrite>;
  install(args: InstallArgs): Run<InstalledResult[]>;
  uninstallSkill(args: UninstallArgs): Run<UninstalledResult[]>;
  uninstallMachine(args: Record<string, never>): Run<MachineUninstallResult>;
  publish(args: PublishArgs): Run<PublishResult>;
  /** Retract a skill from the team marketplace. Destructive and team-wide: confirm before calling. */
  unpublish(args: UnpublishArgs): Run<UnpublishResult>;
  sync(args: SyncArgs): Run<SyncResult>;
  prune(): Run<void>;
  invite(args: InviteArgs): Run<InviteResult>;
  team(args: TeamArgs): Run<TeamResult>;
  setup(args: SetupArgs): Run<SetupResult>;
  eval(args: EvalArgs): Run<EvalResult>;
  /** Several skills at once, or every pending one: run now, in batches with a question between them, or queued for a window. */
  evalMany(args: EvalManyArgs): Run<EvalManyResult>;
  validate(args: ValidateArgs, options?: ReadOptions): Promise<Result<ValidateResult>>;
  update(q?: undefined, options?: ReadOptions): Promise<Result<UpdateAdvice>>;
  /** The desktop app's own update channel. Rendered only where `surfaces().appUpdate` is true. */
  appUpdate: {
    check(q?: { force?: boolean }, options?: ReadOptions): Promise<Result<AppUpdateStatus>>;
    stage(version: string): Run<AppUpdateStaged>;
    apply(version: string, reason?: 'manual' | 'overnight'): Promise<Result<void>>;
    armOnClose(version: string): Promise<Result<void>>;
    disarmOnClose(): Promise<Result<void>>;
  };
  diagnostics(): Run<void>;
  openInEditor(path: string): Promise<Result<void>>;
  copyToClipboard(text: string): Promise<Result<void>>;
  copyImage(png: Blob): Promise<Result<void>>;
  readonly prefs: PrefStore;
  subscribe(listener: (source: ChangeSource) => void): Subscription;
}
