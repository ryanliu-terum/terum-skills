import { expectTypeOf, describe, expect, it } from 'vitest';
import { access, cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../sync.js';
import { run as install } from '../install.js';
import { NonInteractivePrompter } from '../../lib/prompt.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter, temporaryDirectory, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { snapshotSkillDirectory } from '../../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { systemRunner } from '../../lib/runner.js';

const ID = '11111111-1111-4111-8111-111111111111';
const skill = (description: string) => `---\nname: sample\ndescription: ${description}\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${description}\n`;
const toolSkill = (description: string, tools: string[]) => `---\nname: sample\ndescription: ${description}\nlicense: UNLICENSED\nallowed-tools:\n${tools.map((tool) => `  - ${tool}`).join('\n')}\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${description}\n`;

async function configuredSkill() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('old'));
  const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  return { fixture, store, clone };
}

describe('sync --hook (§3, §6)', () => {
  it('is callable with the print-only prompter and has silent empty output', async () => {
    expectTypeOf(run).toBeFunction();
    const io: NonInteractivePrompter = { interactive: false, print: () => undefined };
    const result = await run({ hook: true, config: createConfigStore(await temporaryDirectory()) }, io);
    expect(result).toMatchObject({ ok: true, value: { placed: 0 } });
  });

  it('keeps a pinned placement on its cached tree when HEAD changes', async () => {
    const { fixture, store, clone } = await configuredSkill();
    const home = join(fixture.root, 'home');
    const tree = (await systemRunner.run('git', ['rev-parse', 'HEAD:skills/sample'], { cwd: clone })).stdout.trim();
    expect((await install({ ref: `sample@${tree}`, config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample', 'SKILL.md');
    const fingerprint = Object.values((await store.read()).placements)[0]!.fingerprint;
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toContain('description: old');
    expect(Object.values((await store.read()).placements)[0]!.fingerprint).toBe(fingerprint);
  });

  it('defers newly endorsed global skills in hook mode without prompting or placing', async () => {
    const { fixture, store } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [ID], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ hook: true, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { deferred: ['sample'], placed: 0 } });
    expect(io.lines).toEqual([]);
    expect((await store.read()).placements).toEqual({});
    void fixture;
  });

  it('writes a stamp after interactive success but leaves an old stamp after a failed pull', async () => {
    const { fixture, store } = await configuredSkill();
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    const stamp = join(store.root, 'run', 'team.stamp');
    await expect(access(stamp)).resolves.toBeUndefined();
    await writeFile(stamp, 'old');
    const failing = wrapRunner(systemRunner, async (command, args, _options, next) => command === 'git' && args[0] === 'fetch' ? { code: 1, stdout: '', stderr: 'failed' } : next());
    expect((await run({ config: store, runner: failing }, new ScriptedPrompter())).ok).toBe(false);
    expect(await readFile(stamp, 'utf8')).toBe('old');
    void fixture;
  });

  it('heals a clone whose local main drifted instead of failing to fast-forward', async () => {
    const { store, clone } = await configuredSkill();
    await writeFile(join(clone, 'stray.txt'), 'local'); await git(['add', '--all'], clone); await git(['commit', '-q', '-m', 'local-only'], clone);
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).toBe((await git(['rev-parse', 'origin/main'], clone)).trim());
  });

  it('blocks a placement whose pinned version is not in the clone and touches nothing', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', team: 'team', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const [path] = Object.keys((await store.read()).placements);
    const before = await snapshotSkillDirectory(path!);
    const unknown = '0123456789abcdef0123456789abcdef01234567';
    await store.update((config) => { config.placements[path!]!.version = unknown; });
    const io = new ScriptedPrompter();
    expect((await run({ config: store }, io)).ok).toBe(true);
    expect(io.lines.join('\n')).toContain(`Blocked ${path}: pinned version 01234567`);
    expect((await snapshotSkillDirectory(path!)).fingerprint).toBe(before.fingerprint);
    expect((await store.read()).placements[path!]!.version).toBe(unknown);
  });

  it('adopts or declines orphans interactively and only defers them in hook mode', async () => {
    const adopt = await orphanedPlacement();
    expect((await run({ config: adopt.store }, new ScriptedPrompter([], [true], true))).ok).toBe(true);
    expect(JSON.parse(await readFile(join(adopt.clone, 'people', 'seed.json'), 'utf8')).installed).toHaveLength(1);
    expect(Object.keys((await adopt.store.read()).placements)).toHaveLength(1);

    const decline = await orphanedPlacement();
    expect((await run({ config: decline.store }, new ScriptedPrompter([], [false], true))).ok).toBe(true);
    expect(await readFile(join(decline.path, 'SKILL.md'), 'utf8')).toContain('description: old');
    expect(Object.keys((await decline.store.read()).placements)).toEqual([decline.path]);
    expect(JSON.parse(await readFile(join(decline.clone, 'people', 'seed.json'), 'utf8')).declined).toContain(ID);
    const declinedBefore = await readFile(join(decline.path, 'SKILL.md'), 'utf8');
    const ledgerBefore = JSON.stringify((await decline.store.read()).placements);
    const interactive = new ScriptedPrompter();
    expect(await run({ config: decline.store }, interactive)).toMatchObject({ ok: true, value: { placed: 0, deferred: [] } });
    expect(interactive.asked).toEqual([]);
    const declinedHook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: decline.store }, declinedHook)).toMatchObject({ ok: true, value: { placed: 0, deferred: [] } });
    expect(declinedHook.lines).toEqual([]);
    expect(await readFile(join(decline.path, 'SKILL.md'), 'utf8')).toBe(declinedBefore);
    expect(JSON.stringify((await decline.store.read()).placements)).toBe(ledgerBefore);
    expect((await install({ ref: 'sample', config: decline.store, home: decline.home }, new ScriptedPrompter())).ok).toBe(true);
    expect(JSON.parse(await readFile(join(decline.clone, 'people', 'seed.json'), 'utf8')).declined).not.toContain(ID);

    const hook = await orphanedPlacement();
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: hook.store }, io)).toMatchObject({ ok: true, value: { deferred: ['sample'] } });
    await expect(access(hook.path)).resolves.toBeUndefined();
    expect(io.lines).toEqual([]);
  });

  it('offers adoption for an orphan before considering a changed repository copy, leaving its bytes untouched', async () => {
    const orphan = await orphanedPlacement();
    const before = await readFile(join(orphan.path, 'SKILL.md'), 'utf8');
    await pushFromSeed(orphan.fixture.seed, 'skills/sample/SKILL.md', skill('upstream changed'));
    const io = new ScriptedPrompter([], [false], true);
    expect((await run({ config: orphan.store }, io)).ok).toBe(true);
    expect(io.asked).toEqual([`Adopt orphaned placement at ${orphan.path}?`]);
    expect(await readFile(join(orphan.path, 'SKILL.md'), 'utf8')).toBe(before);
    expect((await orphan.store.read()).placements[orphan.path]).toBeDefined();
    expect(JSON.parse(await readFile(join(orphan.clone, 'people', 'seed.json'), 'utf8')).declined).toContain(ID);
  });

  it('follows an upstream skill rename with exactly one new placement and re-keyed provenance', async () => {
    const { fixture, store, clone } = await configuredSkill(); const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const oldPath = join(home, '.claude', 'skills', 'sample'); const newPath = join(home, '.claude', 'skills', 'renamed');
    await git(['fetch', '-q', 'origin'], fixture.seed); await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    await cp(join(fixture.seed, 'skills', 'sample'), join(fixture.seed, 'skills', 'renamed'), { recursive: true });
    await rm(join(fixture.seed, 'skills', 'sample'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'renamed', 'SKILL.md'), skill('renamed').replace('name: sample', 'name: renamed'));
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'rename sample'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    await expect(access(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(newPath, 'SKILL.md'), 'utf8')).toContain('name: renamed');
    const ledger = await store.read(); expect(Object.keys(ledger.placements)).toEqual([newPath]);
    const fingerprint = (await snapshotSkillDirectory(join(clone, 'skills', 'renamed'))).fingerprint;
    expect(ledger.placements[newPath]!.fingerprint).toBe(fingerprint);
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(Object.keys((await store.read()).placements)).toEqual([newPath]);
  });

  it('defers consent for a noninteractive-shaped interactive call without emitting hook stdout', async () => {
    const setup = await configuredToolSkill();
    await pushFromSeed(setup.fixture.seed, 'skills/sample/SKILL.md', toolSkill('widened', ['Bash(*)']));
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ config: setup.store }, io as never);
    expect(result).toMatchObject({ ok: true, value: { hook: false, deferred: ['sample'], placed: 0 } });
    expect(io.lines).not.toContain('reloadSkills');
    expect(await readFile(join(setup.home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: old');
  });

  it('returns local-change notices in hook mode while keeping stdout limited to reload output', async () => {
    const orphan = await orphanedPlacement(true);
    await writeFile(join(orphan.path, 'SKILL.md'), skill('hand edit'));
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ hook: true, config: orphan.store }, io);
    expect(result).toMatchObject({ ok: true, value: { notices: [expect.stringContaining(orphan.path)] } });
    expect(io.lines).toEqual(['{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}']);
  });

  it('leaves a project pending install deferred outside its worktree and replays it inside', async () => {
    const { fixture, store, clone } = await configuredSkill();
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { project: { remotes: [fixture.bare], skills: [ID] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } }, null, 2)}\n`);
    await store.update((config) => { config.pending.push({ op: 'install', id: ID, team: 'team', version: null, scope: { kind: 'project', project: 'project' }, started: '2026-09-04T00:00:00Z' }); });
    const outside = await temporaryDirectory();
    expect(await run({ config: store, cwd: outside }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { deferred: [expect.stringContaining('project')] } });
    expect((await store.read()).pending).toHaveLength(1);
    expect((await run({ config: store, cwd: clone }, new ScriptedPrompter())).ok).toBe(true);
    expect((await store.read()).pending).toHaveLength(0);
    expect(await readFile(join(clone, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: old');
  });

  it('classifies an update as available and re-places into the ledger-recorded target', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    const before = (await store.read()).placements[path]!.fingerprint;
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('new'));
    const io = new ScriptedPrompter();
    const result = await run({ config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { placed: 1, changed: true } });
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('description: new');
    expect((await store.read()).placements[path]!.fingerprint).not.toBe(before);
    expect(io.lines).toContain('Skills synchronized.');
  });

  it('leaves an up-to-date placement untouched and emits no status line', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    const fingerprint = (await store.read()).placements[path]!.fingerprint;
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 0, changed: false } });
    expect((await store.read()).placements[path]!.fingerprint).toBe(fingerprint);
    expect(io.lines).toEqual([]);
  });

  it('reports a deleted repository skill as blocked without touching its placement or ledger', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    const before = await readFile(join(path, 'SKILL.md'), 'utf8');
    const ledger = JSON.stringify((await store.read()).placements);
    await git(['fetch', '-q', 'origin'], fixture.seed); await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
    await git(['rm', '-qr', 'skills/sample'], fixture.seed); await git(['commit', '-q', '-m', 'remove sample'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const interactive = new ScriptedPrompter();
    expect(await run({ config: store }, interactive)).toMatchObject({ ok: true, value: { placed: 0, notices: [expect.stringContaining('Blocked')] } });
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe(before);
    expect(JSON.stringify((await store.read()).placements)).toBe(ledger);
    const hook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: store }, hook)).toMatchObject({ ok: true, value: { notices: [expect.stringContaining('Blocked')] } });
    expect(hook.lines).toEqual([]);
  });

  it('quarantines and overwrites a hand-edited placement without losing the edit', async () => {
    const { fixture, store } = await configuredSkill();
    const home = join(fixture.root, 'home');
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample');
    await writeFile(join(path, 'SKILL.md'), skill('hand edit'));
    const io = new ScriptedPrompter();
    expect(await run({ config: store }, io)).toMatchObject({ ok: true, value: { placed: 1, changed: true } });
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('description: old');
    const quarantine = join(store.root, 'quarantine');
    const snapshots = await readdir(quarantine, { recursive: true });
    expect(snapshots.some((item) => item.endsWith('sample/SKILL.md'))).toBe(true);
    const copied = await Promise.all(snapshots.filter((item) => item.endsWith('sample/SKILL.md')).map((item) => readFile(join(quarantine, item), 'utf8')));
    expect(copied.join('\n')).toContain('description: hand edit');
    expect(io.lines.some((line) => line.includes('Local changes at'))).toBe(true);
  });

  it('leaves a hand-edited project placement untouched outside its checkout, then repairs it in that checkout', async () => {
    const fixture = await bareTeam();
    const product = await bareTeam();
    const id = '99999999-9999-4999-8999-999999999999';
    await pushFromSeed(fixture.seed, 'skills/projected/SKILL.md', `---\nname: projected\ndescription: projected\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ layout_version: 2, name: 'team', categories: [], global: [], projects: { product: { remotes: [product.bare], skills: [id] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } })}\n`);
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const checkoutA = await cloneWithIdentity(product.bare, join(product.root, 'checkout-a'));
    const checkoutB = await cloneWithIdentity(product.bare, join(product.root, 'checkout-b'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ kind: 'project', project: 'product', config: store, home, cwd: checkoutA }, new ScriptedPrompter())).ok).toBe(true);
    expect((await install({ kind: 'project', project: 'product', config: store, home, cwd: checkoutB }, new ScriptedPrompter())).ok).toBe(true);
    const path = join(checkoutA, '.claude', 'skills', 'projected', 'SKILL.md');
    await writeFile(path, 'hand-edited placement');
    const ledgerBefore = JSON.stringify((await store.read()).placements);
    const outside = await temporaryDirectory('terum-unrelated-sync-');
    expect((await run({ config: store, cwd: outside }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('hand-edited placement');
    await expect(access(join(store.root, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.stringify((await store.read()).placements)).toBe(ledgerBefore);

    expect((await run({ config: store, cwd: checkoutA }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toContain('description: projected');
    expect((await readdir(join(store.root, 'quarantine'), { recursive: true })).some((entry) => entry.endsWith('projected/SKILL.md'))).toBe(true);
  });

  it('normalizes reordered grants but defers an added or widened grant in hook mode', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('old', ['Bash(ls)', 'Read(*)']));
    const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const path = join(home, '.claude', 'skills', 'sample', 'SKILL.md');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('reordered', ['Read(*)', 'Bash(ls)', 'Bash(ls)']));
    const reordered = new ScriptedPrompter();
    expect(await run({ config: store }, reordered)).toMatchObject({ ok: true, value: { placed: 1, deferred: [] } });
    expect(reordered.asked).toEqual([]);
    expect(await readFile(path, 'utf8')).toContain('description: reordered');
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('widened', ['Bash(*)', 'Read(*)']));
    const hook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: store }, hook)).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(hook.lines).toEqual([]);
    expect(await readFile(path, 'utf8')).toContain('description: reordered');
  });

  it('reviews an added tool interactively and defers it unchanged in hook mode', async () => {
    const accepted = await configuredToolSkill();
    await pushFromSeed(accepted.fixture.seed, 'skills/sample/SKILL.md', toolSkill('added', ['Bash(ls)', 'Read(*)']));
    const approved = new ScriptedPrompter([], [true], true);
    expect(await run({ config: accepted.store }, approved)).toMatchObject({ ok: true, value: { placed: 1, deferred: [] } });
    expect(approved.lines.join('\n')).toContain('allowed-tools changed');
    expect(await readFile(join(accepted.home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: added');
    expect((await accepted.store.read()).approvals[ID]!.grants).not.toBe(accepted.oldApproval);

    const declined = await configuredToolSkill();
    await pushFromSeed(declined.fixture.seed, 'skills/sample/SKILL.md', toolSkill('added', ['Bash(ls)', 'Read(*)']));
    expect(await run({ config: declined.store }, new ScriptedPrompter([], [false], true))).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(await readFile(join(declined.home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('description: old');
    expect((await declined.store.read()).approvals[ID]!.grants).toBe(declined.oldApproval);
    const hook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await run({ hook: true, config: declined.store }, hook)).toMatchObject({ ok: true, value: { placed: 0, deferred: ['sample'] } });
    expect(hook.lines).toEqual([]);
  });

  it('never treats an unrelated same-name folder as provenance and prunes only quarantine entries', async () => {
    const { fixture, store } = await configuredSkill();
    const unrelated = join(fixture.root, 'home', '.claude', 'skills', 'sample');
    await mkdir(unrelated, { recursive: true }); await writeFile(join(unrelated, 'SKILL.md'), 'user-owned');
    expect((await run({ config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect(await readFile(join(unrelated, 'SKILL.md'), 'utf8')).toBe('user-owned');
    const outside = join(fixture.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'precious');
    const quarantined = join(store.root, 'quarantine', 'stamp'); await mkdir(quarantined, { recursive: true }); await writeFile(join(quarantined, 'old'), 'old');
    await symlink(outside, join(store.root, 'quarantine', 'escape'));
    const io = new ScriptedPrompter([], [true], true);
    expect((await run({ prune: true, config: store }, io)).ok).toBe(true);
    expect(io.lines).toEqual(expect.arrayContaining([quarantined, join(store.root, 'quarantine', 'escape')]));
    await expect(access(quarantined)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('precious');
    expect(await readFile(join(unrelated, 'SKILL.md'), 'utf8')).toBe('user-owned');
  });
});

async function orphanedPlacement(installed = false) {
  const prepared = await configuredSkill();
  const home = join(prepared.fixture.root, 'home');
  const path = join(home, '.claude', 'skills', 'sample');
  await mkdir(join(home, '.claude', 'skills'), { recursive: true });
  await cp(join(prepared.clone, 'skills', 'sample'), path, { recursive: true });
  const snapshot = await snapshotSkillDirectory(path);
  if (installed) await pushFromSeed(prepared.fixture.seed, 'people/seed.json', `${JSON.stringify(person('seed', { installed: [{ id: ID, version: null, scope: { kind: 'global' }, since: '2026-09-04' }] }), null, 2)}\n`);
  await prepared.store.update((config) => { config.placements[path] = { id: ID, team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-09-04', fingerprint: snapshot.fingerprint }; });
  return { ...prepared, home, path };
}

async function configuredToolSkill() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', toolSkill('old', ['Bash(ls)']));
  const home = join(fixture.root, 'home'); const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  expect((await install({ ref: 'sample', config: store, home }, new ScriptedPrompter([], [true]))).ok).toBe(true);
  return { fixture, store, home, oldApproval: (await store.read()).approvals[ID]!.grants };
}

describe('sync --hook keeps shared-source reconciliation off stdout (§8)', () => {
  it('reports a missing shared source through notices, never through the hook stdout', async () => {
    const { fixture, store } = await configuredSkill();
    await store.update((config) => { config.shared[ID] = { source: join(fixture.root, 'gone'), team: 'team', baseline: 'sha256:0' }; });
    const io: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    const result = await run({ hook: true, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { notices: [expect.stringContaining('missing')] } });
    expect(io.lines).toEqual([]);
  });
});
