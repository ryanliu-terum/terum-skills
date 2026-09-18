import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as platformModule from '../../lib/platform.js';
import { createConfigStore } from '../../lib/config.js';
import { ScriptedPrompter, ghOnlyRunner, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { assetSuffix, detectPlatform } from '../../lib/platform.js';
import type { CommandResult, Exec, RunOptions } from '../../lib/runner.js';
import { APP_REPOSITORY, readAppState, run } from '../app.js';

// Windows keeps a just-executed installer open for a moment, so the move into place is retried; the retry loop is
// exercised by making the real rename/rm fail with the codes Windows reports (the tests run on Linux).
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rename: vi.fn(original.rename), rm: vi.fn(original.rm) };
});
afterEach(() => { vi.mocked(rename).mockReset(); vi.mocked(rm).mockReset(); });
const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const held = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

const ok: CommandResult = { code: 0, stdout: '', stderr: '' };
const V = '0.1.6';
const ASSET = `terum-skills-desktop_${V}_aarch64.app.tar.gz`;
const mac = { platform: 'darwin' as const, arch: 'arm64' };
/** Every macOS run gets its own Applications folder: the default is the real ~/Applications, which may hold the app on the machine running these tests. */
const applications = (root: string) => join(root, 'Applications');
const placed = (root: string) => join(applications(root), 'Terum Skills.app');
/** A bundle already in Applications, with the Info.plist Tauri writes and a marker file that tells the copies apart. */
async function existingBundle(root: string, version: string, marker: string) {
  await mkdir(join(placed(root), 'Contents'), { recursive: true });
  await writeFile(join(placed(root), 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>${version}</string>\n\t<key>CFBundleVersion</key>\n\t<string>${version}</string>\n</dict></plist>\n`);
  await writeFile(join(placed(root), 'Contents', 'marker'), marker);
}

/** gh that answers `--version`, `auth status`, and `release download` (writing the asset into --dir); everything else is unexpected. */
function fakeGhRelease(options: { authenticated?: boolean; download?: 'ok' | 'corrupt' | 'missing' | 'offline' | 'no-release' | 'spawn-error' | 'timeout'; attestation?: 'ok' | 'invalid' | 'old-gh' } = {}) {
  const authenticated = options.authenticated ?? true;
  return ghOnlyRunner(async (args) => {
    const key = args.join(' ');
    if (args[0] === '--version') return { code: 0, stdout: 'gh version 2.0.0', stderr: '' };
    if (args[0] === 'attestation' && args[1] === 'verify') {
      if (options.attestation === 'old-gh') return { code: 1, stdout: '', stderr: 'unknown command "attestation" for "gh"' };
      if (options.attestation === 'invalid') return { code: 1, stdout: '', stderr: '✗ No attestations found matching the given subject' };
      expect(args).toEqual(['attestation', 'verify', args[2], '--repo', APP_REPOSITORY]);
      expect(existsSync(args[2]!)).toBe(true);
      return ok;
    }
    if (key === 'auth status') return authenticated ? ok : { code: 1, stdout: '', stderr: 'not logged in' };
    if (args[0] === 'release' && args[1] === 'download') {
      if (!authenticated) return { code: 1, stdout: '', stderr: 'HTTP 401: Requires authentication' };
      const mode = options.download ?? 'ok';
      if (mode === 'no-release') return { code: 1, stdout: '', stderr: 'release not found' };
      if (mode === 'spawn-error') throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
      if (mode === 'timeout') return { code: 124, stdout: '', stderr: 'terum-skills: gh release exceeded 600 s' };
      if (mode === 'offline') return { code: 1, stdout: '', stderr: 'error connecting to api.github.com: dial tcp: lookup api.github.com: no such host' };
      if (mode === 'missing') return ok;
      const dir = args[args.indexOf('--dir') + 1]!;
      const bytes = Buffer.from(`tarball for ${V}`);
      await writeFile(join(dir, ASSET), bytes);
      const digest = mode === 'corrupt' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(dir, `${ASSET}.sha256`), `${digest}  ${ASSET}\n`);
      return ok;
    }
    return { code: 1, stdout: '', stderr: `unexpected gh ${key}` };
  });
}
/** tar creates the bundle in the staging dir; open records. */
function fakeExec() {
  const calls: { command: string; args: readonly string[] }[] = [];
  const exec: Exec = async (command, args) => {
    calls.push({ command, args });
    if (command === 'tar') { const dir = args[args.indexOf('-C') + 1]!; await mkdir(join(dir, 'Terum Skills.app', 'Contents', 'MacOS'), { recursive: true }); }
    return ok;
  };
  return { exec, calls };
}

describe('platform table (D3)', () => {
  it('names the machine and the release asset it can run', () => {
    expect(detectPlatform({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64');
    expect(detectPlatform({ platform: 'darwin', arch: 'x64' })).toBe('darwin-x64');
    expect(detectPlatform({ platform: 'win32', arch: 'arm64' })).toBe('win32-arm64');
    expect(detectPlatform({ platform: 'win32', arch: 'x64' })).toBe('win32-x64');
    expect(detectPlatform({ platform: 'linux', arch: 'x64', procVersion: 'Linux version 6.6.87.2-microsoft-standard-WSL2' })).toBe('wsl');
    expect(detectPlatform({ platform: 'linux', arch: 'arm64', procVersion: 'Linux version 6.8.0-generic' })).toBe('linux');
    expect(detectPlatform({ platform: 'linux', arch: 'arm64', procVersion: null })).toBe('linux');
    expect(detectPlatform({ platform: 'freebsd', arch: 'x64' })).toBe('unsupported');
    expect(assetSuffix('darwin-arm64')).toBe('aarch64.app.tar.gz');
    expect(assetSuffix('darwin-x64')).toBe('x64.app.tar.gz');
    expect(assetSuffix('win32-arm64')).toBe('arm64-setup.exe');
    expect(assetSuffix('win32-x64')).toBe('x64-setup.exe');
    for (const p of ['linux', 'wsl', 'unsupported'] as const) expect(assetSuffix(p), p).toBeNull();
  });
});

describe('terum-skills app (D1, D3, D7, D8)', () => {
  it('Linux, WSL and unsupported machines get one honest line, exit 0, and no download attempt', async () => {
    for (const [evidence, fragment] of [
      [{ platform: 'linux', arch: 'x64', procVersion: 'Linux 6.8' }, 'no Linux desktop app yet'],
      [{ platform: 'linux', arch: 'x64', procVersion: 'microsoft-standard-WSL2' }, 'Windows side of this machine'],
      [{ platform: 'freebsd', arch: 'x64' }, 'no desktop app for this machine'],
    ] as const) {
      const runner = fakeGhRelease();
      const io = new ScriptedPrompter();
      const result = await run({ config: createConfigStore(await temporaryDirectory()), runner, exec: fakeExec().exec, version: V, evidence }, io);
      expect(result).toMatchObject({ ok: true, value: { action: 'unavailable', appPath: null } });
      expect(io.lines.join('\n')).toContain(fragment);
      expect(runner.calls).toEqual([]);
    }
  });

  it('macOS: downloads through gh for its own version, verifies the checksum, places the bundle in Applications with only the record under <version>/, writes the state file and the opt-in, opens the app; a second run only opens', async () => {
    const root = await temporaryDirectory();
    const store = createConfigStore(root);
    const runner = fakeGhRelease();
    const { exec, calls } = fakeExec();
    const io = new ScriptedPrompter();
    const result = await run({ config: store, runner, exec, version: V, evidence: mac, applicationsDir: applications(root), node: '/opt/node/bin/node', entry: '/opt/lib/node_modules/terum-skills/dist/index.js' }, io);
    expect(result).toMatchObject({ ok: true, value: { platform: 'darwin-arm64', version: V, action: 'installed-and-launched', appPath: placed(root), statePath: join(root, 'run', 'app.json') } });
    const download = runner.calls.find((call) => call.args[0] === 'release')!;
    expect(download.args).toEqual(['release', 'download', `v${V}`, '--repo', APP_REPOSITORY, '--pattern', ASSET, '--pattern', `${ASSET}.sha256`, '--dir', expect.stringContaining(join(root, 'app', '.download-'))]);
    expect(calls.map((call) => call.command)).toEqual(['tar', 'open']);
    expect(calls[1]!.args).toEqual([placed(root)]);
    expect(existsSync(join(placed(root), 'Contents', 'MacOS'))).toBe(true);
    expect(await readdir(join(root, 'app', V))).toEqual(['installed.json']);  // the bundle itself lives in Applications
    expect(await readdir(applications(root))).toEqual(['Terum Skills.app']);  // no aside copy left behind
    const state = JSON.parse(await readFile(join(root, 'run', 'app.json'), 'utf8'));
    expect(state).toMatchObject({ schema: 1, node: '/opt/node/bin/node', entry: '/opt/lib/node_modules/terum-skills/dist/index.js', path: process.env.PATH ?? null, version: V });
    expect(state).not.toHaveProperty('target');
    expect(state).not.toHaveProperty('intent');
    expect((await store.read()).app).toMatchObject({ choice: 'opted-in' });
    expect(await readdir(join(root, 'app'))).toEqual([V]);  // no staging directory left behind
    expect(io.lines.at(-1)).toBe(`Installed and opened Terum Skills ${V}.`);

    const again = await run({ config: store, runner: fakeGhRelease({ download: 'no-release' }), exec: fakeExec().exec, version: V, evidence: mac, applicationsDir: applications(root) }, new ScriptedPrompter());
    expect(again).toMatchObject({ ok: true, value: { action: 'launched' } });
  });

  it('macOS: a bundle deleted from Applications is downloaded again even though its record exists', async () => {
    const root = await temporaryDirectory();
    const args = { config: createConfigStore(root), version: V, evidence: mac, applicationsDir: applications(root) };
    expect(await run({ ...args, runner: fakeGhRelease(), exec: fakeExec().exec }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { action: 'installed-and-launched' } });
    await rm(placed(root), { recursive: true });
    const runner = fakeGhRelease();
    expect(await run({ ...args, runner, exec: fakeExec().exec }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { action: 'installed-and-launched', appPath: placed(root) } });
    expect(runner.calls.some((call) => call.args[0] === 'release')).toBe(true);
  });

  it('macOS: replaces an older bundle in Applications, and never downgrades a newer one the app installed itself', async () => {
    const root = await temporaryDirectory();
    const args = { config: createConfigStore(root), version: V, evidence: mac, applicationsDir: applications(root) };
    await existingBundle(root, '0.1.5', 'older');
    expect(await run({ ...args, runner: fakeGhRelease(), exec: fakeExec().exec }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { action: 'installed-and-launched', appPath: placed(root) } });
    expect(existsSync(join(placed(root), 'Contents', 'marker'))).toBe(false);
    expect(await readdir(applications(root))).toEqual(['Terum Skills.app']);
    await rm(placed(root), { recursive: true }); await rm(join(root, 'app', V), { recursive: true });
    await existingBundle(root, '0.2.0', 'newer');
    const runner = fakeGhRelease(); const { exec, calls } = fakeExec();
    expect(await run({ ...args, runner, exec }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { action: 'launched', appPath: placed(root) } });
    expect(runner.calls.some((call) => call.args[0] === 'release')).toBe(false);
    expect(calls.map((call) => call.command)).toEqual(['open']);
    expect(await readFile(join(placed(root), 'Contents', 'marker'), 'utf8')).toBe('newer');
  });

  it('macOS: when the new bundle cannot be moved into place the previous one is put back, so the machine is never left without an app', async () => {
    const root = await temporaryDirectory();
    await existingBundle(root, '0.1.5', 'older');
    vi.mocked(rename).mockImplementation(async (from, to) => { if (String(from).includes('.download-') && String(to) === placed(root)) throw Object.assign(new Error('EACCES: permission denied, rename'), { code: 'EACCES' }); return real.rename(from, to); });
    const result = await run({ config: createConfigStore(root), runner: fakeGhRelease(), exec: fakeExec().exec, version: V, evidence: mac, applicationsDir: applications(root) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('EACCES: permission denied, rename') });
    expect(await readFile(join(placed(root), 'Contents', 'marker'), 'utf8')).toBe('older');
    expect(await readdir(applications(root))).toEqual(['Terum Skills.app']);
    expect(await readdir(join(root, 'app'))).toEqual([]);
  });

  it('records a join target and verbatim PATH, then clears the target on a plain launch', async () => {
    const root = await temporaryDirectory();
    const args = { config: createConfigStore(root), runner: fakeGhRelease(), exec: fakeExec().exec, version: V, evidence: mac, applicationsDir: applications(root), open: false };
    const path = 'C:\\Program Files\\node;C:\\git\\bin';
    expect((await run({ ...args, target: 'acme/team', intent: 'setup', path }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readAppState(root)).toMatchObject({ target: 'acme/team', intent: 'setup', path });
    expect((await run(args, new ScriptedPrompter())).ok).toBe(true);
    const plain = await readAppState(root);
    expect(plain).not.toHaveProperty('target');
    expect(plain).not.toHaveProperty('intent');
    expect(plain?.path).toBe(process.env.PATH ?? null);
    expect((await run({ ...args, path: null }, new ScriptedPrompter())).ok).toBe(true);
    expect((await readAppState(root))?.path).toBeNull();
  });

  it('reads legacy state without PATH or a join target', async () => {
    const root = await temporaryDirectory();
    const legacy = { schema: 1, node: '/opt/node', entry: '/cli/index.js', version: V, writtenAt: '2026-09-08T00:00:00Z' };
    await mkdir(join(root, 'run'));
    await writeFile(join(root, 'run', 'app.json'), JSON.stringify(legacy));
    expect(await readAppState(root)).toEqual(legacy);
  });

  it('a checksum mismatch discards the download, leaves no <version>/ directory, and says so with the two next steps', async () => {
    const root = await temporaryDirectory();
    const result = await run({ config: createConfigStore(root), runner: fakeGhRelease({ download: 'corrupt' }), exec: fakeExec().exec, version: V, evidence: mac, applicationsDir: applications(root), form: 'bare' }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('did not match its published checksum') });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Everything works from the terminal. Run `terum-skills app` later to try again.') });
    expect(await readdir(join(root, 'app'))).toEqual([]);
  });

  it('an asset without a valid build attestation is discarded after the checksum passed, and so is one an old gh cannot verify', async () => {
    const root = await temporaryDirectory();
    const args = { config: createConfigStore(root), exec: fakeExec().exec, version: V, evidence: mac, applicationsDir: applications(root), form: 'bare' as const };
    const invalid = fakeGhRelease({ attestation: 'invalid' });
    expect(await run({ ...args, runner: invalid }, new ScriptedPrompter())).toMatchObject({ ok: false, error: `The downloaded desktop app has no valid build attestation from ${APP_REPOSITORY}, so it was discarded: ✗ No attestations found matching the given subject. Everything works from the terminal. Run \`terum-skills app\` later to try again.` });
    expect(invalid.calls.map((call) => call.args.slice(0, 2))).toEqual([['release', 'download'], ['attestation', 'verify']]);
    expect(await readdir(join(root, 'app'))).toEqual([]);
    expect(existsSync(placed(root))).toBe(false);
    expect(await run({ ...args, runner: fakeGhRelease({ attestation: 'old-gh' }) }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('gh 2.49 or newer is needed') });
    expect(await readdir(join(root, 'app'))).toEqual([]);
    // A good asset is verified exactly once, after the checksum, before anything is unpacked.
    const good = fakeGhRelease();
    expect(await run({ ...args, runner: good }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { action: 'installed-and-launched' } });
    expect(good.calls.filter((call) => call.args[0] === 'attestation')).toHaveLength(1);
  });

  it('per-cause wording (D7): no release for this version, offline, gh logged out, asset absent', async () => {
    const root = await temporaryDirectory();
    const at = (runner: ReturnType<typeof fakeGhRelease>) => run({ config: createConfigStore(root), runner, exec: fakeExec().exec, version: V, evidence: mac, applicationsDir: applications(root) }, new ScriptedPrompter());
    expect(await at(fakeGhRelease({ download: 'no-release' }))).toMatchObject({ ok: false, error: expect.stringContaining(`No desktop app is published for terum-skills ${V}`) });
    expect(await at(fakeGhRelease({ download: 'offline' }))).toMatchObject({ ok: false, error: expect.stringContaining('offline or behind a proxy') });
    expect(await at(fakeGhRelease({ authenticated: false }))).toMatchObject({ ok: false, error: expect.stringContaining('gh auth login') });
    expect(await at(fakeGhRelease({ download: 'missing' }))).toMatchObject({ ok: false, error: expect.stringContaining('looked for') });
    // A gh that cannot be started (absent from the PATH the app replays) and a download past its ten-minute deadline get a sentence each, never a raw rejection.
    expect(await at(fakeGhRelease({ download: 'spawn-error' }))).toMatchObject({ ok: false, error: 'Could not download the desktop app: spawn gh ENOENT. Everything works from the terminal. Run `npx -y terum-skills@latest app` later to try again.' });
    expect(await at(fakeGhRelease({ download: 'timeout' }))).toMatchObject({ ok: false, error: 'Downloading the desktop app took longer than 10 minutes and was stopped. Everything works from the terminal. Run `npx -y terum-skills@latest app` later to try again.' });
    for (const dir of await readdir(join(root, 'app'))) expect(dir).not.toMatch(/^\.download-/);
  });

  it.each([
    ['arm64', 'win32-arm64', 'arm64-setup.exe'],
    ['x64', 'win32-x64', 'x64-setup.exe'],
  ] as const)('Windows %s: runs the per-user installer silently, then launches the installed exe (built blind, D8)', async (arch, platform, suffix) => {
    const root = await temporaryDirectory();
    const localAppData = join(root, 'LocalAppData');
    const calls: { command: string; args: readonly string[]; options?: RunOptions }[] = [];
    const exec: Exec = async (command, args, options) => { calls.push({ command, args, options }); if (command.endsWith('-setup.exe')) await mkdir(join(localAppData, 'Terum Skills'), { recursive: true }).then(() => writeFile(join(localAppData, 'Terum Skills', 'terum-skills-desktop.exe'), '')); return ok; };
    const runner = ghOnlyRunner(async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'gh version 2.0.0', stderr: '' };
      if (args.join(' ') === 'auth status' || args[0] === 'attestation') return ok;
      const dir = args[args.indexOf('--dir') + 1]!; const name = `terum-skills-desktop_${V}_${suffix}`; const bytes = Buffer.from('nsis');
      await writeFile(join(dir, name), bytes); await writeFile(join(dir, `${name}.sha256`), `${createHash('sha256').update(bytes).digest('hex')} *${name}\n`); return ok;
    });
    const result = await run({ config: createConfigStore(root), runner, exec, version: V, evidence: { platform: 'win32', arch }, localAppData }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { platform, action: 'installed-and-launched', appPath: join(localAppData, 'Terum Skills', 'terum-skills-desktop.exe') } });
    expect(calls.map((call) => [call.command.endsWith(suffix) ? 'installer' : call.command, [...call.args]])).toEqual([['installer', ['/S']], [join(localAppData, 'Terum Skills', 'terum-skills-desktop.exe'), []]]);
    expect(runner.calls.some((call) => call.args.includes(`terum-skills-desktop_${V}_${suffix}`))).toBe(true);
    // The installer is awaited (it must finish); the app itself is a GUI process the CLI must not wait for.
    expect(calls[0]?.options?.detach).toBeUndefined();
    expect(calls[1]?.options).toMatchObject({ detach: true });
  });

  /** A Windows install: gh writes the NSIS installer into --dir, the installer "installs" the exe under %LOCALAPPDATA%. */
  function windowsInstall(root: string) {
    const localAppData = join(root, 'LocalAppData'), exe = join(localAppData, 'Terum Skills', 'terum-skills-desktop.exe'), suffix = 'x64-setup.exe';
    const calls: { command: string; args: readonly string[]; options?: RunOptions }[] = [];
    const exec: Exec = async (command, args, options) => { calls.push({ command, args, options }); if (command.endsWith(suffix)) { await mkdir(join(localAppData, 'Terum Skills'), { recursive: true }); await writeFile(exe, ''); } return ok; };
    const runner = ghOnlyRunner(async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'gh version 2.0.0', stderr: '' };
      if (args.join(' ') === 'auth status' || args[0] === 'attestation') return ok;
      const dir = args[args.indexOf('--dir') + 1]!; const name = `terum-skills-desktop_${V}_${suffix}`; const bytes = Buffer.from('nsis');
      await writeFile(join(dir, name), bytes); await writeFile(join(dir, `${name}.sha256`), `${createHash('sha256').update(bytes).digest('hex')} *${name}\n`); return ok;
    });
    const sleeps: number[] = [];
    const args = { config: createConfigStore(root), runner, exec, version: V, evidence: { platform: 'win32' as const, arch: 'x64' }, localAppData, sleep: async (ms: number) => { sleeps.push(ms); } };
    return { args, calls, exe, sleeps };
  }

  it('Windows: retries the move into place while the just-run installer is still held (EPERM), so the install is never reported as failed', async () => {
    const root = await temporaryDirectory(); const w = windowsInstall(root);
    let refusals = 0;
    vi.mocked(rename).mockImplementation(async (from, to) => { if (String(from).includes('.download-') && refusals++ < 2) throw held(); return real.rename(from, to); });
    const io = new ScriptedPrompter();
    expect(await run(w.args, io)).toMatchObject({ ok: true, value: { action: 'installed-and-launched', appPath: w.exe } });
    expect(w.sleeps).toEqual([50, 100]);
    expect(await readdir(join(root, 'app'))).toEqual([V]);
    expect(JSON.parse(await readFile(join(root, 'app', V, 'installed.json'), 'utf8'))).toMatchObject({ schema: 1, version: V, platform: 'win32-x64', bundle: null });
    expect(await readAppState(root)).toMatchObject({ version: V });
    expect(w.calls.map(call => call.command)).toEqual([expect.stringContaining('-setup.exe'), w.exe]);
    expect(io.lines).toEqual([`Downloading Terum Skills ${V} for win32-x64…`, `Installed and opened Terum Skills ${V}.`]);
  });

  it('Windows: a download folder that stays held after a successful install is reported, never fatal: the record still lands and the app opens', async () => {
    const root = await temporaryDirectory(); const w = windowsInstall(root);
    vi.mocked(rename).mockImplementation(async (from, to) => { if (String(from).includes('.download-')) throw held(); return real.rename(from, to); });
    vi.mocked(rm).mockImplementation(async (path, options) => { if (basename(String(path)).startsWith('.download-')) throw held(); return real.rm(path, options); });
    const io = new ScriptedPrompter();
    expect(await run(w.args, io)).toMatchObject({ ok: true, value: { action: 'installed-and-launched', appPath: w.exe } });
    expect(JSON.parse(await readFile(join(root, 'app', V, 'installed.json'), 'utf8'))).toMatchObject({ schema: 1, version: V, platform: 'win32-x64', bundle: null });
    expect(await readAppState(root)).toMatchObject({ version: V });
    expect(w.calls.map(call => call.command)).toEqual([expect.stringContaining('-setup.exe'), w.exe]);
    const leftovers = (await readdir(join(root, 'app'))).filter(name => name.startsWith('.download-'));
    expect(leftovers).toHaveLength(1);
    expect(io.lines).toEqual([
      `Downloading Terum Skills ${V} for win32-x64…`,
      `The download folder ${join(root, 'app', leftovers[0]!)} is still in use (EPERM: operation not permitted, rename); the install is recorded without it.`,
      `Could not remove the download folder ${join(root, 'app', leftovers[0]!)} (EPERM: operation not permitted, rename); it is removed on a later update check.`,
      `Installed and opened Terum Skills ${V}.`,
    ]);
    // The retry budget is spent once on the move and once on the removal.
    expect(w.sleeps).toHaveLength(18);
  });

  it('Windows: the previous version directory is removed through the same retry loop, and a genuine failure there is still reported', async () => {
    const root = await temporaryDirectory(); const w = windowsInstall(root);
    await mkdir(join(root, 'app', V), { recursive: true }); await writeFile(join(root, 'app', V, 'stale'), '');
    vi.mocked(rm).mockImplementation(async (path, options) => { if (String(path) === join(root, 'app', V)) throw Object.assign(new Error('EACCES: permission denied, rmdir'), { code: 'EACCES' }); return real.rm(path, options); });
    expect(await run({ ...w.args, sleep: async () => undefined }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('EACCES: permission denied, rmdir') });
    expect(vi.mocked(rm).mock.calls.filter(([path]) => String(path) === join(root, 'app', V))).toHaveLength(10);
  });

  it('sweeps download folders older than an hour before downloading, and keeps recent ones (a killed sibling may still own them)', async () => {
    const root = await temporaryDirectory(); const w = windowsInstall(root);
    const old = join(root, 'app', '.download-old'), fresh = join(root, 'app', '.download-fresh');
    await mkdir(old, { recursive: true }); await writeFile(join(old, 'terum-skills-desktop_0.1.5_x64-setup.exe'), 'nsis'); await mkdir(fresh);
    const past = new Date(Date.now() - 2 * 3_600_000); await utimes(old, past, past);
    expect(await run(w.args, new ScriptedPrompter())).toMatchObject({ ok: true, value: { action: 'installed-and-launched' } });
    expect((await readdir(join(root, 'app'))).sort()).toEqual(['.download-fresh', V]);
  });
});

