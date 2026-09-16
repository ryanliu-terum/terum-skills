import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { explainGhFailure } from '../lib/auth.js';
import { createConfigStore, type ConfigStore } from '../lib/config.js';
import { exists, mkdirPrivate, retryTransient, writeJsonPrivate, type TransientRetry } from '../lib/fs.js';
import { invocation, type WithForm } from '../lib/invocation.js';
import type { Launch } from '../lib/launch.js';
import { packageVersion } from '../lib/package.js';
import { assetSuffix, detectPlatform, type AppPlatform, type PlatformEvidence } from '../lib/platform.js';
import type { Prompter } from '../lib/prompt.js';
import { failure, success, type Result } from '../lib/result.js';
import { execCommand, systemRunner, type Exec, type Runner } from '../lib/runner.js';
import { compare } from '../lib/update.js';

/**
 * `terum-skills app` (decision walk 2026-09-08, D1 D3 D7 D8): make sure this version's desktop app is on the
 * machine, record where this CLI is so the app can drive it, and open it. The app is downloaded from this
 * repository's GitHub Release for the CLI's own version (release.yml builds it there before npm publish, D2),
 * through `gh release download` so no HTTP client enters the CLI. Files written by gh carry no macOS quarantine
 * flag, so the app opens without a Gatekeeper dialog. On macOS the bundle lives at `~/Applications/Terum Skills.app`
 * (2026-09-15, revising the 2026-09-08 "unpack into ~/.terum/app" clause): a visible, Spotlight-indexed path that
 * stays the same across updates so a Dock pin survives them. `~/.terum/skills/app/<version>/` keeps only the
 * download records, the way Windows keeps them beside the per-user install under %LOCALAPPDATA%.
 */
export const APP_REPOSITORY = 'ryanliu-terum/terum-skills';
export const APP_SLUG = 'terum-skills-desktop';
export const APP_PRODUCT = 'Terum Skills';
/** The macOS bundle's fixed home is `<Applications>/Terum Skills.app`; `Applications` defaults to the per-user folder (no admin rights, mirrors the Windows per-user install). */
export const APP_BUNDLE = `${APP_PRODUCT}.app`;
export const applicationsDirectory = (override?: string): string => override ?? join(homedir(), 'Applications');
/** The opt-in wording setup shows first (decision walk D4, Ryan's words, 2026-09-08). */
export const APP_OFFER = ["Terum Skills also has a desktop app. It is a wrapper around these same commands with a visual view of your team's skills. Everything works from the terminal without it."];
export const APP_QUESTION = 'Download and open the app?';

