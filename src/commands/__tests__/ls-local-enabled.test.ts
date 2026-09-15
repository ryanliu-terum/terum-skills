import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { run } from '../ls.js';

/**
 * Every `ls --local` row carries `enabled`: false only when Claude Code's `skillOverrides` for that
 * root says `off` (src/lib/skill-overrides.ts). The Library reads this instead of remembering a
 * preference of its own, so the card agrees with Claude's `/skills` menu.
 */
const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`;

async function fixture() {
  const home = await temporaryDirectory('terum-ls-enabled-');
  const store = createConfigStore(join(home, '.terum', 'skills'));
  const repo = join(home, 'code', 'app');
  for (const path of [join(home, '.claude', 'skills', 'alpha'), join(home, '.claude', 'skills', 'beta'), join(repo, '.claude', 'skills', 'alpha')]) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'SKILL.md'), skillMd(path.split(/[\\/]/).at(-1)!));
  }
  await store.update((config) => { config.projects = [{ root: repo, label: 'App' }]; });
  const list = async () => {
    const result = await run({ local: true, home, config: store }, new ScriptedPrompter([]));
    if (!result.ok) throw new Error(result.error);
    const sections = result.value.local ?? [];
    const rows = (scope: 'global' | 'project') => Object.fromEntries(sections.filter((s) => s.scope === scope).flatMap((s) => s.rows.map((row) => [row.name, row.enabled])));
    return { sections, global: rows('global'), project: rows('project') };
  };
  return { home, store, repo, list, userSettings: join(home, '.claude', 'settings.json'), localSettings: join(repo, '.claude', 'settings.local.json') };
}

describe('ls --local enabled', () => {
  it('every row is enabled when no settings file names it', async () => {
    const f = await fixture();
    expect(await f.list()).toMatchObject({ global: { alpha: true, beta: true }, project: { alpha: true } });
  });

  it('a user-level "off" disables the global copy and, absent a project override, the project copy of the same name', async () => {
    const f = await fixture();
    await mkdir(join(f.home, '.claude'), { recursive: true });
    await writeFile(f.userSettings, JSON.stringify({ skillOverrides: { alpha: 'off' } }));
    expect(await f.list()).toMatchObject({ global: { alpha: false, beta: true }, project: { alpha: false } });
  });

  it('a project-local entry outranks the user file for that project only', async () => {
    const f = await fixture();
    await mkdir(join(f.home, '.claude'), { recursive: true });
    await mkdir(join(f.repo, '.claude'), { recursive: true });
    await writeFile(f.userSettings, JSON.stringify({ skillOverrides: { alpha: 'off' } }));
    await writeFile(f.localSettings, JSON.stringify({ skillOverrides: { alpha: 'on' } }));
    expect(await f.list()).toMatchObject({ global: { alpha: false }, project: { alpha: true } });
  });

  it('a malformed settings file is reported as that root\'s problem, and its rows read as enabled rather than guessed off', async () => {
    const f = await fixture();
    await mkdir(join(f.repo, '.claude'), { recursive: true });
    await writeFile(f.localSettings, '{ not json');
    const listed = await f.list();
    expect(listed).toMatchObject({ global: { alpha: true, beta: true }, project: { alpha: true } });
    const project = listed.sections.find((s) => s.scope === 'project')!;
    expect(project.problems).toContainEqual({ path: f.localSettings, reason: `Cannot read ${f.localSettings}: it is not valid JSON.` });
    expect(listed.sections.find((s) => s.scope === 'global')!.problems).toEqual([]);
  });

  it('a folder the inventory does not offer (a symlink) still carries enabled, read from the same files', async () => {
    const f = await fixture();
    const target = join(f.home, 'elsewhere', 'linked');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'SKILL.md'), skillMd('linked'));
    await symlink(target, join(f.home, '.claude', 'skills', 'linked'), 'dir');
    const notOffered = async () => (await f.list()).sections.find((s) => s.scope === 'global')!.notOffered.find((entry) => entry.name === 'linked');
    expect(await notOffered()).toMatchObject({ reason: 'symlink', enabled: true });
    await mkdir(join(f.home, '.claude'), { recursive: true });
    await writeFile(f.userSettings, JSON.stringify({ skillOverrides: { linked: 'off' } }));
    expect(await notOffered()).toMatchObject({ reason: 'symlink', enabled: false });
  });
});
