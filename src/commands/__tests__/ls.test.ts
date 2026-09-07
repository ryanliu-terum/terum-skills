import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter, temporaryDirectory, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { run } from '../ls.js';

const ID = '33333333-3333-4333-8333-333333333333';

describe('ls (§6)', () => {
  it('reads the clone without pulling, computes installs across people, and marks archived members inactive', async () => {
    const fixture = await bareTeam();
    const team = { layout_version: 2, name: 'team', categories: [], global: [ID], projects: { app: { remotes: [], skills: [ID] } }, archived: ['old'], policy: { publish: 'pr', skill_license: 'UNLICENSED' } };
    const installed = [{ id: ID, version: null, scope: { kind: 'global' }, since: '2026-09-04' }];
    await writeFile(join(fixture.seed, 'team.json'), `${JSON.stringify(team, null, 2)}\n`);
    await writeFile(join(fixture.seed, 'people', 'amy.json'), `${JSON.stringify(person('amy', { display_name: 'Amy', installed }), null, 2)}\n`);
    await writeFile(join(fixture.seed, 'people', 'old.json'), `${JSON.stringify(person('old', { installed }), null, 2)}\n`);
    await mkdir(join(fixture.seed, 'skills', 'report'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'report', 'SKILL.md'), `---\nname: report\ndescription: Report writing\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: " amy   <AMY@example.com> "\n  terum-category: docs\n---\n`);
    await git(['add', '--all'], fixture.seed);
    await git(['commit', '-q', '-m', 'skills'], fixture.seed);
    await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const store = createConfigStore(join(fixture.root, 'local'));
    await store.ensureRoot();
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'amy' }; });
    const before = await git(['rev-parse', 'HEAD'], store.teamClone('team'));
    const io = new ScriptedPrompter();
    const result = await run({ config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { skills: [{ name: 'report', installs: 2, endorsement: 'global' }] } });
    expect(io.lines).toContain('  old (inactive)');
    expect(await git(['rev-parse', 'HEAD'], store.teamClone('team'))).toBe(before);
    expect((await git(['status', '--porcelain'], store.teamClone('team'))).trim()).toBe('');
  });

  it('one folder git cannot resolve — present on disk but not in HEAD — costs one row\'s version and one reported line, never the roster or the other rows', async () => {
    const skillFile = (name: string, id: string) => `---\nname: ${name}\ndescription: ${name} skill\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/healthy/SKILL.md', skillFile('healthy', '11111111-1111-4111-8111-111111111111'));
    const store = createConfigStore(join(fixture.root, 'state'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    // A safeWrite that lost its clone lock skips its cleanup, and `reset --hard` never removes an untracked folder.
    await mkdir(join(clone, 'skills', 'ghost')); await writeFile(join(clone, 'skills', 'ghost', 'SKILL.md'), skillFile('ghost', '33333333-3333-4333-8333-333333333333'));
    const io = new ScriptedPrompter();
    const result = await run({ config: store }, io);
    const tree = (await git(['rev-parse', 'HEAD:skills/healthy'], clone)).trim().slice(0, 8);
    expect(result).toMatchObject({ ok: true, value: { skills: [expect.objectContaining({ name: 'ghost', latest: '—' }), expect.objectContaining({ name: 'healthy', latest: tree })] } });
    expect(io.lines.filter((line) => line.startsWith('ghost: Could not resolve the latest version of ghost'))).toHaveLength(1);
    expect(io.lines).toContain('Members:');
    expect(io.lines).toContain(`  healthy — Seed <seed@example.com>; testing; 0 installs; ${tree}; —`);
  });

  it('supports member and project forms', async () => {
    const fixture = await bareTeam();
    const team = { layout_version: 2, name: 'team', categories: [], global: [], projects: { app: { remotes: [], skills: [ID] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } };
    await writeFile(join(fixture.seed, 'team.json'), `${JSON.stringify(team)}\n`);
    await writeFile(join(fixture.seed, 'people', 'amy.json'), `${JSON.stringify(person('amy', { display_name: 'Amy', installed: [{ id: ID, version: null, scope: { kind: 'project', project: 'app' }, since: '2026-09-04' }] }))}\n`);
    await mkdir(join(fixture.seed, 'skills', 'report'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'report', 'SKILL.md'), `---\nname: report\ndescription: Report writing\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Amy <amy@example.com>\n  terum-category: docs\n---\n`);
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'skills'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const store = createConfigStore(join(fixture.root, 'local')); await store.ensureRoot(); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'amy' }; });
    const member = await run({ kind: 'member', value: 'Amy', config: store }, new ScriptedPrompter());
    const project = await run({ kind: 'project', value: 'app', config: store }, new ScriptedPrompter());
    expect(member).toMatchObject({ ok: true, value: { skills: [{ name: 'report', installs: 1, endorsement: 'project: app' }] } });
    expect(project).toMatchObject({ ok: true, value: { skills: [{ name: 'report', installs: 1, endorsement: 'project: app' }] } });
  });

  it('returns a failure Result — never a rejection — for an unknown member, and does not take an inherited object key for a project', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'local')); await store.ensureRoot(); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    await expect(run({ kind: 'member', value: 'nobody', config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'No member named nobody.' });
    await expect(run({ kind: 'project', value: 'constructor', config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'No project named constructor.' });
  });
});


async function localSource(home: string, name: string, raw = `---\nname: ${name}\ndescription: local\n---\n`) {
  const path = join(home, '.claude', 'skills', name); await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), raw); return path;
}
const FOOTER = 'Team status is from local clones and may be stale; open endorsement requests are not checked.';

describe('issue 9 local ls', () => {
  it('lists candidates, placements, and rejected paths with zero teams and no questions', async () => {
    const home = await temporaryDirectory(); const store = createConfigStore(join(home, 'state'));
    const mine = await localSource(home, 'mine'); const placed = await localSource(home, 'placed');
    const rejected = await localSource(home, 'gsd-x', '---\nname: gsd:x\ndescription: x\n---\n');
    await store.update((config) => { config.placements[placed] = { id: ID, team: 'team', version: 'a'.repeat(40), scope: { kind: 'global' }, fingerprint: '', placed_at: '' }; });
    const io = new ScriptedPrompter();
    const result = await run({ local: true, home, config: store, runner: { run: async () => { throw new Error('must not run commands'); } } }, io);
    expect(result).toMatchObject({ ok: true, value: { local: { root: join(home, '.claude', 'skills'), scope: 'global', rows: [{ name: 'mine', path: mine, state: 'untracked locally' }, { name: 'placed', path: placed, state: 'placement recorded from team @aaaaaaaa' }], notOffered: [{ name: 'gsd-x', path: rejected, reason: 'SKILL.md name gsd:x does not equal folder gsd-x' }], problems: [] } } });
    expect(io.lines).toEqual([`Local Claude Code skills (${join(home, '.claude', 'skills')}; global only):`, `  mine — untracked locally; path: ${mine}`, `  placed — placement recorded from team @aaaaaaaa; path: ${placed}`, 'Not offered for sharing:', `  gsd-x — SKILL.md name gsd:x does not equal folder gsd-x; path: ${rejected}`, FOOTER]);
    expect(io.asked).toEqual([]);
  });

  it.each(['global', 'project', 'unendorsed', 'missing', 'broken', 'unparsable'] as const)('enriches by ledger ID with %s clone evidence without writing or running git', async (mode) => {
    const fixture = await bareTeam(); const home = join(fixture.root, 'home');
    const stored = `---\nname: report\ndescription: stored\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;
    await pushFromSeed(fixture.seed, 'skills/report/SKILL.md', stored);
    await pushFromSeed(fixture.seed, 'team.json', JSON.stringify({ ...TEAM_JSON, global: mode === 'global' ? [ID] : [], projects: { b: { remotes: [], skills: [ID] }, a: { remotes: [], skills: [ID] } } }));
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const source = await localSource(home, 'relocated', stored); await localSource(home, 'report');
    const trackedId = mode === 'missing' || mode === 'unparsable' ? '11111111-1111-4111-8111-111111111111' : ID;
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.shared[trackedId] = { team: 'team', source }; });
    if (mode === 'unendorsed') await writeFile(join(clone, 'team.json'), JSON.stringify(TEAM_JSON));
    if (mode === 'unparsable') { await mkdir(join(clone, 'skills', 'broken')); await writeFile(join(clone, 'skills', 'broken', 'SKILL.md'), 'bad'); }
    const before = await git(['rev-parse', 'HEAD'], clone); const status = await git(['status', '--porcelain'], clone); const configBefore = await readFile(join(store.root, 'config.json'), 'utf8');
    if (mode === 'broken') await rm(clone, { recursive: true });
    const io = new ScriptedPrompter();
    const result = await run({ local: true, home, config: store, runner: { run: async () => { throw new Error('no git'); } } }, io);
    const suffix = mode === 'global' ? 'endorsed (global)' : mode === 'project' ? 'endorsed (project: a, b)' : mode === 'unendorsed' ? 'not endorsed in local clone' : mode === 'missing' ? 'repository copy missing from local clone' : 'repository status unknown';
    expect(result).toMatchObject({ ok: true, value: { local: { rows: [{ name: 'relocated', state: `shared source for team; ${suffix}` }, { name: 'report', state: 'untracked locally' }] } } });
    expect(io.lines).toContain(`  relocated — shared source for team; ${suffix}; path: ${source}`);
    expect(io.asked).toEqual([]); expect(io.lines.at(-1)).toBe(FOOTER);
    expect(await readFile(join(store.root, 'config.json'), 'utf8')).toBe(configBefore);
    if (mode !== 'broken') { expect(await git(['rev-parse', 'HEAD'], clone)).toBe(before); expect(await git(['status', '--porcelain'], clone)).toBe(status); }
  });

  it('reads each referenced team once and retains all conflicting tracking plus a source problem', async () => {
    const home = await temporaryDirectory(); const store = createConfigStore(join(home, 'state')); const path = await localSource(home, 'missing'); await rm(join(path, 'SKILL.md'));
    await localSource(home, 'second');
    await store.update((config) => {
      config.shared.one = { source: path, team: 'one' }; config.shared.two = { source: path, team: 'two' }; config.shared.three = { source: join(home, '.claude', 'skills', 'second'), team: 'one' };
      config.placements[path] = { id: ID, team: 'two', version: null, scope: { kind: 'global' }, fingerprint: '', placed_at: '' };
    });
    const calls: string[] = []; const wrapped = { ...store, teamClone: (team: string) => { calls.push(team); return store.teamClone(team); } };
    const io = new ScriptedPrompter(); const result = await run({ local: true, home, config: wrapped }, io);
    expect(result).toMatchObject({ ok: true, value: { local: { rows: [expect.objectContaining({ name: 'missing', state: 'conflicting tracking: shared source for one; repository status unknown; shared source for two; repository status unknown; placement recorded from two', problem: 'SKILL.md missing' }), expect.objectContaining({ name: 'second' })] } } });
    expect(calls.sort()).toEqual(['one', 'two']);
    expect(io.lines[1]).toContain('; source problem: SKILL.md missing; path: ');
  });

  it.each(['empty', 'absent'])('renders the %s root and always prints the footer', async (state) => {
    const home = await temporaryDirectory(); const root = join(home, '.claude', 'skills'); if (state === 'empty') await mkdir(root, { recursive: true });
    const io = new ScriptedPrompter();
    expect(await run({ local: true, home, config: createConfigStore(join(home, 'state')) }, io)).toMatchObject({ ok: true });
    expect(io.lines).toEqual([`Local Claude Code skills (${root}; global only):`, state === 'empty' ? '  none' : `  none (${root} does not exist)`, FOOTER]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('prints file and root inspection failures and succeeds', async () => {
    const home = await temporaryDirectory(); const path = await localSource(home, 'blocked'); const root = join(home, '.claude', 'skills'); const store = createConfigStore(join(home, 'state'));
    await chmod(join(path, 'SKILL.md'), 0o000);
    try {
      const io = new ScriptedPrompter(); expect(await run({ local: true, home, config: store }, io)).toMatchObject({ ok: true, value: { local: { problems: [{ path, reason: expect.stringContaining('EACCES') }] } } });
      expect(io.lines[1]).toMatch(/^Could not inspect .*EACCES/); expect(io.lines.at(-1)).toBe(FOOTER);
    } finally { await chmod(join(path, 'SKILL.md'), 0o600); }
    await chmod(root, 0o000);
    try {
      const io = new ScriptedPrompter(); expect(await run({ local: true, home, config: store }, io)).toMatchObject({ ok: true });
      expect(io.lines[1]).toMatch(/^Could not inspect .*EACCES/); expect(io.lines.at(-1)).toBe(FOOTER);
    } finally { await chmod(root, 0o700); }
  });

  it('escapes terminal controls in names, paths and reasons', async () => {
    const home = await temporaryDirectory(); await localSource(home, 'bad\nname', '---\nname: other\ndescription: x\n---\n');
    const io = new ScriptedPrompter(); expect(await run({ local: true, home, config: createConfigStore(join(home, 'state')) }, io)).toMatchObject({ ok: true });
    expect(io.lines.join('')).not.toContain('\n'); expect(io.lines.join('')).toContain('bad?name');
  });

  it.each([{ kind: 'member' as const, value: 'amy' }, { kind: 'project' as const, value: 'app' }, { team: 'team' }])('rejects incompatible local flags %j before team selection', async (flags) => {
    const home = await temporaryDirectory();
    expect(await run({ ...flags, local: true, home, config: createConfigStore(join(home, 'state')) }, new ScriptedPrompter())).toEqual({ ok: false, error: 'team' in flags ? '--local lists every configured team; drop --team.' : '--local cannot be combined with member or project.' });
  });

  it('ends default ls with its local discovery hint', async () => {
    const fixture = await bareTeam(); const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; }); const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true }); expect(io.lines.at(-1)).toBe('Local skills: npx -y terum-skills@latest ls --local');
  });
});
