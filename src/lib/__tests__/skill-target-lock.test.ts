import { chmod, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPrivateLockDir, ensurePrivateLockDir } from '../placer/vendor/skillhub/skill-target-lock.js';
import { temporaryDirectory } from './fixtures.js';

// The lock directory lives in the shared OS temp root, so these three checks are all that stops
// another local user from pre-creating, symlinking, or opening it. The structural details type
// exists so the foreign-uid case — impossible to stage on a real filesystem without root — can be tested.
const details = (overrides: Partial<{ directory: boolean; symlink: boolean; uid: number; mode: number }> = {}) => ({
  isDirectory: () => overrides.directory ?? true,
  isSymbolicLink: () => overrides.symlink ?? false,
  uid: overrides.uid ?? 501,
  mode: overrides.mode ?? 0o40700,
});

describe('vendored skill-target-lock — the shared-temp lock directory is refused unless it is ours', () => {
  it('accepts a plain directory owned by the current user and refuses a file, a symlink, or another user\'s directory', () => {
    expect(() => assertPrivateLockDir('/tmp/locks', details(), 501)).not.toThrow();
    expect(() => assertPrivateLockDir('/tmp/locks', details({ directory: false }), 501)).toThrow(/unsafe SkillHub CLI lock directory/);
    expect(() => assertPrivateLockDir('/tmp/locks', details({ symlink: true }), 501)).toThrow(/unsafe SkillHub CLI lock directory/);
    expect(() => assertPrivateLockDir('/tmp/locks', details({ uid: 502 }), 501)).toThrow(/owned by another user/);
    // Windows has no uid: the ownership check is skipped there, the shape checks still apply.
    expect(() => assertPrivateLockDir('/tmp/locks', details({ uid: 502 }), null)).not.toThrow();
    expect(() => assertPrivateLockDir('/tmp/locks', details({ uid: 502, symlink: true }), null)).toThrow(/unsafe/);
  });

  it.skipIf(process.platform === 'win32')('tightens a pre-existing group- or world-accessible lock directory to 0700', async () => {
    const dir = join(await temporaryDirectory(), 'locks');
    await mkdir(dir);
    // An explicit chmod: mkdir's mode is umask-masked, so it cannot stage the loose case reliably.
    await chmod(dir, 0o755);
    expect((await lstat(dir)).mode & 0o077).not.toBe(0);
    await ensurePrivateLockDir(dir);
    expect((await lstat(dir)).mode & 0o077).toBe(0);
  });
});
