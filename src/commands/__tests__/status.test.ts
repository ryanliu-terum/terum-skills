import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { stampPath } from '../../lib/hook.js';
import { bareTeam, cloneWithIdentity, git, mappedRunner, person, ScriptedPrompter, TEAM_JSON, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { slackBlock } from '../invite.js';
import { run, StatusArgs } from '../status.js';

const REMOTE = 'github.com/acme/team';
const version = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version as string;
const stale = '  acme may be stale; run `npx -y terum-skills@latest sync`.';

async function fixture(handles = ['seed'], archived: string[] = []) {
  const repo = await bareTeam();
  await rm(join(repo.seed, 'people'), { recursive: true });
  await mkdir(join(repo.seed, 'people'));
  // Preserve an empty roster directory in the clone.
  await writeFile(join(repo.seed, 'people', '.gitkeep'), '');
  for (const handle of handles) await writeFile(join(repo.seed, 'people', `${handle}.json`), JSON.stringify(person(handle)));
  await writeFile(join(repo.seed, 'team.json'), JSON.stringify({ ...TEAM_JSON, archived }));
  await git(['add', '--all'], repo.seed); await git(['commit', '-qm', 'roster'], repo.seed);
  await git(['push', '-q', 'origin', 'HEAD:main'], repo.seed);
  const store = createConfigStore(join(repo.root, 'state'));
  const clone = await cloneWithIdentity(repo.bare, store.teamClone('acme'));
  await store.update((config) => { config.teams.acme = { remote: REMOTE, handle: 'seed' }; });
  return { ...repo, store, clone, runner: mappedRunner(REMOTE, repo.bare) };
}

/** Every status invocation proves it left config and all fixture clones untouched. */
async function query(f: Awaited<ReturnType<typeof fixture>>, args: Partial<StatusArgs> = {}, clones = [f.clone], probes = clones) {
  const configBefore = await readFile(join(f.store.root, 'config.json'), 'utf8');
  const heads = await Promise.all(clones.map((clone) => git(['rev-parse', 'HEAD'], clone)));
  const io = new ScriptedPrompter();
  const result = await run({ config: f.store, runner: f.runner, ...args }, io);
  expect(io.asked).toEqual([]);
  expect(io.lines[0]).toBe(`terum-skills ${version}`);
  expect(io.lines[0]).toMatch(/^terum-skills \d+\.\d+\.\d+$/);
  if (result.value) expect(result.value.version).toBe(version);
  expect(await readFile(join(f.store.root, 'config.json'), 'utf8')).toBe(configBefore);
  for (const [index, clone] of clones.entries()) {
    expect(await git(['rev-parse', 'HEAD'], clone)).toBe(heads[index]);
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
  }
  expect(f.runner.calls.map(({ command, args, cwd }) => ({ command, args, cwd }))).toEqual([{ command: 'git', args: ['--version'], cwd: undefined }, { command: 'gh', args: ['--version'], cwd: undefined }, ...probes.map((cwd) => ({ command: 'git', args: ['remote', 'get-url', 'origin'], cwd }))]);
  return { result, io };
}

async function commit(clone: string) { await git(['add', '--all'], clone); await git(['commit', '-qm', 'fixture damage'], clone); }

describe('status (offline local team summary)', () => {
  it.each([0, 5, 6])('shows %i active members with five rows at most', async (size) => {
    const handles = ['a', 'b', 'seed', 'x', 'y', 'z'].slice(0, size);
    const f = await fixture(handles);
    const { result, io } = await query(f);
    expect(result).toMatchObject({ ok: true, value: { teams: [{ team: 'acme', memberCount: size, sharedSkills: 0, readable: true }] } });
    expect(io.lines).toEqual([
      `terum-skills ${version}`, 'Team acme (you are @seed)', '  Repository: https://github.com/acme/team',
      '  From the local clone; GitHub access is not checked.', `  Members: ${size}`,
      ...handles.slice(0, 5).map((handle) => `    @${handle} — ${handle}${handle === 'seed' ? ' (you)' : ''}`),
      ...(size > 5 ? ['    … and 1 more'] : []), ...(size === 0 ? ['  Your membership: no entry in the local roster.'] : []),
      '  Shared skills: 0', '  Evaluated skills: not yet available', stale,
    ]);
  });

  it.each(['inactive', 'missing'] as const)('reports %s self membership as a successful query', async (membership) => {
    const f = await fixture(membership === 'inactive' ? ['seed', 'a'] : ['a'], membership === 'inactive' ? ['seed'] : []);
    const { result, io } = await query(f);
    expect(result).toMatchObject({ ok: true, value: { teams: [{ membership, memberCount: 1 }] } });
    expect(io.lines).toContain(`  Your membership: ${membership === 'inactive' ? 'inactive' : 'no entry'} in the local roster.`);
  });

  it('checks filenames before archive filtering, reports malformed people, and sorts handles by codepoint', async () => {
    const f = await fixture(['b', 'a0', 'a-b', 'a', 'seed'], ['old']);
    await writeFile(join(f.clone, 'people', 'old.json'), JSON.stringify(person('new')));
    await writeFile(join(f.clone, 'people', 'broken.json'), '{'); await commit(f.clone);
    const { result, io } = await query(f);
    expect(result).toMatchObject({ ok: true, value: { teams: [{ memberCount: 5, unreadableMembers: 2 }] } });
    expect(io.lines).toContain('  Members: 5 readable; 2 unreadable');
    expect(io.lines.filter((line) => line.startsWith('    @'))).toEqual(['a', 'a-b', 'a0', 'b', 'seed'].map((handle) => `    @${handle} — ${handle}${handle === 'seed' ? ' (you)' : ''}`));
    expect(io.lines.filter((line) => /^    people\/(old|broken)\.json: .+/.test(line))).toHaveLength(2);
  });

  it.each([undefined, '2', 'nope'])('uses object enumeration order and explicit selection (%s)', async (team) => {
    const f = await fixture();
    const second = await cloneWithIdentity(f.bare, f.store.teamClone('2'));
    const tenth = await cloneWithIdentity(f.bare, f.store.teamClone('10'));
    await f.store.update((config) => { config.teams = { '10': { remote: REMOTE, handle: 'seed' }, '2': { remote: REMOTE, handle: 'seed' } }; });
    const { result, io } = await query(f, { team }, [f.clone, second, tenth], team === 'nope' ? [] : team === '2' ? [second] : [second, tenth]);
    if (team === 'nope') { expect(result).toMatchObject({ ok: false, error: 'Team nope is not configured.' }); expect(io.lines).toEqual([`terum-skills ${version}`]); }
    else {
      expect(result.ok).toBe(true);
      expect(io.lines.filter((line) => line.startsWith('Team '))).toEqual((team ? ['2'] : ['2', '10']).map((key) => `Team ${key} (you are @seed)`));
      expect(io.lines.filter((line) => line === '')).toHaveLength(team ? 0 : 1);
    }
  });

  it.each([undefined, 'nope'])('handles no configured teams and explicit missing selection (%s)', async (team) => {
    const f = await fixture(); await f.store.update((config) => { config.teams = {}; });
    const { result, io } = await query(f, { team }, [f.clone], []);
    if (team) { expect(result).toMatchObject({ ok: false, error: 'Team nope is not configured.' }); expect(io.lines).toHaveLength(1); }
    else {
      expect(result).toEqual({ ok: true, value: { version, teams: [], ledger: { placements: [], approvals: [], shared: [] }, identity: null, tools: { git: true, gh: false } } });
      expect(io.lines.slice(1)).toEqual(['No team is configured on this machine.', '  Create a team: npx -y terum-skills@latest setup', '  Join a team:   npx -y terum-skills@latest setup <org>/<repo>']);
    }
  });

  it.each(['remote', 'key'] as const)('continues after an invalid first binding %s', async (invalid) => {
    const f = await fixture();
    const key = invalid === 'key' ? '../bad' : 'bad';
    await f.store.update((config) => { config.teams = { [key]: { remote: invalid === 'remote' ? 'not a remote' : REMOTE, handle: 'seed' }, acme: config.teams.acme! }; });
    const { result, io } = await query(f);
    expect(result).toMatchObject({ ok: false, error: `${key}: local team details could not be read.`, value: { teams: [{ readable: false }, { readable: true }] } });
    expect(io.lines[1]).toBe(`Team ${key} (configured handle @seed)`);
    expect(io.lines[2]).toMatch(/^  Team details could not be read: /);
    expect(io.lines).toContain('Team acme (you are @seed)');
    expect(io.lines).toContain('  Shared skills: 0');
  });

  it.each(['missing', 'incomplete', 'foreign', 'unverifiable'] as const)('reports a %s clone with appropriate recovery advice', async (state) => {
    const f = await fixture();
    if (state === 'missing' || state === 'incomplete') await rm(f.clone, { recursive: true });
    if (state === 'incomplete') await mkdir(f.clone);
    if (state === 'foreign') { const other = await bareTeam(); await rm(f.clone, { recursive: true }); await cloneWithIdentity(other.bare, f.clone); }
    const runner = state === 'unverifiable' ? wrapRunner(f.runner, async (command, args, options) => {
      f.runner.calls.push({ command, args: [...args], cwd: options?.cwd }); throw new Error('spawn git ENOENT');
    }) : f.runner;
    const { result, io } = await query(f, { runner }, state === 'missing' || state === 'incomplete' ? [] : [f.clone], state === 'missing' ? [] : [f.clone]);
    expect(result).toMatchObject({ ok: false, error: 'acme: local team details could not be read.', value: { teams: [{ readable: false }] } });
    expect(io.lines[1]).toBe('Team acme (configured handle @seed)');
    expect(io.lines[2]).toBe('  Repository: https://github.com/acme/team');
    if (state === 'missing') expect(io.lines.slice(3)).toEqual([`  Clone: ${f.clone} is missing.`, `  Restore it: npx -y terum-skills@latest team join ${REMOTE}`]);
    if (state === 'incomplete') expect(io.lines.slice(3)).toEqual([`  Clone: ${f.clone} exists but is not a complete clone.`, `  Restore it: move ${f.clone} aside, then run npx -y terum-skills@latest team join ${REMOTE}`]);
    if (state === 'foreign') { expect(io.lines[3]).toMatch(/ is a clone of .+, not github.com\/acme\/team\.$/); expect(io.lines[4]).toBe(`  Restore it: move ${f.clone} aside, then run npx -y terum-skills@latest team join ${REMOTE}`); }
    if (state === 'unverifiable') expect(io.lines.slice(3)).toEqual([`  Clone: ${f.clone} could not be verified (spawn git ENOENT); check that git is installed before repairing anything.`]);
    expect(io.lines.join('\n')).not.toContain('Shared skills:');
  });

  it.each(['missing', 'fresh', 'old', 'future', 'unreadable'] as const)('handles a %s stamp', async (stamp) => {
    const f = await fixture(); const now = Date.now();
    await mkdir(join(f.store.root, 'run'));
    if (stamp === 'unreadable') await mkdir(stampPath(f.store.root, 'acme'));
    else if (stamp !== 'missing') await writeFile(stampPath(f.store.root, 'acme'), '');
    const { result, io } = await query(f, { now: () => now + (stamp === 'old' ? 7_200_000 : stamp === 'future' ? -30_000 : 0) });
    const isStale = !['fresh', 'future'].includes(stamp);
    expect(io.lines.includes(stale)).toBe(isStale);
    expect(result).toMatchObject({ ok: true, value: { teams: [{ stale: isStale }] } });
  });

  it('qualifies bad skill counts and never counts evaluation receipts', async () => {
    const f = await fixture();
    await mkdir(join(f.clone, 'skills', 'good'));
    await writeFile(join(f.clone, 'skills', 'good', 'SKILL.md'), '---\nname: good\ndescription: good\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n');
    await mkdir(join(f.clone, 'skills', 'ghost')); await writeFile(join(f.clone, 'skills', 'ghost', 'SKILL.md'), 'broken');
    await mkdir(join(f.clone, 'evals', '11111111-1111-4111-8111-111111111111', 'hash'), { recursive: true });
    await writeFile(join(f.clone, 'evals', '11111111-1111-4111-8111-111111111111', 'hash', 'run.json'), '{}'); await commit(f.clone);
    const { result, io } = await query(f);
    expect(result).toMatchObject({ ok: true, value: { teams: [{ sharedSkills: 1, unreadableSkills: 1 }] } });
    expect(io.lines).toContain('  Shared skills: 1 readable; 1 unreadable');
    expect(io.lines.some((line) => /^    ghost: .+/.test(line))).toBe(true);
    expect(io.lines).toContain('  Evaluated skills: not yet available');
  });

  it.each(['people', 'skills'])('retains already printed fields when the %s directory cannot be read', async (directory) => {
    const f = await fixture(); await rm(join(f.clone, directory), { recursive: true }); await writeFile(join(f.clone, directory), 'not a directory'); await commit(f.clone);
    const { result, io } = await query(f);
    expect(result).toMatchObject({ ok: false, error: 'acme: local team details could not be read.' });
    expect(io.lines).toContain('  From the local clone; GitHub access is not checked.');
    if (directory === 'skills') expect(io.lines).toContain('  Members: 1');
    expect(io.lines.at(-1)).toMatch(/^  Team details could not be read: /);
  });
});


it.each(['missing', 'incomplete', 'foreign'] as const)('returns pending and the recorded stamp even with a %s clone', async state => {
  const f = await fixture();
  const id = '11111111-1111-4111-8111-111111111111', version = 'a'.repeat(40), started = '2026-09-01T00:00:00.000Z';
  await f.store.update(config => { config.pending = [{ op: 'install', id, team: 'acme', scope: { kind: 'global' }, destination: { kind: 'checkout', root: '/checkout' }, version, started }, { op: 'uninstall', id, team: 'other', scope: { kind: 'global' }, started }]; });
  await mkdir(join(f.store.root, 'run'));
  await writeFile(stampPath(f.store.root, 'acme'), 'ignored');
  await utimes(stampPath(f.store.root, 'acme'), new Date(started), new Date(started));
  await rm(f.clone, { recursive: true });
  if (state === 'incomplete') await mkdir(f.clone);
  if (state === 'foreign') { const other = await bareTeam(); await cloneWithIdentity(other.bare, f.clone); }
  const { result } = await query(f, {}, state === 'foreign' ? [f.clone] : [], state === 'missing' ? [] : [f.clone]);
  expect(result.value?.teams[0]).toMatchObject({ clonePath: f.clone, syncedAt: started, policy: null, categories: null, pending: [{ op: 'install', id, scope: { kind: 'global' }, destination: { kind: 'checkout', root: '/checkout' }, version, started }] });
  expect(result.value?.teams[0]?.pending[0]).not.toHaveProperty('team');
});
it('returns policy, categories, the join block, and an empty pending list without new print lines', async () => {
  const f = await fixture();
  const { result, io } = await query(f);
  expect(result.value?.teams[0]).toMatchObject({ pending: [], syncedAt: null, clonePath: f.clone, policy: TEAM_JSON.policy, categories: TEAM_JSON.categories, joinCommand: 'npx -y terum-skills@latest setup acme/team' });
  expect(result.value?.teams[0]?.joinBlock?.join('\n')).toBe(slackBlock('acme/team'));
  expect(io.lines.join('\n')).not.toMatch(/Policy:|Categories:|Pending:|Synced at:/);
});
it('keeps policy and categories null when team.json cannot be read', async () => {
  const f = await fixture(); await writeFile(join(f.clone, 'team.json'), '{'); await commit(f.clone);
  const { result } = await query(f);
  expect(result.ok).toBe(false);
  expect(result.value?.teams[0]).toMatchObject({ policy: null, categories: null });
});
it('keeps generic git join instructions null', async () => {
  const f = await fixture();
  await f.store.update(config => { config.teams.acme!.remote = 'gitlab.com/acme/team'; });
  const { result } = await query(f);
  expect(result.value?.teams[0]).toMatchObject({ joinCommand: null, joinBlock: null });
});
it('returns the full machine ledger and identity before a missing --team fails', async () => {
  const f = await fixture(), id = '11111111-1111-4111-8111-111111111111';
  const placement = { id, team: 'other', version: 'b'.repeat(40), scope: { kind: 'project' as const, project: 'ops', ignored: 'extra' }, placed_at: '2026-09-01' };
  await f.store.update(config => {
    config.placements['/placed'] = { ...placement, fingerprint: 'private' };
    config.shared[id] = { source: '/source', team: 'other', baseline: 'private' };
    config.approvals[id] = { grants: 'hash', approved_at: '2026-09-02' };
    config.default_handle = 'seed'; config.github = '';
  });
  const { result } = await query(f, { team: 'missing' }, [f.clone], []);
  expect(result.ok).toBe(false);
  expect(result.value?.identity).toEqual({ default_handle: 'seed', github: '', email: null, display_name: null });
  expect(result.value?.ledger).toEqual({ placements: [{ ...placement, path: '/placed', scope: { kind: 'project', project: 'ops' } }], shared: [{ id, source: '/source', team: 'other' }], approvals: [{ id, grants: 'hash', approved_at: '2026-09-02' }] });
});
it('carries an explicit null version for an unpinned pending operation', async () => {
  const f = await fixture();
  await f.store.update(config => { config.pending.push({ op: 'uninstall', id: '11111111-1111-4111-8111-111111111111', team: 'acme', scope: { kind: 'global' }, started: '2026-09-01' }); });
  const { result } = await query(f);
  expect(JSON.parse(JSON.stringify(result.value)).teams[0].pending[0].version).toBeNull();
  expect(JSON.parse(JSON.stringify(result.value)).teams[0].pending[0].destination).toBeNull();
});
