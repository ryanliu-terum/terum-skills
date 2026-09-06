import { lstat, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fsForTests, inspect, lockTarget, place, remove, resolveTarget } from '../placer.js';
import { skillTargetLockPath, TARGET_LOCK_STALE_MS } from '../placer/vendor/skillhub/skill-target-lock.js';
import { bareTeam, cloneWithIdentity, git, temporaryDirectory } from './fixtures.js';
import { diffSkillFiles, snapshotSkillDirectory } from '../placer/vendor/skillhub/skill-fingerprint.js';

describe('native Placer (§7)', () => {
  it('uses explicit Claude Code roots, stages a copy, and refuses unowned removal', async () => {
    const root = await temporaryDirectory();
    const source = join(root, 'source');
    const target = resolveTarget('claude-code', { kind: 'global' }, undefined, root);
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), 'skill');
    expect(target).toBe(join(root, '.claude', 'skills'));
    const release = await lockTarget(target, 'sample');
    const placed = await place(source, target, 'sample');
    await release();
    expect(await readFile(join(target, 'sample', 'SKILL.md'), 'utf8')).toBe('skill');
    expect((await inspect(placed.path, true)).kind).toBe('ours');
    await expect(remove(target, join(root, 'outside'), placed.snapshot.fingerprint, join(root, 'quarantine'))).rejects.toThrow('unowned');
    await remove(target, placed.path, placed.snapshot.fingerprint, join(root, 'quarantine'));
    expect((await inspect(placed.path, false)).kind).toBe('absent');
  });

  it('uses Git\'s reported exclude path inside a linked worktree', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const worktree = join(fixture.root, 'linked');
    await git(['worktree', 'add', '-q', '--detach', worktree], clone);
    const source = join(fixture.root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'skill');
    const root = resolveTarget('claude-code', { kind: 'project', project: 'project' }, worktree);
    const release = await lockTarget(root, 'sample');
    await place(source, root, 'sample', { projectRoot: worktree });
    await release();
    const exclude = (await git(['rev-parse', '--git-path', 'info/exclude'], worktree)).trim();
    const path = exclude.startsWith('/') ? exclude : join(worktree, exclude);
    expect(await readFile(path, 'utf8')).toContain('.claude/skills/sample');
  });

  it('resolves both explicit scopes, rejects an unknown agent, and never leaves a failed copy staging folder', async () => {
    const root = await temporaryDirectory();
    expect(resolveTarget('claude-code', { kind: 'global' }, undefined, root)).toBe(join(root, '.claude', 'skills'));
    expect(resolveTarget('claude-code', { kind: 'project', project: 'p' }, join(root, 'repo'), root)).toBe(join(root, 'repo', '.claude', 'skills'));
    expect(() => resolveTarget('unknown' as never, { kind: 'global' }, undefined, root)).toThrow('Unsupported agent');
    const target = join(root, 'target');
    await expect(place(join(root, 'missing-source'), target, 'sample')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(target)).toEqual([]);
  });

  it('reports exactly added, modified, and removed files while leaving untouched files out', async () => {
    const root = await temporaryDirectory();
    const before = join(root, 'before'); const after = join(root, 'after');
    await mkdir(join(before, 'nested'), { recursive: true }); await mkdir(join(after, 'nested'), { recursive: true });
    await Promise.all([
      writeFile(join(before, 'removed.md'), 'removed'), writeFile(join(before, 'changed.md'), 'old'), writeFile(join(before, 'nested', 'same.md'), 'same'),
      writeFile(join(after, 'added.md'), 'added'), writeFile(join(after, 'changed.md'), 'new'), writeFile(join(after, 'nested', 'same.md'), 'same'),
    ]);
    const baseline = await snapshotSkillDirectory(before); const current = await snapshotSkillDirectory(after);
    expect(diffSkillFiles(baseline.files, current.files)).toEqual(['added.md', 'changed.md', 'removed.md']);
  });

  it('fails fast for a second contender and refuses nested and absent-ledger removals', async () => {
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills');
    const release = await lockTarget(target, 'sample');
    await expect(lockTarget(target, 'sample')).rejects.toThrow('target is busy');
    await release();
    await expect(remove(target, join(target, 'sample', 'nested'), 'sha256:test', join(root, 'quarantine'))).rejects.toThrow('unowned');
    await expect(remove(target, join(target, 'sample'), 'sha256:test', join(root, 'quarantine'))).resolves.toEqual({});
    // The root must be a skills directory: a ledger key pointing anywhere else is refused, not quarantined.
    const elsewhere = join(root, 'documents'); await mkdir(join(elsewhere, 'thing'), { recursive: true }); await writeFile(join(elsewhere, 'thing', 'file.txt'), 'keep');
    await expect(remove(elsewhere, join(elsewhere, 'thing'), 'sha256:test', join(root, 'quarantine'))).rejects.toThrow('not a skills directory');
    expect(await readFile(join(elsewhere, 'thing', 'file.txt'), 'utf8')).toBe('keep');
  });

  it('reclaims a target lock untouched for a minute but keeps a younger one exclusive — ten seconds is a nap, not a death', async () => {
    const root = await temporaryDirectory(); const target = join(root, 'target');
    expect(TARGET_LOCK_STALE_MS).toBe(60_000);
    const staleRelease = await lockTarget(target, 'sample');
    const lockPath = await skillTargetLockPath(target, 'sample');
    const napping = new Date(Date.now() - 11_000);
    await utimes(lockPath, napping, napping);
    await expect(lockTarget(target, 'sample')).rejects.toThrow('target is busy');
    const old = new Date(Date.now() - 61_000);
    await utimes(lockPath, old, old);
    const recoveredRelease = await lockTarget(target, 'sample');
    await writeFile(join(target, 'recovered'), 'yes');
    await recoveredRelease();
    // The displaced holder has not noticed the theft yet (its next refresh tick is half a minute away): its release resolves quietly.
    await expect(staleRelease()).resolves.toBeUndefined();
    const youngRelease = await lockTarget(target, 'sample');
    await expect(lockTarget(target, 'sample')).rejects.toThrow('target is busy');
    await youngRelease();
  });

  it('a lock another process reclaimed is reported from its release as a TargetBusyError, never thrown from the library timer', async () => {
    const root = await temporaryDirectory(); const target = join(root, 'target');
    // The floor proper-lockfile allows, so the theft is noticed on the next refresh tick (half the window).
    const release = await lockTarget(target, 'sample', { stale: 2_000 });
    const lockPath = await skillTargetLockPath(target, 'sample');
    await rm(lockPath, { recursive: true, force: true }); // another process judged us dead and took the lock away
    await new Promise((done) => setTimeout(done, 1_500));
    await expect(release()).rejects.toMatchObject({ name: 'TargetBusyError', message: expect.stringContaining(`Lost the lock on ${join(target, 'sample')}`) });
  });

  it('uses Terum’s private 0700 lock directory rather than skillhub’s shared name', async () => {
    const root = await temporaryDirectory();
    const lock = await skillTargetLockPath(join(root, 'target'), 'sample');
    expect(dirname(lock)).toMatch(/terum-skills-target-locks-(?:\d+|user)$/);
    expect(dirname(lock)).not.toContain('skillhub-cli-target-locks');
    if (process.platform !== 'win32') expect((await lstat(dirname(lock))).mode & 0o077).toBe(0);
  });

  it('quarantines edited placements but deletes identical ones, and refuses symlinked sources', async () => {
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills'); const source = join(root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'original');
    const first = await place(source, target, 'edited');
    await writeFile(join(first.path, 'SKILL.md'), 'edited by user');
    const quarantined = await remove(target, first.path, first.snapshot.fingerprint, join(root, 'quarantine'));
    expect(quarantined.quarantined).toBeDefined();
    expect(await readFile(join(quarantined.quarantined!, 'SKILL.md'), 'utf8')).toBe('edited by user');
    const second = await place(source, target, 'clean');
    expect(await remove(target, second.path, second.snapshot.fingerprint, join(root, 'quarantine'))).toEqual({});
    await expect(readFile(second.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await symlink(join(source, 'SKILL.md'), join(source, 'linked-file'));
    await expect(place(source, target, 'link')).rejects.toThrow('symlink');
  });

  it('replaces an owned placement in place with no staging residue, and rolls the previous copy back when the swap fails midway', async () => {
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills'); const source = join(root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'v1'); await writeFile(join(source, 'only-in-v1.md'), 'gone later');
    const first = await place(source, target, 'sample');
    await writeFile(join(source, 'SKILL.md'), 'v2'); await rm(join(source, 'only-in-v1.md'));
    const second = await place(source, target, 'sample', { replace: true });
    expect(second.path).toBe(first.path);
    expect(await readFile(join(first.path, 'SKILL.md'), 'utf8')).toBe('v2');
    await expect(readFile(join(first.path, 'only-in-v1.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(target)).filter((name) => name.includes('.terum-'))).toEqual([]);
    // The second rename onto the destination — after the installed copy was moved aside — fails: the
    // user's copy must come back byte for byte, and nothing may be left beside it.
    await writeFile(join(source, 'SKILL.md'), 'v3');
    const realRename = fsForTests.rename;
    let attemptsAtDestination = 0;
    fsForTests.rename = async (from, to) => {
      if (String(to) === first.path && ++attemptsAtDestination === 2) throw new Error('simulated crash after displacement');
      return realRename(from, to);
    };
    try { await expect(place(source, target, 'sample', { replace: true })).rejects.toThrow('simulated crash'); }
    finally { fsForTests.rename = realRename; }
    expect(await readFile(join(first.path, 'SKILL.md'), 'utf8')).toBe('v2');
    expect((await readdir(target)).filter((name) => name.includes('.terum-'))).toEqual([]);
  });

  it('keeps the placement failure as the message and moves a copy it cannot restore to quarantine, never leaving it hidden in the skills root', async () => {
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills'); const source = join(root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'v1');
    const first = await place(source, target, 'sample');
    await writeFile(join(source, 'SKILL.md'), 'v2');
    // Every rename onto the destination after the natural first attempt fails: the swap AND the restore.
    const realRename = fsForTests.rename;
    let attemptsAtDestination = 0;
    fsForTests.rename = async (from, to) => {
      if (String(to) === first.path && ++attemptsAtDestination >= 2) throw new Error('simulated crash after displacement');
      return realRename(from, to);
    };
    let failure: Error | undefined;
    try { await place(source, target, 'sample', { replace: true, quarantineRoot: join(root, 'quarantine') }).catch((error: Error) => { failure = error; }); }
    finally { fsForTests.rename = realRename; }
    expect(failure?.message).toContain('simulated crash after displacement');
    expect(failure?.message).toContain('could not be restored');
    expect((await readdir(target)).filter((name) => name.includes('.terum-'))).toEqual([]);
    const quarantined = (await readdir(join(root, 'quarantine'), { recursive: true })).map(String).filter((entry) => entry.endsWith(join('sample', 'SKILL.md')));
    expect(quarantined).toHaveLength(1);
    expect(await readFile(join(root, 'quarantine', quarantined[0]!), 'utf8')).toBe('v1');
  });

  it('a displaced copy whose removal fails after the swap landed goes to quarantine, never stays hidden beside the new copy', async () => {
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills'); const source = join(root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'v1');
    await place(source, target, 'sample');
    await writeFile(join(source, 'SKILL.md'), 'v2');
    // The swap succeeds; only the removal of the displaced copy fails (an immutable file, a busy handle).
    const realRm = fsForTests.rm;
    fsForTests.rm = async (path, options) => { if (String(path).includes('.terum-') && String(path).endsWith('.old')) throw new Error('simulated cleanup failure'); return realRm(path, options); };
    let failure: Error | undefined;
    try { await place(source, target, 'sample', { replace: true, quarantineRoot: join(root, 'quarantine') }).catch((error: Error) => { failure = error; }); }
    finally { fsForTests.rm = realRm; }
    expect(failure?.message).toContain('simulated cleanup failure');
    expect(failure?.message).toContain('could not be restored');
    expect(await readFile(join(target, 'sample', 'SKILL.md'), 'utf8')).toBe('v2');
    expect((await readdir(target)).filter((name) => name.includes('.terum-'))).toEqual([]);
    const quarantined = (await readdir(join(root, 'quarantine'), { recursive: true })).map(String).filter((entry) => entry.endsWith(join('sample', 'SKILL.md')));
    expect(quarantined).toHaveLength(1);
    expect(await readFile(join(root, 'quarantine', quarantined[0]!), 'utf8')).toBe('v1');
  });

  it('a staging cleanup that fails as well keeps the recovery message: the finally never replaces it', async () => {
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills'); const source = join(root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'v1');
    await place(source, target, 'sample');
    await writeFile(join(source, 'SKILL.md'), 'v2');
    // Every cleanup of a hidden `.terum-` folder fails — the persistent EACCES/EBUSY case — so the
    // staging folder's removal in the finally fails exactly like the displaced copy's did; the
    // composed message, and where the previous copy went, must survive it.
    const realRm = fsForTests.rm;
    fsForTests.rm = async (path, options) => { if (String(path).includes('.terum-')) throw new Error('simulated cleanup failure'); return realRm(path, options); };
    let failure: Error | undefined;
    try { await place(source, target, 'sample', { replace: true, quarantineRoot: join(root, 'quarantine') }).catch((error: Error) => { failure = error; }); }
    finally { fsForTests.rm = realRm; }
    expect(failure?.message).toContain('simulated cleanup failure');
    expect(failure?.message).toContain('could not be restored');
    expect(failure?.message).toContain(join(root, 'quarantine'));
    expect(await readFile(join(target, 'sample', 'SKILL.md'), 'utf8')).toBe('v2');
    expect((await readdir(target)).filter((name) => name.includes('.terum-'))).toEqual([]);
    const quarantined = (await readdir(join(root, 'quarantine'), { recursive: true })).map(String).filter((entry) => entry.endsWith(join('sample', 'SKILL.md')));
    expect(quarantined).toHaveLength(1);
    expect(await readFile(join(root, 'quarantine', quarantined[0]!), 'utf8')).toBe('v1');
  });

  it('a failure before anything was displaced rethrows the placement error itself, even when the probe for the displaced copy fails', async () => {
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills');
    // The probe for the `.old` path fails with something other than ENOENT (a locked-down skills root):
    // a run that displaced nothing must still rethrow its own error and name no copy it never made.
    const realLstat = fsForTests.lstat;
    fsForTests.lstat = async (path) => {
      if (path.endsWith('.old')) throw Object.assign(new Error('EACCES: simulated probe failure'), { code: 'EACCES' });
      return realLstat(path);
    };
    try {
      await expect(place(join(root, 'no-such-source'), target, 'sample', { quarantineRoot: join(root, 'quarantine') })).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(place(join(root, 'no-such-source'), target, 'sample', { quarantineRoot: join(root, 'quarantine') })).rejects.not.toThrow(/could not be restored/);
    } finally { fsForTests.lstat = realLstat; }
  });

  it('moves an edited placement to quarantine by copy-then-remove when the rename crosses a volume', async () => {
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills'); const source = join(root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'original');
    const placed = await place(source, target, 'edited');
    await writeFile(join(placed.path, 'SKILL.md'), 'edited by user');
    const realRename = fsForTests.rename;
    fsForTests.rename = async (from, to) => {
      if (String(to).includes('quarantine')) throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
      return realRename(from, to);
    };
    let outcome: { quarantined?: string };
    try { outcome = await remove(target, placed.path, placed.snapshot.fingerprint, join(root, 'quarantine')); }
    finally { fsForTests.rename = realRename; }
    expect(outcome.quarantined).toBeDefined();
    expect(await readFile(join(outcome.quarantined!, 'SKILL.md'), 'utf8')).toBe('edited by user');
    await expect(readFile(join(placed.path, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a completed placement when the project exclude update fails and surfaces the real copy errno', async () => {
    const root = await temporaryDirectory(); const target = join(root, 'target'); const source = join(root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'source');
    const failedExclude = await place(source, target, 'sample', { projectRoot: join(root, 'project'), runner: { run: async () => ({ code: 1, stdout: '', stderr: 'no git metadata' }) } });
    expect(await readFile(join(failedExclude.path, 'SKILL.md'), 'utf8')).toBe('source');
    expect(failedExclude.notices.join('\n')).toContain('no git metadata');
    await expect(place(join(root, 'missing'), target, 'missing')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
