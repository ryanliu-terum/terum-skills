import * as fs from 'node:fs/promises';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter, temporaryDirectory, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { run, format } from '../ls.js';
import { systemRunner, type Runner } from '../../lib/runner.js';
import { allowedTools } from '../../lib/schema.js';
import { snapshotSkillDirectory } from '../../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { candidatesOf, localSkills } from '../../lib/local-skills.js';
import { ghOnlyRunner } from '../../lib/__tests__/fixtures.js';

// Clone the ESM namespace so individual permission failures can be injected and restored.
vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

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
    expect(io.lines).toContain(`  healthy — Seed <seed@example.com>; testing; 0 installs; ${tree}; —; ${(await git(['log', '-1', '--format=%cI', '--', 'skills/healthy'], clone)).trim()}`);
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

describe.each([false, true])('B2 local category (tracked=%s)', tracked => {
  it.each([
    { name:'tdd',raw:'---\nname: tdd\ndescription: Test first\nmetadata:\n  terum-category: misc\n---\n',category:'misc' },
    { name:'no-category',raw:'---\nname: no-category\ndescription: No category\nmetadata:\n  author: Someone\n---\n',category:null },
    { name:'no-frontmatter',raw:'# Bare skill\n',category:null,reason:'no-frontmatter' },
    { name:'invalid-yaml',raw:'---\nname: [\nmetadata:\n  terum-category: misc\n---\n',category:null,reason:'invalid-yaml' },
    { name:'gsd-x',raw:'---\nname: gsd:x\ndescription: Readable rejection\nmetadata:\n  terum-category: misc\n---\n',category:'misc',reason:'name-mismatch' },
    { name:'no-description',raw:'---\nname: no-description\nmetadata:\n  terum-category: misc\n---\n',category:'misc',reason:'description-missing' },
    { name:'unsupported',raw:'---\nname: unsupported\ndescription: Readable rejection\nargument-hint: x\nmetadata:\n  terum-category: misc\n---\n',category:'misc',reason:'unsupported-field' },
    { name:'Bad',raw:'---\nname: Bad\ndescription: Rejected before parsing\nmetadata:\n  terum-category: misc\n---\n',category:null,reason:'illegal-name' },
  ])('emits the parsed category or null for $name',async({name,raw,category,reason})=>{
    const home=await temporaryDirectory(),store=createConfigStore(join(home,'state')),path=await localSource(home,name,raw);
    if(tracked)await store.update(config=>{config.shared[ID]={source:path,team:'team'};});
    const result=await run({local:true,home,config:store,runner:{run:async()=>{throw new Error('no commands');}}},new ScriptedPrompter());
    // Tracked sources may be relocated, so their folder name does not gate parsing.
    const expected=tracked&&reason==='illegal-name'?'misc':category;
    const key=tracked||reason===undefined?'rows':'notOffered';
    expect(result).toMatchObject({ok:true,value:{local:[{[key]:[{name,path,category:expected}]}]}});
  });
});

