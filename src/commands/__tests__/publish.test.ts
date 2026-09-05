import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, fakeGh, git, mappedRunner, originSha, pushFromSeed, ScriptedPrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { run } from '../publish.js';

const REMOTE = 'https://github.com/acme/team.git';
const ID = '11111111-1111-4111-8111-111111111111';
const skill = (name = 'sample') => `---\nname: ${name}\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\nallowed-tools: Bash(git status)\n---\n`;

async function prepared(policy: 'pr' | 'push' = 'pr') {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
  if (policy === 'push') await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: {}, archived: [], policy: { publish: policy, skill_license: 'UNLICENSED' } })}\n`);
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: REMOTE, token: null, handle: 'seed' }; });
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

  it('replaces an abandoned branch under its lease and falls back without clobbering a stale branch', async () => {
    const abandoned = await prepared();
    await pushFromSeed(abandoned.fixture.seed, 'abandoned.txt', 'old attempt');
    await git(['push', '-q', 'origin', 'HEAD:refs/heads/publish/sample'], abandoned.fixture.seed);
    const abandonedBefore = await originSha(abandoned.fixture.bare, 'publish/sample');
    const mainBefore = await originSha(abandoned.fixture.bare);
    const first = await run({ ref: 'sample', config: abandoned.store, runner: mappedRunner(REMOTE, abandoned.fixture.bare) }, new ScriptedPrompter());
    expect(first).toMatchObject({ ok: true, value: { branch: 'publish/sample' } });
    expect(await originSha(abandoned.fixture.bare, 'publish/sample')).not.toBe(abandonedBefore);
    expect(await originSha(abandoned.fixture.bare)).toBe(mainBefore);

    const stale = await prepared();
    await pushFromSeed(stale.fixture.seed, 'abandoned.txt', 'old attempt');
    await git(['push', '-q', 'origin', 'HEAD:refs/heads/publish/sample'], stale.fixture.seed);
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
    await store.update((config) => { config.teams.other = { remote: other.bare, token: null, handle: 'seed' }; });
    const runner = mappedRunner(REMOTE, fixture.bare);
    await expect(run({ ref: 'team/missing', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'No skill team/missing in team team.' });
    await expect(run({ ref: 'sample', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('A bare skill ref is ambiguous across configured teams') });
    await expect(run({ ref: 'sample', team: 'team', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true, value: { team: 'team' } });
  });

  it('re-verifies the skill against the reset tree before publishing', async () => {
    const { fixture, store } = await prepared();
    const base = mappedRunner(REMOTE, fixture.bare);
    let removed = false;
    const runner = wrapRunner(base, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'fetch' && !removed) {
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
});
