import { execFile } from 'node:child_process';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { temporaryDirectory } from '../lib/__tests__/fixtures.js';

const run = promisify(execFile);
const root = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
// The compiler this package installed, wherever the package manager put it — never a hardcoded node_modules path.
const tsc = resolve(dirname(createRequire(import.meta.url).resolve('typescript')), '..', 'bin', 'tsc');

/** The shipped artifact: what `npx terum-skills` actually runs. Built into a scratch directory so the suite never touches the repo's own dist/. */
describe('the built bin (dist/index.js)', () => {
  it('builds with a shebang, prints help with exit 0, and fails a verb with its message on stderr and exit 1', async () => {
    const out = await temporaryDirectory();
    await run(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', out], { cwd: root });
    // What `npm pack` would ship alongside dist/: the module type and the installed dependencies.
    await writeFile(resolve(out, 'package.json'), '{ "type": "module" }\n');
    await symlink(resolve(root, 'node_modules'), resolve(out, 'node_modules'), 'dir');
    const bin = resolve(out, 'index.js');
    expect((await readFile(bin, 'utf8')).split('\n')[0]).toBe('#!/usr/bin/env node');
    const home = await temporaryDirectory();
    // An explicit child env: no inherited NODE_OPTIONS or warnings on stderr, and gh's config under the throwaway home.
    const env = { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, GH_CONFIG_DIR: resolve(home, '.config', 'gh'), NODE_NO_WARNINGS: '1' };
    const help = await run(process.execPath, [bin, '--help'], { cwd: root, env });
    expect(help.stdout).toContain('terum-skills');
    expect(help.stdout).toContain('team');
    const failed = await run(process.execPath, [bin, 'team', 'join', 'not a remote'], { cwd: root, env }).then(() => { throw new Error('expected a non-zero exit'); }, (error: { code?: number; stdout: string; stderr: string }) => error);
    expect(failed.code).toBe(1);
    expect(failed.stderr.trim().split('\n').at(-1)).toBe('Unsupported remote: not a remote');
    expect(failed.stdout).toBe('');
  });
});
