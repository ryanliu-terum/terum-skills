import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_SKILLS, defaultWrapperOptions, fsForTests, inspectManagedSkill, installManagedSkill, isManagedFrontmatter, isManagedSkill, listManagedSkills, managedSkillInventory, managedSkillRoots, managedSkillStates, offerWrapper, readBundledSkills, refreshManagedSkills, removeManagedSkill, renderWrapper } from '../wrapper.js';
import { NPX_PREFIX, pinnedPrefix } from '../invocation.js';
import { packageVersion } from '../package.js';
import { BUNDLED_SKILL_SOURCE, CANONICAL_SKILLS, ScriptedPrompter, SYMLINKS_SUPPORTED, temporaryDirectory, wrapperFor } from './fixtures.js';

const OLD_COPY = '---\nname: terum-skills\ndescription: an older bundled copy\nmetadata:\n  managed-by: terum-skills\n---\nold body\n';
const SOMEONE_ELSES = '---\nname: terum-skills\ndescription: someone else\'s skill under the same name\n---\n';
const SKILL_NAMES = ['eval', 'eval-report', 'list-skills', 'search-skills', 'skill-info', 'skill-status', 'sync-skills', 'terum-skills'];

async function fresh(codex = true) {
  const root = await temporaryDirectory('terum-wrapper-');
  const home = join(root, 'home');
  const bundle = join(root, 'bundle');
  await mkdir(join(home, '.claude'), { recursive: true });
  if (codex) await mkdir(join(home, '.codex'), { recursive: true });
  for (const name of SKILL_NAMES) {
    await mkdir(join(bundle, name), { recursive: true });
    const raw = name === 'terum-skills'
      ? await readFile(BUNDLED_SKILL_SOURCE, 'utf8')
      : `---\nname: ${name}\ndescription: fixture ${name}\nmetadata:\n  managed-by: terum-skills\n---\n# ${name}\n\nRun \`${NPX_PREFIX} ${name} --format md\`.\n`;
    await writeFile(join(bundle, name, 'SKILL.md'), raw);
  }
  const fixture = wrapperFor(home);
  const options = { ...fixture, bundle };
  const bundled = (await readBundledSkills(bundle))!;
  const names = [...bundled.keys()].sort();
  return { root, home, options, claude: options.roots[0]!.root, codexRoot: options.roots[1]!.root, bundled, names };
}
const brace = (root: string, names: string[]) => `${root}/{${names.join(', ')}}`;

