import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfigStore, type ConfigStore } from '../lib/config.js';
import { exists, mkdirPrivate, writeJsonPrivate } from '../lib/fs.js';
import { invocation, type WithForm } from '../lib/invocation.js';
import type { Launch } from '../lib/launch.js';
import { packageVersion } from '../lib/package.js';
import { assetSuffix, detectPlatform, type AppPlatform, type PlatformEvidence } from '../lib/platform.js';
import type { Prompter } from '../lib/prompt.js';
import { failure, success, type Result } from '../lib/result.js';
import { execCommand, systemRunner, type Exec, type Runner } from '../lib/runner.js';
import { compare, createReleaseState, describeUpdate, maintainReleaseState, probePolicy, type ProbePolicy, type ReleaseStateStore } from '../lib/update.js';
import { APP_PRODUCT, APP_REPOSITORY, APP_SLUG, RELEASE_ASSETS_MISSING, explainDownloadFailure, locateApp } from './app.js';

export interface AppUpdateArgs extends WithForm {
  check?: boolean; stage?: boolean; apply?: boolean; applyNow?: boolean;
  release?: string; force?: boolean; awaitPid?: string | number; reason?: string;
  /** Injected seams; identical in shape to AppArgs so both verbs test the same way. */
  config?: ConfigStore; runner?: Runner; exec?: Exec; state?: ReleaseStateStore; probe?: ProbePolicy;
  launch?: Launch; evidence?: PlatformEvidence; now?: () => number;
  /** Test knobs. */
  node?: string; entry?: string; localAppData?: string; waitMs?: number; pollMs?: number;
  /** Test knob: liveness probe for --apply-now (default process.kill(pid, 0)). */
  alive?: (pid: number) => boolean;
}
export type AppUpdatePhase = 'waiting' | 'installing' | 'launched' | 'failed';
export type AppUpdateReason = 'on-close' | 'overnight' | 'manual';
export interface AppUpdateMarker { reason?: AppUpdateReason; schema: 1; version: string; phase: AppUpdatePhase; at: string; error: string | null }
export interface AppUpdateCheck {
  mode: 'check'; platform: AppPlatform; supported: boolean;
  cliVersion: string | null; latest: string | null; latestAt: string | null;
  probe: 'ok' | 'skipped' | 'cached' | 'failed'; probeError: string | null;
  staged: string | null; installed: string[]; lastApply: AppUpdateMarker | null; ppid: number;
}
export interface AppUpdateStage {
  mode: 'stage'; version: string; platform: AppPlatform;
  staged: boolean; notPublished: boolean; alreadyStaged: boolean;
  asset: string; bytes: number; path: string | null;
}
export interface AppUpdateApply { mode: 'apply'; version: string; platform: AppPlatform; awaitPid: number | null; handedOff: true }
export interface AppUpdateApplyNow { mode: 'apply-now'; version: string; platform: AppPlatform; phase: 'launched' | 'failed'; error: string | null }
export type AppUpdateResult = AppUpdateCheck | AppUpdateStage | AppUpdateApply | AppUpdateApplyNow;

const released = /^\d+\.\d+\.\d+$/;
const newestFirst = (a: string, b: string) => compare(b, a) ?? 0;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const tail = (form: WithForm['form']) => `Everything works from the terminal. Run \`${invocation(form, 'app-update --stage')}\` later to try again.`;

