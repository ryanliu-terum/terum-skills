import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { explainGhFailure } from '../lib/auth.js';
import { createConfigStore, type ConfigStore } from '../lib/config.js';
import { exists, mkdirPrivate } from '../lib/fs.js';
import { invocation, type WithForm } from '../lib/invocation.js';
import type { Launch } from '../lib/launch.js';
import { packageVersion } from '../lib/package.js';
import { assetSuffix, detectPlatform, type AppPlatform, type PlatformEvidence } from '../lib/platform.js';
import type { Prompter } from '../lib/prompt.js';
import { failure, success, type Result } from '../lib/result.js';
import { execCommand, systemRunner, type Exec, type Runner } from '../lib/runner.js';

/**
 * `terum-skills app` (decision walk 2026-09-08, D1 D3 D7 D8): make sure this version's desktop app is on the
 * machine, record where this CLI is so the app can drive it, and open it. The app is downloaded from this
 * repository's GitHub Release for the CLI's own version (release.yml builds it there before npm publish, D2),
 * through `gh release download` so no HTTP client enters the CLI. Files written by gh carry no macOS quarantine
 * flag, so the app opens without a Gatekeeper dialog.
 */
export const APP_REPOSITORY = 'ryanliu-terum/terum-skills';
export const APP_SLUG = 'terum-skills-desktop';
export const APP_PRODUCT = 'Terum Skills';
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
  target?: string;
  /** Ask first (setup's opt-in, default no). A no is recorded and returns `action: 'declined'` without touching the network. */
  offer?: boolean;
  /** Test knob: skip opening the app (everything else runs). */
  open?: boolean;
  /** Test knob: where the Windows per-user install lands. */
  localAppData?: string;
}

export interface AppResult {
  platform: AppPlatform;
  version: string;
  action: 'launched' | 'installed-and-launched' | 'unavailable' | 'declined';
  appPath: string | null;
  statePath: string | null;
}

/** `~/.terum/skills/run/app.json`: what desktop/src/backend/tauri/bridge.ts reads (schema 1). */
export interface AppState { schema: 1; node: string; entry: string; path: string | null; version: string; writtenAt: string; target?: string; }

const tail = (form: WithForm['form']) => `Everything works from the terminal. Run \`${invocation(form, 'app')}\` later to try again.`;

