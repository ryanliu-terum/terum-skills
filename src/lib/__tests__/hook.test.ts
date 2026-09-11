import { mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stampedAt, staleLine, stampPath, fsForTests, HOOK_COMMAND, HOOK_ENTRY, hookInstalled, installHook, offerHook, removeHook } from '../hook.js';
import { ScriptedPrompter, temporaryDirectory } from './fixtures.js';

async function options() {
  const root = await temporaryDirectory('terum-hook-');
  return { root, settingsFile: join(root, 'settings.json'), backupDir: join(root, 'backups') };
}

describe('session hook (§8)', () => {
  it('creates an absent settings file with the one canonical entry and no backup', async () => {
    const target = await options();
    await expect(installHook(target)).resolves.toBe('installed');
    expect(JSON.parse(await readFile(target.settingsFile, 'utf8'))).toEqual({ hooks: { SessionStart: [HOOK_ENTRY] } });
    if (process.platform !== 'win32') expect((await stat(target.settingsFile)).mode & 0o777).toBe(0o600);
    expect(await hookInstalled(target.settingsFile)).toBe(true);
    await expect(stat(target.backupDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves unrelated settings, replaces a hand-edited matching entry, and backs up only once', async () => {
    const target = await options();
    await writeFile(target.settingsFile, JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }, { matcher: 'old', hooks: [{ type: 'command', command: 'npx terum-skills sync --hook' }] }], other: 1 }, theme: 'dark' }));
    await expect(installHook(target)).resolves.toBe('replaced');
    const after = JSON.parse(await readFile(target.settingsFile, 'utf8'));
    expect(after.hooks.SessionStart).toEqual([{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }, HOOK_ENTRY]);
    expect(after).toMatchObject({ hooks: { other: 1 }, theme: 'dark' });
    expect(await installHook(target)).toBe('replaced');
    expect((await readdir(target.backupDir)).filter((name) => name.startsWith('settings.'))).toHaveLength(1);
  });

  it('refuses malformed settings without changing bytes and removes only matching entries', async () => {
    const target = await options();
    await writeFile(target.settingsFile, '{ not json');
    await expect(installHook(target)).rejects.toThrow(`Cannot edit ${target.settingsFile}: it is not valid JSON. Fix it by hand or move it aside, then re-run.`);
    expect(await readFile(target.settingsFile, 'utf8')).toBe('{ not json');
    await writeFile(target.settingsFile, JSON.stringify({ hooks: { SessionStart: [HOOK_ENTRY, { matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }] }, theme: 'dark' }));
    await expect(removeHook(target)).resolves.toBe('removed');
    expect(JSON.parse(await readFile(target.settingsFile, 'utf8'))).toEqual({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }] }, theme: 'dark' });
    await expect(removeHook(target)).resolves.toBe('absent');
  });


  it('offers once: present asks nothing, decline writes nothing, acceptance installs', async () => {
    const target = await options();
    await mkdir(join(target.root, 'unused'), { recursive: true });
    const declined = new ScriptedPrompter([], [false]);
    await expect(offerHook(declined, target)).resolves.toBe('declined');
    expect(declined.asked).toEqual([`Install the Claude Code session-start hook so team skills sync automatically? (edits ${target.settingsFile})`]);
    const accepted = new ScriptedPrompter([], [true]);
    await expect(offerHook(accepted, target)).resolves.toBe('installed');
    expect(accepted.countAsked('Install the Claude Code session-start hook')).toBe(1);
    const present = new ScriptedPrompter();
    await expect(offerHook(present, target)).resolves.toBe('present');
    expect(present.asked).toEqual([]);
    expect(HOOK_COMMAND).toContain('terum-skills');
  });

  it('offerHook surfaces an unreadable settings file as the thrown error, asks nothing, and changes no bytes', async () => {
    const target = await options();
    await writeFile(target.settingsFile, '{ not json');
    const io = new ScriptedPrompter();
    await expect(offerHook(io, target)).rejects.toThrow(`Cannot edit ${target.settingsFile}: it is not valid JSON`);
    expect(io.asked).toEqual([]);
    expect(await readFile(target.settingsFile, 'utf8')).toBe('{ not json');
  });

  it('an interrupted rename leaves the previous file intact and parseable, and the next install succeeds', async () => {
    const target = await options();
    const original = JSON.stringify({ theme: 'dark' });
    await writeFile(target.settingsFile, original);
    const realRename = fsForTests.rename;
    fsForTests.rename = async () => { throw new Error('simulated crash between write and rename'); };
    try { await expect(installHook(target)).rejects.toThrow('simulated crash'); }
    finally { fsForTests.rename = realRename; }
    expect(await readFile(target.settingsFile, 'utf8')).toBe(original);
    expect((await readdir(target.root)).filter((name) => name.includes('.tmp'))).toEqual([]);
    await expect(installHook(target)).resolves.toBe('installed');
    expect(JSON.parse(await readFile(target.settingsFile, 'utf8')).hooks.SessionStart).toEqual([HOOK_ENTRY]);
  });
});

