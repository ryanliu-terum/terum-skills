import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconcileShared, run } from '../share.js';
import { run as sync } from '../sync.js';
import { run as install } from '../install.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, originSha, pushFromSeed, ScriptedPrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';
import { canonicalDigest } from '../../lib/skills.js';
import { snapshotSkillDirectory } from '../../lib/placer/vendor/skillhub/skill-fingerprint.js';

describe('share (§5.3)', () => {
  it('injects managed frontmatter into the approved source and records a baseline', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample'); await mkdir(source); await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: x\nmetadata:\n  terum-category: testing\n---\n');
    const result = await run({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [true]));
    expect(result.ok).toBe(true);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toContain('license: UNLICENSED');
    expect(Object.keys((await store.read()).shared)).toHaveLength(1);
  });

  it('preserves binary shared assets through sharing, sync updates, and a later install', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample');
    const pixel = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]);
    await mkdir(join(source, 'references'), { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: x\nmetadata:\n  terum-category: testing\n---\n');
    await writeFile(join(source, 'references', 'pixel.png'), pixel);
    expect((await run({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    expect(await gitBytes(['show', 'main:skills/sample/references/pixel.png'], fixture.bare)).toEqual(pixel);

    const updatedPixel = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xfe, 0xff]);
    await writeFile(join(source, 'references', 'pixel.png'), updatedPixel);
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await gitBytes(['show', 'main:skills/sample/references/pixel.png'], fixture.bare)).toEqual(updatedPixel);

    const secondStore = createConfigStore(join(fixture.root, 'second-state'));
    await cloneWithIdentity(fixture.bare, secondStore.teamClone('team'));
    await secondStore.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const home = join(fixture.root, 'second-home');
    expect((await install({ ref: 'sample', config: secondStore, home }, new ScriptedPrompter())).ok).toBe(true);
    const placed = join(home, '.claude', 'skills', 'sample');
    expect(await readFile(join(placed, 'references', 'pixel.png'))).toEqual(updatedPixel);
    expect((await snapshotSkillDirectory(placed)).fingerprint).toBe((await secondStore.read()).placements[placed]!.fingerprint);
  });

  it('preserves comments and quoted frontmatter scalars, and does not rewrite unchanged managed fields', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample'); await mkdir(source);
    const original = '---\n# retain me\nname: sample\ndescription: "quoted value"\nmetadata:\n  terum-category: testing\n---\n';
    await writeFile(join(source, 'SKILL.md'), original);
    const io = new ScriptedPrompter([], [true]);
    const shared = await run({ path: source, team: 'team', config: store }, io);
    expect(shared.ok).toBe(true);
    const injected = await readFile(join(source, 'SKILL.md'), 'utf8');
    expect(injected).toContain('# retain me');
    expect(injected).toContain('description: "quoted value"');
    expect(io.lines.join('\n')).toContain('metadata.author: Me <me@example.com>');
    const before = await readFile(join(source, 'SKILL.md'), 'utf8');
    await reconcileShared(store, systemRunner, new ScriptedPrompter());
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(before);
  });

  it('does nothing when the source and repository both equal their reconciliation baseline', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const sha = await originSha(fixture.bare); const before = await readFile(join(source, 'SKILL.md'), 'utf8');
    await reconcileShared(store, systemRunner, new ScriptedPrompter());
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(before);
    expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(source));
  });

  it('publishes a source-only reconciliation edit and advances the baseline to the source digest', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const edited = (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: x', 'description: local edit');
    await writeFile(join(source, 'SKILL.md'), edited);
    await reconcileShared(store, systemRunner, new ScriptedPrompter());
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('description: local edit');
    expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(source));
  });

  it('fast-forwards an unchanged authored source when another machine advances the repository copy', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const remoteCopy = (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: other machine');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', remoteCopy);
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toContain('description: other machine');
    expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(source));
  });

  it('continues reconciling healthy shares when one tracked source cannot be read', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const poisoned = join(fixture.root, 'poisoned'); await mkdir(poisoned);
    const poisonedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await writeFile(join(poisoned, 'SKILL.md'), 'not valid frontmatter');
    await pushFromSeed(fixture.seed, 'skills/poisoned/SKILL.md', `---\nname: poisoned\ndescription: poisoned\nlicense: UNLICENSED\nmetadata:\n  id: ${poisonedId}\n  author: Me <me@example.com>\n  terum-category: testing\n---\n`);
    await store.update((config) => {
      config.shared = { [poisonedId]: { source: poisoned, team: 'team' }, ...config.shared };
    });
    await writeFile(join(source, 'SKILL.md'), (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: x', 'description: healthy update'));
    const io = new ScriptedPrompter();
    expect((await sync({ config: store }, io)).ok).toBe(true);
    expect(io.lines.join('\n')).toContain('Could not reconcile shared aaaaaaaa');
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('description: healthy update');
  });

  it('refuses a genuine two-sided divergence without changing either copy or its baseline', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const baseline = (await store.read()).shared[id]!.baseline;
    await writeFile(join(source, 'SKILL.md'), (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: x', 'description: local'));
    const remoteCopy = (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: remote');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', remoteCopy);
    const sha = await originSha(fixture.bare); const local = await readFile(join(source, 'SKILL.md'), 'utf8');
    const io = new ScriptedPrompter();
    expect(await sync({ config: store }, io)).toMatchObject({ ok: true });
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(local);
    expect((await store.read()).shared[id]!.baseline).toBe(baseline);
    expect(io.lines.join('\n')).toMatch(/diverged \(source sha256:.*repo sha256:/);
  });

  it('treats a missing baseline as divergence without changing either copy or restoring the baseline', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    await store.update((config) => { delete config.shared[id]!.baseline; });
    const sha = await originSha(fixture.bare);
    const sourceBefore = await readFile(join(source, 'SKILL.md'), 'utf8');
    const io = new ScriptedPrompter();
    expect((await sync({ config: store }, io)).ok).toBe(true);
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(sourceBefore);
    expect((await store.read()).shared[id]!.baseline).toBeUndefined();
    expect(io.lines.join('\n')).toMatch(/diverged \(source sha256:.*repo sha256:/);
  });

  it('refreshes managed author and license fields on both copies without manufacturing a divergence', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const baseline = (await store.read()).shared[id]!.baseline;
    await store.update((config) => { config.email = 'changed@example.com'; });
    const team = JSON.parse(await git(['show', 'main:team.json'], fixture.bare));
    team.policy.skill_license = 'Apache-2.0';
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify(team, null, 2)}\n`, 'change policy');
    const io = new ScriptedPrompter();
    const result = await sync({ config: store }, io);
    if (!result.ok) throw new Error(result.error);
    const sourceAfter = await readFile(join(source, 'SKILL.md'), 'utf8');
    const repoAfter = await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare);
    for (const copy of [sourceAfter, repoAfter]) {
      expect(copy).toContain('license: Apache-2.0');
      expect(copy).toContain('author: Me <changed@example.com>');
    }
    expect((await store.read()).shared[id]!.baseline).toBe(baseline);
    expect(io.lines.join('\n')).not.toContain('diverged');
    expect((await git(['log', '--format=%s', 'main'], fixture.bare)).split('\n').filter((message) => message === 'seed: update sample')).toHaveLength(1);
  });

  it('resolves a refused divergence with --keep-source and replaces the repository loser', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    await store.update((config) => { config.email = 'new@example.com'; });
    await writeFile(join(source, 'SKILL.md'), (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: x', 'description: source winner'));
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: repo loser'));
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect((await run({ keepSource: id, config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toContain('description: source winner');
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('description: source winner');
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).not.toContain('description: repo loser');
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('author: Me <new@example.com>');
    expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(source));
  });

  it('resolves a refused divergence with --keep-repo and replaces the source loser', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    await writeFile(join(source, 'SKILL.md'), (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: x', 'description: source loser'));
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: repo winner'));
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect((await run({ keepRepo: id, config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toContain('description: repo winner');
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).not.toContain('description: source loser');
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('description: repo winner');
    expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(source));
  });

  it('warns once per sync for a missing source and keeps both the repository copy and tracking entry', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    await rename(source, `${source}-moved`);
    const sha = await originSha(fixture.bare);
    const first = new ScriptedPrompter();
    const second = new ScriptedPrompter();
    expect((await sync({ config: store }, first)).ok).toBe(true);
    expect((await sync({ config: store }, second)).ok).toBe(true);
    for (const io of [first, second]) {
      const warnings = io.lines.filter((line) => line.includes('Shared source'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('--relocate or --forget');
    }
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('name: sample');
    expect((await store.read()).shared[id]!.source).toBe(source);
  });

  it('relocates a missing source and reconciles the next edit from its new path', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const relocated = `${source}-relocated`;
    await rename(source, relocated);
    expect((await run({ relocate: `${id}:${relocated}`, config: store }, new ScriptedPrompter())).ok).toBe(true);
    await writeFile(join(relocated, 'SKILL.md'), (await readFile(join(relocated, 'SKILL.md'), 'utf8')).replace('description: x', 'description: relocated edit'));
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect((await store.read()).shared[id]!.source).toBe(relocated);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('description: relocated edit');
    expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(relocated));
  });

  it('refuses unsafe relocation targets without changing authored tracking', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const original = (await store.read()).shared[id]!.source;
    const noSkill = join(fixture.root, 'no-skill'); await mkdir(noSkill);
    const wrong = join(fixture.root, 'wrong'); await mkdir(wrong);
    await writeFile(join(wrong, 'SKILL.md'), `---\nname: wrong\ndescription: wrong\nlicense: UNLICENSED\nmetadata:\n  id: 99999999-9999-4999-8999-999999999999\n  author: Me <me@example.com>\n  terum-category: testing\n---\n`);
    for (const candidate of [fixture.root, noSkill, wrong]) {
      const result = await run({ relocate: `${id}:${candidate}`, config: store }, new ScriptedPrompter());
      expect(result.ok).toBe(false);
      expect((await store.read()).shared[id]!.source).toBe(original);
    }
    const relocated = join(fixture.root, 'relocated'); await rename(original, relocated);
    expect((await run({ relocate: `${id}:${relocated}`, config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect((await store.read()).shared[id]!.source).toBe(relocated);
  });

  it('forgets only after confirmation and never alters the repository copy or history', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const sha = await originSha(fixture.bare);
    expect(await run({ forget: id, config: store }, new ScriptedPrompter([], [false]))).toMatchObject({ ok: false, error: 'Forget was declined.' });
    expect((await store.read()).shared[id]).toBeDefined();
    expect(await originSha(fixture.bare)).toBe(sha);
    expect((await run({ forget: id, config: store }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    expect((await store.read()).shared[id]).toBeUndefined();
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('name: sample');
  });

  it('leaves source, remote, and tracking untouched when the frontmatter confirmation is declined', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample'); await mkdir(source);
    const original = '---\nname: sample\ndescription: x\nmetadata:\n  terum-category: testing\n---\n';
    await writeFile(join(source, 'SKILL.md'), original);
    const sha = await originSha(fixture.bare);
    expect(await run({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [false]))).toMatchObject({ ok: false, error: 'Share was declined.' });
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
    expect(await originSha(fixture.bare)).toBe(sha);
    expect((await store.read()).shared).toEqual({});
  });

  it('refuses empty plugin and hook directories unless privileged content was explicitly allowed', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    for (const directory of ['plugin-skill', 'hook-skill']) {
      const source = join(fixture.root, directory); await mkdir(source);
      await writeFile(join(source, 'SKILL.md'), `---\nname: ${directory}\ndescription: x\nmetadata:\n  terum-category: testing\n---\n`);
      await mkdir(join(source, directory === 'plugin-skill' ? '.claude-plugin' : 'hooks'));
      expect(await run({ path: source, team: 'team', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('--allow-privileged') });
    }
    const source = join(fixture.root, 'plugin-skill');
    expect((await run({ path: source, team: 'team', config: store, allowPrivileged: true }, new ScriptedPrompter([], [true]))).ok).toBe(true);
  });

  it('refuses symlinked files and directories before it can rewrite a source or team repo', async () => {
    const fixture = await bareTeam(); const store = createConfigStore(join(fixture.root, 'state'));
    const before = await originSha(fixture.bare);
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    for (const [name, directory] of [['file-link', false], ['directory-link', true]] as const) {
      const source = join(fixture.root, name); await mkdir(source);
      const original = `---\nname: ${name}\ndescription: x\nmetadata:\n  terum-category: testing\n---\n`;
      await writeFile(join(source, 'SKILL.md'), original);
      if (directory) { await mkdir(join(source, 'real')); await symlink(join(source, 'real'), join(source, 'linked')); }
      else await symlink(join(source, 'SKILL.md'), join(source, 'linked'));
      expect(await run({ path: source, team: 'team', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('symlink') });
      expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
    }
    expect((await store.read()).shared).toEqual({});
    expect(await originSha(fixture.bare)).toBe(before);
  });

  for (const name of ['Uppercase', '-leading', 'trailing-', 'double--hyphen', 'a'.repeat(65)]) {
    it(`refuses the invalid skill directory name ${JSON.stringify(name)} without writes`, async () => {
      await expectRejectedShare(name, name);
    });
  }

  it('refuses a folder whose name differs from its frontmatter name without writes', async () => {
    await expectRejectedShare('folder-name', 'frontmatter-name');
  });

  it('refuses a repo-wide name collision from a second machine and suggests a rename', async () => {
    const { fixture } = await sharedFixture();
    const second = createConfigStore(join(fixture.root, 'second-state'));
    await cloneWithIdentity(fixture.bare, second.teamClone('team'));
    await second.update((config) => { config.display_name = 'Other'; config.email = 'other@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'other', 'sample');
    await mkdir(source, { recursive: true });
    const original = '---\nname: sample\ndescription: second\nmetadata:\n  terum-category: testing\n---\n';
    await writeFile(join(source, 'SKILL.md'), original);
    const sha = await originSha(fixture.bare);
    const result = await run({ path: source, team: 'team', config: second }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('choose a unique name') });
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
    expect((await second.read()).shared).toEqual({});
  });

  it('refuses a name taken upstream since the local clone was last refreshed without changing the source', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', '---\nname: sample\ndescription: upstream\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Me <me@example.com>\n  terum-category: testing\n---\n');
    const source = join(fixture.root, 'sample'); await mkdir(source);
    const original = '---\nname: sample\ndescription: local\nmetadata:\n  terum-category: testing\n---\n';
    await writeFile(join(source, 'SKILL.md'), original);
    const before = await originSha(fixture.bare);
    expect(await run({ path: source, team: 'team', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('choose a unique name') });
    expect(await originSha(fixture.bare)).toBe(before);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
  });

  it('mints one UUID before a retry and shares one committed skill identity', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample'); await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: x\nmetadata:\n  terum-category: testing\n---\n');
    let rejected = false;
    const runner = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && !rejected) { rejected = true; return { code: 1, stdout: '', stderr: 'non-fast-forward; fetch first' }; }
      return next();
    });
    const result = await run({ path: source, team: 'team', config: store, runner }, new ScriptedPrompter([], [true]));
    if (!result.ok) throw new Error(result.error);
    const id = result.value!.id;
    const sourceId = /id: ([0-9a-f-]{36})/.exec(await readFile(join(source, 'SKILL.md'), 'utf8'))?.[1];
    const repoId = /id: ([0-9a-f-]{36})/.exec(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare))?.[1];
    expect([sourceId, repoId, ...Object.keys((await store.read()).shared)]).toEqual([id, id, id]);
    expect((await git(['log', '--format=%s', 'main'], fixture.bare)).split('\n').filter((message) => message === 'seed: share sample')).toHaveLength(1);
  });
});

async function expectRejectedShare(directoryName: string, frontmatterName: string): Promise<void> {
  const fixture = await bareTeam();
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const source = join(fixture.root, directoryName); await mkdir(source);
  const original = `---\nname: ${frontmatterName}\ndescription: x\nmetadata:\n  terum-category: testing\n---\n`;
  await writeFile(join(source, 'SKILL.md'), original);
  const sha = await originSha(fixture.bare);
  expect((await run({ path: source, team: 'team', config: store }, new ScriptedPrompter())).ok).toBe(false);
  expect(await originSha(fixture.bare)).toBe(sha);
  expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
  expect((await store.read()).shared).toEqual({});
}

async function sharedFixture() {
  const fixture = await bareTeam();
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const source = join(fixture.root, 'sample'); await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: x\nmetadata:\n  terum-category: testing\n---\n');
  const shared = await run({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [true]));
  if (!shared.ok) throw new Error(shared.error);
  return { fixture, store };
}

async function gitBytes(args: readonly string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new Error(Buffer.concat(stderr).toString('utf8'))));
  });
}