describe('the offer (setup asks through the verb, D4)', () => {
  it('offer:true prints the wording and asks; a no records declined and touches nothing; a yes proceeds to download', async () => {
    const root = await temporaryDirectory();
    const store = createConfigStore(root);
    const no = new ScriptedPrompter([], [false]);
    const declined = await run({ config: store, runner: fakeGhRelease(), exec: fakeExec().exec, version: V, evidence: mac, applicationsDir: applications(root), offer: true }, no);
    expect(declined).toMatchObject({ ok: true, value: { action: 'declined', appPath: null, statePath: null } });
    expect(no.lines[0]).toBe("Terum Skills also has a desktop app. It is a wrapper around these same commands with a visual view of your team's skills. Everything works from the terminal without it.");
    expect(no.asked).toEqual(['Download and open the app?']);
    expect((await store.read()).app).toMatchObject({ choice: 'declined' });
    expect(await readdir(join(root, 'app')).catch(() => 'absent')).toBe('absent');
    const yes = new ScriptedPrompter([], [true]);
    const runner = fakeGhRelease();
    expect(await run({ config: store, runner, exec: fakeExec().exec, version: V, evidence: mac, applicationsDir: applications(root), offer: true }, yes)).toMatchObject({ ok: true, value: { action: 'installed-and-launched' } });
    expect(runner.calls.some((call) => call.args[0] === 'release')).toBe(true);
    expect((await store.read()).app).toMatchObject({ choice: 'opted-in' });
  });
});


