import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { describe, expect, it, vi } from 'vitest';
import { APPROVED_UPSTREAM, PACKAGE_NAME } from '../package.js';
import { systemRunner } from '../runner.js';
import { createReleaseState, describeUpdate, maintainReleaseState, noticeLine, probeAdvertisement, recordRunningAndRegistry, updateNotice } from '../update.js';
import { denyingRunner, fakeLaunch, stateFileAt, taggedBare, temporaryDirectory } from './fixtures.js';

const NOW = Date.parse('2026-09-06T21:10:00Z');
const at = new Date(NOW).toISOString();
const ad = (version = '0.1.1') => ({ version, at, source: 'git-tags' as const });
const record = () => ({ schema: 1, package: PACKAGE_NAME, upstream: APPROVED_UPSTREAM, running: null, registry: null, advertisement: ad(), attempt: null, ack: null });
async function fixture() { const root = await temporaryDirectory(); return { root, state: createReleaseState(root), now: () => NOW, launch: fakeLaunch('source'), running: '0.1.0' }; }
const output = (version: string) => ({ code: 0, stdout: `${'a'.repeat(40)}\trefs/tags/v${version}\n`, stderr: '' });
const probeArgs = (upstream = APPROVED_UPSTREAM) => ['-c', `url.${upstream}.insteadOf=${upstream}`, 'ls-remote', '--tags', '--', upstream];
const fakeProbe = (version = '0.1.1') => denyingRunner([{ command: 'git', argsPrefix: probeArgs(), respond: () => output(version) }]);