export async function run(args: AppArgs, io: Prompter): Promise<Result<AppResult>> {
  const version = args.version === undefined ? packageVersion() : args.version;
  if (!version) return failure('This copy of terum-skills has no version; the desktop app is published per version.');
  const platform = detectPlatform(args.evidence ?? { platform: process.platform, arch: process.arch, procVersion: await readProcVersion() });
  const suffix = assetSuffix(platform);
  if (!suffix) {
    // D3: honest and quiet; exit 0 because nothing failed.
    if (platform === 'wsl') io.print('The desktop app runs on the Windows side of this machine, not inside WSL. Install terum-skills there and run this command from a Windows terminal; from here, everything works in the terminal.');
    else if (platform === 'linux') io.print('There is no Linux desktop app yet; everything works from the terminal.');
    else if (platform === 'win32-x64') io.print('There is no Windows x64 desktop app yet (the first builds are Apple Silicon, Intel Mac, and Windows on ARM); everything works from the terminal.');
    else io.print('There is no desktop app for this machine; everything works from the terminal.');
    return success({ platform, version, action: 'unavailable', appPath: null, statePath: null });
  }

  const store = args.config ?? createConfigStore();
  if (args.offer) {
    for (const line of APP_OFFER) io.print(line);
    if (!(await io.confirm(APP_QUESTION))) {
      // D4: a no is remembered as a fact, not as a suppression; setup asks again next run.
      await store.update((config) => { config.app = { choice: 'declined', at: new Date().toISOString() }; });
      return success({ platform, version, action: 'declined', appPath: null, statePath: null });
    }
  }
  const runner = args.runner ?? systemRunner;
  const exec = args.exec ?? execCommand;
  const root = store.root;
  const appRoot = join(root, 'app');
  const versionDir = join(appRoot, version);
  const asset = `${APP_SLUG}_${version}_${suffix}`;
  let installedNow = false;

  try {
    await store.ensureRoot();
    await mkdirPrivate(appRoot);
    if (!(await exists(join(versionDir, 'installed.json')))) {
      const staging = await mkdtemp(join(appRoot, '.download-'));
      try {
        io.print(`Downloading ${APP_PRODUCT} ${version} for ${platform}…`);
        const download = await runner.run('gh', ['release', 'download', `v${version}`, '--repo', APP_REPOSITORY, '--pattern', asset, '--pattern', `${asset}.sha256`, '--dir', staging], { deadlineMs: 600_000 });
        if (download.code !== 0) return failure(await explainDownloadFailure(download.stderr || download.stdout, version, asset, runner, args.form));
        const file = join(staging, asset);
        if (!(await exists(file)) || !(await exists(`${file}.sha256`))) return failure(`No desktop app is published for terum-skills ${version} (looked for ${asset} on release v${version} of ${APP_REPOSITORY}). ${tail(args.form)}`);
        const expected = (await readFile(`${file}.sha256`, 'utf8')).trim().split(/\s+/)[0]?.toLowerCase();
        const actual = createHash('sha256').update(await readFile(file)).digest('hex');
        if (!expected || expected !== actual) return failure(`The downloaded desktop app did not match its published checksum, so it was discarded (expected ${expected ?? 'nothing readable'}, got ${actual}). ${tail(args.form)}`);
        // Unpack or install into the staging directory, then move it into place in one rename so <version>/ only ever exists complete.
        if (platform.startsWith('darwin')) {
          const unpack = await exec('tar', ['-xzf', file, '-C', staging]);
          if (unpack.code !== 0) return failure(`Could not unpack the desktop app: ${(unpack.stderr || unpack.stdout).trim()} ${tail(args.form)}`);
          await rm(file, { force: true }); await rm(`${file}.sha256`, { force: true });
          const bundle = (await readdir(staging)).find((name) => name.endsWith('.app'));
          if (!bundle) return failure(`The downloaded archive did not contain an application bundle. ${tail(args.form)}`);
          await writeFile(join(staging, 'installed.json'), JSON.stringify({ schema: 1, version, platform, bundle, installedAt: new Date().toISOString() }, null, 2));
        } else {
          // Windows on ARM: the asset is a per-user NSIS installer; /S installs silently under %LOCALAPPDATA% with no elevation (D8).
          const install = await exec(file, ['/S']);
          if (install.code !== 0) return failure(`The desktop app installer exited with code ${install.code}. ${(install.stderr || install.stdout).trim()} ${tail(args.form)}`.trim());
          await writeFile(join(staging, 'installed.json'), JSON.stringify({ schema: 1, version, platform, bundle: null, installedAt: new Date().toISOString() }, null, 2));
        }
        await rm(versionDir, { recursive: true, force: true });
        await rename(staging, versionDir);
        installedNow = true;
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }

    const appPath = await locateApp(platform, versionDir, args.localAppData);
    if (!appPath) return failure(`The desktop app ${version} is installed but its executable was not found where it should be (${platform === 'win32-arm64' ? join(args.localAppData ?? process.env['LOCALAPPDATA'] ?? '%LOCALAPPDATA%', APP_PRODUCT) : versionDir}). ${tail(args.form)}`);

    // D1: the app finds Node and this CLI through this file, on every launch, so a relaunch from the Dock a week later still works.
    const statePath = join(root, 'run', 'app.json');
    await writeState(statePath, { schema: 1, node: args.node ?? process.execPath, entry: args.entry ?? (args.launch?.path ?? process.argv[1] ?? ''), path: args.path === undefined ? process.env.PATH ?? null : args.path, version, writtenAt: new Date().toISOString(), ...(args.target === undefined ? {} : { target: args.target }) });
    // D4: running `app` explicitly is opting in; setup will not ask again.
    await store.update((config) => { config.app = { choice: 'opted-in', at: new Date().toISOString() }; });

    if (args.open !== false) {
      const opened = platform.startsWith('darwin') ? await exec('open', [appPath]) : await exec(appPath, []);
      if (opened.code !== 0) return failure(`Could not open ${APP_PRODUCT}: ${(opened.stderr || opened.stdout).trim()} ${tail(args.form)}`.trim());
    }
    io.print(`${installedNow ? 'Installed and opened' : 'Opened'} ${APP_PRODUCT} ${version}.`);
    return success({ platform, version, action: installedNow ? 'installed-and-launched' : 'launched', appPath, statePath });
  } catch (error) {
    return failure(`${error instanceof Error ? error.message : String(error)} ${tail(args.form)}`);
  }
}

async function locateApp(platform: AppPlatform, versionDir: string, localAppData: string | undefined): Promise<string | null> {
  if (platform.startsWith('darwin')) {
    const bundle = (await readdir(versionDir).catch(() => [] as string[])).find((name) => name.endsWith('.app'));
    return bundle ? join(versionDir, bundle) : null;
  }
  const base = localAppData ?? process.env['LOCALAPPDATA'];
  if (!base) return null;
  const exe = join(base, APP_PRODUCT, `${APP_SLUG}.exe`);
  return (await exists(exe)) ? exe : null;
}

async function writeState(path: string, state: AppState): Promise<void> {
  await mkdirPrivate(dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function readProcVersion(): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  try { return await readFile('/proc/version', 'utf8'); } catch { return null; }
}

/** D7: one sentence per cause, and always the same two next steps. */
async function explainDownloadFailure(output: string, version: string, asset: string, runner: Runner, form: WithForm['form']): Promise<string> {
  const text = output.trim();
  const gh = await explainGhFailure(runner);
  if (gh) return `${gh} ${tail(form)}`;
  if (/release not found|Not Found \(HTTP 404\)|no assets match/i.test(text)) return `No desktop app is published for terum-skills ${version} (looked for ${asset} on release v${version} of ${APP_REPOSITORY}). ${tail(form)}`;
  if (/dial tcp|no such host|connection refused|network is unreachable|TLS handshake timeout|i\/o timeout|could not resolve/i.test(text)) return `Could not reach GitHub to download the desktop app; you appear to be offline or behind a proxy that blocks github.com. ${tail(form)}`;
  return `Could not download the desktop app: ${text || 'gh reported no detail'}. ${tail(form)}`;
}

export { readState as readAppState };
type ReadAppState = Omit<AppState, 'path'> & { path?: string | null };
async function readState(root = join(homedir(), '.terum', 'skills')): Promise<ReadAppState | null> {
  try { return JSON.parse(await readFile(join(root, 'run', 'app.json'), 'utf8')) as ReadAppState; } catch { return null; }
}
