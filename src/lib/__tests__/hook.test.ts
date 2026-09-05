import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOOK_COMMAND, HOOK_ENTRY, hookInstalled, installHook, offerHook, removeHook } from '../hook.js';
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
});