export interface AppArgs extends WithForm {
  config?: ConfigStore;
  runner?: Runner;
  exec?: Exec;
  launch?: Launch;
  home?: string;
  version?: string | null;
  evidence?: PlatformEvidence;
  /** The absolute Node binary and CLI entry the app will be told to run; defaults to this process. */
  node?: string;
  entry?: string;
  /** Launch PATH and setup join target; PATH defaults to this process. */
  path?: string | null;
  target?: string; intent?: 'setup';
  /** Ask first. Setup no longer asks (auto-launch, Teddy 2026-09-09); kept for callers that want the opt-in. A no is recorded and returns `action: 'declined'` without touching the network. */
  offer?: boolean;
  /** Test knob: skip opening the app (everything else runs). */
  open?: boolean;
  /** Test knob: where the Windows per-user install lands. */
  localAppData?: string;
  /** Test knob: the folder the macOS bundle is placed in (default `~/Applications`). */
  applicationsDir?: string;
  /** Test knobs: the clock for the leftover-download sweep, and the wait between Windows retries. */
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface AppResult {
  platform: AppPlatform;
  version: string;
  action: 'launched' | 'installed-and-launched' | 'unavailable' | 'declined';
  appPath: string | null;
  statePath: string | null;
  emulation?: 'win32-arm64-on-x64' | null;
}

/** `~/.terum/skills/run/app.json`: what desktop/src/backend/tauri/bridge.ts reads (schema 1). */
export interface AppState { schema: 1; node: string; entry: string; path: string | null; version: string; writtenAt: string; target?: string; intent?: 'setup'; }

const tail = (form: WithForm['form']) => `Everything works from the terminal. Run \`${invocation(form, 'app')}\` later to try again.`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
/** Move and remove, retried on the Windows transient codes (see retryTransient); `rm -rf` semantics for the removal. */
export const moveRetrying = (from: string, to: string, retry: TransientRetry): Promise<void> => retryTransient(() => rename(from, to), retry);
export const removeRetrying = (path: string, retry: TransientRetry): Promise<void> => retryTransient(() => rm(path, { recursive: true, force: true }), retry);

export async function run(args: AppArgs, io: Prompter): Promise<Result<AppResult>> {
  const version = args.version === undefined ? packageVersion() : args.version;
  if (!version) return failure('This copy of terum-skills has no version; the desktop app is published per version.');
  const evidence = args.evidence ?? { platform: process.platform, arch: process.arch, env: process.env, procVersion: await readProcVersion() };
  const platform = detectPlatform(evidence);
  const suffix = assetSuffix(platform);
  if (!suffix) {
    // D3: honest and quiet; exit 0 because nothing failed.
    if (platform === 'wsl') io.print('The desktop app runs on the Windows side of this machine, not inside WSL. Install terum-skills there and run this command from a Windows terminal; from here, everything works in the terminal.');
    else if (platform === 'linux') io.print('There is no Linux desktop app yet; everything works from the terminal.');
    else io.print('There is no desktop app for this machine; everything works from the terminal.');
    return success({ platform, version, action: 'unavailable', appPath: null, statePath: null, emulation: null });
  }

  const store = args.config ?? createConfigStore();
  if (args.offer) {
    for (const line of APP_OFFER) io.print(line);
    if (!(await io.confirm(APP_QUESTION))) {
      // D4: a no is remembered as a fact, not as a suppression; setup asks again next run.
      await store.update((config) => { config.app = { choice: 'declined', at: new Date().toISOString() }; });
      return success({ platform, version, action: 'declined', appPath: null, statePath: null, emulation: null });
    }
  }
  const runner = args.runner ?? systemRunner;
  const exec = args.exec ?? execCommand;
  const root = store.root;
  const appRoot = join(root, 'app');
  const versionDir = join(appRoot, version);
  const applications = applicationsDirectory(args.applicationsDir);
  const asset = `${APP_SLUG}_${version}_${suffix}`;
  const retry: TransientRetry = { windows: platform.startsWith('win32'), ...(args.sleep === undefined ? {} : { sleep: args.sleep }) };
  let installedNow = false;

  try {
    await store.ensureRoot();
    await mkdirPrivate(appRoot);
    if (await needsInstall(platform, version, versionDir, args.localAppData, applications)) {
      await sweepStaleDownloads(appRoot, args.now ?? Date.now);
      const staging = await mkdtemp(join(appRoot, '.download-'));
      try {
        io.print(`Downloading ${APP_PRODUCT} ${version} for ${platform}…`);
        // A runner that cannot start gh rejects rather than resolving; it must reach the same per-cause wording (D7) as a non-zero exit.
        const download = await runner.run('gh', ['release', 'download', `v${version}`, '--repo', APP_REPOSITORY, '--pattern', asset, '--pattern', `${asset}.sha256`, '--dir', staging], { deadlineMs: 600_000 }).catch((error: unknown) => ({ code: 1, stdout: '', stderr: message(error) }));
        if (download.code === 124) return failure(`Downloading the desktop app took longer than 10 minutes and was stopped. ${tail(args.form)}`);
        if (download.code !== 0) return failure(await explainDownloadFailure(download.stderr || download.stdout, version, asset, runner, args.form));
        const file = join(staging, asset);
        if (!(await exists(file)) || !(await exists(`${file}.sha256`))) return failure(`No desktop app is published for terum-skills ${version} (looked for ${asset} on release v${version} of ${APP_REPOSITORY}). ${tail(args.form)}`);
        const expected = (await readFile(`${file}.sha256`, 'utf8')).trim().split(/\s+/)[0]?.toLowerCase();
        const actual = createHash('sha256').update(await readFile(file)).digest('hex');
        if (!expected || expected !== actual) return failure(`The downloaded desktop app did not match its published checksum, so it was discarded (expected ${expected ?? 'nothing readable'}, got ${actual}). ${tail(args.form)}`);
        // Unpack (macOS: and place the bundle) or install from the staging directory, then move the record into place in one rename so <version>/ only ever exists complete.
        let bundle: string | null = null;
        if (platform.startsWith('darwin')) {
          const unpack = await exec('tar', ['-xzf', file, '-C', staging]);
          if (unpack.code !== 0) return failure(`Could not unpack the desktop app: ${(unpack.stderr || unpack.stdout).trim()} ${tail(args.form)}`);
          await rm(file, { force: true }); await rm(`${file}.sha256`, { force: true });
          bundle = (await readdir(staging)).find((name) => name.endsWith('.app')) ?? null;
          if (!bundle) return failure(`The downloaded archive did not contain an application bundle. ${tail(args.form)}`);
          await placeBundle(join(staging, bundle), applications, retry);
        } else {
          // Windows (x64 and ARM64): the asset is a per-user NSIS installer; /S installs silently under %LOCALAPPDATA% with no elevation (D8).
          const install = await exec(file, ['/S']);
          if (install.code !== 0) return failure(`The desktop app installer exited with code ${install.code}. ${(install.stderr || install.stdout).trim()} ${tail(args.form)}`.trim());
        }
        const record = JSON.stringify({ schema: 1, version, platform, bundle, installedAt: new Date().toISOString() }, null, 2);
        await writeFile(join(staging, 'installed.json'), record);
        // Windows still holds the installer it just ran for a moment (EPERM on the move; measured ~200 ms), hence the retries.
        await removeRetrying(versionDir, retry);
        try { await moveRetrying(staging, versionDir, retry); }
        catch (error) {
          // Windows only, and only once the installer has succeeded: the app is on the machine, so the version record
          // lands on its own rather than turning a finished install into a failure. The held folder holds nothing the
          // app needs (the installer copied everything under %LOCALAPPDATA%); the cleanup below and later sweeps remove it.
          if (!platform.startsWith('win32')) throw error;
          io.print(`The download folder ${staging} is still in use (${message(error)}); the install is recorded without it.`);
          await mkdirPrivate(versionDir);
          await writeFile(join(versionDir, 'installed.json'), record);
        }
        installedNow = true;
      } finally {
        await removeStaging(staging, retry, io);
      }
    }

    const appPath = await locateApp(platform, args.localAppData, applications);
    if (!appPath) return failure(`The desktop app ${version} is installed but its executable was not found where it should be (${platform.startsWith('win32') ? join(args.localAppData ?? process.env['LOCALAPPDATA'] ?? '%LOCALAPPDATA%', APP_PRODUCT) : join(applications, APP_BUNDLE)}). ${tail(args.form)}`);

    // D1: the app finds Node and this CLI through this file, on every launch, so a relaunch from the Dock a week later still works.
    const statePath = join(root, 'run', 'app.json');
    const emulation = platform === 'win32-arm64' && evidence.arch === 'x64' ? 'win32-arm64-on-x64' : null;
    if (emulation) io.print(`This machine has an ARM64 processor but you are running an x64 build of Node, so terum-skills and everything the desktop app starts will run under emulation. Install the ARM64 build of Node from nodejs.org, then run \`${invocation(args.form, 'app')}\` again to record it.`);
    await writeState(statePath, { schema: 1, node: args.node ?? process.execPath, entry: args.entry ?? (args.launch?.path ?? process.argv[1] ?? ''), path: args.path === undefined ? process.env.PATH ?? null : args.path, version, writtenAt: new Date().toISOString(), ...(args.target === undefined ? {} : { target: args.target }), ...(args.intent === undefined ? {} : { intent: args.intent }) });
    // D4: running `app` explicitly is opting in; setup will not ask again.
    await store.update((config) => { config.app = { choice: 'opted-in', at: new Date().toISOString() }; });

    if (args.open !== false) {
      // macOS: `open` returns once Launch Services has the app. Windows: the exe IS the app, so start it detached
      // rather than waiting for the window to close (a blocking launch held setup until the app quit).
      const opened = platform.startsWith('darwin') ? await exec('open', [appPath]) : await exec(appPath, [], { detach: true });
      if (opened.code !== 0) return failure(`Could not open ${APP_PRODUCT}: ${(opened.stderr || opened.stdout).trim()} ${tail(args.form)}`.trim());
    }
    io.print(`${installedNow ? 'Installed and opened' : 'Opened'} ${APP_PRODUCT} ${version}.`);
    return success({ platform, version, action: installedNow ? 'installed-and-launched' : 'launched', appPath, statePath, emulation });
  } catch (error) {
    return failure(`${message(error)} ${tail(args.form)}`);
  }
}

/**
 * Download folders older than an hour are leftovers (a killed frame child cannot run its finally; a held installer
 * outlived its retries); a recent one may still belong to a sibling still downloading. One that still cannot be
 * removed just waits for the next sweep: nothing here blocks the install that is about to start.
 */
export async function sweepStaleDownloads(appRoot: string, now: () => number): Promise<void> {
  for (const name of await readdir(appRoot).catch(() => [] as string[])) {
    if (!name.startsWith('.download-')) continue;
    const path = join(appRoot, name);
    try { if ((await stat(path)).mtimeMs < now() - 3_600_000) await rm(path, { recursive: true, force: true }); }
    catch { /* Still held, or gone since readdir: the next sweep tries again. */ }
  }
}

/**
 * After a successful move into place the staging folder no longer exists and this is a no-op. A folder Windows
 * still holds is reported and left for `sweepStaleDownloads`, never fatal: the install outcome decided above is
 * what matters, and the folder contains only the download.
 */
export async function removeStaging(staging: string, retry: TransientRetry, io: Prompter): Promise<void> {
  try { await removeRetrying(staging, retry); }
  catch (error) { io.print(`Could not remove the download folder ${staging} (${message(error)}); it is removed on a later update check.`); }
}

/**
 * Install when this version has no record or its executable is gone (the bundle dragged to the Trash, the Windows
 * app removed from Settings): a record alone cannot vouch for the app. A macOS bundle at the fixed path that is
 * already this version or newer (the app updated itself) is kept as it is; `app` never downgrades it.
 */
export async function needsInstall(platform: AppPlatform, version: string, versionDir: string, localAppData: string | undefined, applications: string): Promise<boolean> {
  if (platform.startsWith('darwin')) {
    const current = await bundleVersion(join(applications, APP_BUNDLE));
    if (current !== null) return (compare(current, version) ?? -1) < 0;
  }
  return !(await exists(join(versionDir, 'installed.json'))) || (await locateApp(platform, localAppData, applications)) === null;
}

/** CFBundleShortVersionString from the bundle's Info.plist (Tauri writes the plain XML form); null without a readable one. */
export async function bundleVersion(bundlePath: string): Promise<string | null> {
  try { return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(await readFile(join(bundlePath, 'Contents', 'Info.plist'), 'utf8'))?.[1]?.trim() ?? null; }
  catch { return null; }
}

/**
 * Moves an unpacked bundle onto its fixed path. The bundle already there is renamed aside first and removed last,
 * so a failure in the middle puts it back and the machine never ends up with no app. Installs (`app`) and updates
 * (`app-update --apply-now`) both go through here; `open` then gets the fixed path, which is also what a Dock pin holds.
 */
export async function placeBundle(from: string, applications: string, retry: TransientRetry): Promise<string> {
  const target = join(applications, APP_BUNDLE), aside = join(applications, `.${APP_BUNDLE}.previous`);
  await mkdir(applications, { recursive: true });
  // A leftover aside from an interrupted earlier swap: best effort, because if it stays the rename below fails with the bundle in place still untouched.
  await removeRetrying(aside, retry).catch(() => undefined);
  const replacing = await exists(target);
  if (replacing) await moveRetrying(target, aside, retry);
  try { await moveRetrying(from, target, retry); }
  catch (error) { if (replacing) await moveRetrying(aside, target, retry).catch(() => undefined); throw error; }
  await removeRetrying(aside, retry).catch(() => undefined);
  return target;
}

export async function locateApp(platform: AppPlatform, localAppData: string | undefined, applications: string): Promise<string | null> {
  if (platform.startsWith('darwin')) {
    const bundle = join(applications, APP_BUNDLE);
    return (await exists(bundle)) ? bundle : null;
  }
  const base = localAppData ?? process.env['LOCALAPPDATA'];
  if (!base) return null;
  const exe = join(base, APP_PRODUCT, `${APP_SLUG}.exe`);
  return (await exists(exe)) ? exe : null;
}

async function writeState(path: string, state: AppState): Promise<void> { await writeJsonPrivate(path, state); }

async function readProcVersion(): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  try { return await readFile('/proc/version', 'utf8'); } catch { return null; }
}