export async function run(args: AppUpdateArgs, io: Prompter): Promise<Result<AppUpdateResult>> {
  if (args.reason !== undefined && !['on-close', 'overnight', 'manual'].includes(args.reason)) return failure('--reason must be on-close, overnight or manual.');
  if ([args.check, args.stage, args.apply].filter(Boolean).length > 1) return failure('Choose one of --check, --stage or --apply.');
  const store = args.config ?? createConfigStore(); const root = store.root; const appRoot = join(root, 'app');
  const platform = detectPlatform(args.evidence ?? { platform: process.platform, arch: process.arch, procVersion: await readProcVersion() });
  const suffix = assetSuffix(platform); const supported = suffix !== null;
  const runner = args.runner ?? systemRunner, exec = args.exec ?? execCommand;
  if (!args.applyNow && !args.apply && !args.stage) {
    const cliVersion = packageVersion(), state = args.state ?? createReleaseState(root);
    let probe: AppUpdateCheck['probe'] = 'cached', probeError: string | null = null;
    try {
      const policy = probePolicy(await store.read(), args.probe);
      if (args.force) {
        const outcome = await maintainReleaseState({ state, running: cliVersion, launch: args.launch, now: args.now, runner, probe: policy, force: true });
        probe = policy === 'nobody' ? 'skipped' : outcome === null ? 'cached' : outcome.ok ? 'ok' : 'failed';
        probeError = outcome && !outcome.ok ? outcome.error : null;
      } else {
        const current = await state.read();
        probe = policy === 'nobody' ? 'skipped' : current?.attempt?.ok === false ? 'failed' : 'cached';
        probeError = current?.attempt?.ok === false ? current.attempt.error : null;
      }
    } catch { probe = 'failed'; probeError = 'The release state could not be read.'; }
    const described = describeUpdate(await state.read().catch(() => null), cliVersion, (args.now ?? Date.now)());
    const installed: string[] = [], staged: string[] = [];
    for (const name of await versionDirectories(appRoot)) {
      if (await exists(join(appRoot, name, 'installed.json'))) installed.push(name);
      else if (await exists(join(appRoot, name, 'staged.json'))) staged.push(name);
    }
    return success({ mode: 'check', platform, supported, cliVersion, latest: described.latest?.version ?? null, latestAt: described.latest?.at ?? null, probe, probeError, installed: installed.sort(newestFirst), staged: staged.sort(newestFirst)[0] ?? null, lastApply: await readMarker(join(root, 'run', 'app-update.json')), ppid: process.ppid });
  }
  const version = args.release ?? packageVersion();
  if (version === null) return failure('This copy has no version, so it cannot say which desktop app to download.');
  const markerPath = join(root, 'run', 'app-update.json');
  const mark = (phase: AppUpdatePhase, error: string | null = null) => writeJsonPrivate(markerPath, { schema: 1, version, phase, at: new Date().toISOString(), error, ...(args.reason === undefined ? {} : { reason: args.reason }) });
  const failed = async (error: string) => { await mark('failed', error); return success<AppUpdateApplyNow>({ mode: 'apply-now', version, platform, phase: 'failed', error }); };
  const rejected = (error: string) => args.applyNow ? failed(error).catch(cause => failure(`${error} Could not record failure: ${message(cause)}`)) : failure(error);
  // The resolved version, not args.release: without --release it comes from packageVersion(), which accepts prereleases.
  if (!released.test(version)) return rejected(`\`${version}\` is not a released version; use three numbers, as in 0.1.11.`);
  if (!supported) return rejected(unsupportedLine(platform));
  const versionDir = join(appRoot, version), asset = `${APP_SLUG}_${version}_${suffix}`;
  if (!args.applyNow && !args.apply) {
    try {
      await store.ensureRoot(); await mkdirPrivate(appRoot);
      // A killed frame child cannot run its finally; old incomplete downloads are safe to discard.
      for (const name of await readdir(appRoot).catch(() => [] as string[])) {
        if (name.startsWith('.download-')) await (async () => {
          const path = join(appRoot, name);
          if ((await stat(path)).mtimeMs < (args.now ?? Date.now)() - 3_600_000) await rm(path, { recursive: true, force: true });
        })().catch(() => undefined);
      }
      if (await exists(join(versionDir, 'installed.json')) || await exists(join(versionDir, 'staged.json'))) return success({ mode: 'stage', version, platform, staged: true, notPublished: false, alreadyStaged: true, asset, bytes: 0, path: versionDir });
      const staging = await mkdtemp(join(appRoot, '.download-'));
      const notPublished = () => {
        io.print(`${APP_PRODUCT} ${version} is announced but its files are not published yet.`);
        return success<AppUpdateStage>({ mode: 'stage', version, platform, staged: false, notPublished: true, alreadyStaged: false, asset, bytes: 0, path: null });
      };
      try {
        io.print(`Downloading ${APP_PRODUCT} ${version} for ${platform}…`);
        const download = await runner.run('gh', ['release', 'download', `v${version}`, '--repo', APP_REPOSITORY, '--pattern', asset, '--pattern', `${asset}.sha256`, '--dir', staging], { deadlineMs: 600_000 }).catch(error => ({ code: 1, stdout: '', stderr: message(error) }));
        if (download.code !== 0) {
          if (download.code === 124) return failure(`Downloading the desktop app took longer than 10 minutes and was stopped. ${tail(args.form)}`);
          const text = (download.stderr || download.stdout).trim();
          if (RELEASE_ASSETS_MISSING.test(text)) return notPublished();
          return failure(await explainDownloadFailure(text, version, asset, runner, args.form));
        }
        const file = join(staging, asset);
        if (!(await exists(file)) || !(await exists(`${file}.sha256`))) return notPublished();
        const expected = (await readFile(`${file}.sha256`, 'utf8')).trim().split(/\s+/)[0]?.toLowerCase();
        const actual = createHash('sha256').update(await readFile(file)).digest('hex');
        if (!expected || expected !== actual) return failure(`The downloaded desktop app did not match its published checksum, so it was discarded (expected ${expected ?? 'nothing readable'}, got ${actual}). ${tail(args.form)}`);
        const bytes = (await stat(file)).size;
        let bundle: string | null = null;
        if (platform.startsWith('darwin')) {
          const unpack = await exec('tar', ['-xzf', file, '-C', staging]);
          if (unpack.code !== 0) return failure(`Could not unpack the desktop app: ${(unpack.stderr || unpack.stdout).trim()} ${tail(args.form)}`);
          await rm(file, { force: true });
          bundle = (await readdir(staging)).find(name => name.endsWith('.app')) ?? null;
          if (!bundle) return failure(`The downloaded archive did not contain an application bundle. ${tail(args.form)}`);
        }
        await rm(`${file}.sha256`, { force: true });
        await writeFile(join(staging, 'staged.json'), JSON.stringify({ schema: 1, version, platform, bundle, installer: bundle === null ? asset : null, stagedAt: new Date().toISOString() }, null, 2));
        await rm(versionDir, { recursive: true, force: true }); await rename(staging, versionDir);
        return success({ mode: 'stage', version, platform, staged: true, notPublished: false, alreadyStaged: false, asset, bytes, path: versionDir });
      } finally { await rm(staging, { recursive: true, force: true }); }
    } catch (error) { return failure(`${message(error)} ${tail(args.form)}`); }
  }
  if (!(await exists(join(versionDir, 'staged.json')))) return rejected(`Nothing is staged for ${version}; download it first.`);
  const awaitPid = args.awaitPid !== undefined ? Number(args.awaitPid) : io.channel === 'frames' ? process.ppid : null;
  if (awaitPid !== null && (!Number.isSafeInteger(awaitPid) || awaitPid <= 0)) return rejected('--await-pid must be a process id.');
  if (!args.applyNow) {
    const entry = args.entry ?? args.launch?.path ?? process.argv[1];
    if (!entry) return failure('This copy cannot locate its own entry point, so it cannot hand the install off.');
    try { await exec(args.node ?? process.execPath, [entry, 'app-update', '--apply-now', '--release', version, ...(args.reason === undefined ? [] : ['--reason', args.reason]), ...(awaitPid === null ? [] : ['--await-pid', String(awaitPid)])], { detach: true }); }
    catch (error) { return failure(`Could not start the installer: ${message(error)}`); }
    return success({ mode: 'apply', version, platform, awaitPid, handedOff: true });
  }
  try {
    await mark('waiting');
    const alive = args.alive ?? ((pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } });
    const deadline = Date.now() + (args.waitMs ?? 30_000);
    if (awaitPid !== null) {
      while (alive(awaitPid)) {
        if (Date.now() >= deadline) {
          if (platform.startsWith('darwin')) return await failed('The desktop app was still running after 30 seconds, so the new version was not opened.');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, args.pollMs ?? 100));
      }
    }
    await mark('installing');
    const staged: unknown = JSON.parse(await readFile(join(versionDir, 'staged.json'), 'utf8'));
    const field = platform.startsWith('darwin') ? 'bundle' : 'installer';
    if (!staged || typeof staged !== 'object' || !(field in staged) || typeof (staged as Record<string, unknown>)[field] !== 'string' || !(staged as Record<string, unknown>)[field]) return await failed('The staged desktop app metadata is incomplete; download it again.');
    const target = (staged as Record<string, string>)[field]!;
    const outcome = platform.startsWith('darwin') ? await exec('open', [join(versionDir, target)]) : await exec(join(versionDir, target), ['/S', '/UPDATE', '/R']);
    if (outcome.code !== 0) {
      const error = platform.startsWith('darwin') ? (outcome.stderr || outcome.stdout).trim() : `The desktop app installer exited with code ${outcome.code}. ${(outcome.stderr || outcome.stdout).trim()}`.trim();
      const result = await failed(error);
      if (platform.startsWith('win32')) {
        // Best-effort courtesy only: a failure here must not replace the installer's own message in the marker.
        const existing = await locateApp(platform, versionDir, args.localAppData).catch(() => null);
        if (existing) await exec(existing, [], { detach: true }).catch(() => undefined);
      }
      return result;
    }
    await writeFile(join(versionDir, 'installed.json'), JSON.stringify({ schema: 1, version, platform, bundle: field === 'bundle' ? target : null, installedAt: new Date().toISOString() }, null, 2));
    await mark('launched');
    const versions = (await versionDirectories(appRoot)).sort(newestFirst);
    const keep = new Set([...versions.slice(0, 2), version, packageVersion()]);
    for (const name of versions) if (!keep.has(name)) await rm(join(appRoot, name), { recursive: true, force: true }).catch(() => undefined);
    return success({ mode: 'apply-now', version, platform, phase: 'launched', error: null });
  } catch (error) {
    // Even a spawn or disk exception must leave an actionable marker when storage is writable.
    try { return await failed(message(error)); } catch { return failure(message(error)); }
  }
}

async function versionDirectories(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && released.test(entry.name)).map(entry => entry.name);
}
async function readMarker(path: string): Promise<AppUpdateMarker | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object') return null;
    const m = value as Record<string, unknown>;
    if (m.schema !== 1 || typeof m.version !== 'string' || typeof m.at !== 'string' || !['waiting', 'installing', 'launched', 'failed'].includes(String(m.phase)) || (m.error !== null && typeof m.error !== 'string')) return null;
    if (m.reason !== undefined && (typeof m.reason !== 'string' || !['on-close', 'overnight', 'manual'].includes(m.reason))) return null;
    return m as unknown as AppUpdateMarker;
  } catch { return null; }
}
function unsupportedLine(platform: AppPlatform): string {
  if (platform === 'wsl') return 'The desktop app runs on the Windows side of this machine, not inside WSL; update it from a Windows terminal.';
  if (platform === 'linux') return 'There is no Linux desktop app yet, so there is nothing to update; everything works from the terminal.';
  return 'There is no desktop app for this machine, so there is nothing to update; everything works from the terminal.';
}
async function readProcVersion(): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  try { return await readFile('/proc/version', 'utf8'); } catch { return null; }
}
