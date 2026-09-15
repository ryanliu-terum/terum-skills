import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import type { Runner } from '../../lib/runner.js';
import { run } from '../skillToggle.js';

/**
 * `skill disable <path>` / `skill enable <path>`: the per-machine switch behind `disablePerMachine`.
 * It writes Claude Code's own `skillOverrides` setting for the root the folder sits in and touches
 * nothing else — no ledger state, no folder move, no team write.
 */
const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`;

/** A runner that answers only `git rev-parse --git-path info/exclude`, the one command the verb may issue. */
function excludeRunner(repo: string): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(command: 'git' | 'gh', args: readonly string[]) {
      calls.push([command, ...args]);
      if (command === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: join(repo, '.git', 'info', 'exclude') + '\n', stderr: '' };
      return { code: 1, stdout: '', stderr: `unexpected ${command} ${args.join(' ')}` };
    },
  } as Runner & { calls: string[][] };
}

async function fixture() {
  const home = await temporaryDirectory('terum-toggle-');
  const store = createConfigStore(join(home, '.terum', 'skills'));
  const globalPath = join(home, '.claude', 'skills', 'alpha');
  const repo = join(home, 'code', 'app');
  const projectPath = join(repo, '.claude', 'skills', 'beta');
  for (const path of [globalPath, projectPath]) { await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), skillMd(path.endsWith('alpha') ? 'alpha' : 'beta')); }
  await mkdir(join(repo, '.git', 'info'), { recursive: true });
  const runner = excludeRunner(repo);
  const io = new ScriptedPrompter([]);
  const invoke = (kind: 'enable' | 'disable', path: string) => run({ kind, path, home, config: store, runner }, io);
  return { home, store, repo, globalPath, projectPath, runner, io, invoke, userSettings: join(home, '.claude', 'settings.json'), localSettings: join(repo, '.claude', 'settings.local.json') };
}

describe('skill disable / enable', () => {
  it('a global folder writes "off" into the user settings file and reports the file it wrote', async () => {
    const f = await fixture();
    const result = await f.invoke('disable', f.globalPath);
    expect(result).toMatchObject({ ok: true, value: { kind: 'disable', path: f.globalPath, name: 'alpha', enabled: false, settingsFile: f.userSettings, changed: true, notices: [] } });
    expect(JSON.parse(await readFile(f.userSettings, 'utf8'))).toEqual({ skillOverrides: { alpha: 'off' } });
    expect(f.runner.calls).toEqual([]);
    expect(f.io.lines.at(-1)).toBe(`Disabled alpha: Claude Code no longer loads it on this machine (skillOverrides in ${f.userSettings}).`);
  });

  it('enabling removes the entry and says so; enabling an already-enabled skill changes nothing and says that too', async () => {
    const f = await fixture();
    await f.invoke('disable', f.globalPath);
    expect(await f.invoke('enable', f.globalPath)).toMatchObject({ ok: true, value: { kind: 'enable', enabled: true, changed: true } });
    expect(JSON.parse(await readFile(f.userSettings, 'utf8'))).toEqual({});
    expect(f.io.lines.at(-1)).toBe(`Enabled alpha: Claude Code loads it again on this machine (skillOverrides in ${f.userSettings}).`);
    expect(await f.invoke('enable', f.globalPath)).toMatchObject({ ok: true, value: { enabled: true, changed: false } });
    expect(f.io.lines.at(-1)).toBe('alpha is already enabled; nothing changed.');
  });

  it('a project folder writes the project-local settings file and excludes it from git when it creates the file', async () => {
    const f = await fixture();
    const result = await f.invoke('disable', f.projectPath);
    expect(result).toMatchObject({ ok: true, value: { name: 'beta', enabled: false, settingsFile: f.localSettings, changed: true } });
    expect(JSON.parse(await readFile(f.localSettings, 'utf8'))).toEqual({ skillOverrides: { beta: 'off' } });
    expect((await readFile(join(f.repo, '.git', 'info', 'exclude'), 'utf8')).split(/\r?\n/)).toContain('.claude/settings.local.json');
    expect(f.runner.calls).toEqual([['git', 'rev-parse', '--git-path', 'info/exclude']]);
    // A second write finds the file present and does not touch git again.
    await f.invoke('enable', f.projectPath);
    expect(f.runner.calls).toHaveLength(1);
  });

  it('reports, and does not fail, when the git exclude cannot be written', async () => {
    const f = await fixture();
    const runner: Runner = { async run() { return { code: 128, stdout: '', stderr: 'fatal: not a git repository' }; } };
    const result = await run({ kind: 'disable', path: f.projectPath, home: f.home, config: f.store, runner }, f.io);
    expect(result).toMatchObject({ ok: true, value: { enabled: false, changed: true } });
    expect(result.ok && result.value.notices).toEqual([`Disabled beta but could not add .claude/settings.local.json to .git/info/exclude: Could not resolve git exclude path: fatal: not a git repository`]);
    expect(JSON.parse(await readFile(f.localSettings, 'utf8'))).toEqual({ skillOverrides: { beta: 'off' } });
  });

  it('refuses a folder that is not directly under a .claude/skills root, and a folder that does not exist', async () => {
    const f = await fixture();
    const elsewhere = join(f.home, 'code', 'loose');
    await mkdir(elsewhere, { recursive: true });
    expect(await f.invoke('disable', elsewhere)).toMatchObject({ ok: false, error: `Refusing to change ${elsewhere}: it is not a folder directly under a .claude/skills directory.` });
    const missing = join(f.home, '.claude', 'skills', 'ghost');
    expect(await f.invoke('disable', missing)).toMatchObject({ ok: false, error: `Nothing at ${missing}.` });
    await expect(stat(f.userSettings)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('surfaces a malformed settings file as the verb error and leaves the file alone', async () => {
    const f = await fixture();
    await mkdir(join(f.home, '.claude'), { recursive: true });
    await writeFile(f.userSettings, '{ not json');
    expect(await f.invoke('disable', f.globalPath)).toMatchObject({ ok: false, error: `Cannot edit ${f.userSettings}: it is not valid JSON. Fix it by hand or move it aside, then re-run.` });
    expect(await readFile(f.userSettings, 'utf8')).toBe('{ not json');
  });
});