it('staleLine shares the freshness predicate and runnable sync spelling', async () => {
  const root = await temporaryDirectory();
  const line = 'team may be stale; run `npx -y terum-skills@latest sync`.';
  expect(await staleLine(root, 'team')).toBe(line);
  await mkdir(join(root, 'run')); await writeFile(stampPath(root, 'team'), '');
  expect(await staleLine(root, 'team')).toBeNull();
  expect(await staleLine(root, 'team', () => Date.now() + 7_200_000)).toBe(line);
});

describe('mixed session hook groups', () => {
  const unrelated = { type: 'command', command: 'echo unrelated' };
  const old = { type: 'command', command: 'npx terum-skills sync --hook' };
  it('removes only our command, preserving the matcher and extra fields', async () => {
    const target = await options();
    await writeFile(target.settingsFile, JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', extra: 'keep', hooks: [old, unrelated] }] } }));
    expect(await removeHook(target)).toBe('removed');
    expect(JSON.parse(await readFile(target.settingsFile, 'utf8'))).toEqual({ hooks: { SessionStart: [{ matcher: 'startup', extra: 'keep', hooks: [unrelated] }] } });
  });
  it('replaces our object in place inside a mixed startup group', async () => {
    const target = await options();
    await writeFile(target.settingsFile, JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', extra: 'keep', hooks: [unrelated, old] }] } }));
    expect(await installHook(target)).toBe('replaced');
    expect(JSON.parse(await readFile(target.settingsFile, 'utf8'))).toEqual({ hooks: { SessionStart: [{ matcher: 'startup', extra: 'keep', hooks: [unrelated, HOOK_ENTRY.hooks[0]] }] } });
  });
  it('moves our command out of a mixed non-startup group into the canonical group and strips later duplicates across groups', async () => {
    const target = await options();
    await writeFile(target.settingsFile, JSON.stringify({ hooks: { SessionStart: [{ matcher: 'other', extra: 'keep', hooks: [old, unrelated, old] }, { matcher: 'startup', hooks: [old, unrelated] }, { matcher: 'old', hooks: [old] }] } }));
    expect(await installHook(target)).toBe('replaced');
    expect(JSON.parse(await readFile(target.settingsFile, 'utf8'))).toEqual({ hooks: { SessionStart: [{ matcher: 'other', extra: 'keep', hooks: [unrelated] }, { matcher: 'startup', hooks: [unrelated] }, HOOK_ENTRY] } });
  });
});


it.each(['2026-09-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z'])('reads stamp mtime verbatim (%s), not its body', async iso => {
  const { root } = await options();
  expect(await stampedAt(root, 'acme')).toBeNull();
  await mkdir(join(root, 'run'));
  const path = stampPath(root, 'acme');
  await writeFile(path, 'not a timestamp');
  await utimes(path, new Date(iso), new Date(iso));
  expect(await stampedAt(root, 'acme')).toBe(iso);
});
it('stampedAt rethrows filesystem failures other than ENOENT', async () => {
  const { root } = await options();
  await writeFile(join(root, 'run'), 'not a directory');
  await expect(stampedAt(root, 'acme')).rejects.toMatchObject({ code: 'ENOTDIR' });
});

it('round-trips HEAD stamps while legacy empty and ISO stamps remain fresh by mtime', async () => {
  const { readStamp, writeStamp, stampIsFresh } = await import('../hook.js');
  const root = await temporaryDirectory();
  const stamp = { head: 'a'.repeat(40), at: new Date().toISOString() };
  await writeStamp(root, 'team', stamp);
  expect(await readStamp(root, 'team')).toEqual(stamp);
  expect(await stampIsFresh(root, 'team')).toBe(true);
  for (const legacy of ['', stamp.at, '{broken', JSON.stringify({ head: 7, at: stamp.at })]) {
    await writeFile(stampPath(root, 'team'), legacy);
    expect(await readStamp(root, 'team')).toBeNull();
    expect(await stampIsFresh(root, 'team')).toBe(true);
  }
  expect(await readStamp(root, 'missing')).toBeNull();
});

it('stamp rename uses the crash seam and cleanup cannot mask its primary error', async () => {
  const { writeStamp } = await import('../hook.js');
  const root = await temporaryDirectory();
  const rename = fsForTests.rename, rm = fsForTests.rm;
  fsForTests.rename = async () => { throw new Error('rename denied'); };
  fsForTests.rm = async () => { throw new Error('cleanup busy'); };
  try {
    await expect(writeStamp(root, 'team', { head: 'a'.repeat(40), at: new Date().toISOString() })).rejects.toThrow('rename denied');
    await expect(stat(stampPath(root, 'team'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { fsForTests.rename = rename; fsForTests.rm = rm; }
});
