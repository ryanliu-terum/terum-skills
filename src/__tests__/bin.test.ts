import { execFile, spawn } from 'node:child_process';
import { cp, chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConfigStore } from '../lib/config.js';
import { systemRunner } from '../lib/runner.js';
import { installPushGuard } from '../lib/teamRepo.js';
import { bareTeam, cloneWithIdentity, exists, git, pushFromSeed } from '../lib/__tests__/fixtures.js';

const run = promisify(execFile);
const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';
const skillOf = (name: string, id: string, author: string, body = 'body') => `---\nname: ${name}\ndescription: d\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: ${author}\n  terum-category: testing\n---\n${body}\n`;
const root = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
// The compiler this package installed, wherever the package manager put it — never a hardcoded node_modules path.
const tsc = resolve(dirname(createRequire(import.meta.url).resolve('typescript')), '..', 'bin', 'tsc');

/** The shipped artifact: what `npx terum-skills` actually runs. Built once into a scratch directory so the suite never touches the repo's own dist/. */
describe('the built bin (dist/index.js)', () => {
  // Its own scratch directory, not temporaryDirectory(): that one is removed after EACH test, and the build serves both.
  let out = '';
  let bin = '';
  let env: Record<string, string> = {};
  beforeAll(async () => {
    // Realpathed: the loader resolves the built module through realpath (/var -> /private/var on macOS), so `bin` and the launcher the built resolver derives from `import.meta.url` name the same path instead of merely ending the same way.
    out = await realpath(await mkdtemp(resolve(tmpdir(), 'terum-bin-')));
    // No source maps: the built module is imported below, and a map pointing at sources that are not beside it only makes vitest warn.
    await run(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', resolve(out, 'dist'), '--sourceMap', 'false', '--declarationMap', 'false'], { cwd: root });
    // What `npm pack` would ship alongside dist/: the module type and the installed dependencies.
    await writeFile(resolve(out, 'package.json'), await readFile(resolve(root, 'package.json'), 'utf8'));
    await symlink(resolve(root, 'node_modules'), resolve(out, 'node_modules'), 'dir');
    bin = resolve(out, 'dist', 'index.js');
    const home = resolve(out, 'home');
    // An explicit child env: no inherited NODE_OPTIONS or warnings on stderr, and gh's config under the throwaway home.
    env = { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, GH_CONFIG_DIR: resolve(home, '.config', 'gh'), NODE_NO_WARNINGS: '1' };
  });
  afterAll(async () => { await rm(out, { recursive: true, force: true }); });

  function framedRun(args: string[]) {
    const result = run(process.execPath, [bin, ...args], { cwd: out, env });
    result.child.stdin?.end();
    return result;
  }

  it.each([
    ['install', '-x'], ['install', '--declined'], ['install'], ['unknown'], [], ['team'], ['sync', '--', '--hook'],
  ])('reports exactly one framed usage failure for %j', async (...args) => {
    const failed = await framedRun(['--frames', ...args]).then(
      () => { throw new Error('expected failure'); },
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
    expect(failed.code).toBe(1);
    const frames = failed.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(frames[0].t).toBe('hello');
    expect(frames.filter(frame => frame.t === 'result')).toHaveLength(1);
    expect(frames.at(-1)).toMatchObject({ t: 'result', ok: false, exitCode: 1 });
    expect(frames.at(-1)).not.toHaveProperty('declined');
    expect(frames.at(-1).error).not.toBe('(outputHelp)');
  });

  it('scans frames and hook only before the separator, removing every frames flag in that prefix', async () => {
    const framed = await framedRun(['--frames', 'search', '--frames', '--', '--hook']);
    expect(framed.stdout.trim().split('\n').map(line => JSON.parse(line)).at(-1)).toEqual({ t: 'result', verb: 'search', ok: true, exitCode: 0, value: [] });
    const plain = await run(process.execPath, [bin, 'search', '--', '--frames'], { cwd: out, env });
    const ordinary = await run(process.execPath, [bin, 'search', '--', '--hook'], { cwd: out, env });
    expect(plain.stdout).toBe(ordinary.stdout);
    expect(plain.stdout).not.toContain('"t":');
    const hook = await run(process.execPath, [bin, 'sync', '--hook'], { cwd: out, env });
    expect(hook.stdout).not.toContain('"t":');
  });

  it('keeps successful framed version and help requests as commander text without a result', async () => {
    const plain = await run(process.execPath, [bin, '--version'], { cwd: out, env });
    const framed = await framedRun(['--frames', '--version']);
    expect(framed.stdout.split('\n').slice(1).join('\n')).toBe(plain.stdout);
    expect(framed.stdout).not.toContain('"t":"result"');
    const help = await framedRun(['--frames', '--help']);
    expect(help.stdout).toContain('Usage:');
    expect(help.stdout).not.toContain('"t":"result"');
  });

  it('the build bundles the canonical /terum-skills skill where the built wrapper module resolves it, byte for byte, marker intact', async () => {
    const bundle = await run(process.execPath, [resolve(root, 'scripts', 'bundle-skill.mjs'), '--out', resolve(out, 'dist')], { cwd: root });
    const bundled = resolve(out, 'dist', 'claude', 'skills', 'terum-skills', 'SKILL.md');
    expect(bundle.stderr.trim()).toBe(`Bundled ${resolve(root, '.claude', 'skills', 'terum-skills', 'SKILL.md')} -> ${bundled}`);
    expect(await readFile(bundled, 'utf8')).toBe(await readFile(resolve(root, '.claude', 'skills', 'terum-skills', 'SKILL.md'), 'utf8'));
    const wrapper = await import(pathToFileURL(resolve(out, 'dist', 'lib', 'wrapper.js')).href) as typeof import('../lib/wrapper.js');
    expect(wrapper.BUNDLED_WRAPPER).toBe(bundled);
    expect(wrapper.isManagedWrapper(await readFile(bundled, 'utf8'))).toBe(true);
    const home = resolve(out, 'bundle-home');
    expect(await wrapper.wrapperState(wrapper.defaultWrapperOptions(home))).toBe('absent');
    expect(await wrapper.installWrapper(wrapper.defaultWrapperOptions(home))).toBe('installed');
    expect(await readFile(resolve(home, '.claude', 'skills', 'terum-skills', 'SKILL.md'), 'utf8')).toBe(await readFile(bundled, 'utf8'));
  });

  async function installedLayout(prefix: string) {
    const packageRoot = resolve(prefix, 'node_modules/terum-skills');
    await mkdir(packageRoot, { recursive: true });
    await cp(resolve(out, 'dist'), resolve(packageRoot, 'dist'), { recursive: true });
    await writeFile(resolve(packageRoot, 'package.json'), await readFile(resolve(root, 'package.json')));
    await symlink(resolve(root, 'node_modules'), resolve(packageRoot, 'node_modules'), 'dir');
    const entry = resolve(packageRoot, 'dist/index.js');
    await chmod(entry, 0o755);
    return entry;
  }

  it.skipIf(process.platform === 'win32')('proves global PATH hints by name, and vetoes absent PATH, shadowing and npm execution', async () => {
    const scratch = resolve(out, 'global-fixture');
    const entry = await installedLayout(resolve(scratch, 'lib'));
    const binDir = resolve(scratch, 'bin'); await mkdir(binDir);
    const link = resolve(binDir, 'terum-skills'); await symlink(entry, link);
    const cleanPath = [dirname(process.execPath), env.PATH].join(delimiter);
    const shadow = resolve(scratch, 'shadow'); await mkdir(shadow);
    // An empty directory ahead of the real bin: a PATH walk must pass entries that lack the executable.
    const miss = resolve(scratch, 'miss'); await mkdir(miss);
    await writeFile(resolve(shadow, 'terum-skills'), '#!/bin/sh\nexit 99\n'); await chmod(resolve(shadow, 'terum-skills'), 0o755);
    for (const scenario of ['by-name', 'absolute', 'shadow', 'npm']) {
      const child = { ...env, PATH: scenario === 'absolute' ? cleanPath : [scenario === 'shadow' ? shadow : miss, binDir, cleanPath].join(delimiter), ...(scenario === 'npm' ? { npm_command: 'exec' } : {}) };
      const executable = scenario === 'by-name' ? 'terum-skills' : link;
      const prefix = scenario === 'by-name' ? 'terum-skills' : 'npx -y terum-skills@latest';
      for (const command of ['--help', 'status']) {
        const result = await run(executable, [command], { cwd: scratch, env: child });
        expect(result.stdout).toContain(`  Create a team: ${prefix} setup`);
        expect(result.stdout).toContain(`  Join a team:   ${prefix} setup <org>/<repo>`);
        expect(result.stderr).toBe('');
      }
    }
  });

  it.skipIf(process.platform === 'win32').each([null, {}])('keeps global provenance but npx hints for a .bin launch without dependency evidence (%j)', async (manifest) => {
    const work = resolve(out, manifest === null ? 'no-manifest/work' : 'empty-manifest/work');
    const entry = await installedLayout(work);
    if (manifest !== null) await writeFile(resolve(work, 'package.json'), JSON.stringify(manifest));
    const binDir = resolve(work, 'node_modules/.bin'); await mkdir(binDir);
    const link = resolve(binDir, 'terum-skills'); await symlink(entry, link);
    const child = { ...env, PATH: [dirname(process.execPath), env.PATH].join(delimiter), TERUM_SKILLS_NO_UPDATE_NOTIFIER: '1' };
    const misuse = await run(link, ['uninstall', 'foo'], { cwd: work, env: child }).then(() => { throw new Error('expected failure'); }, (error: { code: number; stderr: string }) => error);
    expect(misuse.code).toBe(1);
    expect(misuse.stderr).toBe('To remove a skill, use `npx -y terum-skills@latest uninstall-skill <ref>`.\n');
    expect((await run(link, ['status'], { cwd: work, env: child })).stdout).toContain('Create a team: npx -y terum-skills@latest setup');
    const update = await run(link, ['update'], { cwd: work, env: child });
    expect(update.stdout).toContain('If installed globally with npm, run:');
    expect(update.stdout).toContain('npm install -g terum-skills@latest');
    expect(update.stdout).not.toContain('Declared dependency of:');
  });

  it('a bare `setup` with stdin not a TTY fails closed at the create-or-join question: exit 1, no gh or git spawned, nothing written under HOME', async () => {
    const home = resolve(out, 'notty-home'); await mkdir(home, { recursive: true });
    const shims = resolve(out, 'notty-shims'); await mkdir(shims, { recursive: true });
    for (const tool of ['gh', 'git']) { await writeFile(resolve(shims, tool), `#!/bin/sh\n: > "${resolve(out, `notty-${tool}-called`)}"\nexit 1\n`); await chmod(resolve(shims, tool), 0o755); }
    const child = { ...env, HOME: home, USERPROFILE: home, GH_CONFIG_DIR: resolve(home, '.config', 'gh'), PATH: `${shims}${delimiter}${env.PATH}` };
    const failed = await run(process.execPath, [bin, 'setup'], { cwd: root, env: child }).then(() => { throw new Error('expected a non-zero exit'); }, (error: { code?: number; stdout: string; stderr: string }) => error);
    expect.soft(failed.code).toBe(1);
    expect.soft(failed.stderr).toBe('Cannot ask "Create a team or join one?\n1. Create a new team\n2. Join an existing team\n>": this command needs an interactive terminal (stdin is not a TTY).\n');
    expect.soft(failed.stdout).toContain('Creating a new team creates a private GitHub repository under your account.');
    for (const tool of ['gh', 'git']) expect.soft(await exists(resolve(out, `notty-${tool}-called`)), `${tool} was spawned`).toBe(false);
    expect.soft(await exists(resolve(home, '.terum'))).toBe(false);
    expect.soft(await exists(resolve(home, '.claude'))).toBe(false);
  });

  it('status prints the installed version and exact onboarding hints on stdout only', async () => {
    const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
    const result = await run(process.execPath, [bin, 'status'], { cwd: root, env });
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`terum-skills ${version}\nNo team is configured on this machine.\n  Create a team: npx -y terum-skills@latest setup\n  Join a team:   npx -y terum-skills@latest setup <org>/<repo>\n`);
    const failed = await run(process.execPath, [bin, 'status', '--team', 'nope'], { cwd: root, env }).then(() => { throw new Error('expected failure'); }, (error: { code: number; stdout: string; stderr: string }) => error);
    expect(failed).toMatchObject({ code: 1, stdout: `terum-skills ${version}\n`, stderr: 'Team nope is not configured.\n' });
  });

  it('prints the shipped package version and source-checkout update advice', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const version = await run(process.execPath, [bin, '--version'], { cwd: root, env });
    expect(version.stdout).toBe(`${manifest.version}\n`); expect(version.stderr).toBe('');
    const update = await run(process.execPath, [bin, 'update'], { cwd: root, env: { ...env, TERUM_SKILLS_NO_UPDATE_NOTIFIER: '1' } });
    expect(update.stdout).toContain(`terum-skills ${manifest.version}\nThis copy: ${bin}\n`);
    expect(update.stdout).toContain('Running from a source checkout.'); expect(update.stderr).toBe('');
  });

  it('gates notices on stderr TTY, CI and both opt-outs, with a positive sibling that prints last', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const stateRoot = resolve(out, 'notice-home/.terum/skills'); const at = new Date().toISOString();
    await mkdir(resolve(stateRoot, 'run'), { recursive: true });
    const state = { schema: 1, package: 'terum-skills', upstream: 'https://github.com/ryanliu-terum/terum-skills.git', running: null, registry: null, advertisement: { version: '9.9.9', at, source: 'git-tags' }, attempt: null, ack: null };
    const bootstrap = resolve(out, 'tty.mjs');
    await writeFile(bootstrap, `Object.defineProperty(process.stderr, 'isTTY', { value: true }); process.argv = [process.execPath, ${JSON.stringify(bin)}, 'ls']; await import(${JSON.stringify(pathToFileURL(bin).href)});`);
    for (const gate of ['piped', 'CI', 'NO_UPDATE_NOTIFIER', 'TERUM_SKILLS_NO_UPDATE_NOTIFIER', 'enabled']) {
      await writeFile(resolve(stateRoot, 'run/latest-version.json'), JSON.stringify(state));
      const childEnv = { ...env, HOME: resolve(out, 'notice-home'), USERPROFILE: resolve(out, 'notice-home'), ...(gate !== 'enabled' && gate !== 'piped' ? { [gate]: '1' } : {}) };
      const result = await run(process.execPath, gate === 'piped' ? [bin, 'ls'] : [bootstrap], { cwd: root, env: childEnv }).catch((error: { stdout: string; stderr: string }) => error);
      expect(result.stdout).not.toContain('Newer terum-skills');
      if (gate === 'enabled') expect(result.stderr.trim().split('\n').at(-1)).toBe(`Newer terum-skills release advertised: 9.9.9 (running ${manifest.version}). This copy: ${bin}. Run the latest release with npx -y terum-skills@latest <command>.`);
      else expect(result.stderr).not.toContain('Newer terum-skills');
    }
  });

  it('builds with a shebang, prints help with exit 0, and fails a verb with its message on stderr and exit 1', async () => {
    expect((await readFile(bin, 'utf8')).split('\n')[0]).toBe('#!/usr/bin/env node');
    const help = await run(process.execPath, [bin, '--help'], { cwd: root, env });
    expect(help.stdout).toContain('terum-skills');
    expect(help.stdout).toContain('team');
    expect(help.stdout).toContain('Get started:');
    expect(help.stdout).toContain('npx -y terum-skills@latest setup');
    expect(help.stdout).toContain('npx -y terum-skills@latest setup <org>/<repo>');
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('uninstall-skill');
    expect(help.stdout).toMatch(/^\s*uninstall\s/m);
    const failed = await run(process.execPath, [bin, 'team', 'join', 'not a remote'], { cwd: root, env }).then(() => { throw new Error('expected a non-zero exit'); }, (error: { code?: number; stdout: string; stderr: string }) => error);
    expect(failed.code).toBe(1);
    expect(failed.stderr.trim().split('\n').at(-1)).toBe('Unsupported remote: not a remote');
    expect(failed.stdout).toBe('');
  });

  it('publishes what `npm install -g` links: `bin` names the file tsconfig.build.json emits for src/index.ts, the manifest is ESM, and prepack still builds it', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { type?: string; bin?: Record<string, string>; files?: string[]; scripts?: Record<string, string> };
    // The effective emit config with `extends` resolved: the file beforeAll compiled (outDir overridden there) and the one `npm run build` uses unmodified.
    const { config, error } = ts.readConfigFile(resolve(root, 'tsconfig.build.json'), ts.sys.readFile);
    expect(error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
    expect(parsed.errors).toEqual([]);
    expect(resolve(parsed.options.outDir ?? '')).toBe(resolve(root, 'dist'));
    expect(resolve(parsed.options.rootDir ?? '')).toBe(resolve(root, 'src'));
    expect(parsed.fileNames.map((f) => resolve(f))).toContain(resolve(root, 'src', 'index.ts'));
    // Where src/index.ts lands relative to the package root, from the config — the bin entry must name exactly that.
    const emitted = relative(root, resolve(parsed.options.outDir ?? '', 'index.js')).split(sep).join('/');
    expect(manifest.bin).toEqual({ 'terum-skills': `./${emitted}` });
    expect(manifest.files).toContain(emitted.split('/')[0]);
    // ESM: the built file uses import/export, so the shipped manifest must say so (the fixture's own manifest above merely mirrors this).
    expect(manifest.type).toBe('module');
    // The lifecycle that produces dist/ on `npm publish`: prepack runs the build, the build compiles this config.
    expect(manifest.scripts?.build).toBe('tsc -p tsconfig.build.json && node scripts/bundle-cli.mjs && node scripts/bundle-skill.mjs');
    expect(manifest.scripts?.prepack).toBe('npm run build');
  });

  it.skipIf(process.platform === 'win32')('POSIX launcher smoke test: the built file runs through a bin-directory symlink found by PATH lookup from a foreign cwd', async () => {
    const prefixBin = resolve(out, 'prefix', 'bin');
    await mkdir(prefixBin, { recursive: true });
    await symlink(relative(prefixBin, bin), resolve(prefixBin, 'terum-skills'));
    await chmod(bin, 0o755);
    // The shebang's `env node` needs the running node's directory on PATH as well.
    const pathEnv = { ...env, PATH: [prefixBin, dirname(process.execPath), env.PATH].join(delimiter) };
    const help = await run('terum-skills', ['--help'], { cwd: tmpdir(), env: pathEnv });
    expect(help.stdout).toContain('terum-skills');
    expect(help.stdout).toContain('team');
    expect(help.stderr).toBe('');
  });

  it('bare invocation: usage and the get-started hint on stderr, empty stdout, exit 1', async () => {
    const bare = await run(process.execPath, [bin], { cwd: root, env }).then(
      () => { throw new Error('expected exit 1'); },
      (error: { code?: number; stdout: string; stderr: string }) => error,
    );
    expect(bare.code).toBe(1);
    expect(bare.stdout).toBe('');
    expect(bare.stderr).toContain('Usage: terum-skills');
    expect(bare.stderr).toContain('Get started:');
    expect(bare.stderr).toContain('npx -y terum-skills@latest setup <org>/<repo>');
  });

  it('exits 0 with no stack trace when the reader closes the pipe before the output is written (`terum-skills … | head`)', async () => {
    const child = spawn(process.execPath, [bin, '--help'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    // Closing the read end before the child has even started makes its first stdout write a broken pipe — deterministic, no 64 KiB buffer to fill.
    child.stdout.destroy();
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const code = await new Promise<number | null>((done) => child.on('close', done));
    expect(Buffer.concat(stderr).toString('utf8')).toBe('');
    expect(code).toBe(0);
  });

  it('the clone-local pre-push guard (D12) makes a raw `git push` of another author\'s skill fail with the path named, lets your own edit through, judges every ref of a multi-ref push, and fails open when its launcher is gone', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/theirs/v1/SKILL.md', skillOf('theirs', THEIRS, 'Other <other@example.com>'));
    await pushFromSeed(fixture.seed, 'skills/mine/v1/SKILL.md', skillOf('mine', MINE, 'Seed <seed@example.com>'));
    const home = resolve(out, 'guard-home');
    const store = createConfigStore(resolve(home, '.terum', 'skills'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'), 'Seed', 'seed@example.com');
    // Armed through the BUILT package's own default — the resolver a real install runs (dist/index.js beside dist/lib/), not a hand-picked launcher; the machine's identity is the config under this HOME.
    const built = await import(pathToFileURL(resolve(out, 'dist', 'lib', 'teamRepo.js')).href) as typeof import('../lib/teamRepo.js');
    await built.installPushGuard(clone, systemRunner);
    const armed = await readFile(resolve(clone, '.git', 'hooks', 'pre-push'), 'utf8');
    expect(armed).toContain(bin);
    expect(armed).toContain('Re-run `npx -y terum-skills@latest team join <remote>`');
    expect(armed.split('\n').find((line) => line.includes(' guard-push'))).not.toContain('npx');
    // A machine-wide core.hooksPath pointing away from .git/hooks would hide the guard: the clone-local override is what makes the refusal below fire.
    await mkdir(resolve(home, 'no-hooks'), { recursive: true });
    await writeFile(resolve(home, '.gitconfig'), `[core]\n\thooksPath = ${resolve(home, 'no-hooks')}\n`);
    await store.update((config) => { config.display_name = 'Seed'; config.email = 'seed@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const main = (await git(['rev-parse', 'origin/main'], clone)).trim();
    const pushEnv = { ...process.env, HOME: home, USERPROFILE: home, NODE_NO_WARNINGS: '1' };
    const push = (...refspecs: string[]) => run('git', ['push', '-q', 'origin', ...(refspecs.length ? refspecs : ['HEAD:main'])], { cwd: clone, env: pushEnv }).then((result) => ({ code: 0, stderr: result.stderr }), (error: { code?: number; stderr: string }) => ({ code: error.code ?? 1, stderr: error.stderr }));
    await writeFile(resolve(clone, 'skills', 'theirs', 'SKILL.md'), skillOf('theirs', THEIRS, 'Other <other@example.com>', 'meddled'));
    await git(['commit', '-q', '-am', 'meddle'], clone);
    const refused = await push();
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain('Push guard refused skills/theirs/v1/SKILL.md');
    expect((await git(['rev-parse', 'main'], fixture.bare)).trim()).toBe(main);
    await git(['reset', '-q', '--hard', 'origin/main'], clone);
    await writeFile(resolve(clone, 'skills', 'mine', 'SKILL.md'), skillOf('mine', MINE, 'Seed <seed@example.com>', 'edited'));
    await git(['commit', '-q', '-am', 'edit mine'], clone);
    expect((await push()).code).toBe(0);
    const advanced = (await git(['rev-parse', 'main'], fixture.bare)).trim();
    expect(advanced).not.toBe(main);
    // Two refs in one push: git hands the hook two stdin lines, the shell flattens them into one argument
    // list, and the second group's refusal aborts the whole push — the allowed first group does not land either.
    await writeFile(resolve(clone, 'skills', 'mine', 'SKILL.md'), skillOf('mine', MINE, 'Seed <seed@example.com>', 'edited again'));
    await git(['commit', '-q', '-am', 'edit mine again'], clone);
    await git(['checkout', '-q', '-b', 'meddle', 'origin/main'], clone);
    await writeFile(resolve(clone, 'skills', 'theirs', 'SKILL.md'), skillOf('theirs', THEIRS, 'Other <other@example.com>', 'meddled again'));
    await git(['commit', '-q', '-am', 'meddle again'], clone);
    const two = await push('main', 'meddle:refs/heads/publish/meddle');
    expect(two.code).not.toBe(0);
    expect(two.stderr).toContain('Push guard refused skills/theirs/v1/SKILL.md');
    expect((await git(['rev-parse', 'main'], fixture.bare)).trim()).toBe(advanced);
    // The launcher is gone (an npx cache pruned): the push goes through, and says it was not checked.
    await installPushGuard(clone, systemRunner, { node: process.execPath, entry: resolve(out, 'pruned', 'index.js') });
    const unchecked = await push('meddle:refs/heads/publish/meddle');
    expect(unchecked.code).toBe(0);
    expect(unchecked.stderr).toContain('NOT checked');
  });
});
