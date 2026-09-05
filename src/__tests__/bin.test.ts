import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { temporaryDirectory } from '../lib/__tests__/fixtures.js';

const run = promisify(execFile);
const root = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

/** The shipped artifact: what `npx terum-skills` actually runs. Everything else tests source through vitest. */
describe('the built bin (dist/index.js)', () => {
  it('builds with a shebang, prints help with exit 0, and fails a verb with its message on stderr and exit 1', async () => {
    await run(process.execPath, [resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], { cwd: root });
    const bin = resolve(root, 'dist', 'index.js');
    expect((await readFile(bin, 'utf8')).split('\n')[0]).toBe('#!/usr/bin/env node');
    const home = await temporaryDirectory();
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const help = await run(process.execPath, [bin, '--help'], { cwd: root, env });
    expect(help.stdout).toContain('terum-skills');
    expect(help.stdout).toContain('team');
    const failed = await run(process.execPath, [bin, 'team', 'join', 'not a remote'], { cwd: root, env }).then(() => { throw new Error('expected a non-zero exit'); }, (error: { code?: number; stdout: string; stderr: string }) => error);
    expect(failed.code).toBe(1);
    expect(failed.stderr.trim()).toBe('Unsupported remote: not a remote');
    expect(failed.stdout).toBe('');
  }, 120_000);
});
