import { mkdir, realpath, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, fakeGh, git, holdCloneLock, mappedRunner, originSha, pushFromSeed, ScriptedPrompter, TEAM_JSON, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { run } from '../publish.js';
import { CommandResult } from '../../lib/runner.js';

const V = 'npx -y terum-skills@latest';

async function localSkill(home: string, name: string, frontmatterName = name): Promise<string> {
  const directory = join(home, '.claude', 'skills', name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${frontmatterName}\ndescription: ${name} skill\n---\n`);
  return directory;
}

const REMOTE = 'https://github.com/acme/team.git';
const ID = '11111111-1111-4111-8111-111111111111';
/** The branch a publish of `sample` by `seed` mints: fresh every run (R2), so tests match the shape, never a literal. */
const FRESH = /^publish\/sample-seed-[0-9a-f]{8}$/;
/** A gh that answers `pr create` for ANY head — the head is minted per run — and everything else through fakeGh. */
function ghCreating(reply: CommandResult, api: Record<string, CommandResult> = {}): ReturnType<typeof fakeGh> {
  const base = fakeGh('seed', api);
  return (args, options) => (args[0] === 'pr' && args[1] === 'create' ? reply : base(args, options));
}
const skill = (name = 'sample') => `---\nname: ${name}\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\nallowed-tools: Bash(git status)\n---\n`;

/** Commit files from the seed clone and push them to a branch only — main stays where it is; the seed is reset afterwards. */
async function pushBranchFromSeed(seed: string, files: ReadonlyArray<{ path: string; content: string }>, branch: string): Promise<string> {
  await git(['fetch', '-q', 'origin'], seed);
  await git(['reset', '-q', '--hard', 'origin/main'], seed);
  for (const file of files) { await mkdir(join(seed, file.path, '..'), { recursive: true }); await writeFile(join(seed, file.path), file.content); }
  await git(['add', '--all'], seed);
  await git(['commit', '-q', '-m', `${branch}: theirs`], seed);
  const sha = (await git(['rev-parse', 'HEAD'], seed)).trim();
  await git(['push', '-q', '-f', 'origin', `HEAD:refs/heads/${branch}`], seed);
  await git(['reset', '-q', '--hard', 'origin/main'], seed);
  return sha;
}

async function prepared(policy: 'pr' | 'push' = 'pr') {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
  if (policy === 'push') await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: {}, archived: [], policy: { publish: policy, skill_license: 'UNLICENSED' } })}\n`);
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: REMOTE, handle: 'seed' }; });
  return { fixture, store };
}

