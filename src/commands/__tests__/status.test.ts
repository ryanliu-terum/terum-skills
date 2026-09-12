import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { stampPath } from '../../lib/hook.js';
import { bareTeam, cloneWithIdentity, fakeGh, git, mappedRunner, person, ScriptedPrompter, TEAM_JSON, wrapRunner, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
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
  const calls = f.runner.calls.map(({ command, args, cwd }) => ({ command, args, cwd }));
  // A readable clone also gets the roster's join-date pass; it is one read-only `git log` over people/,
  // asserted by shape here and by its dates in the roster tests below.
  expect(calls.filter((call) => call.args[0] === 'log').every((call) => call.command === 'git' && call.args.join(' ') === 'log --reverse --no-renames --diff-filter=A --format=%aI --name-only -- people' && clones.includes(call.cwd ?? ''))).toBe(true);
  expect(calls.filter((call) => call.args[0] !== 'log')).toEqual([{ command: 'git', args: ['--version'], cwd: undefined }, { command: 'gh', args: ['--version'], cwd: undefined }, ...probes.map((cwd) => ({ command: 'git', args: ['remote', 'get-url', 'origin'], cwd }))]);
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
    // Every member carries the day their people file landed (the fixture commits them together); none of
    // these fixture people has reported a skill total, so every `skillsTotal` is null and never 0.
    const members = result.ok ? result.value.teams[0]!.members : [];
    expect(members.map((member) => member.skillsTotal)).toEqual(handles.map(() => null));
    for (const member of members) expect(member.joined).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
      expect(result).toEqual({ ok: true, value: { version, teams: [], ledger: { placements: [], approvals: [] }, identity: null, tools: { git: true, gh: false }, hostArch: process.arch, processArch: process.arch } });
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
    config.approvals[id] = { grants: 'hash', approved_at: '2026-09-02' };
    config.default_handle = 'seed'; config.github = '';
  });
  const { result } = await query(f, { team: 'missing' }, [f.clone], []);
  expect(result.ok).toBe(false);
  expect(result.value?.identity).toEqual({ default_handle: 'seed', github: '', email: null, display_name: null });
  expect(result.value?.ledger).toEqual({ placements: [{ ...placement, path: '/placed', scope: { kind: 'project', project: 'ops' } }], approvals: [{ id, grants: 'hash', approved_at: '2026-09-02' }] });
});
it('carries an explicit null version for an unpinned pending operation', async () => {
  const f = await fixture();
  await f.store.update(config => { config.pending.push({ op: 'uninstall', id: '11111111-1111-4111-8111-111111111111', team: 'acme', scope: { kind: 'global' }, started: '2026-09-01' }); });
  const { result } = await query(f);
  expect(JSON.parse(JSON.stringify(result.value)).teams[0].pending[0].version).toBeNull();
  expect(JSON.parse(JSON.stringify(result.value)).teams[0].pending[0].destination).toBeNull();
});

it('joins host admin permission onto each member with --permissions when gh answers, and keeps it null otherwise', async () => {
  const f = await fixture(['a', 'seed']);
  const admins = { code: 0, stdout: JSON.stringify([[{ login: 'SEED' }], [{ login: 'outsider' }]]), stderr: '' };
  const withGh = mappedRunner(REMOTE, f.bare, fakeGh('seed', { 'api repos/acme/team/collaborators?permission=admin --paginate --slurp': admins }));
  const answered = await run({ config: f.store, runner: withGh, permissions: true }, new ScriptedPrompter());
  expect(answered.value?.teams[0]?.members).toMatchObject([{ handle: 'a', admin: false }, { handle: 'seed', admin: true }]);
  expect(withGh.calls.some(call => call.command === 'gh' && call.args.join(' ').includes('collaborators?permission=admin'))).toBe(true);
  // gh installed and --permissions passed, but the lookup fails (offline / unauthorized): status still succeeds, admin unknown.
  const failing = mappedRunner(REMOTE, f.bare, fakeGh('seed'));
  const offline = await run({ config: f.store, runner: failing, permissions: true }, new ScriptedPrompter());
  expect(offline.ok).toBe(true);
  expect(offline.value?.teams[0]?.members.map(member => member.admin)).toEqual([null, null]);
  // No gh at all: the lookup is never attempted.
  const absent = await run({ config: f.store, runner: f.runner }, new ScriptedPrompter());
  expect(absent.ok).toBe(true);
  expect(absent.value?.teams[0]?.members.map(member => member.admin)).toEqual([null, null]);
  expect(f.runner.calls.filter(call => call.command === 'gh').map(call => call.args)).toEqual([['--version']]);
});


