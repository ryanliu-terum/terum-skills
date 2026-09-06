import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConfigStore } from '../lib/config.js';
import { systemRunner } from '../lib/runner.js';
import { installPushGuard } from '../lib/teamRepo.js';
import { bareTeam, cloneWithIdentity, git, pushFromSeed } from '../lib/__tests__/fixtures.js';

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
    out = await mkdtemp(resolve(tmpdir(), 'terum-bin-'));
    await run(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', out], { cwd: root });
    // What `npm pack` would ship alongside dist/: the module type and the installed dependencies.
    await writeFile(resolve(out, 'package.json'), '{ "type": "module" }\n');
    await symlink(resolve(root, 'node_modules'), resolve(out, 'node_modules'), 'dir');
    bin = resolve(out, 'index.js');
    const home = resolve(out, 'home');
    // An explicit child env: no inherited NODE_OPTIONS or warnings on stderr, and gh's config under the throwaway home.
    env = { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, GH_CONFIG_DIR: resolve(home, '.config', 'gh'), NODE_NO_WARNINGS: '1' };
  });
  afterAll(async () => { await rm(out, { recursive: true, force: true }); });

  it('builds with a shebang, prints help with exit 0, and fails a verb with its message on stderr and exit 1', async () => {
    expect((await readFile(bin, 'utf8')).split('\n')[0]).toBe('#!/usr/bin/env node');
    const help = await run(process.execPath, [bin, '--help'], { cwd: root, env });
    expect(help.stdout).toContain('terum-skills');
    expect(help.stdout).toContain('team');
    const failed = await run(process.execPath, [bin, 'team', 'join', 'not a remote'], { cwd: root, env }).then(() => { throw new Error('expected a non-zero exit'); }, (error: { code?: number; stdout: string; stderr: string }) => error);
    expect(failed.code).toBe(1);
    expect(failed.stderr.trim().split('\n').at(-1)).toBe('Unsupported remote: not a remote');
    expect(failed.stdout).toBe('');
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
    await pushFromSeed(fixture.seed, 'skills/theirs/SKILL.md', skillOf('theirs', THEIRS, 'Other <other@example.com>'));
    await pushFromSeed(fixture.seed, 'skills/mine/SKILL.md', skillOf('mine', MINE, 'Seed <seed@example.com>'));
    const home = resolve(out, 'guard-home');
    const store = createConfigStore(resolve(home, '.terum', 'skills'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'), 'Seed', 'seed@example.com');
    // The hook runs the built bin as its launcher (what a real arming records); the machine's identity is the config under this HOME.
    await installPushGuard(clone, systemRunner, { node: process.execPath, entry: bin });
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
    expect(refused.stderr).toContain('Push guard refused skills/theirs/SKILL.md');
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
    expect(two.stderr).toContain('Push guard refused skills/theirs/SKILL.md');
    expect((await git(['rev-parse', 'main'], fixture.bare)).trim()).toBe(advanced);
    // The launcher is gone (an npx cache pruned): the push goes through, and says it was not checked.
    await installPushGuard(clone, systemRunner, { node: process.execPath, entry: resolve(out, 'pruned', 'index.js') });
    const unchecked = await push('meddle:refs/heads/publish/meddle');
    expect(unchecked.code).toBe(0);
    expect(unchecked.stderr).toContain('NOT checked');
  });
});
