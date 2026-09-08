import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { ScriptedPrompter, ghOnlyRunner, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { assetSuffix, detectPlatform } from '../../lib/platform.js';
import type { CommandResult, Exec } from '../../lib/runner.js';
import { APP_REPOSITORY, run } from '../app.js';

const ok: CommandResult = { code: 0, stdout: '', stderr: '' };
const V = '0.1.6';
const ASSET = `terum-skills-desktop_${V}_aarch64.app.tar.gz`;
const mac = { platform: 'darwin' as const, arch: 'arm64' };

/** gh that answers `--version`, `auth status`, and `release download` (writing the asset into --dir); everything else is unexpected. */
function fakeGhRelease(options: { authenticated?: boolean; download?: 'ok' | 'corrupt' | 'missing' | 'offline' | 'no-release' } = {}) {
  const authenticated = options.authenticated ?? true;
  return ghOnlyRunner(async (args) => {
    const key = args.join(' ');
    if (args[0] === '--version') return { code: 0, stdout: 'gh version 2.0.0', stderr: '' };
    if (key === 'auth status') return authenticated ? ok : { code: 1, stdout: '', stderr: 'not logged in' };
    if (args[0] === 'release' && args[1] === 'download') {
      if (!authenticated) return { code: 1, stdout: '', stderr: 'HTTP 401: Requires authentication' };
      const mode = options.download ?? 'ok';
      if (mode === 'no-release') return { code: 1, stdout: '', stderr: 'release not found' };
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
    for (const p of ['win32-x64', 'linux', 'wsl', 'unsupported'] as const) expect(assetSuffix(p), p).toBeNull();
  });
});

describe('terum-skills app (D1, D3, D7, D8)', () => {
  it('Linux, WSL and Windows x64 get one honest line, exit 0, and no download attempt', async () => {
    for (const [evidence, fragment] of [
      [{ platform: 'linux', arch: 'x64', procVersion: 'Linux 6.8' }, 'no Linux desktop app yet'],
      [{ platform: 'linux', arch: 'x64', procVersion: 'microsoft-standard-WSL2' }, 'Windows side of this machine'],
      [{ platform: 'win32', arch: 'x64' }, 'no Windows x64 desktop app yet'],
    ] as const) {
      const runner = fakeGhRelease();
      const io = new ScriptedPrompter();
      const result = await run({ config: createConfigStore(await temporaryDirectory()), runner, exec: fakeExec().exec, version: V, evidence }, io);
      expect(result).toMatchObject({ ok: true, value: { action: 'unavailable', appPath: null } });
      expect(io.lines.join('\n')).toContain(fragment);
      expect(runner.calls).toEqual([]);
    }
  });

  it('macOS: downloads through gh for its own version, verifies the checksum, unpacks into <version>/, writes the state file and the opt-in, opens the app; a second run only opens', async () => {
    const root = await temporaryDirectory();
    const store = createConfigStore(root);
    const runner = fakeGhRelease();
    const { exec, calls } = fakeExec();
    const io = new ScriptedPrompter();
    const result = await run({ config: store, runner, exec, version: V, evidence: mac, node: '/opt/node/bin/node', entry: '/opt/lib/node_modules/terum-skills/dist/index.js' }, io);
    expect(result).toMatchObject({ ok: true, value: { platform: 'darwin-arm64', version: V, action: 'installed-and-launched', appPath: join(root, 'app', V, 'Terum Skills.app'), statePath: join(root, 'run', 'app.json') } });
    const download = runner.calls.find((call) => call.args[0] === 'release')!;
    expect(download.args).toEqual(['release', 'download', `v${V}`, '--repo', APP_REPOSITORY, '--pattern', ASSET, '--pattern', `${ASSET}.sha256`, '--dir', expect.stringContaining(join(root, 'app', '.download-'))]);
    expect(calls.map((call) => call.command)).toEqual(['tar', 'open']);
    expect(calls[1]!.args).toEqual([join(root, 'app', V, 'Terum Skills.app')]);
    const state = JSON.parse(await readFile(join(root, 'run', 'app.json'), 'utf8'));
    expect(state).toMatchObject({ schema: 1, node: '/opt/node/bin/node', entry: '/opt/lib/node_modules/terum-skills/dist/index.js', version: V });
    expect((await store.read()).app).toMatchObject({ choice: 'opted-in' });
    expect(await readdir(join(root, 'app'))).toEqual([V]);  // no staging directory left behind
    expect(io.lines.at(-1)).toBe(`Installed and opened Terum Skills ${V}.`);

    const again = await run({ config: store, runner: fakeGhRelease({ download: 'no-release' }), exec: fakeExec().exec, version: V, evidence: mac }, new ScriptedPrompter());
    expect(again).toMatchObject({ ok: true, value: { action: 'launched' } });
  });

  it('a checksum mismatch discards the download, leaves no <version>/ directory, and says so with the two next steps', async () => {
    const root = await temporaryDirectory();
    const result = await run({ config: createConfigStore(root), runner: fakeGhRelease({ download: 'corrupt' }), exec: fakeExec().exec, version: V, evidence: mac, form: 'bare' }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('did not match its published checksum') });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Everything works from the terminal. Run `terum-skills app` later to try again.') });
    expect(await readdir(join(root, 'app'))).toEqual([]);
  });

  it('per-cause wording (D7): no release for this version, offline, gh logged out, asset absent', async () => {
    const root = await temporaryDirectory();
    const at = (runner: ReturnType<typeof fakeGhRelease>) => run({ config: createConfigStore(root), runner, exec: fakeExec().exec, version: V, evidence: mac }, new ScriptedPrompter());
    expect(await at(fakeGhRelease({ download: 'no-release' }))).toMatchObject({ ok: false, error: expect.stringContaining(`No desktop app is published for terum-skills ${V}`) });
    expect(await at(fakeGhRelease({ download: 'offline' }))).toMatchObject({ ok: false, error: expect.stringContaining('offline or behind a proxy') });
    expect(await at(fakeGhRelease({ authenticated: false }))).toMatchObject({ ok: false, error: expect.stringContaining('gh auth login') });
    expect(await at(fakeGhRelease({ download: 'missing' }))).toMatchObject({ ok: false, error: expect.stringContaining('looked for') });
    for (const dir of await readdir(join(root, 'app'))) expect(dir).not.toMatch(/^\.download-/);
  });

  it('Windows on ARM: runs the per-user installer silently, then launches the installed exe (built blind, D8)', async () => {
    const root = await temporaryDirectory();
    const localAppData = join(root, 'LocalAppData');
    const calls: { command: string; args: readonly string[] }[] = [];
    const exec: Exec = async (command, args) => { calls.push({ command, args }); if (command.endsWith('-setup.exe')) await mkdir(join(localAppData, 'Terum Skills'), { recursive: true }).then(() => writeFile(join(localAppData, 'Terum Skills', 'terum-skills-desktop.exe'), '')); return ok; };
    const runner = ghOnlyRunner(async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'gh version 2.0.0', stderr: '' };
      if (args.join(' ') === 'auth status') return ok;
      const dir = args[args.indexOf('--dir') + 1]!; const name = `terum-skills-desktop_${V}_arm64-setup.exe`; const bytes = Buffer.from('nsis');
      await writeFile(join(dir, name), bytes); await writeFile(join(dir, `${name}.sha256`), `${createHash('sha256').update(bytes).digest('hex')} *${name}\n`); return ok;
    });
    const result = await run({ config: createConfigStore(root), runner, exec, version: V, evidence: { platform: 'win32', arch: 'arm64' }, localAppData }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { platform: 'win32-arm64', action: 'installed-and-launched', appPath: join(localAppData, 'Terum Skills', 'terum-skills-desktop.exe') } });
    expect(calls.map((call) => [call.command.endsWith('-setup.exe') ? 'installer' : call.command, [...call.args]])).toEqual([['installer', ['/S']], [join(localAppData, 'Terum Skills', 'terum-skills-desktop.exe'), []]]);
  });
});