describe('release state identity and sources', () => {
  it.each([{ ...record(), schema: 2 }, { ...record(), package: 'fork' }, { ...record(), upstream: 'https://fork.test/a.git' }, '{bad'])('ignores and preserves incompatible bytes: %j', async (value) => {
    const f = await fixture(); const path = await stateFileAt(f.root, value); const before = await readFile(path, 'utf8');
    expect(await f.state.read()).toBeNull();
    await recordRunningAndRegistry(f);
    expect(await readFile(path, 'utf8')).toBe(before);
  });
  it('records an unpublished source version without creating a notice candidate; unchanged observations do not rewrite', async () => {
    const f = await fixture(); await recordRunningAndRegistry({ ...f, running: '0.1.1' });
    const path = join(f.root, 'run/latest-version.json'); const before = await stat(path);
    expect(describeUpdate(await f.state.read(), '0.1.0', NOW).candidate).toBeNull();
    await recordRunningAndRegistry({ ...f, running: '0.1.1', now: () => NOW + 1000 });
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it.each(['0.2.0-rc.1', 'garbage', '1.0', '0.0.9', '0.1.0'])('does not compare %s as newer', async (version) => {
    const f = await fixture(); await stateFileAt(f.root, { ...record(), advertisement: ad(version) });
    expect(describeUpdate(await f.state.read(), '0.1.0', NOW).candidate).toBeNull();
  });
  it('treats timestamps two hours in the future as stale', async () => {
    const f = await fixture(); const future = new Date(NOW + 7200000).toISOString();
    await stateFileAt(f.root, { ...record(), advertisement: { ...ad(), at: future }, attempt: { at: future, ok: true, error: null }, ack: { at: future, version: '0.1.1' } });
    expect(describeUpdate(await f.state.read(), '0.1.0', NOW).candidate).toBeNull();
    const runner = fakeProbe(); const spy = vi.spyOn(runner, 'run');
    await maintainReleaseState({ ...f, runner, probe: 'everyone' }); expect(spy).toHaveBeenCalledTimes(1);
  });
  it('replaces advertisements downward and clears them when stable tags disappear', async () => {
    const f = await fixture(); await stateFileAt(f.root, record());
    await maintainReleaseState({ ...f, runner: fakeProbe('0.1.0'), probe: 'everyone', force: true });
    expect((await f.state.read())?.advertisement?.version).toBe('0.1.0');
    expect(describeUpdate(await f.state.read(), '0.1.0', NOW).candidate).toBeNull();
    await maintainReleaseState({ ...f, runner: fakeProbe('0.2.0-rc.1'), probe: 'everyone', force: true });
    expect((await f.state.read())?.advertisement).toBeNull();
  });
  it.each(['npx-latest', 'npx-pinned', 'npx-bare', 'local', 'global', 'source'] as const)('records registry evidence only for npx latest: %s', async (kind) => {
    const f = await fixture(); const cacheDir = join(f.root, '_npx/hash'); const manifest = join(cacheDir, 'node_modules/terum-skills/package.json');
    await mkdir(join(manifest, '..'), { recursive: true }); await writeFile(manifest, JSON.stringify({ name: PACKAGE_NAME, version: '0.1.1' })); await utimes(manifest, NOW / 1000, NOW / 1000);
    const launch = kind.startsWith('npx') ? { kind: 'npx' as const, path: join(cacheDir, 'node_modules/terum-skills/dist/index.js'), cacheDir, request: kind === 'npx-latest' ? 'terum-skills@latest' : kind === 'npx-pinned' ? 'terum-skills@0.1.1' : 'terum-skills' } : fakeLaunch(kind as 'local' | 'global' | 'source');
    if (launch.kind === 'npx') await writeFile(join(cacheDir, 'package.json'), JSON.stringify({ _npx: { packages: [launch.request] } }));
    await recordRunningAndRegistry({ ...f, launch, running: '0.1.1' });
    expect((await f.state.read())?.registry).toEqual(kind === 'npx-latest' ? { version: '0.1.1', at, source: 'npx-latest-cache', entry: join(cacheDir, 'node_modules/terum-skills') } : null);
  });
  it('allows a registry rollback rather than retaining a maximum', async () => {
    const f = await fixture(); const cacheDir = join(f.root, '_npx/hash'); const entry = join(cacheDir, 'node_modules/terum-skills');
    await mkdir(entry, { recursive: true }); await writeFile(join(entry, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '0.1.0' })); await utimes(join(entry, 'package.json'), NOW / 1000, NOW / 1000);
    await writeFile(join(cacheDir, 'package.json'), JSON.stringify({ _npx: { packages: ['terum-skills@latest'] } }));
    await stateFileAt(f.root, { ...record(), registry: { version: '99.0.0', at, source: 'npx-latest-cache', entry } });
    await recordRunningAndRegistry({ ...f, running: '0.1.0', launch: { kind: 'npx', cacheDir, path: join(entry, 'dist/index.js'), request: 'terum-skills@latest' } });
    expect((await f.state.read())?.registry?.version).toBe('0.1.0');
  });
});

describe('bounded advertisements and due checks', () => {
  it('reads only the allow-listed local bare tags and chooses numeric stable maximum', async () => {
    const { bare } = await taggedBare(['v0.1.0', 'v0.1.1', 'v0.10.0', 'v0.2.0-rc.1']);
    const runner = denyingRunner([{ command: 'git', argsPrefix: probeArgs(bare) }], systemRunner);
    const spy = vi.spyOn(runner, 'run');
    const result = await probeAdvertisement(runner, bare, { deadlineMs: 10000 });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, version: '0.10.0' });
    expect(spy).toHaveBeenCalledWith('git', probeArgs(bare), { deadlineMs: 10000, maxOutputBytes: 65536 });
  });
  it('refuses a probe whose destination differs from the state namespace before invoking the runner', async () => {
    const f = await fixture(); const runner = denyingRunner([]); const spy = vi.spyOn(runner, 'run');
    await maintainReleaseState({ ...f, upstream: '/a/different/bare', runner, probe: 'everyone', force: true });
    expect(spy).not.toHaveBeenCalled(); expect((await f.state.read())?.advertisement).toBeNull();
  });
  it.each(['exit', 'spawn', 'deadline'])('keeps the prior advertisement on %s failure and sanitizes error', async (kind) => {
    const f = await fixture(); await stateFileAt(f.root, record());
    const runner = denyingRunner([{ command: 'git', argsPrefix: probeArgs(), respond: () => { if (kind === 'spawn') throw new Error('\u001b[31moffline\u001b[0m\nsecret'); return { code: kind === 'deadline' ? 124 : 1, stdout: '', stderr: kind === 'deadline' ? 'terum-skills: git ls-remote exceeded 10 s' : '\u001b[31moffline\u001b[0m\nsecret' }; } }]);
    await maintainReleaseState({ ...f, runner, probe: 'everyone', force: true });
    const state = await f.state.read(); expect(state?.advertisement).toEqual(ad());
    expect(state?.attempt).toEqual({ at, ok: false, error: kind === 'deadline' ? 'terum-skills: git ls-remote exceeded 10 s' : 'offline' });
  });
  it.each([[23, true, 0], [23, false, 0], [25, true, 1], [25, false, 1]])('backs off after %s hours (success %s)', async (hours, ok, calls) => {
    const f = await fixture(); await stateFileAt(f.root, { ...record(), attempt: { at: new Date(NOW - Number(hours) * 3600000).toISOString(), ok, error: ok ? null : 'offline' } });
    const runner = fakeProbe(); const spy = vi.spyOn(runner, 'run');
    await maintainReleaseState({ ...f, runner, probe: 'everyone' }); expect(spy).toHaveBeenCalledTimes(Number(calls));
  });
});

