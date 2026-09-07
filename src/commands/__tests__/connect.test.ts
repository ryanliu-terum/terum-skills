import { spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconcileShared, run } from '../connect.js';
import { run as sync } from '../sync.js';
import { run as install } from '../install.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, originSha, pushFromSeed, ScriptedPrompter, NonInteractivePrompter, ghOnlyRunner, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';
import { canonicalDigest } from '../../lib/skills.js';
import { snapshotSkillDirectory } from '../../lib/placer/vendor/skillhub/skill-fingerprint.js';

describe('connect (§5.3)', () => {
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

  it('shares an off-the-shelf SKILL.md with no metadata block: the tool generates all four fields, shows the category default before the y/N, and the repository copy parses', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'stock'); await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: stock\ndescription: a skill exactly as it ships\n---\nUse it.\n');
    const io = new ScriptedPrompter([], [true]);
    const result = await run({ path: source, team: 'team', config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { name: 'stock' } });
    const written = await readFile(join(source, 'SKILL.md'), 'utf8');
    expect(written).toContain('terum-category: misc');
    expect(written).toMatch(/\n---\nUse it\.\n$/);
    expect(io.lines.join('\n')).toContain('Will add:\nlicense: UNLICENSED\nmetadata.id: ');
    expect(io.lines.join('\n')).toContain('metadata.terum-category: misc (no category was set; edit SKILL.md any time)');
    expect(await git(['show', 'main:skills/stock/SKILL.md'], fixture.bare)).toBe(written);
    // A file that declares its category is shown three lines and keeps the category it declared.
    const declared = join(fixture.root, 'declared'); await mkdir(declared);
    await writeFile(join(declared, 'SKILL.md'), '---\nname: declared\ndescription: x\nmetadata:\n  terum-category: testing\n---\n');
    const declaredIo = new ScriptedPrompter([], [true]);
    expect((await run({ path: declared, team: 'team', config: store }, declaredIo)).ok).toBe(true);
    expect(declaredIo.lines.join('\n')).not.toContain('terum-category');
    expect(await readFile(join(declared, 'SKILL.md'), 'utf8')).toContain('terum-category: testing');
  });

  it('rejects a malformed allowed-tools value at connect time, names the line, and writes nothing', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample'); await mkdir(source);
    const original = '---\nname: sample\ndescription: x\nallowed-tools:\n  bash: true\nmetadata:\n  terum-category: testing\n---\n';
    await writeFile(join(source, 'SKILL.md'), original);
    const before = await originSha(fixture.bare);
    const result = await run({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [true]));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('allowed-tools is malformed (SKILL.md line 4)') });
    expect(await originSha(fixture.bare)).toBe(before);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
    expect((await store.read()).shared).toEqual({});
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

  it('blocks a planted credential during reconcile before any managed-field refresh, repo write, or baseline advance', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!; const source = (await store.read()).shared[id]!.source;
    const baseline = (await store.read()).shared[id]!.baseline;
    const repoBefore = await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare);
    await writeFile(join(source, 'SKILL.md'), `${await readFile(join(source, 'SKILL.md'), 'utf8')}\nghp_abcdefghijklmnopqrstuvwxyz\n`);
    const io = new ScriptedPrompter(); await reconcileShared(store, systemRunner, io);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toBe(repoBefore);
    expect((await store.read()).shared[id]!.baseline).toBe(baseline);
    expect(io.lines.join('\n')).toContain('HYG3');
    expect(io.lines).toContain('Connected skill sample failed hygiene:\nHYG3 SKILL.md:11: Contains a credential-shaped value.');
  });

  it('fast-forwards an unchanged authored source when another machine advances the repository copy', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const remoteCopy = (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: other machine');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', remoteCopy);
    const io = new ScriptedPrompter();
    expect((await sync({ config: store }, io)).ok).toBe(true);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toContain('description: other machine');
    expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(source));
    // The displaced authoring folder is recoverable, never deleted: it sits in quarantine, announced.
    expect(await quarantinedFiles(store.root, 'sample/SKILL.md')).toEqual([expect.stringContaining('description: x')]);
    expect(io.lines.filter((line) => line.startsWith(`Previous source at ${source} moved to `))).toHaveLength(1);
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
    expect(io.lines).toContain('Could not reconcile connected aaaaaaaa: SKILL.md has no YAML frontmatter');
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

  it('a diverged shared skill is undone work: sync defers it and withholds the team stamp instead of silencing the notice for an hour', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    await writeFile(join(source, 'SKILL.md'), (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: x', 'description: local'));
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: remote'));
    const io = new ScriptedPrompter();
    expect(await sync({ config: store }, io)).toMatchObject({ ok: true, value: { deferred: ['sample'] } });
    await expect(access(join(store.root, 'run', 'team.stamp'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(io.lines.join('\n')).toMatch(/diverged/);
    // Resolved, the next sync completes and stamps the team.
    expect((await run({ keepSource: id, config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await sync({ config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { deferred: [] } });
    await expect(access(join(store.root, 'run', 'team.stamp'))).resolves.toBeUndefined();
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

  it('applies a managed-field refresh to the bytes actually upstream, not the stale preflight copy, when another machine moved the repository ahead', async () => {
    const { fixture, store } = await sharedFixture();
    await store.update((config) => { config.email = 'changed@example.com'; });
    const remoteCopy = (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: other machine');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', remoteCopy);
    // Called directly: sync's own refreshClone would close the window this test is about.
    await reconcileShared(store, systemRunner, new ScriptedPrompter());
    const upstream = await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare);
    expect(upstream).toContain('description: other machine');
    expect(upstream).toContain('author: Me <changed@example.com>');
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
    await writeFile(join(source, 'notes.md'), 'unpublished notes that exist nowhere else');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: repo winner'));
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    const io = new ScriptedPrompter();
    expect((await run({ keepRepo: id, config: store }, io)).ok).toBe(true);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toContain('description: repo winner');
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).not.toContain('description: source loser');
    await expect(readFile(join(source, 'notes.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('description: repo winner');
    expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(source));
    // The loser — edits no commit ever held — is in quarantine, every file of it, and the user was told where.
    expect(await quarantinedFiles(store.root, 'sample/SKILL.md')).toEqual([expect.stringContaining('description: source loser')]);
    expect(await quarantinedFiles(store.root, 'sample/notes.md')).toEqual(['unpublished notes that exist nowhere else']);
    expect(io.lines.filter((line) => line.startsWith(`Previous source at ${source} moved to `))).toHaveLength(1);
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
      const warnings = io.lines.filter((line) => line.includes('Connected source'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toBe(`Connected source for ${id.slice(0, 8)} is missing; keeping the repository copy. Use npx -y terum-skills@latest connect --relocate or npx -y terum-skills@latest connect --forget.`);
    }
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('name: sample');
    expect((await store.read()).shared[id]!.source).toBe(source);
  });

  it('propagates an author-side rename: the repository folder moves, the id carries, and an installer follows on its next sync', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample'); await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: x\nmetadata:\n  terum-category: testing\n---\n');
    expect((await run({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const [id] = Object.keys((await store.read()).shared);
    // A second machine installs it under the old name.
    const secondStore = createConfigStore(join(fixture.root, 'second-state'));
    await cloneWithIdentity(fixture.bare, secondStore.teamClone('team'));
    await secondStore.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const home = join(fixture.root, 'second-home');
    expect((await install({ ref: 'sample', config: secondStore, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    // The author renames: the folder, the tracking (relocate), and the name line.
    const renamed = join(fixture.root, 'renamed'); await rename(source, renamed);
    expect((await run({ relocate: `${id}:${renamed}`, config: store }, new ScriptedPrompter())).ok).toBe(true);
    await writeFile(join(renamed, 'SKILL.md'), (await readFile(join(renamed, 'SKILL.md'), 'utf8')).replace('name: sample', 'name: renamed'));
    const io = new ScriptedPrompter();
    expect((await sync({ config: store }, io)).ok).toBe(true);
    expect(io.lines).toContain('Renamed connected skill sample to renamed.');
    const tree = await git(['ls-tree', '--name-only', 'main', 'skills/'], fixture.bare);
    expect(tree).toContain('skills/renamed'); expect(tree).not.toContain('skills/sample');
    expect(await git(['show', 'main:skills/renamed/SKILL.md'], fixture.bare)).toContain(`id: ${id}`);
    expect((await store.read()).shared[id!]!.baseline).toBe(await canonicalDigest(renamed));
    // The installer's next sync re-places under the new name and drops the old placement.
    expect((await sync({ config: secondStore }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(home, '.claude', 'skills', 'renamed', 'SKILL.md'), 'utf8')).toContain('name: renamed');
    await expect(readFile(join(home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Object.keys((await secondStore.read()).placements)).toEqual([join(home, '.claude', 'skills', 'renamed')]);
  });

  it('refuses a rename to a name another skill already uses, and to an invalid name, leaving the repository unchanged', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const source = join(fixture.root, 'sample'); await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '---\nname: sample\ndescription: x\nmetadata:\n  terum-category: testing\n---\n');
    expect((await run({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const [id] = Object.keys((await store.read()).shared);
    await pushFromSeed(fixture.seed, 'skills/taken/SKILL.md', '---\nname: taken\ndescription: t\nlicense: UNLICENSED\nmetadata:\n  id: 99999999-9999-4999-8999-999999999999\n  author: Other <other@example.com>\n  terum-category: testing\n---\n');
    const before = await originSha(fixture.bare);
    const baseline = (await store.read()).shared[id!]!.baseline;
    const shared = await readFile(join(source, 'SKILL.md'), 'utf8');
    await writeFile(join(source, 'SKILL.md'), shared.replace('name: sample', 'name: taken'));
    const taken = new ScriptedPrompter();
    expect((await sync({ config: store }, taken)).ok).toBe(true);
    expect(taken.lines).toContain('Connected skill sample: cannot rename to taken; another skill already uses that name.');
    await writeFile(join(source, 'SKILL.md'), shared.replace('name: sample', 'name: Bad_Name'));
    const invalid = new ScriptedPrompter();
    expect((await sync({ config: store }, invalid)).ok).toBe(true);
    expect(invalid.lines).toContain('Connected skill sample: cannot rename to Bad_Name; a skill name is 1–64 lowercase alphanumerics or single hyphens.');
    expect(await originSha(fixture.bare)).toBe(before);
    expect((await store.read()).shared[id!]!.baseline).toBe(baseline);
    expect(await git(['ls-tree', '--name-only', 'main', 'skills/'], fixture.bare)).toContain('skills/sample');
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
    expect(await run({ path: source, team: 'team', config: store }, new ScriptedPrompter([], [false]))).toMatchObject({ ok: false, error: 'Connect was declined.' });
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

  it('holds back hooks added to an already-shared source until the author re-consents with --keep-source --allow-privileged', async () => {
    const { fixture, store } = await sharedFixture();
    const id = Object.keys((await store.read()).shared)[0]!;
    const source = (await store.read()).shared[id]!.source;
    const baseline = (await store.read()).shared[id]!.baseline;
    await mkdir(join(source, 'hooks')); await writeFile(join(source, 'hooks', 'session-start.sh'), '#!/bin/sh\necho hi\n');
    const sha = await originSha(fixture.bare);
    const io = new ScriptedPrompter();
    expect((await sync({ config: store }, io)).ok).toBe(true);
    expect(io.lines).toContain(`Connected skill sample now contains plugin or hook definitions; run npx -y terum-skills@latest connect --keep-source '${id}' --allow-privileged after reviewing them.`);
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await git(['ls-tree', '-r', '--name-only', 'main', 'skills/sample/'], fixture.bare)).not.toContain('hooks/');
    expect((await store.read()).shared[id]!.baseline).toBe(baseline);
    // A managed-field repair is pending — this user renamed themselves since the connect — so the
    // refusal is only write-free if the gate runs before that repair reaches the source or the remote.
    await store.update((config) => { config.display_name = 'Me Renamed'; });
    const sourceBefore = await readFile(join(source, 'SKILL.md'), 'utf8');
    await expect(run({ keepSource: id, config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('--allow-privileged') });
    expect(await originSha(fixture.bare)).toBe(sha);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(sourceBefore);
    // Walk D5 (Ryan, 2026-09-07): explicit --allow-privileged consent waives HYG4's exec/shebang
    // findings — the reviewed hooks land, and once the repo copy carries them later edits sync freely.
    expect((await run({ keepSource: id, allowPrivileged: true, config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await git(['ls-tree', '-r', '--name-only', 'main', 'skills/sample/'], fixture.bare)).toContain('skills/sample/hooks/session-start.sh');
    await writeFile(join(source, 'SKILL.md'), (await readFile(join(source, 'SKILL.md'), 'utf8')).replace('description: x', 'description: after consent'));
    expect((await sync({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toContain('description: after consent');
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
    expect((await git(['log', '--format=%s', 'main'], fixture.bare)).split('\n').filter((message) => message === 'seed: connect sample')).toHaveLength(1);
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

async function quarantinedFiles(storeRoot: string, suffix: string): Promise<string[]> {
  const quarantine = join(storeRoot, 'quarantine');
  const entries = await readdir(quarantine, { recursive: true });
  return Promise.all(entries.filter((entry) => entry.endsWith(suffix)).map((entry) => readFile(join(quarantine, entry), 'utf8')));
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


async function pickerFixture(name = 'sample') {
  const fixture = await bareTeam(); const home = join(fixture.root, 'home');
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const source = join(home, '.claude', 'skills', name); await mkdir(source, { recursive: true });
  const original = `---\nname: ${name}\ndescription: stock source\n---\n`;
  await writeFile(join(source, 'SKILL.md'), original);
  return { fixture, home, store, source, original };
}

async function batchFixture(names = ['a', 'b', 'c']) {
  const fixture = await pickerFixture(names[0]);
  const sources: Record<string, string> = {};
  const originals: Record<string, string> = {};
  for (const name of names) {
    const source = join(fixture.home, '.claude', 'skills', name);
    await mkdir(source, { recursive: true });
    sources[name] = source;
    originals[name] = `---\nname: ${name}\ndescription: stock source\n---\n`;
    await writeFile(join(source, 'SKILL.md'), originals[name]!);
  }
  return { ...fixture, sources, originals };
}

describe('locked multi-connect', () => {
  const menu = 'Connect a local skill folder to team team?';

  it('1 connects selected skills with ordered commits, source and ledger identities, and a summary', async () => {
    const { fixture, home, store, sources, originals } = await batchFixture();
    const before = await originSha(fixture.bare);
    const io = new ScriptedPrompter(['Connect a', 'Connect c', 'Done'], [true, true], true);
    const result = await run({ home, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { kind: 'batch', shared: [{ name: 'a' }, { name: 'c' }], declined: [], refused: [] } });
    expect(io.offered).toEqual([['Connect a', 'Connect b', 'Connect c', 'Skip'], ['Connect b', 'Connect c', 'Done'], ['Connect b', 'Done']]);
    expect(io.asked).toEqual([menu, 'Connect a?', menu, 'Connect c?', menu]);
    const ledger = (await store.read()).shared;
    expect(Object.keys(ledger)).toHaveLength(2);
    const ids = [];
    for (const name of ['a', 'c']) {
      const bytes = await readFile(join(sources[name]!, 'SKILL.md'), 'utf8');
      const id = /id: ([0-9a-f-]{36})/.exec(bytes)![1]!;
      ids.push(id);
      expect(ledger[id]).toMatchObject({ source: sources[name], team: 'team' });
      expect(await git(['show', `main:skills/${name}/SKILL.md`], fixture.bare)).toBe(bytes);
    }
    expect(new Set(ids).size).toBe(2);
    expect(await git(['log', '--reverse', '--format=%s', `${before}..main`], fixture.bare)).toBe('seed: connect a\nseed: connect c\n');
    expect(await readFile(join(sources.b!, 'SKILL.md'), 'utf8')).toBe(originals.b);
    expect(io.lines).toContain('Connected 2 skills to team team: a, c.');
  });

  it('2 keeps a declined source offered and untouched while continuing to another skill', async () => {
    const { home, store, sources, originals } = await batchFixture();
    const io = new ScriptedPrompter(['Connect a', 'Connect b', 'Connect c', 'Done'], [true, false, true], true);
    expect(await run({ home, config: store }, io)).toMatchObject({ ok: true, value: { shared: [{ name: 'a' }, { name: 'c' }], declined: ['b'] } });
    expect(io.offered[2]).toEqual(['Connect b', 'Connect c', 'Done']);
    expect(await readFile(join(sources.b!, 'SKILL.md'), 'utf8')).toBe(originals.b);
    expect(io.lines).toContain('Not connected: b (declined).');
  });

  it('3 refuses HYG4 before mutation and continues to the next skill', async () => {
    const { fixture, home, store, sources, originals } = await batchFixture();
    await writeFile(join(sources.b!, 'notes.sh'), '#!/bin/sh\nplain notes');
    const io = new ScriptedPrompter(['Connect a', 'Connect b', 'Connect c', 'Done'], [true, true], true);
    expect(await run({ home, config: store }, io)).toMatchObject({ ok: true, value: { shared: [{ name: 'a' }, { name: 'c' }], refused: [{ name: 'b', reason: 'hygiene: File begins with a shebang' }] } });
    expect(io.lines).toContain('HYG4 notes.sh: File begins with a shebang.');
    expect(io.lines).toContain('Not connected: b (hygiene: File begins with a shebang).');
    expect(await readFile(join(sources.b!, 'SKILL.md'), 'utf8')).toBe(originals.b);
    expect(await readFile(join(sources.b!, 'notes.sh'), 'utf8')).toBe('#!/bin/sh\nplain notes');
    expect(await git(['ls-tree', '--name-only', 'main:skills'], fixture.bare)).not.toContain('b\n');
    expect(io.asked).toEqual([menu, 'Connect a?', menu, menu, 'Connect c?', menu]);
  });

  it('4 re-reads config and inventories new folders before every menu', async () => {
    const { home, store, sources } = await batchFixture();
    const config = { ...store, update: async (mutate: Parameters<typeof store.update>[0]) => {
      const result = await store.update(mutate);
      if (Object.values(result.shared).some((entry) => entry.source === sources.a)) {
        await store.update((fresh) => {
          fresh.shared['11111111-1111-4111-8111-111111111111'] = { source: sources.b!, team: 'team', baseline: '' };
          fresh.placements[sources.c!] = { id: '22222222-2222-4222-8222-222222222222', team: 'team', scope: { kind: 'global' }, version: null, fingerprint: '', placed_at: '' };
        });
        const d = join(home, '.claude', 'skills', 'd'); await mkdir(d, { recursive: true });
        await writeFile(join(d, 'SKILL.md'), '---\nname: d\ndescription: added between menus\n---\n');
      }
      return result;
    } };
    const io = new ScriptedPrompter(['Connect a', 'Done'], [true], true);
    expect((await run({ home, config }, io)).ok).toBe(true);
    expect(io.offered).toEqual([['Connect a', 'Connect b', 'Connect c', 'Skip'], ['Connect d', 'Done']]);
  });

  it('5 freezes duplicate labels and refuses a preflight collision without changing the second source', async () => {
    const { fixture, home, store, original } = await pickerFixture();
    const cwd = join(fixture.root, 'project'); const other = join(cwd, '.claude', 'skills', 'sample');
    await mkdir(other, { recursive: true }); await mkdir(join(cwd, '.git'));
    await writeFile(join(other, 'SKILL.md'), original);
    const io = new ScriptedPrompter(['Connect sample (global)', 'Connect sample (project)', 'Done'], [true], true);
    expect(await run({ home, cwd, config: store }, io)).toMatchObject({ ok: true, value: { shared: [{ name: 'sample' }], refused: [{ name: 'sample', reason: 'Skill name sample already exists in team team; choose a unique name.' }] } });
    expect(io.offered).toEqual([['Connect sample (global)', 'Connect sample (project)', 'Skip'], ['Connect sample (project)', 'Done'], ['Connect sample (project)', 'Done']]);
    expect(await readFile(join(other, 'SKILL.md'), 'utf8')).toBe(original);
    expect(io.asked).toEqual([menu, 'Connect sample?', menu, menu]);
  });

  it('6 auto-exits after the sole candidate without offering Done', async () => {
    const { home, store } = await pickerFixture();
    const io = new ScriptedPrompter(['Connect sample'], [true], true);
    expect(await run({ home, config: store }, io)).toMatchObject({ ok: true, value: { kind: 'batch', shared: [{ name: 'sample' }] } });
    expect(io.offered).toEqual([['Connect sample', 'Skip']]);
    expect(io.lines.at(-1)).toBe('Connected 1 skill to team team: sample.');
  });

  it('7 returns the durable partial batch when the second menu closes', async () => {
    const { fixture, home, store, sources, originals } = await batchFixture();
    const io = new ScriptedPrompter(['Connect a'], [true], true);
    expect(await run({ home, config: store }, io)).toMatchObject({ ok: false, value: { kind: 'batch', shared: [{ name: 'a' }] } });
    expect(io.lines.at(-2)).toMatch(/^Stopped: /);
    expect(io.lines.at(-1)).toBe('Connected 1 skill to team team: a.');
    expect(Object.values((await store.read()).shared).map((entry) => entry.source)).toEqual([sources.a]);
    expect(await git(['show', 'main:skills/a/SKILL.md'], fixture.bare)).toBe(await readFile(join(sources.a!, 'SKILL.md'), 'utf8'));
    expect(await readFile(join(sources.c!, 'SKILL.md'), 'utf8')).toBe(originals.c);
    expect(io.asked).toEqual([menu, 'Connect a?', menu]);
  });

  it('8 reports a mutated source after a rejected push and stops before C', async () => {
    const { fixture, home, store, sources, originals } = await batchFixture();
    let pushes = 0;
    const runner = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && ++pushes > 1) return { code: 1, stdout: '', stderr: 'permission denied' };
      return next();
    });
    const io = new ScriptedPrompter(['Connect a', 'Connect b', 'Connect c'], [true, true, true], true);
    const result = await run({ home, config: store, runner }, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`b's SKILL.md at ${sources.b}`), value: { shared: [{ name: 'a' }] } });
    expect(io.lines.join('\n')).toContain('the team repository was not changed. Fix the cause');
    expect(await readFile(join(sources.b!, 'SKILL.md'), 'utf8')).toContain('metadata:');
    expect(await readFile(join(sources.b!, 'SKILL.md'), 'utf8')).toContain('license: UNLICENSED');
    expect(await git(['ls-tree', '--name-only', 'main:skills'], fixture.bare)).toBe('.gitkeep\na\n');
    expect(Object.values((await store.read()).shared).map((entry) => entry.source)).toEqual([sources.a]);
    expect(await readFile(join(sources.c!, 'SKILL.md'), 'utf8')).toBe(originals.c);
    expect(io.asked).toEqual([menu, 'Connect a?', menu, 'Connect b?']);
  });

  it('9 reports pushed identity and team when the local ledger write fails', async () => {
    const { fixture, home, store, sources } = await batchFixture();
    let writes = 0;
    const config = { ...store, update: async (mutate: Parameters<typeof store.update>[0]) => {
      if (++writes === 2) throw new Error('ledger unavailable');
      return store.update(mutate);
    } };
    const io = new ScriptedPrompter(['Connect a', 'Connect b', 'Connect c'], [true, true, true], true);
    const result = await run({ home, config }, io);
    const bytes = await git(['show', 'main:skills/b/SKILL.md'], fixture.bare);
    const id = /id: ([0-9a-f-]{36})/.exec(bytes)![1]!;
    expect(result).toMatchObject({ ok: false, error: `Stopped: ledger unavailable. b was pushed to team team as ${id} but is not tracked on this machine; run \`npx -y terum-skills@latest sync\` and, if it is still not listed by \`ls --local\`, report this — the local ledger entry is missing.`, value: { shared: [{ name: 'a' }] } });
    expect((await store.read()).shared[id]).toBeUndefined();
    expect(Object.values((await store.read()).shared).map((entry) => entry.source)).toEqual([sources.a]);
    expect(io.asked).toEqual([menu, 'Connect a?', menu, 'Connect b?']);
  });

  it('10 keeps two distinct skill UUIDs stable across four push attempts with one commit per skill', async () => {
    const { fixture, home, store, sources } = await batchFixture(['a', 'b']);
    const ids: string[] = [];
    const runner = wrapRunner(systemRunner, async (command, args, options, next) => {
      if (command === 'git' && args[0] === 'push') {
        const name = ids.length < 2 ? 'a' : 'b';
        ids.push(/id: ([0-9a-f-]{36})/.exec(await readFile(join(options!.cwd!, 'skills', name, 'SKILL.md'), 'utf8'))![1]!);
        if (ids.length % 2 === 1) return { code: 1, stdout: '', stderr: 'non-fast-forward; fetch first' };
      }
      return next();
    });
    const io = new ScriptedPrompter(['Connect a', 'Connect b'], [true, true], true);
    expect((await run({ home, config: store, runner }, io)).ok).toBe(true);
    expect(ids).toHaveLength(4); expect(ids[0]).toBe(ids[1]); expect(ids[2]).toBe(ids[3]); expect(ids[0]).not.toBe(ids[2]);
    expect(Object.keys((await store.read()).shared).sort()).toEqual([ids[0], ids[2]].sort());
    for (const [index, name] of ['a', 'b'].entries()) {
      expect(await readFile(join(sources[name]!, 'SKILL.md'), 'utf8')).toContain(`id: ${ids[index * 2]}`);
      expect(await git(['show', `main:skills/${name}/SKILL.md`], fixture.bare)).toContain(`id: ${ids[index * 2]}`);
      expect((await git(['log', '--format=%s', 'main'], fixture.bare)).split('\n').filter((message) => message === `seed: connect ${name}`)).toHaveLength(1);
    }
  });
});

describe('issue 9 connect picker', () => {
  it.each(['sample', 'skip'])('shares %s through selection and a separate consent question', async (name) => {
    const { fixture, home, store, source } = await pickerFixture(name);
    const io = new ScriptedPrompter([`Connect ${name}`], [true], true);
    const result = await run({ home, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { kind: 'batch', shared: [{ name }] } });
    expect(io.offered).toEqual([[`Connect ${name}`, 'Skip']]);
    expect(io.asked).toEqual(['Connect a local skill folder to team team?', `Connect ${name}?`]);
    expect(await git(['show', `main:skills/${name}/SKILL.md`], fixture.bare)).toBe(await readFile(join(source, 'SKILL.md'), 'utf8'));
    expect(Object.values((await store.read()).shared)).toEqual([expect.objectContaining({ source, team: 'team' })]);
  });

  it('Skip changes no source, config, or remote', async () => {
    const { fixture, home, store, source, original } = await pickerFixture();
    const before = await originSha(fixture.bare); const config = await readFile(join(store.root, 'config.json'), 'utf8');
    const io = new ScriptedPrompter(['Skip'], [], true);
    expect(await run({ home, config: store }, io)).toEqual({ ok: true, value: undefined });
    expect(io.lines).toEqual(['Nothing connected.']);
    expect(await originSha(fixture.bare)).toBe(before);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
    expect(await readFile(join(store.root, 'config.json'), 'utf8')).toBe(config);
  });

  it('empty discovery succeeds before requiring identity', async () => {
    const { fixture, store } = await pickerFixture(); const home = join(fixture.root, 'empty-home');
    await store.update((config) => { delete config.email; delete config.display_name; });
    const io = new NonInteractivePrompter();
    expect(await run({ home, config: store }, io)).toEqual({ ok: true, value: undefined });
    expect(io.lines).toEqual([`No local candidates to connect under ${join(home, '.claude', 'skills')}. Skills elsewhere can be connected by passing their folder path.`]);
    expect(io.asked).toEqual([]);
  });

  it('non-interactive discovery prints absolute paths, fails with guidance, and writes nothing', async () => {
    const { fixture, home, store, source, original } = await pickerFixture();
    const before = await originSha(fixture.bare); const config = await readFile(join(store.root, 'config.json'), 'utf8');
    const io = new NonInteractivePrompter();
    expect(await run({ home, config: store }, io)).toEqual({ ok: false, error: "No skill selected. In an interactive terminal, run `npx -y terum-skills@latest connect --team 'team'`, or pass an explicit skill folder path." });
    expect(io.lines).toEqual([`Local candidates under ${join(home, '.claude', 'skills')}:`, `  ${source}`]);
    expect(io.asked).toEqual([]);
    expect(await originSha(fixture.bare)).toBe(before);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
    expect(await readFile(join(store.root, 'config.json'), 'utf8')).toBe(config);
  });

  it('widens choices for --allow-privileged and reports omissions otherwise', async () => {
    const { home, store, source } = await pickerFixture();
    await mkdir(join(source, 'hooks'));
    const ordinary = new ScriptedPrompter([], [], true);
    expect(await run({ home, config: store }, ordinary)).toEqual({ ok: true, value: undefined });
    expect(ordinary.lines[0]).toBe('Skipped 1 local folders that cannot be connected. Run `npx -y terum-skills@latest ls --local` for paths and reasons.');
    const optedIn = new ScriptedPrompter(['Skip'], [], true);
    expect(await run({ home, config: store, allowPrivileged: true }, optedIn)).toEqual({ ok: true, value: undefined });
    expect(optedIn.offered).toEqual([['Connect sample', 'Skip']]);
  });

  it('rejects an unlisted answer without using it as a path', async () => {
    const { home, store } = await pickerFixture();
    expect(await run({ home, config: store }, new ScriptedPrompter(['../outside'], [], true))).toEqual({ ok: false, error: 'Unknown choice ../outside.' });
    expect((await store.read()).shared).toEqual({});
  });

  it('routes unsupported source fields through the HYG1 gate before any write or consent', async () => {
    const { fixture, home, store, source, original } = await pickerFixture();
    const bytes = original.replace('description: stock source', 'description: stock source\nargument-hint: example');
    await writeFile(join(source, 'SKILL.md'), bytes); const before = await originSha(fixture.bare);
    const io = new ScriptedPrompter([], [true]);
    const picked = await run({ path: source, home, config: store }, io);
    expect(picked.ok).toBe(false);
    if (!picked.ok) { expect(picked.error).toContain('HYG1'); expect(picked.error).toContain('argument-hint'); }
    expect(io.asked).toEqual([]);
    expect(await originSha(fixture.bare)).toBe(before);
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(bytes);
    expect((await store.read()).shared).toEqual({});
  });

  it('explicit paths never inspect the injected home', async () => {
    const { fixture, store, source } = await pickerFixture(); const home = join(fixture.root, 'not-a-directory'); await writeFile(home, 'file');
    expect(await run({ path: source, home, config: store }, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true, value: { name: 'sample' } });
  });
});


describe('project connect discovery', () => {
  it('offers a project-only candidate with its unqualified name and keeps the separate confirmation', async () => {
    const { fixture, home, store, source } = await pickerFixture(); const cwd = join(fixture.root, 'project');
    const projectRoot = join(cwd, '.claude', 'skills'); await mkdir(projectRoot, { recursive: true }); await mkdir(join(cwd, '.git'));
    const projectSource = join(projectRoot, 'sample'); await rename(source, projectSource);
    const io = new ScriptedPrompter(['Connect sample'], [true], true);
    expect(await run({ home, cwd, config: store }, io)).toMatchObject({ ok: true, value: { kind: 'batch', shared: [{ name: 'sample' }] } });
    expect(io.offered).toEqual([['Connect sample', 'Skip']]);
    expect(io.asked).toEqual(['Connect a local skill folder to team team?', 'Connect sample?']);
    expect(Object.values((await store.read()).shared)).toEqual([expect.objectContaining({ source: projectSource })]);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toBe(await readFile(join(projectSource, 'SKILL.md'), 'utf8'));
  });

  it.each(['global', 'project'])('qualifies duplicate names and shares the selected %s source', async (scope) => {
    const { fixture, home, store, source, original } = await pickerFixture(); const cwd = join(fixture.root, 'project');
    const projectSource = join(cwd, '.claude', 'skills', 'sample'); await mkdir(projectSource, { recursive: true }); await mkdir(join(cwd, '.git'));
    const projectBytes = original.replace('stock source', 'project source'); await writeFile(join(projectSource, 'SKILL.md'), projectBytes);
    const io = new ScriptedPrompter([`Connect sample (${scope})`, 'Done'], [true], true);
    expect(await run({ home, cwd, config: store }, io)).toMatchObject({ ok: true, value: { kind: 'batch', shared: [{ name: 'sample' }] } });
    expect(io.offered).toEqual([['Connect sample (global)', 'Connect sample (project)', 'Skip'], [`Connect sample (${scope === 'global' ? 'project' : 'global'})`, 'Done']]);
    const selected = scope === 'global' ? source : projectSource;
    expect(Object.values((await store.read()).shared)).toEqual([expect.objectContaining({ source: selected })]);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toBe(await readFile(join(selected, 'SKILL.md'), 'utf8'));
    expect(await readFile(join(scope === 'global' ? projectSource : source, 'SKILL.md'), 'utf8')).toBe(scope === 'global' ? projectBytes : original);
  });

  it('names both roots when there are no candidates', async () => {
    const { fixture, store } = await pickerFixture(); const home = join(fixture.root, 'empty-home'); const cwd = join(fixture.root, 'project');
    await mkdir(join(cwd, '.git'), { recursive: true }); const io = new NonInteractivePrompter();
    expect(await run({ home, cwd, config: store }, io)).toEqual({ ok: true, value: undefined });
    expect(io.lines).toEqual([`No local candidates to connect under ${join(home, '.claude', 'skills')} or ${join(cwd, '.claude', 'skills')}. Skills elsewhere can be connected by passing their folder path.`]);
  });

  it('prints one non-interactive candidates block per root and sums omission counts', async () => {
    const { fixture, home, store, source } = await pickerFixture(); const cwd = join(fixture.root, 'project');
    const projectSource = join(cwd, '.claude', 'skills', 'project'); await mkdir(projectSource, { recursive: true }); await mkdir(join(cwd, '.git'));
    await writeFile(join(projectSource, 'SKILL.md'), '---\nname: project\ndescription: local\n---\n');
    for (const base of [home, cwd]) {
      const invalid = join(base, '.claude', 'skills', 'invalid'); await mkdir(invalid); await writeFile(join(invalid, 'SKILL.md'), '---\nname: invalid\ndescription: a: b\n---\n');
    }
    const runner = ghOnlyRunner(() => ({ code: 0, stdout: '', stderr: '' })); const io = new NonInteractivePrompter();
    expect(await run({ home, cwd, config: store, runner }, io)).toMatchObject({ ok: false, error: expect.stringContaining('No skill selected.') });
    expect(io.lines).toEqual([
      'Skipped 2 local folders that cannot be connected. Run `npx -y terum-skills@latest ls --local` for paths and reasons.',
      `Local candidates under ${join(home, '.claude', 'skills')}:`, `  ${source}`,
      `Local candidates under ${join(cwd, '.claude', 'skills')}:`, `  ${projectSource}`,
    ]);
    expect(io.asked).toEqual([]); expect(runner.calls).toEqual([]);
  });

  it.each([false, true])('refuses explicit state-directory sources before git and preserves all bytes (aliased: %s)', async (aliased) => {
    const { fixture, store } = await pickerFixture();
    const root = join(store.root, 'authoring'); const source = join(root, 'inside'); await mkdir(source, { recursive: true });
    const original = '---\nname: inside\ndescription: state source\n---\n'; const binary = Buffer.from([0, 255, 42, 128]);
    await writeFile(join(source, 'SKILL.md'), original); await writeFile(join(source, 'asset.bin'), binary);
    const alias = join(fixture.root, 'alias'); if (aliased) await symlink(root, alias);
    const selected = aliased ? join(alias, 'inside') : source;
    const before = await originSha(fixture.bare); const configBefore = await readFile(join(store.root, 'config.json'));
    const runner = ghOnlyRunner(() => ({ code: 0, stdout: '', stderr: '' })); const io = new ScriptedPrompter([], [true], true);
    expect(await run({ path: selected, config: store, runner }, io)).toEqual({ ok: false, error: `${selected} is inside the terum-skills state directory ${store.root}; move the folder elsewhere and connect that path.` });
    expect(runner.calls).toEqual([]); expect(io.asked).toEqual([]);
    expect(await originSha(fixture.bare)).toBe(before); expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(original);
    expect(await readFile(join(source, 'asset.bin'))).toEqual(binary); expect(await readFile(join(store.root, 'config.json'))).toEqual(configBefore);
  });
});

describe('issue 5 connected-source contract', () => {
  it('sends the exact divergence remedy through hook SyncResult.notices without prompting', async () => {
    const { fixture, store } = await sharedFixture();
    const [id, tracked] = Object.entries((await store.read()).shared)[0]!;
    const skillPath = join(tracked.source, 'SKILL.md');
    await writeFile(skillPath, (await readFile(skillPath, 'utf8')).replace('description: x', 'description: local'));
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', (await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).replace('description: x', 'description: remote'));
    const io = new NonInteractivePrompter();
    const result = await sync({ config: store, hook: true }, io);
    expect(result.ok).toBe(true);
    expect(result.value?.notices).toEqual([`Connected skill sample diverged (source ${await canonicalDigest(tracked.source)}, repo ${await canonicalDigest(join(store.teamClone('team'), 'skills', 'sample'))}); choose npx -y terum-skills@latest connect --keep-source '${id}' or npx -y terum-skills@latest connect --keep-repo '${id}'.`]);
    expect(result.value?.deferred).toEqual(['sample']);
    expect(io.lines).toEqual([]); expect(io.asked).toEqual([]);
  });

  it('reconciles a legacy config.shared entry without ever running the connect verb', async () => {
    const fixture = await bareTeam(); const store = createConfigStore(join(fixture.root, 'state'));
    const id = '11111111-1111-4111-8111-111111111111'; const source = join(fixture.root, 'sample');
    const original = `---\nname: sample\ndescription: legacy\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Me <me@example.com>\n  terum-category: testing\n---\n`;
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', original);
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), original);
    const baseline = await canonicalDigest(source);
    await store.ensureRoot();
    await writeFile(join(store.root, 'config.json'), JSON.stringify({ teams: { team: { remote: fixture.bare, handle: 'seed' } }, display_name: 'Me', email: 'me@example.com', shared: { [id]: { source, team: 'team', baseline } }, placements: {}, approvals: {}, pending: [] }));
    const updated = original.replace('description: legacy', 'description: legacy edited');
    await writeFile(join(source, 'SKILL.md'), updated);
    const io = new ScriptedPrompter(); await reconcileShared(store, systemRunner, io);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toBe(updated);
    expect((await store.read()).shared).toEqual({ [id]: { source, team: 'team', baseline: await canonicalDigest(source) } });
    expect(io.lines).toEqual([]); expect(io.asked).toEqual([]);
  });
});

it('issue 5 refuses an explicit connection without joined identity with the exact message', async () => {
  const { store, source } = await pickerFixture();
  await store.update((config) => { delete config.email; });
  expect(await run({ path: source, config: store }, new ScriptedPrompter())).toEqual({ ok: false, error: 'Connect needs your joined team identity, name, and email.' });
});

it.each(['keepSource', 'keepRepo', 'relocate'] as const)('issue 5 names an unknown connected record for %s', async (option) => {
  const { store } = await sharedFixture();
  const [id, tracked] = Object.entries((await store.read()).shared)[0]!;
  await store.update((config) => { delete config.shared[id]; });
  const args = option === 'relocate' ? { relocate: { id, path: tracked.source } } : { [option]: id };
  expect(await run({ ...args, config: store }, new ScriptedPrompter())).toEqual({ ok: false, error: `No connected skill ${id}.` });
});

it('issue 5 reports a missing repository copy with the exact connect remedy', async () => {
  const { store } = await sharedFixture(); const [id] = Object.keys((await store.read()).shared);
  const directory = join(store.teamClone('team'), 'skills', 'sample'); await rename(directory, `${directory}-missing`);
  const io = new ScriptedPrompter(); await reconcileShared(store, systemRunner, io);
  expect(io.lines).toEqual([`Repository copy for connected ${id!.slice(0, 8)} is missing; run npx -y terum-skills@latest connect again to restore it.`]);
});

it('issue 5 reports an unreadable repository inventory using connected wording', async () => {
  const { store } = await sharedFixture(); const [id] = Object.keys((await store.read()).shared);
  const directory = join(store.teamClone('team'), 'skills'); await rename(directory, `${directory}-saved`); await writeFile(directory, 'not a directory');
  let detail = '';
  try { await readdir(directory); } catch (error) { detail = (error as Error).message; }
  expect(detail).not.toBe('');
  const io = new ScriptedPrompter(); await reconcileShared(store, systemRunner, io);
  expect(io.lines).toEqual([`Could not read connected ${id!.slice(0, 8)}: ${detail}`]);
});
describe('HYG6 size warnings', () => {
  it.each([false, true])('first connect reports warnings before consent and refuses only errors (mixed: %s)', async (mixed) => {
    const { fixture, store, source, original } = await pickerFixture();
    const bytes = original + 'x'.repeat(20_001) + (mixed ? '\u202E' : '');
    await writeFile(join(source, 'SKILL.md'), bytes);
    const before = await originSha(fixture.bare); const io = new ScriptedPrompter([], [true]);
    const result = await run({ path: source, config: store }, io);
    expect(result.ok).toBe(!mixed);
    expect(io.lines[0]).toMatch(/^warning HYG6/);
    if (mixed) {
      expect(result).toMatchObject({ error: expect.stringContaining('HYG2') });
      expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(bytes);
      expect(await originSha(fixture.bare)).toBe(before);
      expect(io.lines.some((line) => line.startsWith('Will add:'))).toBe(false);
    } else {
      expect(io.lines.findIndex((line) => line.startsWith('warning HYG6'))).toBeLessThan(io.lines.findIndex((line) => line.startsWith('Will add:')));
      expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toBe(await readFile(join(source, 'SKILL.md'), 'utf8'));
      expect(Object.values((await store.read()).shared)[0]!.baseline).toBe(await canonicalDigest(source));
    }
  });

  it.each([false, true])('reconcile mirrors warnings but defers errors (mixed: %s)', async (mixed) => {
    const { fixture, store } = await sharedFixture();
    const [id, tracked] = Object.entries((await store.read()).shared)[0]!;
    const before = await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare);
    const bytes = before + 'x'.repeat(20_001) + (mixed ? '\nghp_abcdefghijklmnopqrstuvwxyz\n' : '');
    await writeFile(join(tracked.source, 'SKILL.md'), bytes);
    const io = new ScriptedPrompter(); const deferred: string[] = [];
    await reconcileShared(store, systemRunner, io, new Set(), (team, label) => { deferred.push(`${team}/${label}`); });
    expect(io.lines[0]).toMatch(/^warning HYG6/);
    if (mixed) {
      expect(io.lines[1]).toContain('HYG3'); expect(deferred).toEqual(['team/sample']);
      expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toBe(before);
      expect((await store.read()).shared[id]!.baseline).toBe(tracked.baseline);
      expect(await readFile(join(tracked.source, 'SKILL.md'), 'utf8')).toBe(bytes);
    } else {
      expect(deferred).toEqual([]);
      expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toBe(bytes);
      expect((await store.read()).shared[id]!.baseline).toBe(await canonicalDigest(tracked.source));
      expect((await store.read()).shared[id]!.baseline).not.toBe(tracked.baseline);
    }
  });

  it('unchanged oversized source has no output', async () => {
    const { fixture, store } = await sharedFixture();
    const [id, tracked] = Object.entries((await store.read()).shared)[0]!;
    const bytes = (await readFile(join(tracked.source, 'SKILL.md'), 'utf8')) + 'x'.repeat(20_001);
    await writeFile(join(tracked.source, 'SKILL.md'), bytes);
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', bytes);
    await git(['fetch', 'origin'], store.teamClone('team')); await git(['reset', '--hard', 'origin/main'], store.teamClone('team'));
    const baseline = await canonicalDigest(tracked.source); await store.update((config) => { config.shared[id]!.baseline = baseline; });
    const io = new ScriptedPrompter(); const deferred: string[] = [];
    await reconcileShared(store, systemRunner, io, new Set(), (_team, label) => { deferred.push(label); });
    expect(io.lines).toEqual([]); expect(deferred).toEqual([]);
  });

  it('repo-to-source reconciliation emits no hygiene output', async () => {
    const { fixture, store } = await sharedFixture();
    const [id, tracked] = Object.entries((await store.read()).shared)[0]!;
    const baselineBytes = (await readFile(join(tracked.source, 'SKILL.md'), 'utf8')) + 'x'.repeat(20_001);
    await writeFile(join(tracked.source, 'SKILL.md'), baselineBytes);
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', baselineBytes);
    const baseline = await canonicalDigest(tracked.source); await store.update((config) => { config.shared[id]!.baseline = baseline; });
    const bytes = baselineBytes + '\nremote edit';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', bytes);
    const io = new ScriptedPrompter(); expect((await sync({ config: store }, io)).ok).toBe(true);
    expect(io.lines.filter((line) => /HYG|hygiene/.test(line))).toEqual([]);
    expect(await readFile(join(tracked.source, 'SKILL.md'), 'utf8')).toBe(bytes);
  });

  it.each([false, true])('--keep-source proceeds with size warnings and refuses mixed errors (mixed: %s)', async (mixed) => {
    const { fixture, store } = await sharedFixture(); const [id, tracked] = Object.entries((await store.read()).shared)[0]!;
    const before = await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare);
    const bytes = before + 'x'.repeat(20_001) + (mixed ? '\nghp_abcdefghijklmnopqrstuvwxyz' : '');
    await writeFile(join(tracked.source, 'SKILL.md'), bytes); const io = new ScriptedPrompter();
    expect(await run({ keepSource: id, config: store }, io)).toMatchObject({ ok: !mixed });
    expect(io.lines[0]).toMatch(/^warning HYG6/);
    expect(await git(['show', 'main:skills/sample/SKILL.md'], fixture.bare)).toBe(mixed ? before : bytes);
    expect((await store.read()).shared[id]!.baseline).toBe(mixed ? tracked.baseline : await canonicalDigest(tracked.source));
  });

  it('--keep-repo never inspects oversized content', async () => {
    const { fixture, store } = await sharedFixture(); const [id, tracked] = Object.entries((await store.read()).shared)[0]!;
    const bytes = (await readFile(join(tracked.source, 'SKILL.md'), 'utf8')) + 'x'.repeat(20_001) + '\nghp_abcdefghijklmnopqrstuvwxyz';
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', bytes);
    await git(['fetch', 'origin'], store.teamClone('team')); await git(['reset', '--hard', 'origin/main'], store.teamClone('team'));
    const before = await originSha(fixture.bare); const io = new ScriptedPrompter();
    expect((await run({ keepRepo: id, config: store }, io)).ok).toBe(true);
    expect(io.lines.filter((line) => /HYG|hygiene/.test(line))).toEqual([]);
    expect(await originSha(fixture.bare)).toBe(before);
    expect(await readFile(join(tracked.source, 'SKILL.md'), 'utf8')).toBe(bytes);
  });
});