describe('publish (§6)', () => {
  it('pushes a PR branch only and opens a GitHub pull request', async () => {
    const { fixture, store } = await prepared();
    const runner = mappedRunner(REMOTE, fixture.bare, ghCreating({ code: 0, stdout: 'https://github.com/acme/team/pull/1\n', stderr: '' }));
    const before = await originSha(fixture.bare);
    const result = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { branch: expect.stringMatching(FRESH), prUrl: 'https://github.com/acme/team/pull/1' } });
    const branch = result.ok ? result.value.branch! : '';
    expect(await originSha(fixture.bare)).toBe(before);
    expect(JSON.parse(await git(['show', `${branch}:team.json`], fixture.bare)).global).toContain(ID);
    expect(runner.calls.filter((call) => call.command === 'gh' && call.args[0] === 'pr' && call.args[1] === 'create').map((call) => call.args[call.args.indexOf('--head') + 1])).toEqual([branch]);
    expect(runner.calls.some((call) => call.command === 'git' && call.args.includes('HEAD:refs/heads/main'))).toBe(false);
  });

  it('heals a clone whose local main drifted instead of failing to fast-forward', async () => {
    const { fixture, store } = await prepared();
    const clone = store.teamClone('team');
    await writeFile(join(clone, 'stray.txt'), 'local'); await git(['add', '--all'], clone); await git(['commit', '-q', '-m', 'local-only'], clone);
    const before = await originSha(fixture.bare);
    const result = await run({ ref: 'sample', config: store, runner: mappedRunner(REMOTE, fixture.bare) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { branch: expect.stringMatching(FRESH) } });
    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('keeps the PR policy when gh is unavailable or logged out', async () => {
    for (const gh of [undefined, fakeGh('seed', {}, false)]) {
      const { fixture, store } = await prepared();
      const runner = mappedRunner(REMOTE, fixture.bare, gh);
      const io = new ScriptedPrompter();
      const result = await run({ ref: 'sample', config: store, runner }, io);
      expect(result).toMatchObject({ ok: true, value: { branch: expect.stringMatching(FRESH), prUrl: null } });
      expect(io.lines.join('\n')).toContain(`https://github.com/acme/team/compare/main...${result.ok ? result.value.branch : ''}?expand=1`);
      expect(runner.calls.some((call) => call.command === 'git' && call.args.includes('HEAD:refs/heads/main'))).toBe(false);
      expect(runner.calls.filter((call) => call.command === 'gh' && call.args[0] === 'pr')).toHaveLength(0);
    }
  });

  it('requires confirmation only for direct-push policy and writes the endorsed ID', async () => {
    const { fixture, store } = await prepared('push');
    const before = await originSha(fixture.bare);
    await expect(run({ ref: 'sample', config: store }, new ScriptedPrompter([], [false]))).resolves.toMatchObject({ ok: false, error: 'Publish was cancelled.' });
    expect(await originSha(fixture.bare)).toBe(before);
    const io = new ScriptedPrompter([], [true]);
    const confirmed = await run({ ref: 'sample', config: store, runner: mappedRunner(REMOTE, fixture.bare) }, io);
    if (!confirmed.ok) throw new Error(confirmed.error);
    expect(confirmed).toMatchObject({ ok: true, value: { branch: null, policy: 'push' } });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).global).toContain(ID);
    expect((await git(['log', '--format=%s', '-1', 'main'], fixture.bare)).trim()).toBe('seed: publish sample');
    expect((await git(['rev-list', '--count', `${before}..main`], fixture.bare)).trim()).toBe('1');
    expect(io.lines.join('\n')).toContain('allowed-tools: Bash(git status)');
  });

  it.each(['pr', 'push'] as const)('refuses hygiene failures before endorsement activity under %s policy', async (policy) => {
    const { fixture, store } = await prepared(policy);
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `${skill()}ghp_abcdefghijklmnopqrstuvwxyz\n`);
    const runner = mappedRunner(REMOTE, fixture.bare); const io = new ScriptedPrompter([], [true]);
    expect(await run({ ref: 'sample', config: store, runner }, io)).toMatchObject({ ok: false, error: expect.stringContaining('HYG3') });
    expect(runner.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
    expect(io.lines.join('\n')).not.toContain('allowed-tools:');
  });

  it('handles projects, existing endorsements, and version refs before writing', async () => {
    const { fixture, store } = await prepared();
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: ['x'], skills: [] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    await git(['pull', '--ff-only'], store.teamClone('team'));
    const runner = mappedRunner(REMOTE, fixture.bare);
    const projectResult = await run({ ref: 'team/sample', project: 'product', config: store, runner }, new ScriptedPrompter());
    expect(projectResult).toMatchObject({ ok: true, value: { scope: { kind: 'project', project: 'product' } } });
    const branchTeam = JSON.parse(await git(['show', `${projectResult.ok ? projectResult.value.branch : ''}:team.json`], fixture.bare));
    expect(branchTeam.projects.product.skills).toEqual([ID]);
    expect(branchTeam.global).toEqual([]);
    await expect(run({ ref: 'sample@deadbeef', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'publish endorses a skill by ID, not a version; drop @<version>.' });
    await expect(run({ ref: 'sample', project: 'nope', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'Unknown project nope.' });
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ ...branchTeam, global: [ID], projects: { product: { remotes: ['x'], skills: [] } } })}\n`);
    await git(['pull', '--ff-only'], store.teamClone('team'));
    const io = new ScriptedPrompter();
    await expect(run({ ref: 'sample', config: store, runner }, io)).resolves.toMatchObject({ ok: true, value: { changed: false } });
    expect(io.asked).toEqual([]);
  });

  it('never exposes credentials in publish messages', async () => {
    const { fixture, store } = await prepared();
    await store.update((config) => { config.teams.team!.remote = 'https://me:tok@github.com/acme/team.git'; });
    const runner = mappedRunner('https://me:tok@github.com/acme/team.git', fixture.bare);
    const io = new ScriptedPrompter();
    const result = await run({ ref: 'sample', config: store, runner }, io);
    expect(JSON.stringify(result) + io.lines.join('\n')).not.toContain('tok');
    expect(await readFile(join(store.teamClone('team'), 'team.json'), 'utf8')).toContain('team');
  });

  it('every publish creates a fresh branch and a fresh PR and never touches an existing one; a second publish of the same skill is noted and declined by default', async () => {
    const { fixture, store } = await prepared();
    const mainBefore = await originSha(fixture.bare);
    const runner = mappedRunner(REMOTE, fixture.bare);
    const first = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter());
    expect(first).toMatchObject({ ok: true, value: { changed: true, branch: expect.stringMatching(FRESH) } });
    const firstBranch = first.ok ? first.value.branch! : '';
    const firstSha = await originSha(fixture.bare, firstBranch);
    expect(JSON.parse(await git(['show', `${firstBranch}:team.json`], fixture.bare)).global).toContain(ID);
    expect(await originSha(fixture.bare)).toBe(mainBefore);
    // One remote probe per publish, asking for every form of the name at once; the push is create-only.
    const probes = runner.calls.filter((call) => call.command === 'git' && call.args[0] === 'ls-remote');
    expect(probes).toHaveLength(1);
    expect(probes[0]!.args).toEqual(expect.arrayContaining(['refs/heads/publish/sample', 'refs/heads/publish/sample-*']));
    const pushes = runner.calls.filter((call) => call.command === 'git' && call.args[0] === 'push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.args).toContain(`--force-with-lease=refs/heads/${firstBranch}:`);
    // main moves on; publishing again is a note and a y/N. Declined: nothing pushed, the first branch untouched.
    await pushFromSeed(fixture.seed, 'note.txt', 'main moved on');
    const mainMoved = await originSha(fixture.bare);
    const declinedIo = new ScriptedPrompter([], [false]);
    expect(await run({ ref: 'sample', config: store, runner }, declinedIo)).toMatchObject({ ok: true, value: { changed: false, branch: null, prUrl: null } });
    expect(declinedIo.lines).toEqual(expect.arrayContaining([`An endorsement of sample is already open: ${firstBranch} (by seed).`, 'Nothing pushed; sample keeps its open endorsement.']));
    expect(declinedIo.asked).toEqual(['Open another pull request for sample? If both merge, GitHub will flag the second as conflicting.']);
    expect(await originSha(fixture.bare, firstBranch)).toBe(firstSha);
    expect((await git(['branch', '--list', 'publish/sample-*'], fixture.bare)).trim().split('\n')).toHaveLength(1);
    // Accepted: a second fresh branch on the new base; the first still points where it did.
    const again = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter([], [true]));
    expect(again).toMatchObject({ ok: true, value: { changed: true, branch: expect.stringMatching(FRESH) } });
    const secondBranch = again.ok ? again.value.branch! : '';
    expect(secondBranch).not.toBe(firstBranch);
    expect((await git(['rev-parse', `${secondBranch}^`], fixture.bare)).trim()).toBe(mainMoved);
    expect(await originSha(fixture.bare, firstBranch)).toBe(firstSha);
    expect(await originSha(fixture.bare)).toBe(mainMoved);
    // The pre-R2 names a team may still carry are noted too — and never written to.
    const legacy = await prepared();
    const theirs = await pushBranchFromSeed(legacy.fixture.seed, [{ path: 'unrelated.txt', content: 'someone else' }], 'publish/sample');
    const legacyIo = new ScriptedPrompter([], [true]);
    const legacyRunner = mappedRunner(REMOTE, legacy.fixture.bare);
    expect(await run({ ref: 'sample', config: legacy.store, runner: legacyRunner }, legacyIo)).toMatchObject({ ok: true, value: { branch: expect.stringMatching(FRESH) } });
    expect(legacyIo.lines).toContain('An endorsement of sample is already open: publish/sample.');
    expect(await originSha(legacy.fixture.bare, 'publish/sample')).toBe(theirs);
    expect(legacyRunner.calls.filter((call) => call.command === 'git' && call.args[0] === 'push').every((call) => call.args.some((arg) => /^--force-with-lease=refs\/heads\/publish\/sample-seed-[0-9a-f]{8}:$/.test(arg)))).toBe(true);
  });

  it('refuses to refresh a clone another operation is writing to, and pushes nothing', async () => {
    const { fixture, store } = await prepared();
    const runner = mappedRunner(REMOTE, fixture.bare);
    const clone = store.teamClone('team');
    const release = await holdCloneLock(clone);
    try {
      await expect(run({ ref: 'sample', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/write lock/i) });
      expect(runner.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
    } finally { await release(); }
    expect((await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter())).ok).toBe(true);
  });

  it('rejects unknown names and resolves an ambiguous bare ref only with --team', async () => {
    const { fixture, store } = await prepared();
    const other = await bareTeam();
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    const runner = mappedRunner(REMOTE, fixture.bare);
    await expect(run({ ref: 'team/missing', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: `No skill team/missing in team team. Run \`${V} ls\` to check the team's skill names. Inspect local folders with \`${V} ls --local\`; publish local skills explicitly from the Library.` });
    await expect(run({ ref: 'sample', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('A bare skill ref is ambiguous across configured teams') });
    await expect(run({ ref: 'sample', team: 'team', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true, value: { team: 'team' } });
  });

  it('re-verifies the skill against the reset tree before publishing', async () => {
    const { fixture, store } = await prepared();
    const base = mappedRunner(REMOTE, fixture.bare);
    let removed = false; let fetches = 0;
    const runner = wrapRunner(base, async (command, args, _options, next) => {
      // The first fetch is the preflight refresh; safeWrite's own fetch is the second — the race the spec means.
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2 && !removed) {
        removed = true;
        await git(['fetch', '-q', 'origin'], fixture.seed);
        await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
        await git(['rm', '-qr', 'skills/sample'], fixture.seed);
        await git(['commit', '-q', '-m', 'remove sample'], fixture.seed);
        await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
      }
      return next();
    });
    await expect(run({ ref: 'sample', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('sample is no longer in the repository') });
    expect(base.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
  });

  it('replays hygiene against the reset tree when a secret lands during publish', async () => {
    const { fixture, store } = await prepared();
    const base = mappedRunner(REMOTE, fixture.bare); let fetches = 0;
    const runner = wrapRunner(base, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2) await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `${skill()}ghp_abcdefghijklmnopqrstuvwxyz\n`);
      return next();
    });
    expect(await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('HYG3') });
    expect(base.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
  });

  it('reports gh failure after pushing the endorsement branch exactly once', async () => {
    const { fixture, store } = await prepared();
    const runner = mappedRunner(REMOTE, fixture.bare, ghCreating({ code: 1, stdout: '', stderr: 'gh could not create it' }));
    const before = await originSha(fixture.bare);
    const result = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('gh could not create it') });
    const message = result.ok ? '' : result.error;
    const branch = /publish\/sample-seed-[0-9a-f]{8}/.exec(message)?.[0] ?? '';
    expect(branch).toMatch(FRESH);
    expect(message).toContain(`https://github.com/acme/team/compare/main...${branch}?expand=1`);
    expect(JSON.parse(await git(['show', `${branch}:team.json`], fixture.bare)).global).toContain(ID);
    expect(await originSha(fixture.bare)).toBe(before);
    expect(runner.calls.filter((call) => call.command === 'gh' && call.args[0] === 'pr' && call.args[1] === 'create')).toHaveLength(1);
  });

  it('with gh, an open PR for the skill is named by URL before the y/N, a fresh PR is opened on yes, and a branch whose PR is closed is a leftover nobody is asked about', async () => {
    const { fixture, store } = await prepared();
    const existing = await pushBranchFromSeed(fixture.seed, [{ path: 'team.json', content: `${JSON.stringify({ ...TEAM_JSON, global: [ID] }, null, 2)}\n` }], 'publish/sample-alice-deadbeef');
    let created: string[] = [];
    const noting = ghCreating({ code: 0, stdout: 'https://github.com/acme/team/pull/9\n', stderr: '' }, {
      'pr list -R acme/team --head publish/sample-alice-deadbeef --state open --json url -q .[0].url': { code: 0, stdout: 'https://github.com/acme/team/pull/7\n', stderr: '' },
    });
    const runner = mappedRunner(REMOTE, fixture.bare, (args, options) => { if (args[0] === 'pr' && args[1] === 'create') created = [...args]; return noting(args, options); });
    const io = new ScriptedPrompter([], [true]);
    const result = await run({ ref: 'sample', config: store, runner }, io);
    expect(io.lines).toContain('An endorsement of sample is already open: https://github.com/acme/team/pull/7 (by alice).');
    expect(result).toMatchObject({ ok: true, value: { changed: true, prUrl: 'https://github.com/acme/team/pull/9', branch: expect.stringMatching(FRESH) } });
    expect(created).toEqual(expect.arrayContaining(['--head', result.ok ? result.value.branch : '']));
    expect(await originSha(fixture.bare, 'publish/sample-alice-deadbeef')).toBe(existing);
    // Every PR closed: the branches are leftovers, nothing is noted, nothing is asked.
    const quiet = fakeGh('seed');
    const quietRunner = mappedRunner(REMOTE, fixture.bare, (args, options) => (args[0] === 'pr' && args[1] === 'list' ? { code: 0, stdout: '', stderr: '' } : args[0] === 'pr' && args[1] === 'create' ? { code: 0, stdout: 'https://github.com/acme/team/pull/10\n', stderr: '' } : quiet(args, options)));
    const quietIo = new ScriptedPrompter();
    expect(await run({ ref: 'sample', config: store, runner: quietRunner }, quietIo)).toMatchObject({ ok: true, value: { changed: true, prUrl: 'https://github.com/acme/team/pull/10' } });
    expect(quietIo.asked).toEqual([]);
    expect(quietIo.lines.filter((line) => line.startsWith('An endorsement of'))).toEqual([]);
  });

  it('re-reads the publish policy on the reset tree: a policy flipped from push to pr mid-write is refused, nothing lands on main', async () => {
    const { fixture, store } = await prepared('push');
    const before = await originSha(fixture.bare);
    let flipped = false; let fetches = 0;
    const runner = wrapRunner(mappedRunner(REMOTE, fixture.bare), async (command, args, _options, next) => {
      // Second fetch = safeWrite's, after the preflight refresh: the flip must land mid-write.
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2 && !flipped) {
        flipped = true;
        await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
      }
      return next();
    });
    await expect(run({ ref: 'sample', config: store, runner }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: false, error: expect.stringContaining('publish policy changed to "pr"') });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).global).toEqual([]);
    expect((await git(['rev-list', '--count', `${before}..main`], fixture.bare)).trim()).toBe('1');
    expect((await git(['branch', '--list', 'publish/*'], fixture.bare)).trim()).toBe('');
  });

  it('an inherited object key is not a project', async () => {
    const { fixture, store } = await prepared();
    await expect(run({ ref: 'sample', project: 'constructor', config: store, runner: mappedRunner(REMOTE, fixture.bare) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'Unknown project constructor.' });
  });

});


