import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, fakeGh, git, mappedRunner, originSha, pushFromSeed, ScriptedPrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { run } from '../publish.js';

const REMOTE = 'https://github.com/acme/team.git';
const ID = '11111111-1111-4111-8111-111111111111';
const skill = (name = 'sample') => `---\nname: ${name}\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\nallowed-tools: Bash(git status)\n---\n`;

/** Commit one file from the seed clone and push it to a branch only — main stays where it is; the seed is reset afterwards. */
async function pushBranchFromSeed(seed: string, path: string, content: string, branch: string): Promise<string> {
  await git(['fetch', '-q', 'origin'], seed);
  await git(['reset', '-q', '--hard', 'origin/main'], seed);
  await writeFile(join(seed, path), content);
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
    const runner = mappedRunner(REMOTE, fixture.bare, fakeGh('seed', { 'pr create -R acme/team --base main --head publish/sample --title seed: publish sample --body Endorse sample (11111111) for team: global.\n\nOpened by terum-skills publish; merge to endorse.': { code: 0, stdout: 'https://github.com/acme/team/pull/1\n', stderr: '' } }));
    const before = await originSha(fixture.bare);
    const result = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { branch: 'publish/sample', prUrl: 'https://github.com/acme/team/pull/1' } });
    expect(await originSha(fixture.bare)).toBe(before);
    expect(JSON.parse(await git(['show', 'publish/sample:team.json'], fixture.bare)).global).toContain(ID);
    expect(runner.calls.some((call) => call.command === 'git' && call.args.includes('HEAD:refs/heads/main'))).toBe(false);
  });

  it('heals a clone whose local main drifted instead of failing to fast-forward', async () => {
    const { fixture, store } = await prepared();
    const clone = store.teamClone('team');
    await writeFile(join(clone, 'stray.txt'), 'local'); await git(['add', '--all'], clone); await git(['commit', '-q', '-m', 'local-only'], clone);
    const before = await originSha(fixture.bare);
    const result = await run({ ref: 'sample', config: store, runner: mappedRunner(REMOTE, fixture.bare) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { branch: 'publish/sample' } });
    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('keeps the PR policy when gh is unavailable or logged out', async () => {
    for (const gh of [undefined, fakeGh('seed', {}, false)]) {
      const { fixture, store } = await prepared();
      const runner = mappedRunner(REMOTE, fixture.bare, gh);
      const io = new ScriptedPrompter();
      const result = await run({ ref: 'sample', config: store, runner }, io);
      expect(result).toMatchObject({ ok: true, value: { branch: 'publish/sample', prUrl: null } });
      expect(io.lines.join('\n')).toContain('https://github.com/acme/team/compare/main...publish/sample?expand=1');
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

  it('handles projects, existing endorsements, and version refs before writing', async () => {
    const { fixture, store } = await prepared();
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: ['x'], skills: [] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    await git(['pull', '--ff-only'], store.teamClone('team'));
    const runner = mappedRunner(REMOTE, fixture.bare);
    await expect(run({ ref: 'team/sample', project: 'product', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true, value: { scope: { kind: 'project', project: 'product' } } });
    const branchTeam = JSON.parse(await git(['show', 'publish/sample:team.json'], fixture.bare));
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

  it('reuses an abandoned attempt of the SAME endorsement, refuses a branch carrying anything else, and falls back to -2 on a stale lease', async () => {
    const abandoned = await prepared();
    const mainBefore = await originSha(abandoned.fixture.bare);
    const abandonedRunner = mappedRunner(REMOTE, abandoned.fixture.bare);
    const first = await run({ ref: 'sample', config: abandoned.store, runner: abandonedRunner }, new ScriptedPrompter());
    expect(first).toMatchObject({ ok: true, value: { branch: 'publish/sample' } });
    const abandonedBefore = await originSha(abandoned.fixture.bare, 'publish/sample');
    // main moves on; the same endorsement again refreshes the abandoned branch onto the new base under its lease, main untouched by the publish.
    await pushFromSeed(abandoned.fixture.seed, 'note.txt', 'main moved on');
    const mainMoved = await originSha(abandoned.fixture.bare);
    const again = await run({ ref: 'sample', config: abandoned.store, runner: abandonedRunner }, new ScriptedPrompter());
    expect(again).toMatchObject({ ok: true, value: { branch: 'publish/sample' } });
    expect(await originSha(abandoned.fixture.bare, 'publish/sample')).not.toBe(abandonedBefore);
    expect((await git(['rev-parse', 'publish/sample^'], abandoned.fixture.bare)).trim()).toBe(mainMoved);
    expect(JSON.parse(await git(['show', 'publish/sample:team.json'], abandoned.fixture.bare)).global).toContain(ID);
    expect(await originSha(abandoned.fixture.bare)).toBe(mainMoved);
    void mainBefore;
    // A branch of that name holding anything else (an unrelated commit; someone else's project endorsement) is never replaced.
    const projectEndorsement = { layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: ['x'], skills: [ID] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } };
    for (const theirsOnBranch of [{ path: 'unrelated.txt', content: 'someone else' }, { path: 'team.json', content: `${JSON.stringify(projectEndorsement)}\n` }]) {
      const other = await prepared();
      const theirs = await pushBranchFromSeed(other.fixture.seed, theirsOnBranch.path, theirsOnBranch.content, 'publish/sample');
      const otherMain = await originSha(other.fixture.bare);
      const theirRunner = mappedRunner(REMOTE, other.fixture.bare);
      const refused = await run({ ref: 'sample', config: other.store, runner: theirRunner }, new ScriptedPrompter());
      expect(refused, theirsOnBranch.path).toMatchObject({ ok: false, error: expect.stringMatching(/publish\/sample already exists on the remote with a different endorsement[\s\S]*compare\/main\.\.\.publish\/sample[\s\S]*--delete publish\/sample/) });
      expect(await originSha(other.fixture.bare, 'publish/sample')).toBe(theirs);
      expect(await originSha(other.fixture.bare)).toBe(otherMain);
      expect(theirRunner.calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false);
    }

    const stale = await prepared();
    expect((await run({ ref: 'sample', config: stale.store, runner: mappedRunner(REMOTE, stale.fixture.bare) }, new ScriptedPrompter())).ok).toBe(true);
    await pushFromSeed(stale.fixture.seed, 'racer.txt', 'new attempt');
    const seedCommit = (await git(['rev-parse', 'HEAD'], stale.fixture.seed)).trim();
    const staleMain = await originSha(stale.fixture.bare);
    let moved = false;
    const base = mappedRunner(REMOTE, stale.fixture.bare);
    const runner = wrapRunner(base, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && !moved) {
        moved = true;
        await git(['push', '-q', '--force', 'origin', 'HEAD:refs/heads/publish/sample'], stale.fixture.seed);
      }
      return next();
    });
    const second = await run({ ref: 'sample', config: stale.store, runner }, new ScriptedPrompter());
    expect(second).toMatchObject({ ok: true, value: { branch: 'publish/sample-2' } });
    expect(await originSha(stale.fixture.bare, 'publish/sample')).toBe(seedCommit);
    expect(await originSha(stale.fixture.bare)).toBe(staleMain);
  });

  it('rejects unknown names and resolves an ambiguous bare ref only with --team', async () => {
    const { fixture, store } = await prepared();
    const other = await bareTeam();
    await store.update((config) => { config.teams.other = { remote: other.bare, handle: 'seed' }; });
    const runner = mappedRunner(REMOTE, fixture.bare);
    await expect(run({ ref: 'team/missing', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'No skill team/missing in team team.' });
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

  it('reports gh failure after pushing the endorsement branch exactly once', async () => {
    const { fixture, store } = await prepared();
    const runner = mappedRunner(REMOTE, fixture.bare, fakeGh('seed', {
      'pr create -R acme/team --base main --head publish/sample --title seed: publish sample --body Endorse sample (11111111) for team: global.\n\nOpened by terum-skills publish; merge to endorse.': { code: 1, stdout: '', stderr: 'gh could not create it' },
    }));
    const before = await originSha(fixture.bare);
    const result = await run({ ref: 'sample', config: store, runner }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('gh could not create it') });
    expect(result.ok ? '' : result.error).toContain('https://github.com/acme/team/compare/main...publish/sample?expand=1');
    expect(JSON.parse(await git(['show', 'publish/sample:team.json'], fixture.bare)).global).toContain(ID);
    expect(await originSha(fixture.bare)).toBe(before);
    expect(runner.calls.filter((call) => call.command === 'gh' && call.args[0] === 'pr' && call.args[1] === 'create')).toHaveLength(1);
  });
  it('re-running while the pull request is still open refreshes the branch and reports the existing PR as success', async () => {
    const { fixture, store } = await prepared();
    const runner = mappedRunner(REMOTE, fixture.bare, fakeGh('seed', {
      'pr create -R acme/team --base main --head publish/sample --title seed: publish sample --body Endorse sample (11111111) for team: global.\n\nOpened by terum-skills publish; merge to endorse.': { code: 1, stdout: '', stderr: 'a pull request for branch "publish/sample" into branch "main" already exists:\nhttps://github.com/acme/team/pull/7' },
    }));
    const io = new ScriptedPrompter();
    const result = await run({ ref: 'sample', config: store, runner }, io);
    expect(result).toMatchObject({ ok: true, value: { branch: 'publish/sample', prUrl: 'https://github.com/acme/team/pull/7', compareUrl: null } });
    expect(io.lines).toContain('https://github.com/acme/team/pull/7');
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
