import { cp, mkdir, realpath, readFile, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { configSchema } from '../../lib/schema.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter, SYMLINKS_SUPPORTED, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { run } from '../project.js';

async function fixture() {
  const home = await realpath(await temporaryDirectory()); const config = createConfigStore(join(home, 'state'));
  const root = join(home, 'repo'); const cwd = join(root, 'src');
  await mkdir(cwd, { recursive: true }); await mkdir(join(root, '.git'));
  return { home, config, root, cwd };
}

describe('project registry (§7.1)', () => {
  it.skipIf(!SYMLINKS_SUPPORTED)('asks for the nearest repository, stores a realpath, and adds idempotently without a team', async () => {
    const args = await fixture(); const io = new ScriptedPrompter(['']);
    expect(await run({ ...args, kind: 'add' }, io)).toMatchObject({ ok: true, value: { path: args.root, label: 'repo', added: true } });
    expect(io.asked).toEqual(['Which folder?']);
    expect(io.lines).toEqual([`Added ${args.root} to your library.`]);
    const alias = join(args.home, 'alias'); await symlink(args.root, alias);
    const again = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'add', path: alias }, again)).toMatchObject({ ok: true, value: { path: args.root, added: false } });
    expect(again.lines).toEqual([`${args.root} is already in your library.`]);
    const stored = (await args.config.read()).projects;
    expect(stored).toMatchObject([{ root: args.root, label: 'repo' }]);
    expect(stored![0]!.added_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it.skipIf(!SYMLINKS_SUPPORTED)('adds a non-git folder through an alias', async () => {
    const args = await fixture(); const root = join(args.home, 'plain'); await mkdir(root);
    const alias = join(args.home, 'alias'); await symlink(root, alias);
    expect(await run({ ...args, kind: 'add', path: alias }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { path: root } });
    expect((await args.config.read()).projects).toMatchObject([{ root, label: 'plain' }]);
  });
  it('returns a root-scoped reconcile list after a new frame-mode add and excludes other projects', async () => {
    const args = await fixture();
    const team = await bareTeam();
    const id = '92929292-9292-4292-8292-929292929292';
    const source = `---\nname: matching\ndescription: matching\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;
    await pushFromSeed(team.seed, 'skills/matching/v1/SKILL.md', source);
    const clone = await cloneWithIdentity(team.bare, args.config.teamClone('team'));
    const other = join(args.home, 'other');
    for (const root of [args.root, other]) {
      const target = join(root, '.claude', 'skills', 'matching');
      await mkdir(join(root, '.claude', 'skills'), { recursive: true });
      await cp(join(clone, 'skills', 'matching', 'v1'), target, { recursive: true });
    }
    await args.config.update(config => {
      config.teams.team = { remote: team.bare, handle: 'seed' };
      config.projects = [{ root: other, label: 'other' }];
    });
    const io = Object.assign(new ScriptedPrompter(), { channel: 'frames' as const });
    const result = await run({ ...args, kind: 'add', path: args.root }, io);
    expect(result).toMatchObject({ ok: true, value: { added: true, reconcile: { identical: [{ path: join(args.root, '.claude', 'skills', 'matching') }] } } });
    expect(result.ok && 'reconcile' in result.value && result.value.reconcile?.identical).toHaveLength(1);
    expect(result.ok && 'reconcile' in result.value && result.value.reconcile?.identical.some(row => row.path.startsWith(other))).toBe(false);
  });
  it('lists instead of asking when the terminal is not interactive', async () => {
    const args = await fixture();
    const team = await bareTeam();
    const id = '93939393-9393-4393-8393-939393939393';
    await pushFromSeed(team.seed, 'skills/matching/v1/SKILL.md', `---\nname: matching\ndescription: matching\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    const clone = await cloneWithIdentity(team.bare, args.config.teamClone('team'));
    const target = join(args.root, '.claude', 'skills', 'matching');
    await mkdir(join(args.root, '.claude', 'skills'), { recursive: true });
    await cp(join(clone, 'skills', 'matching', 'v1'), target, { recursive: true });
    await args.config.update(config => { config.teams.team = { remote: team.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter([], [], false);
    const result = await run({ ...args, kind: 'add', path: args.root }, io);
    expect(result).toMatchObject({ ok: true, value: { added: true } });
    expect(result.ok && 'reconcile' in result.value).toBe(false);
    expect(io.asked).toEqual([]);
    expect(io.lines).toContain(`  matching — matches Version 1 (${target})`);
  });
  it('does not scan when project add reports added false', async () => {
    const args = await fixture();
    expect((await run({ ...args, kind: 'add', path: args.root }, new ScriptedPrompter())).ok).toBe(true);
    await args.config.update(config => { config.teams.team = { remote: '/unused/team.git', handle: 'seed' }; });
    const reconcile = vi.fn();
    const result = await run({ ...args, kind: 'add', path: args.root, reconcile: reconcile as never }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { added: false } });
    expect(reconcile).not.toHaveBeenCalled();
  });
  it.each(['state', 'home', 'missing'])('refuses %s without writing', async (kind) => {
    const args = await fixture(); await args.config.update(() => undefined);
    const before = await readFile(join(args.config.root, 'config.json'), 'utf8');
    const path = kind === 'state' ? args.config.root : kind === 'home' ? args.home : join(args.home, 'missing');
    const result = await run({ ...args, kind: 'add', path }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(kind === 'missing' ? 'does not exist' : kind === 'state' ? 'state directory' : 'Global') });
    expect(await readFile(join(args.config.root, 'config.json'), 'utf8')).toBe(before);
  });
  /** §3.6: two roots that share a basename are both qualified — one Library row per readable name. */
  it('qualifies a colliding label by its parent, and relabels the project already stored', async () => {
    const args = await fixture();
    const first = join(args.home, 'alpha', 'web'); const second = join(args.home, 'beta', 'web');
    await mkdir(first, { recursive: true }); await mkdir(second, { recursive: true });
    await run({ ...args, kind: 'add', path: first }, new ScriptedPrompter());
    expect((await args.config.read()).projects).toMatchObject([{ root: first, label: 'web' }]);
    await run({ ...args, kind: 'add', path: second }, new ScriptedPrompter());
    expect((await args.config.read()).projects).toMatchObject([{ root: first, label: 'web (alpha)' }, { root: second, label: 'web (beta)' }]);
  });
  it('removes only registry membership, retaining the empty key and ledger', async () => {
    const args = await fixture(); const target = join(args.root, '.claude', 'skills', 'one');
    await args.config.update(c => {
      c.projects = [{ root: args.root, label: 'repo' }];
      c.placements[target] = { id: '11111111-1111-4111-8111-111111111111', team: 'team', version: null, scope: { kind: 'project', project: 'app' }, placed_at: '', fingerprint: '' };
    });
    const before = (await args.config.read()).placements; const io = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'remove', path: args.root }, io)).toMatchObject({ ok: true, value: { path: args.root, placementsRemaining: 1 } });
    expect(io.lines).toEqual([`Removed ${args.root} from your library.`, `1 placements recorded under ${args.root} stay in the ledger; uninstall-skill removes them.`]);
    const after = configSchema.parse(JSON.parse(await readFile(join(args.config.root, 'config.json'), 'utf8')));
    expect(after.projects).toEqual([]); expect(after.placements).toEqual(before);
    expect(await run({ ...args, kind: 'remove', path: args.root }, new ScriptedPrompter())).toMatchObject({ ok: false, error: `${args.root} is not in your library.` });
  });
  it('lists scanned and absent roots with their labels and skill-folder counts', async () => {
    const args = await fixture(); const absent = join(args.home, 'missing');
    const skill = join(args.root, '.claude', 'skills', 'one'); await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), '---\nname: mismatch\ndescription: x\n---\n');
    await args.config.update(c => { c.projects = [{ root: absent, label: 'missing' }, { root: args.root, label: 'repo' }]; });
    const io = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'list' }, io)).toMatchObject({ ok: true, value: { projects: [
      { path: absent, label: 'missing', rootState: 'absent', skillFolders: 0 }, { path: args.root, label: 'repo', rootState: 'scanned', skillFolders: 1 },
    ] } });
    expect(io.lines).toEqual([`missing — ${absent}; absent; 0 skill folders`, `repo — ${args.root}; scanned; 1 skill folders`]);
    expect(io.asked).toEqual([]);
    await args.config.update(c => { c.projects = []; });
    const empty = new ScriptedPrompter(); await run({ ...args, kind: 'list' }, empty); expect(empty.lines).toEqual(['none']);
  });
});