describe('the bundled terum-skills skills', () => {
  it('reads marked canonical entries and skips missing, unmarked, and misnamed entries', async () => {
    const bundled = await readBundledSkills(CANONICAL_SKILLS);
    expect(bundled).not.toBeNull();
    expect(bundled!.get('terum-skills')).toBe(await readFile(BUNDLED_SKILL_SOURCE, 'utf8'));
    for (const [name, raw] of bundled!) {
      expect(isManagedSkill(raw), name).toBe(true);
      expect(raw).toMatch(new RegExp(`^---\\s*\\r?\\nname: ${name}\\s*$`, 'm'));
    }
    const canonical = (await readdir(CANONICAL_SKILLS, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    for (const name of bundled!.keys()) expect(canonical).toContain(name);
    expect(BUNDLED_SKILLS).toMatch(/[\\/]dist[\\/]claude[\\/]skills$/);
    const root = await temporaryDirectory('terum-bundle-');
    expect(await readBundledSkills(join(root, 'nowhere'))).toBeNull();
    await mkdir(join(root, 'unmarked', 'x'), { recursive: true });
    await writeFile(join(root, 'unmarked', 'x', 'SKILL.md'), SOMEONE_ELSES);
    expect(await readBundledSkills(join(root, 'unmarked'))).toBeNull();
    await mkdir(join(root, 'misnamed', 'other'), { recursive: true });
    await writeFile(join(root, 'misnamed', 'other', 'SKILL.md'), OLD_COPY);
    expect(await readBundledSkills(join(root, 'misnamed'))).toBeNull();
  });

  it('uses the marker under any name and rejects unmarked or malformed frontmatter', () => {
    expect(isManagedSkill(OLD_COPY)).toBe(true);
    expect(isManagedSkill('---\nname: other\nmetadata:\n  managed-by: terum-skills\n---\n')).toBe(true);
    for (const raw of ['no frontmatter', '---\nname: terum-skills\n---\n', SOMEONE_ELSES, '---\nmetadata:\n  managed-by: terum-skills\n---\n', '---\nname: terum-skills\nmetadata: [x]\n---\n', '---\nname: [\n---\n']) expect(isManagedSkill(raw), raw).toBe(false);
    expect(isManagedFrontmatter(null)).toBe(false);
    expect(isManagedFrontmatter([])).toBe(false);
    expect(isManagedFrontmatter({ name: 7, metadata: { 'managed-by': 'terum-skills' } })).toBe(false);
  });

  it('uses Claude and Codex roots, with Codex eligible only when its parent exists', async () => {
    expect(managedSkillRoots('/h', {})).toEqual([{ host: 'claude', root: join('/h', '.claude', 'skills') }, { host: 'codex', root: join('/h', '.codex', 'skills') }]);
    expect(managedSkillRoots('/h', { CODEX_HOME: '/elsewhere/codex' })[1]).toEqual({ host: 'codex', root: join('/elsewhere/codex', 'skills') });
    expect(managedSkillRoots('/h', { CODEX_HOME: '' })[1]).toEqual({ host: 'codex', root: join('/h', '.codex', 'skills') });
    expect(defaultWrapperOptions('/h', undefined, {})).toMatchObject({ roots: managedSkillRoots('/h', {}), bundle: BUNDLED_SKILLS });
    expect(defaultWrapperOptions('/h').prefix).toBe(`npx -y terum-skills@${packageVersion()}`);
    expect(defaultWrapperOptions('/h', 'bare').prefix).toBe('terum-skills');
    expect(pinnedPrefix(undefined)).not.toContain('@latest');
    const { options, names } = await fresh(false);
    const states = await managedSkillStates(options);
    if (states.kind !== 'ready') throw new Error(states.kind);
    expect(states.roots.map((root) => [root.host, root.eligible])).toEqual([['claude', true], ['codex', false]]);
    expect(states.roots[0]!.skills.map((skill) => [skill.name, skill.state])).toEqual(names.map((name) => [name, 'absent']));
    expect(states.roots[1]!.skills.map((skill) => skill.state)).toEqual(names.map(() => 'absent'));
  });

  it('installs byte for byte, refreshes its own outdated copy, and removes only its marked SKILL.md', async () => {
    const { options, claude, bundled } = await fresh();
    const raw = bundled.get('terum-skills')!;
    const directory = join(claude, 'terum-skills');
    expect(await inspectManagedSkill(claude, 'terum-skills')).toEqual({ kind: 'absent' });
    expect(await installManagedSkill(claude, 'terum-skills', raw)).toBe('installed');
    expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toBe(raw);
    expect(await installManagedSkill(claude, 'terum-skills', raw)).toBe('replaced');
    await writeFile(join(directory, 'SKILL.md'), OLD_COPY);
    const states = await managedSkillStates(options);
    expect(states.kind === 'ready' && states.roots[0]!.skills.find((skill) => skill.name === 'terum-skills')?.state).toBe('outdated');
    await installManagedSkill(claude, 'terum-skills', raw);
    expect(await listManagedSkills(claude)).toEqual([{ name: 'terum-skills', directory }]);
    expect(await removeManagedSkill(claude, 'terum-skills')).toBe('removed');
    await installManagedSkill(claude, 'terum-skills', raw);
    await writeFile(join(directory, 'notes.md'), 'mine');
    expect(await removeManagedSkill(claude, 'terum-skills')).toBe('removed');
    expect(await inspectManagedSkill(claude, 'terum-skills')).toEqual({ kind: 'foreign', why: 'it has no SKILL.md' });
    expect(await removeManagedSkill(claude, 'terum-skills')).toBe('foreign');
  });

  it('removes the folder it created when the write fails, so a retry installs instead of reading it as foreign', async () => {
    const { claude, bundled } = await fresh();
    const raw = bundled.get('terum-skills')!;
    const realOpen = fsForTests.open;
    fsForTests.open = async () => { throw Object.assign(new Error('disk full (simulated)'), { code: 'ENOSPC' }); };
    try { await expect(installManagedSkill(claude, 'terum-skills', raw)).rejects.toThrow('disk full (simulated)'); }
    finally { fsForTests.open = realOpen; }
    expect(await readdir(claude)).not.toContain('terum-skills');
    expect(await inspectManagedSkill(claude, 'terum-skills')).toEqual({ kind: 'absent' });
    expect(await installManagedSkill(claude, 'terum-skills', raw)).toBe('installed');
    expect(await readFile(join(claude, 'terum-skills', 'SKILL.md'), 'utf8')).toBe(raw);
  });

  it.skipIf(!SYMLINKS_SUPPORTED)('leaves foreign skills, symlinks, files, and non-file SKILL.md entries alone', async () => {
    const other = await fresh();
    const theirs = join(other.claude, 'list-skills');
    await mkdir(theirs, { recursive: true });
    await writeFile(join(theirs, 'SKILL.md'), SOMEONE_ELSES);
    await expect(installManagedSkill(other.claude, 'list-skills', other.bundled.get('list-skills')!)).rejects.toThrow(`${theirs} exists and is not a bundled terum-skills skill (it is a different skill); move it aside and re-run.`);
    expect(await removeManagedSkill(other.claude, 'list-skills')).toBe('foreign');
    const linked = await fresh();
    const real = join(linked.root, 'real');
    await mkdir(real, { recursive: true });
    await writeFile(join(real, 'SKILL.md'), linked.bundled.get('eval')!);
    await mkdir(linked.claude, { recursive: true });
    await symlink(real, join(linked.claude, 'eval'));
    expect(await inspectManagedSkill(linked.claude, 'eval')).toEqual({ kind: 'foreign', why: 'it is a symbolic link' });
    const file = await fresh();
    await mkdir(file.claude, { recursive: true });
    await writeFile(join(file.claude, 'eval'), 'x');
    expect(await inspectManagedSkill(file.claude, 'eval')).toEqual({ kind: 'foreign', why: 'it is not a directory' });
    await mkdir(join(file.claude, 'sync-skills', 'SKILL.md'), { recursive: true });
    expect(await inspectManagedSkill(file.claude, 'sync-skills')).toEqual({ kind: 'foreign', why: 'its SKILL.md is not a regular file' });
  });

  it("places every skill in this machine's spelling: the bundle says @latest, the placed copies name the bare binary or the pinned version, and a copy in another spelling is outdated", async () => {
    const manual = await readFile(BUNDLED_SKILL_SOURCE, 'utf8');
    expect(manual).toContain(NPX_PREFIX);
    expect(renderWrapper(manual, 'terum-skills')).not.toContain('@latest');
    expect(renderWrapper(manual, NPX_PREFIX)).toBe(manual);
    const bare = await fresh(); const options = { ...bare.options, prefix: 'terum-skills' };
    for (const raw of bare.bundled.values()) expect(raw).toContain(NPX_PREFIX);
    expect(await offerWrapper(new ScriptedPrompter([], [true]), options)).toBe('installed');
    for (const root of [bare.claude, bare.codexRoot]) for (const name of bare.names) {
      const placed = await readFile(join(root, name, 'SKILL.md'), 'utf8');
      expect(placed, name).toBe(renderWrapper(bare.bundled.get(name)!, 'terum-skills'));
      expect(placed, name).not.toContain('@latest');
      expect(isManagedSkill(placed), name).toBe(true);
    }
    const states = async (judge: typeof options) => { const s = await managedSkillStates(judge); if (s.kind !== 'ready') throw new Error(s.kind); return s.roots.map((root) => root.skills.map((skill) => skill.state)); };
    const all = (state: string) => [bare.names.map(() => state), bare.names.map(() => state)];
    expect(await states(options)).toEqual(all('current'));
    // The same files judged by a copy pinned to a version: outdated, and a refresh rewrites them in that spelling.
    const pinned = { ...bare.options, prefix: 'npx -y terum-skills@9.9.9' };
    expect(await states(pinned)).toEqual(all('outdated'));
    expect((await refreshManagedSkills(pinned)).sort()).toEqual([bare.claude, bare.codexRoot].flatMap((root) => bare.names.map((name) => join(root, name))).sort());
    expect(await readFile(join(bare.claude, 'terum-skills', 'SKILL.md'), 'utf8')).toContain('npx -y terum-skills@9.9.9 ');
    expect(await states(pinned)).toEqual(all('current'));
    expect(await states(options)).toEqual(all('outdated'));
  });

  it('reports an unavailable bundle without prompting or writing', async () => {
    const { root, options, claude } = await fresh();
    const missing = { ...options, bundle: join(root, 'nowhere') };
    expect(await managedSkillStates(missing)).toEqual({ kind: 'unavailable', bundle: missing.bundle });
    const io = new ScriptedPrompter([], []);
    expect(await offerWrapper(io, missing)).toBe('unavailable');
    expect(io.asked).toEqual([]);
    expect(io.lines).toEqual([`The terum-skills skills are not bundled in this copy of terum-skills (expected under ${missing.bundle}); skipped.`]);
    expect(await refreshManagedSkills(missing)).toEqual([]);
    expect(await listManagedSkills(claude)).toEqual([]);
  });

  it('asks exactly once for a first install and subsequently reports or refreshes without asking', async () => {
    const { options, claude, codexRoot, names, bundled } = await fresh();
    const question = `Install the terum-skills skills for Claude Code and Codex so they can run terum-skills for you? (writes ${brace(claude, names)} and ${brace(codexRoot, names)})`;
    const declined = new ScriptedPrompter([], [false]);
    expect(await offerWrapper(declined, options)).toBe('declined');
    expect(declined.asked).toEqual([question]);
    expect(declined.lines).toEqual(['Skipped the terum-skills skills; re-run setup to install them later.']);
    const accepted = new ScriptedPrompter([], [true]);
    expect(await offerWrapper(accepted, options)).toBe('installed');
    expect(accepted.asked).toEqual([question]);
    expect(accepted.lines).toEqual([`Installed the terum-skills skills at ${claude}: ${names.join(', ')}.`, `Installed the terum-skills skills at ${codexRoot}: ${names.join(', ')}.`]);
    for (const root of [claude, codexRoot]) for (const name of names) expect(await readFile(join(root, name, 'SKILL.md'), 'utf8')).toBe(bundled.get(name));
    const again = new ScriptedPrompter([], []);
    expect(await offerWrapper(again, options)).toBe('present');
    expect(again.lines).toEqual([`The terum-skills skills at ${claude} and ${codexRoot} are current.`]);
    await writeFile(join(codexRoot, 'terum-skills', 'SKILL.md'), OLD_COPY);
    const refreshed = new ScriptedPrompter([], []);
    expect(await offerWrapper(refreshed, options)).toBe('replaced');
    expect(refreshed.asked).toEqual([]);
    expect(refreshed.lines).toEqual([`Updated the terum-skills skills at ${codexRoot}: terum-skills.`]);
  });

  it('migrates one old marked copy without a question, and skips Codex when its parent is absent', async () => {
    const migration = await fresh();
    await mkdir(join(migration.claude, 'terum-skills'), { recursive: true });
    await writeFile(join(migration.claude, 'terum-skills', 'SKILL.md'), OLD_COPY);
    const migrated = new ScriptedPrompter([], []);
    expect(await offerWrapper(migrated, migration.options)).toBe('installed');
    expect(migrated.asked).toEqual([]);
    const others = migration.names.filter((name) => name !== 'terum-skills');
    expect(migrated.lines).toEqual([`Installed the terum-skills skills at ${migration.claude}: ${others.join(', ')}.`, `Updated the terum-skills skills at ${migration.claude}: terum-skills.`, `Installed the terum-skills skills at ${migration.codexRoot}: ${migration.names.join(', ')}.`]);
    const absentCodex = await fresh(false);
    const io = new ScriptedPrompter([], [true]);
    expect(await offerWrapper(io, absentCodex.options)).toBe('installed');
    expect(io.asked).toEqual([`Install the terum-skills skills for Claude Code so it can run terum-skills for you? (writes ${brace(absentCodex.claude, absentCodex.names)})`]);
    expect(io.lines).toEqual([`No ${dirname(absentCodex.codexRoot)} on this machine; Codex skills skipped.`, `Installed the terum-skills skills at ${absentCodex.claude}: ${absentCodex.names.join(', ')}.`]);
  });

  it('refreshes only roots that already hold a marked copy and inventories marked and foreign entries', async () => {
    const { options, claude, codexRoot, names, bundled } = await fresh();
    expect(await refreshManagedSkills(options)).toEqual([]);
    await mkdir(join(claude, 'terum-skills'), { recursive: true });
    await writeFile(join(claude, 'terum-skills', 'SKILL.md'), OLD_COPY);
    const theirs = join(claude, 'skill-info');
    await mkdir(theirs);
    await writeFile(join(theirs, 'SKILL.md'), SOMEONE_ELSES);
    expect((await refreshManagedSkills(options)).sort()).toEqual(names.filter((name) => name !== 'skill-info').map((name) => join(claude, name)).sort());
    await installManagedSkill(claude, 'eval', bundled.get('eval')!);
    await mkdir(join(claude, 'renamed-copy'));
    await writeFile(join(claude, 'renamed-copy', 'SKILL.md'), OLD_COPY);
    await mkdir(join(codexRoot, 'sync-skills'), { recursive: true });
    await writeFile(join(codexRoot, 'sync-skills', 'SKILL.md'), SOMEONE_ELSES);
    const inventory = await managedSkillInventory(options);
    expect(inventory.roots[0]!.managed).toContainEqual({ name: 'renamed-copy', directory: join(claude, 'renamed-copy') });
    expect(inventory.roots[1]!.foreign).toEqual([{ name: 'sync-skills', directory: join(codexRoot, 'sync-skills'), why: 'it is a different skill' }]);
  });
});
