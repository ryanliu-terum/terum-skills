import { z } from 'zod';
import { openPath } from '@tauri-apps/plugin-opener';
import { writeText, writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { Image } from '@tauri-apps/api/image';
import type { Backend } from '../Backend';
import type { Library, SkillCard, SkillDetail, Capabilities, Surfaces, ReadOptions, ChangeSource, ConnectArgs, ConnectOutcome, EvalArgs, EvalResult, InstallArgs, InstalledResult, InviteArgs, InviteResult, MachineUninstallResult, PrefStore, PublishArgs, PublishResult, Result, Run, SearchArgs, SearchHit, SetupArgs, SetupResult, Subscription, SyncArgs, SyncResult, TeamArgs, TeamResult, UninstallArgs, UninstalledResult, ValidateArgs, ValidateResult } from '../types';
import { tauriBridge, type AppState, type Bridge } from './bridge';
import { cliRun } from './run';
import { abbreviateHome } from '../paths';

/**
 * The real adapter: every long verb is one `terum-skills --frames <verb>` process (run.ts). What the CLI has
 * no verb for yet is answered honestly with a failing Result that names GAPS.md, so the screens render their
 * drawn error states instead of fixture data pretending to be real. Mappings between the CLI's result shapes
 * (src/commands/*.ts) and the seam's DTOs (../types) are here and nowhere else.
 */

// The CLI's result shapes, as of terum-skills 0.1.5 (src/commands/*.ts). Validated loosely: only the fields the seam reads.
const cliInstalled = z.array(z.object({ id: z.string(), team: z.string() }).passthrough());
const cliUninstalled = z.array(z.object({ id: z.string(), team: z.string(), removed: z.number() }).passthrough());
const cliMachine = z.object({ teams: z.array(z.string()) }).passthrough();
const cliConnectResult = z.object({ id: z.string(), name: z.string(), reconciled: z.boolean().optional() }).passthrough();
const cliConnect = z.union([z.object({ kind: z.literal('batch'), shared: z.array(cliConnectResult), declined: z.array(z.string()), refused: z.array(z.object({ name: z.string(), reason: z.string() })) }).passthrough(), cliConnectResult]).optional();
const cliPublish = z.object({ name: z.string(), branch: z.string().nullable(), prUrl: z.string().nullable(), changed: z.boolean().optional() }).passthrough();
const cliSync = z.object({ placed: z.number(), deferred: z.array(z.string()) }).passthrough();
const cliInvite = z.object({ team: z.string(), invited: z.array(z.string()) }).passthrough();
const cliTeam = z.object({ team: z.string() }).passthrough();
const cliSetup = z.object({ role: z.enum(['creator', 'joiner']), team: z.string() }).passthrough();
const cliEval = z.object({ name: z.string() }).passthrough();
const cliValidate = z.object({ name: z.string(), findings: z.number(), warnings: z.number() });
const cliSearch = z.array(z.object({ team: z.string().optional(), endorsed: z.string().optional(), id: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), unresolved: z.boolean(), description: z.string(), grants: z.string().nullable(), grantsHash: z.string().nullable(), updated: z.string() }));

