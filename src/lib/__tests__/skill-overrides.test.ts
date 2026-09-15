import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadOverrides, overrideFilesFor, overrideTargetFor, writeSkillEnabled } from '../skill-overrides.js';
import { temporaryDirectory } from './fixtures.js';

/**
 * Per-machine enable/disable rides Claude Code's own `skillOverrides` setting (docs: "Override skill
 * visibility from settings"): `"off"` hides the skill from the model and the `/` menu, and the `/skills`
 * menu writes the same key. terum-skills reads and writes that key and keeps no state of its own, so the
 * two switches can never disagree.
 */
async function home() {
  const root = await temporaryDirectory('terum-overrides-');
  return { root, user: join(root, '.claude', 'settings.json'), backups: join(root, '.terum', 'skills', 'backups') };
}

describe('overrideFilesFor', () => {
  it('a global root reads and writes the user settings file only', async () => {
    const h = await home();
    expect(overrideFilesFor({ scope: 'global' }, h.root)).toEqual({ write: h.user, read: [h.user] });
  });

  it('a project root writes the project-local file and reads user, shared project, then local in precedence order', async () => {
    const h = await home();
    const repo = join(h.root, 'code', 'app');
    expect(overrideFilesFor({ scope: 'project', repoRoot: repo }, h.root)).toEqual({
      write: join(repo, '.claude', 'settings.local.json'),
      read: [h.user, join(repo, '.claude', 'settings.json'), join(repo, '.claude', 'settings.local.json')],
    });
  });
});

const readSkillEnabled = async (files: string[], name: string): Promise<boolean> => { const reader = await loadOverrides(files); if (reader.problems.length) throw new Error(reader.problems[0]!.reason); return reader.enabled(name); };

describe('loadOverrides', () => {
  it('is enabled when no file exists and when no entry names the skill', async () => {
    const h = await home();
    expect(await readSkillEnabled([h.user], 'alpha')).toBe(true);
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, JSON.stringify({ skillOverrides: { other: 'off' } }));
    expect(await readSkillEnabled([h.user], 'alpha')).toBe(true);
  });

  it('only "off" disables; name-only and user-invocable-only still count as enabled', async () => {
    const h = await home();
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, JSON.stringify({ skillOverrides: { alpha: 'off', beta: 'name-only', gamma: 'user-invocable-only', delta: 'on' } }));
    expect(await readSkillEnabled([h.user], 'alpha')).toBe(false);
    expect(await readSkillEnabled([h.user], 'beta')).toBe(true);
    expect(await readSkillEnabled([h.user], 'gamma')).toBe(true);
    expect(await readSkillEnabled([h.user], 'delta')).toBe(true);
  });

  it('the later (higher-precedence) file wins when several name the skill', async () => {
    const h = await home();
    const local = join(h.root, 'local.json');
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, JSON.stringify({ skillOverrides: { alpha: 'off' } }));
    await writeFile(local, JSON.stringify({ skillOverrides: { alpha: 'on' } }));
    expect(await readSkillEnabled([h.user, local], 'alpha')).toBe(true);
    expect(await readSkillEnabled([local, h.user], 'alpha')).toBe(false);
  });

  it('a file that is not valid JSON or whose skillOverrides is not an object is a named problem, and its skills read as enabled rather than guessed off', async () => {
    const h = await home();
    const local = join(h.root, 'local.json');
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, '{ not json');
    await writeFile(local, JSON.stringify({ skillOverrides: { beta: 'off' } }));
    const reader = await loadOverrides([h.user, local]);
    expect(reader.problems).toEqual([{ path: h.user, reason: `Cannot read ${h.user}: it is not valid JSON.` }]);
    expect(reader.enabled('alpha')).toBe(true);
    expect(reader.enabled('beta')).toBe(false);
    await writeFile(h.user, JSON.stringify({ skillOverrides: ['alpha'] }));
    expect((await loadOverrides([h.user])).problems).toEqual([{ path: h.user, reason: `Cannot read ${h.user}: "skillOverrides" is not an object.` }]);
  });

  it('matches names the way Claude Code does: case and spacing do not matter', async () => {
    const h = await home();
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, JSON.stringify({ skillOverrides: { 'Deploy Check': 'off' } }));
    expect(await readSkillEnabled([h.user], 'deploy-check')).toBe(true);
    expect(await readSkillEnabled([h.user], 'deploycheck')).toBe(false);
  });
});