describe('the offer (setup asks through the verb, D4)', () => {
  it('offer:true prints the wording and asks; a no records declined and touches nothing; a yes proceeds to download', async () => {
    const root = await temporaryDirectory();
    const store = createConfigStore(root);
    const no = new ScriptedPrompter([], [false]);
    const declined = await run({ config: store, runner: fakeGhRelease(), exec: fakeExec().exec, version: V, evidence: mac, offer: true }, no);
    expect(declined).toMatchObject({ ok: true, value: { action: 'declined', appPath: null, statePath: null } });
    expect(no.lines[0]).toBe("Terum Skills also has a desktop app. It is a wrapper around these same commands with a visual view of your team's skills. Everything works from the terminal without it.");
    expect(no.asked).toEqual(['Download and open the app?']);
    expect((await store.read()).app).toMatchObject({ choice: 'declined' });
    expect(await readdir(join(root, 'app')).catch(() => 'absent')).toBe('absent');
    const yes = new ScriptedPrompter([], [true]);
    const runner = fakeGhRelease();
    expect(await run({ config: store, runner, exec: fakeExec().exec, version: V, evidence: mac, offer: true }, yes)).toMatchObject({ ok: true, value: { action: 'installed-and-launched' } });
    expect(runner.calls.some((call) => call.args[0] === 'release')).toBe(true);
    expect((await store.read()).app).toMatchObject({ choice: 'opted-in' });
  });
});