describe('issue 9 local ls', () => {
  it('lists candidates, placements, and rejected paths with zero teams and no questions', async () => {
    const home = await temporaryDirectory(); const store = createConfigStore(join(home, 'state'));
    const mine = await localSource(home, 'mine'); const placed = await localSource(home, 'placed');
    const rejected = await localSource(home, 'gsd-x', '---\nname: gsd:x\ndescription: x\n---\n');
    await store.update((config) => { config.placements[placed] = { id: ID, team: 'team', version: 'a'.repeat(40), scope: { kind: 'global' }, fingerprint: '', placed_at: '' }; });
    const io = new ScriptedPrompter();
    const result = await run({ local: true, home, config: store, runner: { run: async () => { throw new Error('must not run commands'); } } }, io);
    expect(result).toMatchObject({ ok: true, value: { local: [{ root: join(home, '.claude', 'skills'), scope: 'global', rows: [{ name: 'mine', path: mine, state: 'untracked locally' }, { name: 'placed', path: placed, state: 'placement recorded from team @aaaaaaaa' }], notOffered: [{ name: 'gsd-x', path: rejected, reason: 'name-mismatch', detail: 'SKILL.md name gsd:x does not equal folder gsd-x' }], problems: [] }] } });
    expect(io.lines).toEqual([`Local Claude Code skills (${join(home, '.claude', 'skills')}; global):`, `  mine — untracked locally; path: ${mine}`, `  placed — placement recorded from team @aaaaaaaa; path: ${placed}`, 'Cannot be connected:', `  gsd-x — SKILL.md name gsd:x does not equal folder gsd-x; path: ${rejected}`, '  3 skill folders (1 connectable)', FOOTER]);
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
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'relocated', state: `connected source for team; ${suffix}` }, { name: 'report', state: 'untracked locally' }] }] } });
    expect(io.lines).toContain(`  relocated — connected source for team; ${suffix}; path: ${source}`);
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
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [expect.objectContaining({ name: 'missing', state: 'conflicting tracking: connected source for one; repository status unknown; connected source for two; repository status unknown; placement recorded from two', problem: 'SKILL.md missing' }), expect.objectContaining({ name: 'second' })] }] } });
    expect(calls.sort()).toEqual(['one', 'two']);
    expect(io.lines[1]).toContain('; source problem: SKILL.md missing; path: ');
  });

  it.each(['empty', 'absent'])('renders the %s root and always prints the footer', async (state) => {
    const home = await temporaryDirectory(); const root = join(home, '.claude', 'skills'); if (state === 'empty') await mkdir(root, { recursive: true });
    const io = new ScriptedPrompter();
    expect(await run({ local: true, home, config: createConfigStore(join(home, 'state')) }, io)).toMatchObject({ ok: true });
    expect(io.lines).toEqual([`Local Claude Code skills (${root}; global):`, state === 'empty' ? '  none' : `  none (${root} does not exist)`, '  0 skill folders (0 connectable)', FOOTER]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('prints file and root inspection failures and succeeds', async () => {
    const home = await temporaryDirectory(); const path = await localSource(home, 'blocked'); const root = join(home, '.claude', 'skills'); const store = createConfigStore(join(home, 'state'));
    await chmod(join(path, 'SKILL.md'), 0o000);
    try {
      const io = new ScriptedPrompter(); expect(await run({ local: true, home, config: store }, io)).toMatchObject({ ok: true, value: { local: [{ problems: [{ path, reason: expect.stringContaining('EACCES') }] }] } });
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


describe('global and project local sections', () => {
  it('lists both roots, retains project placements and malformed YAML, and caches team snapshots across roots with no runner call beyond each checkout\'s origin probe', async () => {
    const home = await temporaryDirectory(); const repo = join(home, 'repo'); await mkdir(join(repo, '.git'), { recursive: true });
    const store = createConfigStore(join(home, 'state'));
    const global = await localSource(home, 'global'); const project = await localSource(repo, 'project'); const placed = await localSource(repo, 'placed');
    const invalid = await localSource(repo, 'invalid', '---\nname: invalid\ndescription: a: b\n---\n');
    await store.update((config) => {
      config.shared[ID] = { source: global, team: 'team' };
      config.shared.other = { source: project, team: 'team' };
      config.placements[placed] = { id: ID, team: 'team', version: null, scope: { kind: 'project', project: 'app' }, fingerprint: '', placed_at: '' };
    });
    const clone = store.teamClone('team'); await mkdir(join(clone, 'skills', 'global'), { recursive: true });
    await writeFile(join(clone, 'team.json'), JSON.stringify({ ...TEAM_JSON, global: [ID] }));
    await writeFile(join(clone, 'skills', 'global', 'SKILL.md'), `---\nname: global\ndescription: stored\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Me <me@example.com>\n  terum-category: testing\n---\n`);
    const teamCalls: string[] = []; const wrapped = { ...store, teamClone: (team: string) => { teamCalls.push(team); return store.teamClone(team); } };
    const runner = ghOnlyRunner(() => ({ code: 0, stdout: '', stderr: '' })); const io = new ScriptedPrompter();
    const before = await readFile(join(store.root, 'config.json'));
    const result = await run({ local: true, home, cwd: repo, config: wrapped, runner }, io);
    expect(result).toMatchObject({ ok: true, value: { local: [
      { root: join(home, '.claude', 'skills'), scope: 'global', rows: [{ name: 'global', state: 'connected source for team; endorsed (global)' }] },
      { root: join(repo, '.claude', 'skills'), scope: 'project', repoRoot: repo, rows: [{ name: 'placed', state: 'placement recorded from team' }, { name: 'project' }], notOffered: [{ name: 'invalid', path: invalid, reason: 'invalid-yaml', detail: expect.stringContaining('not valid YAML') }] },
    ] } });
    expect(io.lines.filter((line) => line.startsWith('Local Claude Code skills'))).toEqual([
      `Local Claude Code skills (${join(home, '.claude', 'skills')}; global):`, `Local Claude Code skills (${join(repo, '.claude', 'skills')}; project; detected, not registered — \`npx -y terum-skills@latest checkout add '${repo}'\` keeps it in your library):`,
    ]);
    expect(io.lines).toContain(`  placed — placement recorded from team; path: ${placed}`);
    expect(io.lines).toContain('Cannot be connected:');
    expect(io.lines.filter((line) => line === FOOTER)).toHaveLength(1); expect(io.lines.at(-1)).toBe(FOOTER);
    expect(teamCalls).toEqual(['team']); expect(runner.calls).toEqual([{ command: 'git', args: ['remote', 'get-url', 'origin'], cwd: repo, env: undefined, stdio: undefined }]); expect(io.asked).toEqual([]);
    expect(await readFile(join(store.root, 'config.json'))).toEqual(before);
    expect(candidatesOf(await localSkills(join(repo, '.claude', 'skills'), await store.read(), { scope: 'project', stateRoot: store.root }))).toEqual([]);
  });

  it('renders an absent project root as its own empty section', async () => {
    const home = await temporaryDirectory(); const repo = join(home, 'repo'); await mkdir(join(repo, '.git'), { recursive: true });
    const io = new ScriptedPrompter();
    expect(await run({ local: true, home, cwd: repo, config: createConfigStore(join(home, 'state')) }, io)).toMatchObject({ ok: true, value: { local: [{ scope: 'global' }, { scope: 'project', rows: [] }] } });
    expect(io.lines).toEqual([`Local Claude Code skills (${join(home, '.claude', 'skills')}; global):`, `  none (${join(home, '.claude', 'skills')} does not exist)`, '  0 skill folders (0 connectable)', `Local Claude Code skills (${join(repo, '.claude', 'skills')}; project; detected, not registered — \`npx -y terum-skills@latest checkout add '${repo}'\` keeps it in your library):`, '  GitHub: not connected', `  none (${join(repo, '.claude', 'skills')} does not exist)`, '  0 skill folders (0 connectable)', FOOTER]);
  });

  it("names each checkout's GitHub origin, and says not connected for every other origin", async () => {
    const originRunner = (stdout: string): Runner => ({ async run(command, args) { return command === 'git' && args.join(' ') === 'remote get-url origin' ? { code: 0, stdout, stderr: '' } : { code: 1, stdout: '', stderr: '' }; } });
    const github = await temporaryDirectory(); await mkdir(join(github, 'repo', '.git'), { recursive: true });
    const githubIo = new ScriptedPrompter();
    expect(await run({ local: true, home: github, cwd: join(github, 'repo'), config: createConfigStore(join(github, 'state')), runner: originRunner('git@github.com:ryanliu-terum/terum-skills.git\n') }, githubIo))
      .toMatchObject({ ok: true, value: { local: [{ scope: 'global', remote: null }, { scope: 'project', remote: { url: 'https://github.com/ryanliu-terum/terum-skills', slug: 'ryanliu-terum/terum-skills' } }] } });
    expect(githubIo.lines).toContain('  GitHub: ryanliu-terum/terum-skills');

    const elsewhere = await temporaryDirectory(); await mkdir(join(elsewhere, 'repo', '.git'), { recursive: true });
    const elsewhereIo = new ScriptedPrompter();
    expect(await run({ local: true, home: elsewhere, cwd: join(elsewhere, 'repo'), config: createConfigStore(join(elsewhere, 'state')), runner: originRunner('https://gitlab.com/acme/tools.git\n') }, elsewhereIo))
      .toMatchObject({ ok: true, value: { local: [{ scope: 'global' }, { scope: 'project', remote: { url: 'https://gitlab.com/acme/tools.git', slug: null } }] } });
    expect(elsewhereIo.lines).toContain('  GitHub: not connected (origin is https://gitlab.com/acme/tools.git)');

    const bare = await temporaryDirectory(); await mkdir(join(bare, 'repo', '.git'), { recursive: true });
    const bareIo = new ScriptedPrompter();
    expect(await run({ local: true, home: bare, cwd: join(bare, 'repo'), config: createConfigStore(join(bare, 'state')), runner: originRunner('') }, bareIo))
      .toMatchObject({ ok: true, value: { local: [{ scope: 'global' }, { scope: 'project', remote: null }] } });
    expect(bareIo.lines).toContain('  GitHub: not connected');
  });

  it('keeps outside-repository listing successful (regression) and adds the explicit cwd line before the footer', async () => {
    const home = await temporaryDirectory(); const cwd = join(home, 'outside\nrepo'); await mkdir(cwd);
    const io = new ScriptedPrompter();
    expect(await run({ local: true, home, cwd, config: createConfigStore(join(home, 'state')) }, io)).toMatchObject({ ok: true });
    expect(io.lines.slice(-2)).toEqual([`Project skills: none (${cwd.replace('\n', '?')} is not inside a git repository).`, FOOTER]);
  });

  it('does not print a no-repository message for a deduplicated home repository', async () => {
    const home = await temporaryDirectory(); await mkdir(join(home, '.git'));
    const io = new ScriptedPrompter(); const result = await run({ local: true, home, cwd: home, config: createConfigStore(join(home, 'state')) }, io);
    expect(result).toMatchObject({ ok: true, value: { local: [{ scope: 'global' }] } });
    expect(io.lines.filter((line) => line.startsWith('Local Claude'))).toHaveLength(1);
    expect(io.lines.join('')).not.toContain('not inside a git repository');
  });

  it('prints project-root EACCES as an inspection problem and still succeeds', async () => {
    const home = await temporaryDirectory(); const repo = join(home, 'repo'); await mkdir(join(repo, '.git'), { recursive: true });
    const root = join(repo, '.claude', 'skills'); await mkdir(root, { recursive: true });
    const original = fs.access;
    const spy = vi.spyOn(fs, 'access').mockImplementation(async (...args) => {
      if (args[0] === root) throw Object.assign(new Error('EACCES: project skills'), { code: 'EACCES' });
      return original(...args);
    });
    try {
      const io = new ScriptedPrompter();
      expect(await run({ local: true, home, cwd: repo, config: createConfigStore(join(home, 'state')) }, io)).toMatchObject({ ok: true, value: { local: [{ scope: 'global' }] } });
      expect(io.lines.slice(-2)).toEqual([`Could not inspect ${root}: EACCES: project skills`, FOOTER]);
      expect(io.lines.join('')).not.toContain('; project):');
    } finally { spy.mockRestore(); }
  });
});

it('issue 5 names connect in the privileged local-source guidance', async () => {
  const home = await temporaryDirectory(); const source = await localSource(home, 'privileged');
  await mkdir(join(source, 'hooks'));
  const io = new ScriptedPrompter();
  const result = await run({ local: true, home, config: createConfigStore(join(home, 'state')) }, io);
  expect(result.ok).toBe(true);
  expect(io.lines).toContain(`  privileged — untracked locally; source problem: contains plugin or hook definitions (connect needs --allow-privileged); path: ${source}`);
});


async function inventoryFixture() {
  const fixture = await bareTeam(); const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  return { ...fixture, store, clone };
}
const inventorySource = (name: string, grants = 'allowed-tools: [Read, Bash, Read]') => `---\nname: ${name}\ndescription: "A description with <tags> and  spaces"\nlicense: UNLICENSED\n${grants}\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n# Real body\n`;
it('one malformed folder and one malformed person each cost only their row, with named problems', async () => {
  const { store, clone } = await inventoryFixture();
  for (const name of ['good','bad','mismatch']) { await mkdir(join(clone,'skills',name)); await writeFile(join(clone,'skills',name,'SKILL.md'), name==='bad'?'invalid':inventorySource(name==='mismatch'?'other':name)); }
  await writeFile(join(clone,'people','bad.json'), '{broken');
  const io = new ScriptedPrompter(); const result = await run({config:store},io);
  expect(result).toMatchObject({ok:true,value:{skills:[{name:'good',unresolved:true,latest:'—',installs:0}],roster:[{handle:'seed'}]}});
  if(!result.ok)throw new Error(result.error);
  expect(result.value.problems.map(p=>p.source).sort()).toEqual(['people/bad.json','skills/bad','skills/good','skills/mismatch']);
  expect(io.lines.filter(line=>line.startsWith('people/bad.json:'))).toHaveLength(1);
  for(const kind of ['member','project'] as const) {
    if(kind==='project') await writeFile(join(clone,'team.json'),JSON.stringify({...TEAM_JSON,projects:{app:{skills:[ID],remotes:[]}}}));
    const scoped=await run({config:store,kind,value:kind==='member'?'seed':'app'},new ScriptedPrompter());
    expect(scoped).toMatchObject({ok:true,value:{skills:[{name:'good'}],problems:expect.arrayContaining([{source:'skills/mismatch',message:expect.stringContaining('does not match')}])}});
  }
});
it('an unreadable skills root fails whole, never masquerading as an empty team', async () => {
  const {store,clone}=await inventoryFixture();const original=fs.readdir;
  const spy=vi.spyOn(fs,'readdir').mockImplementation((...args)=>{if(args[0]===join(clone,'skills'))return Promise.reject(new Error('EACCES skills root'));return original(...args);});
  try {expect(await run({config:store},new ScriptedPrompter())).toEqual({ok:false,error:'EACCES skills root'});}finally{spy.mockRestore();}
});
it('carries verbatim description, normalized grants, body, installers and date; format adds only the date',async()=>{
  const {store,clone}=await inventoryFixture();await mkdir(join(clone,'skills','good'));await writeFile(join(clone,'skills','good','SKILL.md'),inventorySource('good'));
  await writeFile(join(clone,'people','seed.json'),JSON.stringify(person('seed',{installed:[{id:ID,version:null,scope:{kind:'global'},since:'2026-08-01'},{id:ID,version:null,scope:{kind:'project',project:'app'},since:'2026-08-02'}]})));
  await git(['add','--all'],clone);await git(['commit','-qm','inventory'],clone);
  const io=new ScriptedPrompter();const result=await run({config:store},io);if(!result.ok)throw new Error(result.error);
  const row=result.value.skills[0]!;const grants=allowedTools(['Read','Bash','Read']);if(!grants.ok)throw new Error('bad grants');
  expect(row).toMatchObject({description:'A description with <tags> and  spaces',grants:grants.normalized,grantsHash:grants.hash,body:'# Real body\n',installs:1,unresolved:false,updated:(await git(['log','-1','--format=%cI','--','skills/good'],clone)).trim()});
  expect(row.installedBy.map(p=>p.scope)).toEqual([{kind:'global'},{kind:'project',project:'app'}]);
  expect(format(row)).toBe(`  good — Seed <seed@example.com>; testing; 1 installs; ${row.latest}; —; ${row.updated}`);
  expect(io.lines).toContain(format(row));
  await writeFile(join(clone,'skills','good','SKILL.md'),inventorySource('good','allowed-tools: {bad: value}'));
  expect(await run({config:store},new ScriptedPrompter())).toMatchObject({ok:true,value:{skills:[{grants:null,grantsHash:null}]}});
});
it('returns sorted passthrough projects including empty projects, member declined only on member, and no registry on local',async()=>{
  const {store,clone,root}=await inventoryFixture();
  await writeFile(join(clone,'team.json'),JSON.stringify({...TEAM_JSON,projects:{z:{skills:[],remotes:[]},A:{skills:[ID],remotes:['github.com/acme/a'],description:'Hand maintained'}}}));
  await writeFile(join(clone,'people','seed.json'),JSON.stringify(person('seed',{declined:[ID]})));
  for(const args of [{},{kind:'member' as const,value:'seed'},{kind:'project' as const,value:'A'}]) {
    const result=await run({config:store,...args},new ScriptedPrompter());if(!result.ok)throw new Error(result.error);
    expect(result.value.projects).toEqual([{name:'A',skills:[ID],remotes:['github.com/acme/a'],description:'Hand maintained'},{name:'z',skills:[],remotes:[]}]);
    if(args.kind==='member')expect(result.value.member).toEqual({handle:'seed',declined:[ID],role:null,projects:[],installed:[]});else expect(result.value).not.toHaveProperty('member');
  }
  const local=await run({config:store,local:true,home:root},new ScriptedPrompter());expect(local).toMatchObject({ok:true,value:{problems:[]}});expect(local.value).not.toHaveProperty('projects');
});
it('uses one version child and at most eight simultaneous date children for a large listing',async()=>{
  const {store,clone}=await inventoryFixture();
  for(let i=0;i<19;i++){const name='skill-'+i;await mkdir(join(clone,'skills',name));await writeFile(join(clone,'skills',name,'SKILL.md'),inventorySource(name));}
  await git(['add','--all'],clone);await git(['commit','-qm','many'],clone);
  let active=0,peak=0;const calls:string[][]=[];
  const runner={run:async(command:Parameters<typeof systemRunner.run>[0],args:readonly string[],options?:Parameters<typeof systemRunner.run>[2])=>{active++;peak=Math.max(peak,active);calls.push([...args]);try{return await systemRunner.run(command,args,options);}finally{active--;}}};
  const result=await run({config:store,runner},new ScriptedPrompter());expect(result.ok).toBe(true);expect(peak).toBeLessThanOrEqual(9);expect(peak).toBeGreaterThan(1);expect(calls.filter(c=>c[0]==='ls-tree')).toEqual([['ls-tree','HEAD:skills']]);expect(calls.filter(c=>c[0]==='log')).toHaveLength(19);
});


describe('S7g local health and provenance', () => {
  it.each(['up-to-date', 'update-available', 'local-changed', 'both', 'gone-from-repo', 'unreadable', 'incomplete', 'rejected', 'failed-snapshot'] as const)('reports %s from the ledger and current filesystem without changing the row sentence', async mode => {
    const home = await temporaryDirectory(), store = createConfigStore(join(home, 'state'));
    const placed = await localSource(home, 'good', inventorySource('good'));
    const clone = store.teamClone('team'), source = join(clone, 'skills', 'good');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), inventorySource('good'));
    await writeFile(join(clone, 'team.json'), JSON.stringify(TEAM_JSON));
    const baseline = (await snapshotSkillDirectory(placed)).fingerprint;
    await store.update(config => { config.placements[placed] = { id: ID, team: 'team', version: 'a'.repeat(40), fingerprint: baseline, scope: {kind:'global'}, placed_at: '' }; });
    if (mode === 'update-available' || mode === 'both') await writeFile(join(source, 'extra.txt'), 'clone changed');
    if (mode === 'local-changed' || mode === 'both') await writeFile(join(placed, 'extra.txt'), 'placed changed');
    if (mode === 'gone-from-repo') await rm(source, {recursive:true});
    if (mode === 'unreadable') await rm(clone, {recursive:true});
    if (mode === 'incomplete') { await mkdir(join(clone,'skills','broken')); await writeFile(join(clone,'skills','broken','SKILL.md'), 'bad'); }
    if (mode === 'rejected') { await rm(placed,{recursive:true}); await fs.symlink(source,placed,'dir'); }
    const original = fs.readdir;
    const spy = vi.spyOn(fs, 'readdir').mockImplementation((...args) => {
      if (args[0] === placed && (mode === 'rejected' || mode === 'failed-snapshot')) return Promise.reject(new Error('must not read rejected target'));
      return original(...args);
    });
    const before = await readFile(join(store.root,'config.json'),'utf8');
    try {
      const io = new ScriptedPrompter(), result = await run({local:true,home,config:store},io);
      const health = ['unreadable','incomplete','rejected','failed-snapshot'].includes(mode) ? 'unknown' : mode;
      expect(result).toMatchObject({ok:true,value:{local:[{rows:[{name:'good',path:placed,tracked:true,shared:[],placement:{id:ID,team:'team',version:'a'.repeat(40)},health}]}]}});
      if (mode === 'rejected') {
        expect(spy.mock.calls.some(([path])=>path===placed)).toBe(false);
        expect(result.value?.local?.[0]?.rows[0]?.problem).toBe('symbolic link');
      } else if (mode !== 'failed-snapshot') expect(io.lines).toContain(`  good — placement recorded from team @aaaaaaaa; path: ${placed}`);
      expect(await readFile(join(store.root,'config.json'),'utf8')).toBe(before);
    } finally { spy.mockRestore(); }
  });

  it('carries shared refs, null tracking versions and untracked rows independently of prose',async()=>{
    const home=await temporaryDirectory(),store=createConfigStore(join(home,'state'));
    const connected=await localSource(home,'connected'),placed=await localSource(home,'placed');await localSource(home,'untracked');
    await store.update(config=>{config.shared[ID]={source:connected,team:'one'};config.placements[placed]={id:ID,team:'two',version:null,fingerprint:'',scope:{kind:'global'},placed_at:''};});
    expect(await run({local:true,home,config:store},new ScriptedPrompter())).toMatchObject({ok:true,value:{local:[{rows:[
      {name:'connected',tracked:true,shared:[{id:ID,team:'one'}],placement:null,health:'unknown'},
      {name:'placed',tracked:true,shared:[],placement:{id:ID,team:'two',version:null},health:'unknown'},
      {name:'untracked',tracked:false,shared:[],placement:null,health:'untracked'},
    ]}]}});
  });

  it.each([false,true])('names a missing placement without inventing a row (absent root=%s)',async absent=>{
    const home=await temporaryDirectory(),store=createConfigStore(join(home,'state')),root=join(home,'.claude','skills'),path=join(root,'missing');
    if(!absent)await mkdir(root,{recursive:true});
    await store.update(config=>{config.placements[path]={id:ID,team:'team',version:null,fingerprint:'',scope:{kind:'global'},placed_at:''};});
    expect(await run({local:true,home,config:store},new ScriptedPrompter())).toMatchObject({ok:true,value:{local:[{rows:[],problems:[{path,reason:'placement recorded in the ledger but the folder is missing'}]}]}});
  });
});


describe('local identity', () => {
  it.each(['present', 'placed', 'connected-and-placed', 'rejected', 'non-uuid'])('reports %s without changing printed state', async mode => {
    const home = await temporaryDirectory(), store = createConfigStore(join(home, 'state'));
    const raw = mode === 'rejected' ? 'not frontmatter' : inventorySource('good').replace(ID, mode === 'non-uuid' ? 'not-an-id' : ID);
    const path = await localSource(home, 'good', raw);
    const placed = mode === 'placed' || mode === 'connected-and-placed';
    const connected = mode === 'connected-and-placed';
    if (placed) await store.update(config => {
      config.placements[path] = { id: ID, team: 'team', version: null, fingerprint: '', scope: {kind:'global'}, placed_at: '' };
      if (connected) config.shared[ID] = { source: path, team: 'team' };
    });
    const io = new ScriptedPrompter(), result = await run({ local: true, home, config: store }, io);
    expect(result.ok).toBe(true);
    if (mode === 'rejected') expect(result.value?.local?.[0]?.notOffered[0]).toMatchObject({skillId:null});
    else {
      expect(result.value?.local?.[0]?.rows[0]).toMatchObject({skillId:mode === 'non-uuid' ? null : ID, placed, connected});
      const state = connected ? 'conflicting tracking: connected source for team; repository status unknown; placement recorded from team' : placed ? 'placement recorded from team' : 'untracked locally';
      expect(io.lines).toContain(`  good — ${state}; path: ${path}`);
    }
  });
});

it('returns recorded member install ids even when no skills were authored',async()=>{
 const root=await temporaryDirectory(),store=createConfigStore(join(root,'state')),clone=store.teamClone('team');
 await mkdir(join(clone,'skills'),{recursive:true});await mkdir(join(clone,'people'));
 await writeFile(join(clone,'team.json'),JSON.stringify(TEAM_JSON));
 await writeFile(join(clone,'people','seed.json'),JSON.stringify(person('seed',{installed:[{id:ID,version:null,scope:{kind:'global'},since:'2026-09-01'}]})));
 await store.update(config=>{config.teams.team={remote:'https://github.com/acme/team',handle:'seed'};});
 const runner={run:async()=>({code:0,stdout:'',stderr:''})},io=new ScriptedPrompter();
 expect(await run({kind:'member',value:'seed',config:store,runner},io)).toMatchObject({ok:true,value:{skills:[],member:{installed:[{id:ID,scope:{kind:'global'},since:'2026-09-01'}]}}});
 expect(io.lines).toContain(`  Installed: ${ID}`);
});


it('lists registered and detected roots with typed counts without registering on reads', async () => {
  const home = await temporaryDirectory(); const config = createConfigStore(join(home, 'state'));
  const repoA = join(home, 'repoA'), repoB = join(home, 'repoB');
  for (const root of [repoA, repoB]) await mkdir(join(root, '.git'), { recursive: true });
  const root = join(repoA, '.claude', 'skills');
  for (const name of ['good', 'bad']) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name === 'bad' ? 'mismatch' : name}\ndescription: x\n---\n`);
  }
  await fs.symlink(join(root, 'good'), join(root, 'link'));
  await config.update(c => { c.checkouts = [repoA]; });
  const before = await readFile(join(config.root, 'config.json'), 'utf8'); const io = new ScriptedPrompter();
  const result = await run({ local: true, home, cwd: repoB, config }, io);
  expect(result).toMatchObject({ ok: true, value: { local: [
    { label: 'Global', registered: false, detected: false, rootState: 'absent', counts: { skillFolders: 0, connectable: 0 } },
    { label: 'repoA', registered: true, detected: false, rootState: 'scanned', counts: { skillFolders: 2, connectable: 1 }, notOffered: [
      { name: 'bad', reason: 'name-mismatch', detail: expect.any(String) }, { name: 'link', reason: 'symlink', detail: expect.any(String) },
    ] },
    { label: 'repoB', registered: false, detected: true, rootState: 'absent' },
  ] } });
  expect(io.lines).toContain(`Local Claude Code skills (${root}; project; registered):`);
  expect(io.lines).toContain(`Local Claude Code skills (${join(repoB, '.claude', 'skills')}; project; detected, not registered — \`npx -y terum-skills@latest checkout add '${repoB}'\` keeps it in your library):`);
  expect(io.lines).toContain('  2 skill folders (1 connectable)');
  expect(await readFile(join(config.root, 'config.json'), 'utf8')).toBe(before);
});


it('detects shared-source and project-placement repositories without cwd or config writes', async () => {
  const home = await temporaryDirectory(); const config = createConfigStore(join(home, 'state'));
  const roots = [join(home, 'shared'), join(home, 'placed')];
  for (const root of roots) await mkdir(join(root, '.git'), { recursive: true });
  await config.update(c => {
    c.shared[ID] = { source: join(roots[0]!, 'any', 'skill'), team: 'unavailable' };
    c.placements[join(roots[1]!, '.claude', 'skills', 'missing')] = { id: ID, team: 'unavailable', scope: { kind: 'project', project: 'app' }, version: null, placed_at: '', fingerprint: '' };
  });
  const before = await readFile(join(config.root, 'config.json'), 'utf8');
  const result = await run({ local: true, home, config }, new ScriptedPrompter());
  expect(result).toMatchObject({ ok: true, value: { local: [
    { label: 'Global', registered: false, detected: false },
    ...roots.map(repoRoot => ({ repoRoot, registered: false, detected: true, rootState: 'absent' })),
  ] } });
  expect(await readFile(join(config.root, 'config.json'), 'utf8')).toBe(before);
});


describe('W-02 local read stability', () => {
  it('produces byte-identical output for a root with placements', async () => {
    const home = await temporaryDirectory(); const store = createConfigStore(join(home, 'state'));
    // Bound discovery to the fixture home even if an ancestor of the system temp directory is a checkout.
    await mkdir(join(home, '.git'));
    const clone = store.teamClone('team');
    await mkdir(join(clone, 'skills'), { recursive: true });
    await writeFile(join(clone, 'team.json'), JSON.stringify(TEAM_JSON));
    for (let i = 0; i < 10; i++) {
      const name = `skill-${i}`; const id = `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`;
      const raw = `---\nname: ${name}\ndescription: stable\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nBody\n`;
      await mkdir(join(clone, 'skills', name)); await writeFile(join(clone, 'skills', name, 'SKILL.md'), raw);
      if (i < 6) {
        const path = await localSource(home, name, raw);
        const fingerprint = (await snapshotSkillDirectory(path)).fingerprint;
        await store.update(config => { config.placements[path] = { id, team: 'team', version: null, scope: { kind: 'global' }, fingerprint, placed_at: '' }; });
      }
    }
    const io = new ScriptedPrompter(); const result = await run({ local: true, home, config: store }, io);
    expect(result.ok).toBe(true);
    expect(JSON.stringify({ value: result.value, lines: io.lines }).replaceAll(home, '<HOME>')).toMatchInlineSnapshot(`"{"value":{"roster":[],"skills":[],"problems":[],"local":[{"root":"<HOME>/.claude/skills","scope":"global","registered":false,"detected":false,"rootState":"scanned","label":"Global","remote":null,"counts":{"skillFolders":6,"connectable":0},"rows":[{"skillId":"33333333-3333-4333-8333-000000000000","placed":true,"connected":false,"name":"skill-0","path":"<HOME>/.claude/skills/skill-0","state":"placement recorded from team","tracked":true,"shared":[],"placement":{"id":"33333333-3333-4333-8333-000000000000","team":"team","version":null},"health":"up-to-date","description":"stable","category":"testing","characters":180},{"skillId":"33333333-3333-4333-8333-000000000001","placed":true,"connected":false,"name":"skill-1","path":"<HOME>/.claude/skills/skill-1","state":"placement recorded from team","tracked":true,"shared":[],"placement":{"id":"33333333-3333-4333-8333-000000000001","team":"team","version":null},"health":"up-to-date","description":"stable","category":"testing","characters":180},{"skillId":"33333333-3333-4333-8333-000000000002","placed":true,"connected":false,"name":"skill-2","path":"<HOME>/.claude/skills/skill-2","state":"placement recorded from team","tracked":true,"shared":[],"placement":{"id":"33333333-3333-4333-8333-000000000002","team":"team","version":null},"health":"up-to-date","description":"stable","category":"testing","characters":180},{"skillId":"33333333-3333-4333-8333-000000000003","placed":true,"connected":false,"name":"skill-3","path":"<HOME>/.claude/skills/skill-3","state":"placement recorded from team","tracked":true,"shared":[],"placement":{"id":"33333333-3333-4333-8333-000000000003","team":"team","version":null},"health":"up-to-date","description":"stable","category":"testing","characters":180},{"skillId":"33333333-3333-4333-8333-000000000004","placed":true,"connected":false,"name":"skill-4","path":"<HOME>/.claude/skills/skill-4","state":"placement recorded from team","tracked":true,"shared":[],"placement":{"id":"33333333-3333-4333-8333-000000000004","team":"team","version":null},"health":"up-to-date","description":"stable","category":"testing","characters":180},{"skillId":"33333333-3333-4333-8333-000000000005","placed":true,"connected":false,"name":"skill-5","path":"<HOME>/.claude/skills/skill-5","state":"placement recorded from team","tracked":true,"shared":[],"placement":{"id":"33333333-3333-4333-8333-000000000005","team":"team","version":null},"health":"up-to-date","description":"stable","category":"testing","characters":180}],"notOffered":[],"problems":[]}]},"lines":["Local Claude Code skills (<HOME>/.claude/skills; global):","  skill-0 — placement recorded from team; path: <HOME>/.claude/skills/skill-0","  skill-1 — placement recorded from team; path: <HOME>/.claude/skills/skill-1","  skill-2 — placement recorded from team; path: <HOME>/.claude/skills/skill-2","  skill-3 — placement recorded from team; path: <HOME>/.claude/skills/skill-3","  skill-4 — placement recorded from team; path: <HOME>/.claude/skills/skill-4","  skill-5 — placement recorded from team; path: <HOME>/.claude/skills/skill-5","  6 skill folders (0 connectable)","Team status is from local clones and may be stale; open endorsement requests are not checked."]}"`);
  });
});


describe('W-02 local read failure isolation',()=>{
  it('asks each root for its origin remote once, before the section loop',async()=>{
    const home=await temporaryDirectory();const store=createConfigStore(join(home,'state'));const roots=[join(home,'a'),join(home,'b')];for(const root of roots){await mkdir(join(root,'.git'),{recursive:true});await localSource(root,'sample');}await store.update(c=>{c.checkouts=roots;});
    const calls:{args:readonly string[];cwd:string|undefined}[]=[];let release!:()=>void;const both=new Promise<void>(resolve=>{release=resolve;});
    const runner:Runner={run:async(_command,args,options)=>{calls.push({args,cwd:options?.cwd});if(calls.length===2)release();await both;return {code:0,stdout:'https://github.com/acme/team.git',stderr:''};}};
    const result=await run({local:true,home,config:store,runner},new ScriptedPrompter());expect(result.ok).toBe(true);expect(calls).toEqual(roots.map(cwd=>({args:['remote','get-url','origin'],cwd})));
  },5000);
  it.skipIf(process.platform==='win32'||process.getuid?.()===0)('still yields the other root when one root is unreadable',async()=>{
    const home=await temporaryDirectory();const store=createConfigStore(join(home,'state'));await localSource(home,'healthy');const repo=join(home,'repo');const path=await localSource(repo,'blocked');await store.update(c=>{c.checkouts=[repo];});const root=join(path,'..');await chmod(root,0);
    try{const io=new ScriptedPrompter();const result=await run({local:true,home,config:store,runner:ghOnlyRunner(()=>({code:0,stdout:'',stderr:''}))},io);expect(result.value?.local?.[0]?.rows.map(r=>r.name)).toEqual(['healthy']);expect(result.value?.local?.[1]).toMatchObject({rootState:'unreadable',problems:[{reason:expect.stringContaining('EACCES')}]});expect(io.lines.some(l=>l.includes('Could not inspect')&&l.includes('EACCES'))).toBe(true);}finally{await chmod(root,0o700);}
  });
  it('reports health unknown for a placed folder whose fingerprint walk throws',async()=>{
    const home=await temporaryDirectory();const store=createConfigStore(join(home,'state'));const clone=store.teamClone('team');await mkdir(join(clone,'skills'),{recursive:true});await writeFile(join(clone,'team.json'),JSON.stringify(TEAM_JSON));
    const raw=`---\nname: placed\ndescription: placed\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;await mkdir(join(clone,'skills/placed'));await writeFile(join(clone,'skills/placed/SKILL.md'),raw);
    const path=await localSource(home,'placed',raw);await localSource(home,'healthy');const fingerprint=(await snapshotSkillDirectory(path)).fingerprint;await store.update(c=>{c.placements[path]={id:ID,team:'team',version:null,scope:{kind:'global'},fingerprint,placed_at:''};});
    const original=fs.readdir;const spy=vi.spyOn(fs,'readdir').mockImplementation(async(...args)=>{if(args[0]===path)throw new Error('unreadable walk');return original(...args);});
    try{const result=await run({local:true,home,config:store},new ScriptedPrompter());expect(result.value?.local?.[0]?.rows.map(r=>[r.name,r.health])).toEqual([['healthy','untracked'],['placed','unknown']]);}finally{spy.mockRestore();}
  });
});
