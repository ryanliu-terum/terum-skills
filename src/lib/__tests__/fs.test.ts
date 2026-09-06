import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdirPrivate } from '../fs.js';
import { temporaryDirectory } from './fixtures.js';

describe('mkdirPrivate (the ~/.terum/skills tree is private)', () => {
  it.skipIf(process.platform === 'win32')('tightens a pre-existing, caller-owned directory to 0700', async () => {
    const dir = join(await temporaryDirectory(), 'skills');
    await mkdir(dir); await chmod(dir, 0o755);
    await mkdirPrivate(dir);
    expect(((await stat(dir)).mode & 0o777).toString(8)).toBe('700');
  });

  it.skipIf(process.platform === 'win32')('refuses a directory owned by another user, and leaves it untouched', async () => {
    const dir = join(await temporaryDirectory(), 'skills');
    await mkdir(dir); await chmod(dir, 0o755);
    // A genuinely foreign-owned directory cannot be staged without root, so the uid source is swapped for the duration of the call (the same reason the vendored lock-dir check exposes a pure predicate).
    const real = process.getuid!;
    process.getuid = () => real.call(process) + 1;
    try { await expect(mkdirPrivate(dir)).rejects.toThrow('owned by another user'); }
    finally { process.getuid = real; }
    expect(((await stat(dir)).mode & 0o777).toString(8)).toBe('755');
  });
});
