import { chmod, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { rename, rm } from 'node:fs/promises';
import { TRANSIENT_RETRY_DELAYS_MS, exists, mkdirPrivate, retryTransient } from '../fs.js';
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

describe('retryTransient (Windows holds a just-executed or just-written file for a moment)', () => {
  const held = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
  const recorder = () => { const sleeps: number[] = []; return { sleeps, sleep: async (ms: number) => { sleeps.push(ms); } }; };

  it.each(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])('retries %s on Windows with the bounded backoff, then returns the value', async code => {
    const { sleeps, sleep } = recorder();
    const operation = vi.fn<() => Promise<string>>().mockRejectedValueOnce(held(code)).mockRejectedValueOnce(held(code)).mockResolvedValue('placed');
    expect(await retryTransient(operation, { windows: true, sleep })).toBe('placed');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([50, 100]);
  });

  it('gives up after the last attempt and rethrows the operation error itself', async () => {
    const { sleeps, sleep } = recorder();
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(held('EPERM'));
    await expect(retryTransient(operation, { windows: true, sleep })).rejects.toMatchObject({ code: 'EPERM' });
    expect(operation).toHaveBeenCalledTimes(TRANSIENT_RETRY_DELAYS_MS.length + 1);
    expect(sleeps).toEqual([...TRANSIENT_RETRY_DELAYS_MS]);
    // About five and a half seconds in all: longer than the ~200 ms hold measured after an NSIS installer, short enough that a real lock is still reported.
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(5550);
  });

  it('honours a smaller attempt budget', async () => {
    const { sleeps, sleep } = recorder();
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(held('EBUSY'));
    await expect(retryTransient(operation, { windows: true, sleep, attempts: 3 })).rejects.toMatchObject({ code: 'EBUSY' });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([50, 100]);
  });

  it.each(['ENOENT', 'EISDIR', 'EXDEV', undefined])('never retries a non-transient code (%s), even on Windows', async code => {
    const { sleeps, sleep } = recorder();
    const error = code === undefined ? new Error('plain failure') : held(code);
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    await expect(retryTransient(operation, { windows: true, sleep })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('runs exactly once off Windows: there EPERM is a real answer', async () => {
    const { sleeps, sleep } = recorder();
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(held('EPERM'));
    await expect(retryTransient(operation, { windows: false, sleep })).rejects.toMatchObject({ code: 'EPERM' });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('defaults the platform gate to this process', async () => {
    const { sleeps, sleep } = recorder();
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(held('EPERM'));
    await expect(retryTransient(operation, { sleep })).rejects.toMatchObject({ code: 'EPERM' });
    expect(operation).toHaveBeenCalledTimes(process.platform === 'win32' ? TRANSIENT_RETRY_DELAYS_MS.length + 1 : 1);
    expect(sleeps).toEqual(process.platform === 'win32' ? [...TRANSIENT_RETRY_DELAYS_MS] : []);
  });

  it('passes a real move and a real removal through unchanged, and a real ENOENT without waiting', async () => {
    const dir = await temporaryDirectory();
    const staging = join(dir, '.download-abc'), placed = join(dir, '1.2.3');
    await mkdir(staging); await writeFile(join(staging, 'installed.json'), '{}');
    const { sleeps, sleep } = recorder();
    await retryTransient(() => rename(staging, placed), { windows: true, sleep });
    expect(await readdir(dir)).toEqual(['1.2.3']);
    expect(await exists(join(placed, 'installed.json'))).toBe(true);
    await retryTransient(() => rm(placed, { recursive: true, force: true }), { windows: true, sleep });
    expect(await readdir(dir)).toEqual([]);
    await expect(retryTransient(() => rename(staging, placed), { windows: true, sleep })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(sleeps).toEqual([]);
  });
});
