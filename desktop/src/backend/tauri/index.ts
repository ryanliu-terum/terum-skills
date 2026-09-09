import { z } from 'zod';
import { openPath } from '@tauri-apps/plugin-opener';
import { writeText, writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { Image } from '@tauri-apps/api/image';
import type { Backend } from '../Backend';
import type { Capabilities, Surfaces, ReadOptions, ChangeSource, ConnectArgs, ConnectOutcome, EvalArgs, EvalResult, InstallArgs, InstalledResult, InviteArgs, InviteResult, MachineUninstallResult, PrefStore, PublishArgs, PublishResult, Result, Run, SearchArgs, SearchHit, SetupArgs, SetupResult, Subscription, SyncArgs, SyncResult, TeamArgs, TeamResult, UninstallArgs, UninstalledResult, ValidateArgs, ValidateResult } from '../types';
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
const cliSearch = z.array(z.object({ team: z.string().optional(), endorsed: z.string().optional(), id: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), unresolved: z.boolean() }).passthrough());

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

  const backend: Backend = {
    async capabilities(): Promise<Capabilities> {
      const platform = await bridge.hostPlatform().catch(() => 'unknown');
      return { windowChrome: platform === 'macos' ? 'mac-overlay' : 'drawn-controls', disablePerMachine: false, inboxEventLog: false, offtargetKind: false, machineRegistry: false, perCaseEvalTables: false, openInEditor: true, clipboard: true };
    },
    async surfaces(): Promise<Surfaces> {
      return { status: false, settings: false, onboarding: false, library: false, skill: false, receipts: false, inbox: false, catalog: false, roster: false, update: false };
    },
    // Read models the CLI cannot produce yet (GAPS.md): the drawn error boards render, nothing is invented.
    status: async () => gap('Team status in the design’s shape (machine, me, teams, counts)'),
    settings: async () => gap('Settings'),
    onboarding: async () => gap('Onboarding data'),
    library: async () => gap('The Library'),
    skill: async () => gap('Skill detail'),
    receipts: async () => gap('Eval receipts'),
    inbox: async () => gap('The Inbox'),
    catalog: async () => gap('The Marketplace catalog'),
    roster: async () => gap('The roster'),
    search: (args: SearchArgs, options?: ReadOptions) => read(run(['search', '--', args.q], cliSearch, (hits): SearchHit[] => hits.map((hit) => ({ kind: 'skill', ref: hit.team === undefined ? hit.name : `${hit.team}/${hit.name}`, name: hit.name, description: '', team: hit.team ?? null, category: hit.category ?? null, author: hit.author ?? null, installs: hit.installs ?? null, latest: hit.latest ?? null, endorsed: hit.endorsed ?? null, unresolved: hit.unresolved ?? null })), []), options).then(result),
    // Long verbs: one process each, questions become dialogs, the CLI's own decline messages come back as `ok:false`.
    install: (args: InstallArgs) => run(['install', ...(!(args.kind === 'member' && args.member || args.kind === 'project' && args.project) && args.force ? ['--force'] : []), ...(args.team ? ['--team', args.team] : []), '--', ...(args.kind === 'member' && args.member ? ['member', args.member] : args.kind === 'project' && args.project ? ['project', args.project] : [args.ref])], cliInstalled, (installed): InstalledResult[] => installed.map((item) => ({ id: item.id, name: item.id, scope: args.scope ?? 'Global' }))),
    uninstallSkill: (args: UninstallArgs) => run(['uninstall-skill', ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliUninstalled, (removed): UninstalledResult[] => removed.map((item) => ({ id: item.id, name: item.id }))),
    uninstallMachine: () => run(['uninstall'], cliMachine, (value): MachineUninstallResult => ({ removed: value.teams })),
    connect: (args: ConnectArgs) => run<z.infer<typeof cliConnect>, ConnectOutcome | undefined>(['connect', ...(args.team ? ['--team', args.team] : []), ...(args.allowPrivileged ? ['--allow-privileged'] : []), ...(args.path ? ['--', args.path] : [])], cliConnect, (value) => value as ConnectOutcome | undefined, ['config', 'clone']),
    publish: (args: PublishArgs) => run(['publish', ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliPublish, (value): PublishResult => ({ name: value.name, version: value.prUrl ?? value.branch ?? null, changed: value.changed ?? true }), ['clone']),
    // Never `--hook` from the app: its stdout is the reload directive (frame mode refuses it anyway).
    sync: (args: SyncArgs) => run(['sync', ...(args.prune ? ['--prune'] : []), ...(args.team ? ['--team', args.team] : [])], cliSync, (value): SyncResult => ({ placed: value.deferred.length || value.placed ? [] : [], removed: [] }), ['clone', 'placed', 'stamp']),
    invite: (args: InviteArgs) => run(['invite', ...(args.team ? ['--team', args.team] : []), ...(args.logins.length ? ['--', ...args.logins] : [])], cliInvite, (value): InviteResult => ({ invited: [...value.invited] }), ['clone']),
    team: (args: TeamArgs) => run(teamArgv(args), cliTeam, (value): TeamResult => ({ name: value.team, kind: args.kind }), ['config', 'clone', 'placed']),
    setup: (args: SetupArgs) => run(['setup', ...(args.target ? ['--', args.target] : [])], cliSetup, (value): SetupResult => ({ team: value.team, role: value.role }), ['config', 'clone', 'placed']),
    eval: (args: EvalArgs) => run(['eval', ...(args.commit ? ['--commit'] : []), ...(args.team ? ['--team', args.team] : []), '--', args.ref], cliEval, (value): EvalResult => ({ name: value.name, receipt: null }), ['clone']),
    validate: (args: ValidateArgs, options?: ReadOptions) => args.ref || args.cwd ? read(run(['validate', ...(args.cwd && args.ref ? ['--cwd', args.cwd] : []), ...(args.team ? ['--team', args.team] : []), '--', args.ref || args.cwd || ''], cliValidate, (value): ValidateResult => value, []), options).then(result) : fail('validate needs a skill name or a folder.'),
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
    case 'create': return ['team', 'create', ...(args.remote ? ['--remote', args.remote] : []), ...(args.name ? ['--', args.name] : [])];
    case 'join': return ['team', 'join', ...(args.remote && args.name ? ['--as', args.name] : []), '--', args.remote ?? args.name ?? ''];
    case 'remove': return ['team', 'remove', ...(args.team ? ['--team', args.team] : []), '--', args.handle ?? ''];
    case 'leave': return ['team', 'leave', '--', args.name ?? args.team ?? ''];
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