describe.each([undefined, 'bare'] as const)('publish local recovery hints (form=%s)', (form) => {
  const V = form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest';
  it('a miss with an untracked local folder names the local-library route and writes nothing', async () => {
    const { fixture, store } = await prepared();
    const home = join(fixture.root, 'home with space');
    const local = await localSkill(home, 'local');
    const runner = mappedRunner(REMOTE, fixture.bare);
    const before = await originSha(fixture.bare);
    const sourceBefore = await readFile(join(local, 'SKILL.md'), 'utf8');
    const io = new ScriptedPrompter([], [], true);
    await expect(run({ form, ref: 'local', home, project: 'p', config: store, runner }, io)).resolves.toMatchObject({ ok: false,
      error: `No skill local in team team. Found a local folder at ${local}. Inspect local skills with \`${V} ls --local\`; publish local skills explicitly from the Library.` });
    expect(io.asked).toEqual([]);
    expect(await readFile(join(local, 'SKILL.md'), 'utf8')).toBe(sourceBefore);
    expect(await originSha(fixture.bare)).toBe(before);
    expect(runner.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
  });

  it('a miss with no candidate gets the team and local-library hints', async () => {
    const { fixture, store } = await prepared();
    const home = join(fixture.root, 'home');
    await localSkill(home, 'gsd-x', 'gsd:x');
    const placed = await localSkill(home, 'mine');
    await store.update((config) => {
      config.placements[placed] = { id: '22222222-2222-4222-8222-222222222222', team: 'other', version: null, fingerprint: '', scope: { kind: 'global' }, placed_at: '' };
    });
    const runner = mappedRunner(REMOTE, fixture.bare);
    const before = await originSha(fixture.bare);
    const generic = (ref: string) => `No skill ${ref} in team team. Run \`${V} ls\` to check the team's skill names. Inspect local folders with \`${V} ls --local\`; publish local skills explicitly from the Library.`;
    for (const ref of ['missing', 'gsd-x', 'mine']) await expect(run({ form, ref, home, config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: generic(ref) });
    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('two configured teams: the hint carries the team the ref selected', async () => {
    const { fixture, store } = await prepared();
    const other = await bareTeam();
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    const home = join(fixture.root, 'home');
    const local = await localSkill(home, 'local');
    const result = await run({ form, ref: 'team/local', home, config: store, runner: mappedRunner(REMOTE, fixture.bare) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false,
      error: `No skill team/local in team team. Found a local folder at ${local}. Inspect local skills with \`${V} ls --local\`; publish local skills explicitly from the Library.` });
  });

  it('an existing team skill with the same name as a local folder is endorsed, never re-shared', async () => {
    const { fixture, store } = await prepared();
    const home = join(fixture.root, 'home');
    await localSkill(home, 'sample');
    const before = await originSha(fixture.bare);
    const result = await run({ form, ref: 'sample', home, config: store, runner: mappedRunner(REMOTE, fixture.bare) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { branch: expect.stringMatching(FRESH) } });
    expect(await originSha(fixture.bare)).toBe(before);
  });
});


describe('publish project recovery hints', () => {
  it.each([false, true])('prints the actual project candidate path and scope-labels duplicate names (duplicated: %s)', async (duplicated) => {
    const { fixture, store } = await prepared(); const home = join(fixture.root, 'home'); const cwd = join(fixture.root, 'project');
    await mkdir(join(cwd, '.git'), { recursive: true }); const project = await localSkill(cwd, 'local');
    const global = duplicated ? await localSkill(home, 'local') : undefined;
    const runner = mappedRunner(REMOTE, fixture.bare); const io = new ScriptedPrompter();
    const result = await run({ ref: 'local', home, cwd, project: 'p', config: store, runner }, io);
    expect(result.ok).toBe(false); if (result.ok) throw new Error('Expected recovery hint');
    expect(result.error).toContain(`Found a local folder at ${project}${duplicated ? ' (project)' : ''}.`);
    expect(result.error).toContain(`${V} ls --local`);
    expect(result.error).toContain('publish local skills explicitly from the Library.');
    if (duplicated) expect(result.error).toContain(`Found a local folder at ${global} (global).`);
    expect(io.asked).toEqual([]);
    expect(runner.calls.some((call) => call.args[0] === 'push')).toBe(false);
  });
});

describe('publish HYG6 warnings', () => {
  it.each(['pr', 'push'] as const)('publishes oversized content with exactly one warning under %s', async (policy) => {
    const { fixture, store } = await prepared(policy);
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill().padEnd(20_001, 'x'));
    const runner = mappedRunner(REMOTE, fixture.bare); const io = new ScriptedPrompter([], [true]);
    const result = await run({ ref: 'sample', config: store, runner }, io);
    expect(result).toMatchObject({ ok: true, value: { changed: true } });
    expect(io.lines.filter((line) => line.startsWith('warning HYG6'))).toHaveLength(1);
    expect(io.lines[0]).toContain('20,001');
    expect(runner.calls.filter((call) => call.command === 'git' && call.args[0] === 'push')).toHaveLength(1);
  });

  it.each([
    { before: 0, after: 20_001, lengths: ['20,001'] },
    { before: 20_001, after: 21_001, lengths: ['20,001', '21,001'] },
    { before: 20_001, after: 0, lengths: ['20,001'] },
  ])('reports only completed replay warning changes ($before -> $after)', async ({ before, after, lengths }) => {
    const { fixture, store } = await prepared();
    if (before) await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill().padEnd(before, 'x'));
    const io = new ScriptedPrompter(); const base = mappedRunner(REMOTE, fixture.bare);
    let fetches = 0; let duringWrite: string[] | undefined;
    const runner = wrapRunner(base, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2) {
        duringWrite = [...io.lines];
        await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill().padEnd(after, 'x'));
      }
      const result = await next();
      // Includes commit, push, and safeWrite's finally fetch/reset: no mutation-time printing.
      if (command === 'git' && duringWrite !== undefined) expect(io.lines).toEqual(duringWrite);
      return result;
    });
    expect(await run({ ref: 'sample', config: store, runner }, io)).toMatchObject({ ok: true, value: { changed: true } });
    const warnings = io.lines.filter((line) => line.startsWith('warning HYG6'));
    expect(warnings).toHaveLength(lengths.length);
    lengths.forEach((length, index) => expect(warnings[index]).toContain(`is ${length} characters`));
  });

  it('prints replay warnings before refusing mixed errors', async () => {
    const { fixture, store } = await prepared(); const io = new ScriptedPrompter();
    const base = mappedRunner(REMOTE, fixture.bare); let fetches = 0;
    const runner = wrapRunner(base, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2) await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill().padEnd(20_001, 'x') + '\nghp_abcdefghijklmnopqrstuvwxyz');
      return next();
    });
    expect(await run({ ref: 'sample', config: store, runner }, io)).toMatchObject({ ok: false, error: expect.stringContaining('HYG3') });
    expect(io.lines).toEqual([expect.stringMatching(/^warning HYG6/)]);
    expect(base.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
  });

  it.each(['pr', 'push'] as const)('mixed preflight shows warning before refusal without a card under %s', async (policy) => {
    const { fixture, store } = await prepared(policy);
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill().padEnd(20_001, 'x') + '\nghp_abcdefghijklmnopqrstuvwxyz');
    const runner = mappedRunner(REMOTE, fixture.bare); const io = new ScriptedPrompter([], [true]);
    expect(await run({ ref: 'sample', config: store, runner }, io)).toMatchObject({ ok: false, error: expect.stringContaining('HYG3') });
    expect(io.lines).toEqual([expect.stringMatching(/^warning HYG6/)]); expect(io.asked).toEqual([]);
    expect(runner.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
  });

  it('already-endorsed oversized content has no hygiene output', async () => {
    const { fixture, store } = await prepared();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill().padEnd(20_001, 'x') + '\nghp_abcdefghijklmnopqrstuvwxyz');
    await pushFromSeed(fixture.seed, 'team.json', JSON.stringify({ ...TEAM_JSON, global: [ID] }));
    const io = new ScriptedPrompter(); const runner = mappedRunner(REMOTE, fixture.bare);
    expect(await run({ ref: 'sample', config: store, runner }, io)).toMatchObject({ ok: true, value: { changed: false } });
    expect(io.lines).toEqual(['sample is already endorsed (global) in team.']);
    expect(runner.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
  });

  it('prints no new replay warning when another publisher already endorsed it', async () => {
    const { fixture, store } = await prepared(); const io = new ScriptedPrompter();
    let fetches = 0;
    const runner = wrapRunner(mappedRunner(REMOTE, fixture.bare), async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch' && ++fetches === 2) {
        await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill().padEnd(20_001, 'x'));
        await pushFromSeed(fixture.seed, 'team.json', JSON.stringify({ ...TEAM_JSON, global: [ID] }));
      }
      return next();
    });
    expect(await run({ ref: 'sample', config: store, runner }, io)).toMatchObject({ ok: true, value: { changed: false } });
    expect(io.lines).toEqual(['sample is already endorsed (global) in team.']);
  });
});


it.each([true, false])('registers a checkout only after successful publish (consent: %s)', async consent => {
  const { fixture, store } = await prepared('push');
  const root = join(await realpath(fixture.root), 'checkout'); const cwd = join(root, 'src');
  await mkdir(cwd, { recursive: true }); await mkdir(join(root, '.git'));
  const args = { ref: 'sample', config: store, runner: mappedRunner(REMOTE, fixture.bare), cwd, home: fixture.root };
  const io = new ScriptedPrompter([], [consent]);
  expect((await run(args, io)).ok).toBe(consent);
  expect((await store.read()).checkouts ?? []).toEqual(consent ? [root] : []);
  expect(io.lines.filter(line => line.startsWith('Registered '))).toEqual(consent ? [`Registered ${root} in your library.`] : []);
  if (consent) {
    const again = new ScriptedPrompter(); expect((await run(args, again)).ok).toBe(true);
    expect(again.lines.filter(line => line.startsWith('Registered '))).toEqual([]);
  }
});