const cliScope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('global') }), z.object({ kind: z.literal('project'), project: z.string() })]);
const cliLsSkill = z.object({ id: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), endorsement: z.string(), unresolved: z.boolean(), description: z.string(), grants: z.string().nullable(), grantsHash: z.string().nullable(), updated: z.string(), body: z.string().nullable(), installedBy: z.array(z.object({ handle: z.string(), displayName: z.string(), scope: cliScope, since: z.string() })) });
const cliProject = z.object({ name: z.string(), skills: z.array(z.string()), remotes: z.array(z.string()), description: z.string().optional() }).catchall(z.unknown());
const cliLs = z.object({
  roster: z.array(z.object({ handle: z.string(), active: z.boolean() })), skills: z.array(cliLsSkill), problems: z.array(z.object({ source: z.string(), message: z.string() })), projects: z.array(cliProject).optional(), member: z.object({ handle: z.string(), declined: z.array(z.string()) }).optional(),
  local: z.array(z.object({ root: z.string(), scope: z.enum(['global', 'project']), repoRoot: z.string().optional(), rows: z.array(z.object({ name: z.string(), path: z.string(), state: z.string(), problem: z.string().optional() })), notOffered: z.array(z.object({ name: z.string(), path: z.string(), reason: z.string() })), problems: z.array(z.object({ path: z.string(), reason: z.string() })) })).optional(),
});
const cliStatus = z.object({ version: z.string().nullable(), teams: z.array(z.object({ team: z.string(), handle: z.string(), repository: z.string().nullable(), readable: z.boolean(), sharedSkills: z.number().nullable(), memberCount: z.number().nullable() })) });
type Inventory = z.infer<typeof cliLs>;
type InventorySkill = z.infer<typeof cliLsSkill>;
type InventoryTeam = z.infer<typeof cliStatus>['teams'][number];

// Until S7g supplies structured placement provenance, accept only the CLI's explicit ledger sentence.
function placement(local: Inventory, team: string, name: string) {
  return local.local?.flatMap(section => section.rows.map(row => ({ ...row, scope: section.scope }))).find(row => row.name === name && (row.state === `placement recorded from ${team}` || row.state.startsWith(`placement recorded from ${team} @`)));
}
function inventoryCard(row: InventorySkill, local: Inventory, team: string): SkillCard {
  return { name: row.name, category: row.category, project: row.endorsement === 'global' ? 'Global' : row.endorsement.replace(/^project: /, ''), installs: `${row.installs} installs`, installsN: row.installs, installed: placement(local, team, row.name) !== undefined, desc: row.description, grants: row.grants?.split('\n') ?? null, normalizedGrants: row.grants ?? null, grantsHash: row.grantsHash ?? null, size: '—', tokensK: 0, wlt: null, summary: null, favorite: false, favorites: null, enabled: true, flags: row.unresolved ? ['broken'] : [], flagText: {}, updated: row.updated === '—' ? null : row.updated ?? null, indicators: { broken: { icon: 'alert', token: 'bad', text: 'The skill version could not be resolved.' }, update: { icon: 'arrow-up-circle', token: 'warn', text: '' }, local: { icon: 'pencil', token: 'text3', text: '' } } };
}
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
function inventoryDetail(row: InventorySkill, local: Inventory, team: InventoryTeam, validation: Result<ValidateResult>, inventory: Inventory): SkillDetail {
  const card = inventoryCard(row, local, team.team), placed = placement(local, team.team, row.name);
  const name = row.author.replace(/\s*<[^>]*>$/, '');
  const installers = row.installedBy;
  return { ...card, team: team.team, installScopes: [], projectNames: inventory.projects?.map(project => project.name) ?? null, favorites: null, lines: null, skillRef: `${team.team}/${row.name}`, root: 'Global', desc_long: row.description, files: ['SKILL.md'], size_bytes: '—', version: row.latest, version_full: null, scope: placed?.scope === 'global' ? 'Global' : placed?.scope ?? null, installs_n: row.installs, installed: card.installed,
    used_by: [...new Map(installers.map(person => [person.handle, initials(person.displayName)])).values()], users: installers.map(person => [person.handle, initials(person.displayName), `${person.scope.kind === 'global' ? 'Global' : person.scope.project} · since ${person.since}`]),
    author: { name, handle: '', role: '', initials: initials(name) }, repo: team.repository ?? null, path: placed?.path ?? `skills/${row.name}`, grants_approved: '', receipt: null, history: [], activity: [], hygiene: [], hygieneCaption: validation.value === undefined ? null : `Hygiene checks · ${validation.ok && validation.value.findings === 0 ? 'pass' : 'fail'} on connect`,
    skillMd: { frontmatter: '', body: [], markdown: row.body ?? null }, evalEstimate: null, evalEstimateText: '', evalEstimateTip: '', evalCommand: `npx -y terum-skills@latest eval ${row.name}`, shareCommand: `npx -y terum-skills@latest install ${team.team}/${row.name}`, incumbentLift: null, reportNumbers: null, scoreFractions: { routesExpected: null, roi: null, quality: null }, method: '',
  };
}

