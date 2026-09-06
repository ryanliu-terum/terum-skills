import { spawn } from 'node:child_process';
import { access, chmod, mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireTeamLock, lockPath, LOCK_STALE_MS, reclaimStaleLock, stampIsFresh, stampPath } from '../hook.js';
import { temporaryDirectory } from './fixtures.js';

/** A pid that certainly belonged to a process which has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  const pid = child.pid!;
  await new Promise((done) => child.on('close', done));
  return pid;
}

describe('sync --hook mutex and rate limit (§8, §12 "hook mutex")', () => {
  it('creates run/<team>.lock exclusively with pid, host and start time, refuses a second live holder, is per team, and frees the lock on release', async () => {
    const root = await temporaryDirectory();
    const release = await acquireTeamLock(root, 'team');
    expect(release).not.toBeNull();
    const record = JSON.parse(await readFile(lockPath(root, 'team'), 'utf8'));
    expect(record).toMatchObject({ pid: process.pid, host: hostname() });
    expect(Date.parse(record.started)).toBeGreaterThan(Date.now() - 60_000);
    if (process.platform !== 'win32') expect((await stat(lockPath(root, 'team'))).mode & 0o777).toBe(0o600);
    expect(await acquireTeamLock(root, 'team')).toBeNull();
    const other = await acquireTeamLock(root, 'other');
    expect(other).not.toBeNull();
    await other!();
    await release!();
    await expect(access(lockPath(root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
    const again = await acquireTeamLock(root, 'team');
    expect(again).not.toBeNull();
    await again!();
  });

  it('recovers a stale lock — a dead pid on this host, or any holder older than ten minutes — and respects a live lock from another host', async () => {
    const root = await temporaryDirectory();
    const path = lockPath(root, 'team');
    await mkdir(join(root, 'run'), { recursive: true });
    await writeFile(path, JSON.stringify({ pid: await deadPid(), host: hostname(), started: new Date().toISOString() }));
    const dead = await acquireTeamLock(root, 'team');
    expect(dead).not.toBeNull();
    expect(JSON.parse(await readFile(path, 'utf8')).pid).toBe(process.pid);
    await dead!();
    const now = Date.now();
    await writeFile(path, JSON.stringify({ pid: process.pid, host: hostname(), started: new Date(now - LOCK_STALE_MS - 1_000).toISOString() }));
    const old = await acquireTeamLock(root, 'team', { now: () => now });
    expect(old).not.toBeNull();
    await old!();
    await writeFile(path, JSON.stringify({ pid: process.pid, host: 'another-machine', started: new Date(now).toISOString() }));
    expect(await acquireTeamLock(root, 'team', { now: () => now })).toBeNull();
    expect(JSON.parse(await readFile(path, 'utf8')).host).toBe('another-machine');
    await writeFile(path, JSON.stringify({ pid: process.pid, host: 'another-machine', started: new Date(now - LOCK_STALE_MS - 1_000).toISOString() }));
    const foreignOld = await acquireTeamLock(root, 'team', { now: () => now });
    expect(foreignOld).not.toBeNull();
    await foreignOld!();
  });

  it('judges an unreadable lock by its age alone, so a holder caught between its open and its write is never mistaken for a crash', async () => {
    const root = await temporaryDirectory();
    const path = lockPath(root, 'team');
    await mkdir(join(root, 'run'), { recursive: true });
    await writeFile(path, '');
    expect(await acquireTeamLock(root, 'team')).toBeNull();
    const old = new Date(Date.now() - LOCK_STALE_MS - 60_000);
    await utimes(path, old, old);
    const recovered = await acquireTeamLock(root, 'team');
    expect(recovered).not.toBeNull();
    await recovered!();
  });

  it('release frees only this holder\'s lock, so a lock reclaimed as stale mid-run stays with its new holder', async () => {
    const root = await temporaryDirectory();
    const path = lockPath(root, 'team');
    const release = await acquireTeamLock(root, 'team');
    expect(release).not.toBeNull();
    // A sync that outlives the stale window: another hook judges the lock stale and takes it over.
    const later = Date.now() + LOCK_STALE_MS + 1_000;
    const stealer = await acquireTeamLock(root, 'team', { now: () => later });
    expect(stealer).not.toBeNull();
    await release!();
    expect(JSON.parse(await readFile(path, 'utf8')).started).toBe(new Date(later).toISOString());
    expect(await acquireTeamLock(root, 'team', { now: () => later })).toBeNull();
    await stealer!();
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a reclaim removes only the record it judged: a fresh holder\'s lock that arrived in between is put back, and a lock already taken aside counts as reclaimed', async () => {
    const root = await temporaryDirectory();
    const path = lockPath(root, 'team');
    await mkdir(join(root, 'run'), { recursive: true });
    const stale = JSON.stringify({ pid: 1, host: hostname(), started: new Date(0).toISOString() });
    await writeFile(path, stale);
    expect(await reclaimStaleLock(path, stale)).toBe(true);
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    const fresh = JSON.stringify({ pid: process.pid, host: hostname(), token: 'x', started: new Date().toISOString() });
    await writeFile(path, fresh);
    expect(await reclaimStaleLock(path, stale)).toBe(false);
    expect(await readFile(path, 'utf8')).toBe(fresh);
    expect((await readdir(join(root, 'run'))).filter((name) => name.includes('.stale-'))).toEqual([]);
    expect(await reclaimStaleLock(join(root, 'run', 'gone.lock'), stale)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('tightens a run/ directory that already existed with loose permissions, so the 0600 lock is not undone by its folder', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'run'), { recursive: true });
    await chmod(join(root, 'run'), 0o755);
    const release = await acquireTeamLock(root, 'team');
    expect((await stat(join(root, 'run'))).mode & 0o777).toBe(0o700);
    await release!();
  });

  it('stampIsFresh: absent is not fresh, just written is, older than an hour is not, and a stamp dated in the future is not either', async () => {
    const root = await temporaryDirectory();
    expect(await stampIsFresh(root, 'team')).toBe(false);
    await mkdir(join(root, 'run'), { recursive: true });
    await writeFile(stampPath(root, 'team'), new Date().toISOString());
    expect(await stampIsFresh(root, 'team')).toBe(true);
    expect(await stampIsFresh(root, 'team', () => Date.now() + 2 * 3_600_000)).toBe(false);
    // A clock stepped back a day, or a run/ copied from another machine: not evidence of a recent sync.
    expect(await stampIsFresh(root, 'team', () => Date.now() - 24 * 3_600_000)).toBe(false);
  });
});