describe('overrideTargetFor', () => {
  it('names the user file for a global folder, the project-local file for a checkout folder, and nothing for a stray folder', async () => {
    const h = await home();
    const repo = join(h.root, 'code', 'app');
    expect(overrideTargetFor(join(h.root, '.claude', 'skills', 'alpha'), h.root)).toEqual({ name: 'alpha', repoRoot: undefined, files: { write: h.user, read: [h.user] } });
    expect(overrideTargetFor(join(repo, '.claude', 'skills', 'beta'), h.root)).toEqual({ name: 'beta', repoRoot: repo, files: { write: join(repo, '.claude', 'settings.local.json'), read: [h.user, join(repo, '.claude', 'settings.json'), join(repo, '.claude', 'settings.local.json')] } });
    expect(overrideTargetFor(join(h.root, 'code', 'loose'), h.root)).toBeUndefined();
  });
});

describe('writeSkillEnabled', () => {
  it('disabling creates an absent settings file with one "off" entry, mode 0600, and no backup', async () => {
    const h = await home();
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'alpha', false)).resolves.toEqual({ changed: true, created: true });
    expect(JSON.parse(await readFile(h.user, 'utf8'))).toEqual({ skillOverrides: { alpha: 'off' } });
    if (process.platform !== 'win32') expect((await stat(h.user)).mode & 0o777).toBe(0o600);
    await expect(stat(h.backups)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('disabling preserves every other setting and every other override, and backs the file up once', async () => {
    const h = await home();
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, JSON.stringify({ theme: 'dark', hooks: { other: 1 }, skillOverrides: { beta: 'name-only' } }));
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'alpha', false)).resolves.toEqual({ changed: true, created: false });
    expect(JSON.parse(await readFile(h.user, 'utf8'))).toEqual({ theme: 'dark', hooks: { other: 1 }, skillOverrides: { beta: 'name-only', alpha: 'off' } });
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'gamma', false)).resolves.toEqual({ changed: true, created: false });
    expect((await stat(h.backups)).isDirectory()).toBe(true);
  });

  it('enabling removes the entry and drops an emptied skillOverrides object; a second call is unchanged', async () => {
    const h = await home();
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, JSON.stringify({ theme: 'dark', skillOverrides: { alpha: 'off' } }));
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'alpha', true)).resolves.toEqual({ changed: true, created: false });
    expect(JSON.parse(await readFile(h.user, 'utf8'))).toEqual({ theme: 'dark' });
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'alpha', true)).resolves.toEqual({ changed: false, created: false });
  });

  it('enabling a skill whose entry is name-only leaves that entry alone: only "off" is ours to remove', async () => {
    const h = await home();
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, JSON.stringify({ skillOverrides: { alpha: 'name-only' } }));
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'alpha', true)).resolves.toEqual({ changed: false, created: false });
    expect(JSON.parse(await readFile(h.user, 'utf8'))).toEqual({ skillOverrides: { alpha: 'name-only' } });
  });

  it('enabling with no settings file writes nothing', async () => {
    const h = await home();
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'alpha', true)).resolves.toEqual({ changed: false, created: false });
    await expect(stat(h.user)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a malformed file without changing its bytes', async () => {
    const h = await home();
    await mkdir(join(h.root, '.claude'), { recursive: true });
    await writeFile(h.user, '{ not json');
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'alpha', false)).rejects.toThrow(`Cannot edit ${h.user}: it is not valid JSON. Fix it by hand or move it aside, then re-run.`);
    expect(await readFile(h.user, 'utf8')).toBe('{ not json');
    await writeFile(h.user, JSON.stringify({ skillOverrides: 'off' }));
    await expect(writeSkillEnabled({ settingsFile: h.user, backupDir: h.backups }, 'alpha', false)).rejects.toThrow(`Cannot edit ${h.user}: "skillOverrides" is not an object. Fix it by hand or move it aside, then re-run.`);
  });
});