describe('app host architecture (p-arch)', () => {
  it.each([
    ['x64', { PROCESSOR_ARCHITEW6432: 'ARM64' }, 'bare', 'win32-arm64-on-x64'],
    ['x64', { PROCESSOR_ARCHITEW6432: 'arm64' }, 'npx', 'win32-arm64-on-x64'],
    // x64 Node under Prism on a Snapdragon box: no WOW64 hint, only the identifier names the silicon (Teddy's machine, 2026-09-13).
    ['x64', { PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_IDENTIFIER: 'ARMv8 (64-bit) Family 8 Model 1 Revision 201, Qualcomm Technologies Inc' }, 'bare', 'win32-arm64-on-x64'],
    ['arm64', { PROCESSOR_ARCHITECTURE: 'ARM64', PROCESSOR_IDENTIFIER: 'ARMv8 (64-bit) Family 8 Model 1 Revision 201, Qualcomm Technologies Inc' }, 'bare', null],
    ['arm64', {}, 'bare', null],
    ['x64', {}, 'bare', null],
  ] as const)('installs for host with process %s, hint %j and form %s; emulation=%s', async (arch, env, form, emulation) => {
    const root = await temporaryDirectory();
    const localAppData = join(root, 'LocalAppData');
    const appPath = join(localAppData, 'Terum Skills', 'terum-skills-desktop.exe');
    const suffix = arch === 'arm64' || emulation ? 'arm64-setup.exe' : 'x64-setup.exe';
    const asset = `terum-skills-desktop_${V}_${suffix}`;
    const runner = ghOnlyRunner(async args => {
      if (args[0] === 'attestation') return ok;
      expect(args.slice(0, 2)).toEqual(['release', 'download']);
      expect(args).toContain(asset);
      const dir = args[args.indexOf('--dir') + 1]!;
      const bytes = Buffer.from('installer');
      await writeFile(join(dir, asset), bytes);
      await writeFile(join(dir, `${asset}.sha256`), createHash('sha256').update(bytes).digest('hex'));
      return ok;
    });
    const exec: Exec = async command => {
      if (command.endsWith('-setup.exe')) {
        await mkdir(join(localAppData, 'Terum Skills'), { recursive: true });
        await writeFile(appPath, '');
      }
      return ok;
    };
    const io = new ScriptedPrompter();
    const expectedCommand = form === 'bare' ? 'terum-skills app' : 'npx -y terum-skills@latest app';
    const warning = `This machine has an ARM64 processor but you are running an x64 build of Node, so terum-skills and everything the desktop app starts will run under emulation. Install the ARM64 build of Node from nodejs.org, then run \`${expectedCommand}\` again to record it.`;
    const print = io.print.bind(io);
    io.print = line => {
      if (line === warning) expect(existsSync(join(root, 'run', 'app.json'))).toBe(false);
      print(line);
    };
    const args = { config: createConfigStore(root), runner, exec, version: V, evidence: { platform: 'win32' as const, arch, env }, localAppData, form, node: '/test/node' };
    const result = await run(args, io);
    expect(result).toMatchObject({ ok: true, value: { platform: suffix === 'arm64-setup.exe' ? 'win32-arm64' : 'win32-x64', action: 'installed-and-launched', emulation } });
    expect(io.lines.filter(line => line.includes('emulation'))).toEqual(emulation ? [warning] : []);
    expect(await readAppState(root)).toMatchObject({ node: '/test/node', version: V });
    const againIo = new ScriptedPrompter();
    expect(await run(args, againIo)).toMatchObject({ ok: true, value: { action: 'launched', emulation } });
    expect(againIo.lines.filter(line => line.includes('emulation'))).toEqual(emulation ? [warning] : []);
    expect(runner.calls.map(call => call.args[0])).toEqual(['release', 'attestation']); // the first run downloaded and verified; the second called gh for nothing
  });

  it('passes the live environment to detection while an injected evidence object wins unchanged', async () => {
    const detect = vi.spyOn(platformModule, 'detectPlatform').mockReturnValue('linux');
    try {
      expect(await run({ version: V }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { emulation: null } });
      expect(detect.mock.calls[0]?.[0].env).toBe(process.env);
      const evidence = { platform: 'win32' as const, arch: 'arm64' };
      await run({ version: V, evidence }, new ScriptedPrompter());
      expect(detect.mock.calls[1]?.[0]).toBe(evidence);
      expect(evidence).not.toHaveProperty('env');
    } finally { detect.mockRestore(); }
  });

  it('a declined install reports no emulation warning because Node is not recorded', async () => {
    const root = await temporaryDirectory();
    const io = new ScriptedPrompter([], [false]);
    expect(await run({ config: createConfigStore(root), version: V, offer: true, evidence: { platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITEW6432: 'ARM64' } } }, io)).toMatchObject({ ok: true, value: { action: 'declined', emulation: null } });
    expect(io.lines.join(' ')).not.toContain('emulation');
    expect(await readAppState(root)).toBeNull();
  });
});