describe('locked state and acknowledgment merges', () => {
  it('locks before reads, skips contention, and preserves every field from preceding writers', async () => {
    const f = await fixture(); await stateFileAt(f.root, record());
    let entered!: () => void; const inside = new Promise<void>((resolve) => { entered = resolve; });
    let finish!: () => void; const barrier = new Promise<void>((resolve) => { finish = resolve; });
    const first = f.state.update(async (state) => { entered(); await barrier; state.advertisement = ad('0.2.0'); });
    await inside;
    expect(await f.state.update((state) => { state.ack = { version: '0.1.1', at }; })).toBe(false);
    finish(); await first;
    await f.state.update((state) => { state.ack = { version: '0.1.1', at }; });
    expect(await f.state.read()).toMatchObject({ advertisement: ad('0.2.0'), ack: { version: '0.1.1', at } });
  });
  it('skips a contended observation write immediately', async () => {
    const f = await fixture(); const path = await stateFileAt(f.root, record());
    const release = await lockfile.lock(path, { realpath: false }); const start = Date.now();
    try { await recordRunningAndRegistry(f); expect(Date.now() - start).toBeLessThan(500); expect((await f.state.read())?.running).toBeNull(); }
    finally { await release(); }
  });
});

describe('notice wording and cadence', () => {
  it.each(['global', 'local', 'source', 'unknown', 'npx'] as const)('uses exact advertised advice for %s', (kind) => {
    const launch = fakeLaunch(kind);
    const advice = kind === 'local' ? 'If installed locally with npm, run npm install terum-skills@latest in /work/app.' : kind === 'global' ? 'If installed globally with npm, run npm install -g terum-skills@latest.' : `This copy: ${launch.path}. Run the latest release with npx -y terum-skills@latest <command>.`;
    expect(noticeLine({ version: '0.1.1', at, source: 'git-tags' }, '0.1.0', launch)).toBe(`Newer terum-skills release advertised: 0.1.1 (running 0.1.0). ${advice}`);
  });
  it('preserves devDependency advice and labels registry evidence as observed', () => {
    const launch = { kind: 'local' as const, path: '/work/app/node_modules/terum-skills/dist/index.js', root: '/work/app', dependencyKind: 'devDependencies' as const };
    expect(noticeLine({ version: '0.1.1', at, source: 'npx-latest-cache' }, '0.1.0', launch)).toBe('Newer terum-skills release observed: 0.1.1 (running 0.1.0). If installed locally with npm, run npm install --save-dev terum-skills@latest in /work/app.');
  });
  it('prints once per version/day, immediately for a newer version, and never for equal/lower versions', async () => {
    const f = await fixture(); await stateFileAt(f.root, record()); const lines: string[] = [];
    const args = { ...f, stderr: (line: string) => { lines.push(line); } };
    await updateNotice(args); await updateNotice(args); expect(lines).toHaveLength(1);
    await updateNotice({ ...args, now: () => NOW + 25 * 3600000 }); expect(lines).toHaveLength(2);
    await f.state.update((state) => { state.advertisement = ad('0.2.0'); });
    await updateNotice(args); expect(lines).toHaveLength(3);
    await updateNotice({ ...args, running: '0.2.0' }); await updateNotice({ ...args, running: '1.0.0' }); expect(lines).toHaveLength(3);
  });
  it('prints even if acknowledging fails, without throwing or clobbering a new advertisement', async () => {
    const f = await fixture(); await stateFileAt(f.root, record()); const lines: string[] = [];
    const update = f.state.update; f.state.update = async () => { throw new Error('refused'); };
    await expect(updateNotice({ ...f, stderr: (line) => { lines.push(line); } })).resolves.toBeUndefined(); expect(lines).toHaveLength(1);
    f.state.update = update;
    await updateNotice({ ...f, stderr: () => { /* next writer below models a later observation */ } });
    await f.state.update((state) => { state.advertisement = ad('0.3.0'); });
    expect((await f.state.read())?.advertisement).toEqual(ad('0.3.0'));
  });
});

it('does not turn a mixed npx cache request into a registry-latest observation', async () => {
  const f = await fixture(); const cacheDir = join(f.root, '_npx/hash'); const entry = join(cacheDir, 'node_modules/terum-skills');
  await mkdir(entry, { recursive: true }); await writeFile(join(entry, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '0.1.1' }));
  await writeFile(join(cacheDir, 'package.json'), JSON.stringify({ _npx: { packages: ['other-package', 'terum-skills@latest'] } }));
  await recordRunningAndRegistry({ ...f, launch: { kind: 'npx', cacheDir, path: join(entry, 'dist/index.js'), request: 'terum-skills@latest' } });
  expect((await f.state.read())?.registry).toBeNull();
});