/** The tag is advertised but its release carries no assets yet: release.yml pushes the tag before it creates the Release. */
export const RELEASE_ASSETS_MISSING = /release not found|Not Found \(HTTP 404\)|no assets match/i;

/** D7: one sentence per cause, and always the same two next steps. */
export async function explainDownloadFailure(output: string, version: string, asset: string, runner: Runner, form: WithForm['form']): Promise<string> {
  const text = output.trim();
  const gh = await explainGhFailure(runner);
  if (gh) return `${gh} ${tail(form)}`;
  if (RELEASE_ASSETS_MISSING.test(text)) return `No desktop app is published for terum-skills ${version} (looked for ${asset} on release v${version} of ${APP_REPOSITORY}). ${tail(form)}`;
  if (/dial tcp|no such host|connection refused|network is unreachable|TLS handshake timeout|i\/o timeout|could not resolve/i.test(text)) return `Could not reach GitHub to download the desktop app; you appear to be offline or behind a proxy that blocks github.com. ${tail(form)}`;
  return `Could not download the desktop app: ${text || 'gh reported no detail'}. ${tail(form)}`;
}

export { readState as readAppState };
type ReadAppState = Omit<AppState, 'path'> & { path?: string | null };
async function readState(root = join(homedir(), '.terum', 'skills')): Promise<ReadAppState | null> {
  try { return JSON.parse(await readFile(join(root, 'run', 'app.json'), 'utf8')) as ReadAppState; } catch { return null; }
}