it.skipIf(!SYMLINKS_SUPPORTED)('preserves unrelated formatting and counts missing placements by lexical registry evidence', async () => {
  const args = await fixture(); const alias = join(args.home, 'alias'); await symlink(args.root, alias);
  const target = join(alias, '.claude', 'skills', 'missing');
  await args.config.update(c => {
    c.projects = [{ root: alias, label: 'alias' }]; c.extra = { kept: true };
    c.placements[target] = { id: '11111111-1111-4111-8111-111111111111', team: 'team', version: null, scope: { kind: 'project', project: 'app' }, placed_at: '', fingerprint: '' };
  });
  const file = join(args.config.root, 'config.json');
  const original = (await readFile(file, 'utf8')).replace('"kept": true', '"kept"  :  true'); await writeFile(file, original);
  const result = await run({ ...args, kind: 'remove', path: args.root }, new ScriptedPrompter());
  expect(result).toMatchObject({ ok: true, value: { placementsRemaining: 1 } });
  expect(await readFile(file, 'utf8')).toContain('"kept"  :  true');
});


/** Sub-projects (2026-09-19): a registered folder inside a registered folder, read off the paths; `project rename` names a row. */
describe('sub-projects and rename', () => {
  it('adds a folder inside a project as its sub-project, labelled by its path inside the parent', async () => {
    const args = await fixture(); const web = join(args.root, 'apps', 'web'); await mkdir(web, { recursive: true });
    await run({ ...args, kind: 'add', path: args.root }, new ScriptedPrompter());
    const io = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'add', path: web }, io)).toMatchObject({ ok: true, value: { path: web, label: join('apps', 'web'), added: true, parent: args.root } });
    expect(io.lines).toEqual([`Added ${web} to your library as a sub-project of repo.`]);
    expect((await args.config.read()).projects).toMatchObject([{ root: args.root, label: 'repo' }, { root: web, label: join('apps', 'web') }]);
  });
  it('adopts registered folders inside a project added later, and lists the tree in order', async () => {
    const args = await fixture();
    const web = join(args.root, 'apps', 'web'), api = join(args.root, 'packages', 'api'), other = join(args.home, 'other');
    for (const dir of [web, api, other]) await mkdir(dir, { recursive: true });
    for (const dir of [api, other, web]) await run({ ...args, kind: 'add', path: dir }, new ScriptedPrompter());
    expect((await args.config.read()).projects).toMatchObject([{ label: 'api' }, { label: 'other' }, { label: 'web' }]);
    const io = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'add', path: args.root }, io)).toMatchObject({ ok: true, value: { path: args.root, label: 'repo', added: true, parent: null } });
    expect(io.lines).toEqual([`Added ${args.root} to your library.`, `2 projects already in your library sit inside it and are now its sub-projects: ${join('packages', 'api')}, ${join('apps', 'web')}.`]);
    const list = new ScriptedPrompter();
    const result = await run({ ...args, kind: 'list' }, list);
    expect(result).toMatchObject({ ok: true, value: { projects: [
      { path: other, label: 'other', parent: null }, { path: args.root, label: 'repo', parent: null },
      { path: api, label: join('packages', 'api'), parent: args.root }, { path: web, label: join('apps', 'web'), parent: args.root },
    ] } });
    expect(list.lines).toEqual([
      `other — ${other}; absent; 0 skill folders`, `repo — ${args.root}; absent; 0 skill folders`,
      `  ${join('packages', 'api')} — ${api}; absent; 0 skill folders`, `  ${join('apps', 'web')} — ${web}; absent; 0 skill folders`,
    ]);
  });
  it('renames a row, keeps the name across later adds, and refuses a second chosen name that reads the same', async () => {
    const args = await fixture(); const other = join(args.home, 'other'); await mkdir(other);
    await run({ ...args, kind: 'add', path: args.root }, new ScriptedPrompter());
    const io = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'rename', path: args.root, to: '  Payments ' }, io)).toMatchObject({ ok: true, value: { path: args.root, label: 'Payments', previous: 'repo' } });
    expect(io.lines).toEqual([`Renamed repo to Payments; the folder ${args.root} is unchanged.`]);
    const stored = (await args.config.read()).projects!;
    expect(stored).toMatchObject([{ root: args.root, label: 'Payments' }]);
    expect(stored[0]!.renamed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A later add recomputes derived labels only; the chosen one stays, and a derived twin moves out of its way.
    const payments = join(args.home, 'payments'); await mkdir(payments);
    await run({ ...args, kind: 'add', path: payments }, new ScriptedPrompter());
    expect((await args.config.read()).projects).toMatchObject([{ root: args.root, label: 'Payments' }, { root: payments, label: `payments (${basename(args.home)})` }]);
    await run({ ...args, kind: 'add', path: other }, new ScriptedPrompter());
    expect(await run({ ...args, kind: 'rename', path: other, to: 'payments' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: `Another project is already named Payments (${args.root}).` });
    expect(await run({ ...args, kind: 'rename', path: other, to: 'Global' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'a project name is 1-64 characters and is not Global' });
    expect(await run({ ...args, kind: 'rename', path: join(args.home, 'missing'), to: 'x' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: `${join(args.home, 'missing')} is not in your library.` });
    expect(await run({ ...args, kind: 'rename', path: other }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Specify the new name with --to.' });
  });
  it('forgets a parent alone and says how many sub-projects stay', async () => {
    const args = await fixture(); const web = join(args.root, 'apps', 'web'); await mkdir(web, { recursive: true });
    for (const dir of [args.root, web]) await run({ ...args, kind: 'add', path: dir }, new ScriptedPrompter());
    const io = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'remove', path: args.root }, io)).toMatchObject({ ok: true, value: { path: args.root, placementsRemaining: 0, subProjectsRemaining: 1 } });
    expect(io.lines).toEqual([`Removed ${args.root} from your library.`, `0 placements recorded under ${args.root} stay in the ledger; uninstall-skill removes them.`, `1 sub-project under ${args.root} stays in your library.`]);
    expect(await run({ ...args, kind: 'list' }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { projects: [{ path: web, label: join('apps', 'web'), parent: null }] } });
  });
});