const PREF = 'terum-skills-app:pref:';

export function createTauriBackend(bridge: Bridge = tauriBridge()): Backend {
  // Read once per app session; `terum-skills app` rewrites the file on every launch, and the app is launched by it.
  let stateOnce: Promise<AppState | null> | undefined;
  const state = () => (stateOnce ??= bridge.readAppState());
  let homeOnce: Promise<string> | undefined;
  const home = () => (homeOnce ??= bridge.homeDirectory().catch(() => ''));
  async function result<T>(value: Result<T>): Promise<Result<T>> {
    return value.ok ? value : { ...value, error: abbreviateHome(value.error, await home()) };
  }
  const fail = (error: string) => result<never>({ ok: false, error });
  const gap = (what: string) => fail(`${what} is not available from terum-skills yet: the CLI has no verb that returns it (desktop/GAPS.md). The terminal has everything the app shows here.`);
  const listeners = new Set<(source: ChangeSource) => void>();
  const notify = (...sources: ChangeSource[]) => { for (const source of sources) for (const listener of listeners) listener(source); };
  const cwd = () => backend.prefs.get<string>('workspace', '') || undefined;

  function run<TIn, TOut>(argv: readonly string[], schema: z.ZodType<TIn>, map: (value: TIn) => TOut, touches: ChangeSource[] = ['config', 'placed']): Run<TOut> {
    const job = cliRun<unknown, TOut>(bridge, state(), argv, { cwd: cwd(), map: (value) => map(schema.parse(value)), onSettled: (result) => { if (result.ok) notify(...touches); } });
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

  async function inventoryTeam(team: string | undefined, options?: ReadOptions): Promise<Result<InventoryTeam>> {
    const status = await read(run(['status', ...(team ? ['--team', team] : [])], cliStatus, value => value, []), options);
    if (!status.ok) return { ok: false, error: status.error };
    const selected = team ? status.value.teams.find(value => value.team === team) : status.value.teams.length === 1 ? status.value.teams[0] : undefined;
    if (!selected) return fail('Select a team explicitly to read its skills.');
    if (!selected.readable) return fail(`Team ${selected.team} could not be read.`);
    return { ok: true, value: selected };
  }
  const backend: Backend = {
    async capabilities(): Promise<Capabilities> {
      const platform = await bridge.hostPlatform().catch(() => 'unknown');
      return { windowChrome: platform === 'macos' ? 'mac-overlay' : 'drawn-controls', disablePerMachine: false, inboxEventLog: false, offtargetKind: false, machineRegistry: false, perCaseEvalTables: false, openInEditor: true, clipboard: true };
    },
    async surfaces(): Promise<Surfaces> {
      return { status: false, settings: false, onboarding: false, library: true, skill: true, receipts: false, inbox: false, catalog: false, roster: false, update: false };
    },
    // Read models the CLI cannot produce yet (GAPS.md): the drawn error boards render, nothing is invented.
    status: async () => gap('Team status in the design’s shape (machine, me, teams, counts)'),
    settings: async () => gap('Settings'),
    onboarding: async () => gap('Onboarding data'),
    async library({ scope, team }, options) {
      const selected = await inventoryTeam(team, options);
      if (!selected.ok) return fail(selected.error);
      const args = scope.toLowerCase() === 'global' || scope.toLowerCase() === 'installed' ? [] : ['project', scope];
      const inventory = await read(run(['ls', ...args, '--team', selected.value.team], cliLs, value => value, []), options);
      if (!inventory.ok) return fail(inventory.error);
      const local = await read(run(['ls', '--local'], cliLs, value => value, []), options);
      if (!local.ok) return fail(local.error);
      const skills = inventory.value.skills.map(row => inventoryCard(row, local.value, selected.value.team)).filter(row => scope.toLowerCase() !== 'installed' || row.installed);
      const installs = skills.reduce((sum, row) => sum + row.installsN, 0);
      const value: Library = { skills, title: `${skills.length} of ${selected.value.sharedSkills ?? inventory.value.skills.length} skills`, projects: inventory.value.projects ?? [], problems: inventory.value.problems, provenance: null,
        overview: { skills: String(skills.length), skills_note: `${inventory.value.skills.filter(row => row.endorsement === 'global').length} endorsed to Global`, evaluated: '—', meter: { pass_: 0, neutral: 0, fail: 0, total: 0 }, meter_text: '', installs: String(installs), installs_note: `across every readable people file · ${inventory.value.roster.filter(person => person.active).length} active teammate${inventory.value.roster.filter(person => person.active).length === 1 ? '' : 's'}`, attention: '—', attention_lines: [], attention_link: '', zero: { skills: '', evaluated: '', installs: '', attention: '' } },
      };
      return { ok: true, value };
    },
    async skill({ ref, team }, options) {
      const parts = ref.split('/');
      const explicitTeam = team ?? (parts.length === 2 ? parts[0] : undefined);
      const name = parts.length === 2 ? parts[1]! : ref;
      const selected = await inventoryTeam(explicitTeam, options);
      if (!selected.ok) return fail(selected.error);
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
      return { ok: true, value: inventoryDetail(row, local.value, selected.value, validation, inventory.value) };
    },
    receipts: async () => gap('Eval receipts'),
    inbox: async () => gap('The Inbox'),
    catalog: async () => gap('The Marketplace catalog'),
    roster: async () => gap('The roster'),
    search: (args: SearchArgs, options?: ReadOptions) => read(run(['search', args.q], cliSearch, (hits): SearchHit[] => hits.map((hit) => ({ kind: 'skill', ref: hit.team === undefined ? hit.name : `${hit.team}/${hit.name}`, name: hit.name, description: hit.description, team: hit.team ?? null, category: hit.category ?? null, author: hit.author ?? null, installs: hit.installs ?? null, latest: hit.latest ?? null, endorsed: hit.endorsed ?? null, unresolved: hit.unresolved ?? null })), []), options).then(result),
    // Long verbs: one process each, questions become dialogs, the CLI's own decline messages come back as `ok:false`.
    install: (args: InstallArgs) => run([...(args.kind === 'member' && args.member ? ['install', 'member', args.member] : args.kind === 'project' && args.project ? ['install', 'project', args.project] : ['install', args.ref, ...(args.force ? ['--force'] : [])]), ...(args.team ? ['--team', args.team] : [])], cliInstalled, (installed): InstalledResult[] => installed.map((item) => ({ id: item.id, name: item.id, scope: args.scope ?? 'Global' }))),
    uninstallSkill: (args: UninstallArgs) => run(['uninstall-skill', args.ref, ...(args.team ? ['--team', args.team] : [])], cliUninstalled, (removed): UninstalledResult[] => removed.map((item) => ({ id: item.id, name: item.id }))),
    uninstallMachine: () => run(['uninstall'], cliMachine, (value): MachineUninstallResult => ({ removed: value.teams })),
    connect: (args: ConnectArgs) => run<z.infer<typeof cliConnect>, ConnectOutcome | undefined>(['connect', ...(args.path ? [args.path] : []), ...(args.team ? ['--team', args.team] : []), ...(args.allowPrivileged ? ['--allow-privileged'] : [])], cliConnect, (value) => value as ConnectOutcome | undefined, ['config', 'clone']),
    publish: (args: PublishArgs) => run(['publish', args.ref, ...(args.team ? ['--team', args.team] : [])], cliPublish, (value): PublishResult => ({ name: value.name, version: value.prUrl ?? value.branch ?? null, changed: value.changed ?? true }), ['clone']),
    // Never `--hook` from the app: its stdout is the reload directive (frame mode refuses it anyway).
    sync: (args: SyncArgs) => run(['sync', ...(args.prune ? ['--prune'] : []), ...(args.team ? ['--team', args.team] : [])], cliSync, (value): SyncResult => ({ placed: value.deferred.length || value.placed ? [] : [], removed: [] }), ['clone', 'placed', 'stamp']),
    invite: (args: InviteArgs) => run(['invite', ...args.logins, ...(args.team ? ['--team', args.team] : [])], cliInvite, (value): InviteResult => ({ invited: [...value.invited] }), ['clone']),
    team: (args: TeamArgs) => run(teamArgv(args), cliTeam, (value): TeamResult => ({ name: value.team, kind: args.kind }), ['config', 'clone', 'placed']),
    setup: (args: SetupArgs) => run(['setup', ...(args.target ? [args.target] : [])], cliSetup, (value): SetupResult => ({ team: value.team, role: value.role }), ['config', 'clone', 'placed']),
    eval: (args: EvalArgs) => run(['eval', args.ref, ...(args.commit ? ['--commit'] : []), ...(args.team ? ['--team', args.team] : [])], cliEval, (value): EvalResult => ({ name: value.name, receipt: null }), ['clone']),
    validate: (args: ValidateArgs, options?: ReadOptions) => args.ref || args.cwd ? read(run(['validate', args.ref || args.cwd || '', ...(args.cwd && args.ref ? ['--cwd', args.cwd] : []), ...(args.team ? ['--team', args.team] : [])], cliValidate, (value): ValidateResult => value, []), options).then(result) : fail('validate needs a skill name or a folder.'),
    // `update` prints its advice and returns no value; the printed lines are the advice. The seam wants numbers the CLI does not return.
    update: async () => gap('Update advice as structured data'),
    async openInEditor(path) { try { await openPath(path); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async copyToClipboard(text) { try { await writeText(text); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    async copyImage(png) { try { await writeImage(await Image.fromBytes(new Uint8Array(await png.arrayBuffer()))); return { ok: true, value: undefined }; } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } },
    // The webview's own storage is app-owned and survives relaunches; same key scheme as the mock so a preference set in one mode reads in the other.
    prefs: prefStore(),
    subscribe(listener): Subscription { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return backend;
}

function teamArgv(args: TeamArgs): string[] {
  switch (args.kind) {
    case 'create': return ['team', 'create', ...(args.name ? [args.name] : []), ...(args.remote ? ['--remote', args.remote] : [])];
    case 'join': return ['team', 'join', args.remote ?? args.name ?? '', ...(args.remote && args.name ? ['--as', args.name] : [])];
    case 'remove': return ['team', 'remove', args.handle ?? '', ...(args.team ? ['--team', args.team] : [])];
    case 'leave': return ['team', 'leave', args.name ?? args.team ?? ''];
  }
}

function prefStore(): PrefStore {
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = localStorage.getItem(PREF + key);
        if (raw === null) return fallback;
        const parsed: unknown = JSON.parse(raw);
        return (parsed === null) === (fallback === null) && typeof parsed === typeof fallback && Array.isArray(parsed) === Array.isArray(fallback) ? (parsed as T) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      const text = JSON.stringify(z.json().parse(value));
      if (text === undefined) throw new Error('Preference must be JSON-safe.');
      localStorage.setItem(PREF + key, text);
    },
  };
}

/** Drive a read-only run without answering questions, retaining diagnostics and partial values. */
export async function read<T>(job: Run<T>, options?: ReadOptions): Promise<Result<T>> {
  const signal = options?.signal;
  const cancel = () => { void job.cancel(); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const lines: string[] = [];
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