describe('W-02 status permissions and probes', () => {
  const api = 'api repos/acme/team/collaborators?permission=admin --paginate --slurp';
  it.each([false,true])('queries collaborators only with permissions=%s', async permissions => {
    const f=await fixture(['seed','other']);
    await writeFile(join(f.clone,'people/seed.json'),JSON.stringify({...person('seed'),github:'seed'}));
    await writeFile(join(f.clone,'people/other.json'),JSON.stringify({...person('other'),github:'other'}));
    const runner=mappedRunner(REMOTE,f.bare,fakeGh('seed',{[api]:{code:0,stdout:'[[{"login":"seed"}]]',stderr:''}}));
    const result=await run({config:f.store,runner,...(permissions?{permissions:true}:{})},new ScriptedPrompter());
    expect(result.ok).toBe(true);
    expect(runner.calls.filter(c=>c.command==='gh'&&c.args[0]==='api').map(c=>c.args.join(' '))).toEqual(permissions?[api]:[]);
    expect(result.value?.teams[0]?.members.map(m=>[m.handle,m.admin])).toEqual([['other',permissions?false:null],['seed',permissions?true:null]]);
    // Without --permissions status still makes no gh API call; the one extra git call is the roster's
    // local read-only join-date pass over people/, which needs no network and no credentials.
    if(!permissions){const calls=runner.calls.map(c=>[c.command,...c.args].join(' '));expect(calls.slice(0,2).sort()).toEqual(['gh --version','git --version']);expect(calls.slice(2)).toEqual(['git remote get-url origin','git log --reverse --no-renames --diff-filter=A --format=%aI --name-only -- people']);}
  });
  it.each([false,true])('reports admin null when gh is absent, permissions=%s',async permissions=>{
    const f=await fixture();const result=await run({config:f.store,runner:f.runner,permissions},new ScriptedPrompter());
    expect(result).toMatchObject({ok:true,value:{tools:{git:true,gh:false}}});expect(result.value?.teams[0]?.members.every(m=>m.admin===null)).toBe(true);expect(f.runner.calls.some(c=>c.command==='gh'&&c.args[0]==='api')).toBe(false);
  });
  it.each([1,124])('reports admin null when collaborator lookup exits %s',async code=>{
    const f=await fixture();let deadline:number|undefined;
    const gh=fakeGh('seed');const runner=mappedRunner(REMOTE,f.bare,(args,options)=>{if(args[0]==='api'){deadline=options?.deadlineMs;return {code,stdout:'',stderr:code===124?'deadline':'HTTP 403'};}return gh(args,options);});
    const result=await run({config:f.store,runner,permissions:true},new ScriptedPrompter());expect(result.ok).toBe(true);expect(result.value?.teams[0]?.members.every(m=>m.admin===null)).toBe(true);expect(deadline).toBe(10_000);
  });
  it('starts the git and gh probes together',async()=>{
    const f=await fixture();let count=0;let release!:()=>void;const both=new Promise<void>(resolve=>{release=resolve;});
    const runner=wrapRunner(f.runner,async(_command,args,_options,next)=>{if(args[0]==='--version'){if(++count===2)release();await both;}return next();});
    expect((await run({config:f.store,runner},new ScriptedPrompter())).ok).toBe(true);expect(count).toBe(2);
  },5000);
});


describe('status architecture (p-arch A4)', () => {
  it.each([
    ['win32', 'x64', 'ARM64', 'arm64'],
    ['win32', 'arm64', undefined, 'arm64'],
    ['win32', 'ia32', 'AMD64', 'x64'],
    ['win32', 'future-arch', 'unknown', 'future-arch'],
    ['darwin', 'x64', 'ARM64', 'x64'],
    ['linux', 'x64', 'ARM64', 'x64'],
  ] as const)('reports host and process separately on %s %s with hint %s', async (platform, arch, hint, host) => {
    const config = createConfigStore(await temporaryDirectory());
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')!;
    Object.defineProperty(process, 'platform', { value: platform });
    Object.defineProperty(process, 'arch', { value: arch });
    vi.stubEnv('PROCESSOR_ARCHITEW6432', hint);
    const runner = { run: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })) };
    try {
      expect(await run({ config, runner }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { processArch: arch, hostArch: host } });
      const read = vi.spyOn(config, 'read').mockRejectedValue(new Error('config unreadable'));
      try {
        expect(await run({ config, runner }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'config unreadable', value: { processArch: arch, hostArch: host } });
      } finally { read.mockRestore(); }
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor);
      Object.defineProperty(process, 'arch', archDescriptor);
      vi.unstubAllEnvs();
    }
  });
});
