import { access, mkdir, readdir, readFile, rmdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { fsForTests as hookFs, installHook } from '../../lib/hook.js';
import { installWrapper } from '../../lib/wrapper.js';
import { place } from '../../lib/placer.js';
import { PromptClosedError } from '../../lib/prompt.js';
import { bareTeam, cloneWithIdentity, holdCloneLock, ScriptedPrompter, temporaryDirectory, wrapperFor } from '../../lib/__tests__/fixtures.js';
import { fsForTests, run } from '../uninstallMachine.js';

const complete = 'Machine cleanup complete. The package itself has not been removed; finish with the package manager that installed it.';
const membership = 'Your membership and installed-skill records in each team repo are unchanged. Rejoining does not re-place skills; `npx -y terum-skills@latest install member <handle>` does.';
const unrelated = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo unrelated' }] };

async function minimal() {
  const root = await temporaryDirectory(); const store = createConfigStore(join(root, 'state'));
  return { root, store, hook: { settingsFile: join(root, 'settings.json'), backupDir: join(store.root, 'backups') } };
}
async function prepared(names = ['team']) {
  const fixture = await bareTeam(); const store = createConfigStore(join(fixture.root, 'state'));
  const hook = { settingsFile: join(fixture.root, 'settings.json'), backupDir: join(store.root, 'backups') };
  const placements: string[] = [];
  const wrapper = wrapperFor(join(fixture.root, 'home')); await installWrapper(wrapper);
  for (const name of names) {
    await cloneWithIdentity(fixture.bare, store.teamClone(name));
    const source = join(fixture.root, `source-${name}`); await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: sample\n---\noriginal\n`);
    const placed = await place(source, join(fixture.root, 'home', '.claude', 'skills'), name); placements.push(placed.path);
    await store.update((c) => {
      c.teams[name] = { remote: fixture.bare, handle: 'seed' };
      c.placements[placed.path] = { id: '22222222-2222-4222-8222-222222222222', team: name, version: null, scope: { kind: 'global' }, placed_at: '2026-01-01', fingerprint: placed.snapshot.fingerprint };
    });
    await mkdir(join(store.root, 'cache', name), { recursive: true });
    await mkdir(join(store.root, 'run'), { recursive: true }); await writeFile(join(store.root, 'run', `${name}.stamp`), 'stamp');
  }
  return { fixture, store, hook, wrapper, placements };
}
async function gone(path: string) { await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' }); }

describe('machine uninstall', () => {
  it('cleans two teams and the hook, preserves unrelated settings and recovery records, and prints the manual step', async () => {
    const { store, hook, wrapper, placements } = await prepared(['team', 'other']);
    await writeFile(hook.settingsFile, JSON.stringify({ hooks: { SessionStart: [unrelated] } })); await installHook(hook);
    const wrapperDir = join(wrapper.skillsRoot, 'terum-skills');
    const before = await store.read(); const io = new ScriptedPrompter([], [true]);
    const launch = { kind: 'global' as const, path: '/opt/homebrew/lib/node_modules/terum-skills/dist/index.js' };
    const result = await run({ config: store, hook, wrapper, launch }, io);
    expect(result).toMatchObject({ ok: true, value: { teams: ['team', 'other'], removedPlacements: 2, hookRemoved: true, wrapperRemoved: true, configRemoved: true, launch } });
    if (!result.ok) throw new Error(result.error);
    for (const path of [...placements, store.teamClone('team'), store.teamClone('other'), ...['config.json', 'run', 'cache', 'teams'].map((x) => join(store.root, x))]) await gone(path);
    await gone(wrapperDir);
    expect(JSON.parse(await readFile(result.value.record, 'utf8'))).toEqual(before);
    expect((await stat(result.value.record)).mode & 0o777).toBe(0o600);
    expect((await readdir(hook.backupDir)).filter((name) => name.startsWith('settings.'))).toHaveLength(1);
    expect(JSON.parse(await readFile(hook.settingsFile, 'utf8'))).toEqual({ hooks: { SessionStart: [unrelated] } });
    await expect(access(store.root)).resolves.toBeUndefined();
    expect(io.lines).toContain(membership);
    expect(io.lines).toContain(`  /terum-skills Claude Code skill at ${wrapperDir}`);
    expect(io.lines).toContain(`Removed the /terum-skills Claude Code skill from ${wrapperDir}.`);
    expect(io.lines.slice(-3)).toEqual([complete, `This copy of terum-skills runs from ${launch.path}.`, 'If you installed it with npm: npm uninstall -g terum-skills   (pnpm: pnpm remove -g terum-skills · yarn: yarn global remove terum-skills · bun: bun remove -g terum-skills · Volta: volta uninstall terum-skills)']);
    expect(io.asked).toEqual(['Remove terum-skills from this machine?']);
  });

  it('leaves a terum-skills folder that is not the bundled skill alone, and says so', async () => {
    const { store, hook, wrapper } = await prepared(); const wrapperDir = join(wrapper.skillsRoot, 'terum-skills');
    const theirs = '---\nname: terum-skills\ndescription: someone else\'s skill under our name\n---\n'; await writeFile(join(wrapperDir, 'SKILL.md'), theirs);
    const io = new ScriptedPrompter([], [true]); const result = await run({ config: store, hook, wrapper }, io);
    expect(result).toMatchObject({ ok: true, value: { teams: ['team'], wrapperRemoved: false } });
    expect(await readFile(join(wrapperDir, 'SKILL.md'), 'utf8')).toBe(theirs);
    expect(io.lines).toContain(`  ${wrapperDir} is not the bundled /terum-skills Claude Code skill (it is a different skill); left alone`);
    expect(io.lines.join('\n')).not.toContain('Removed the /terum-skills');
  });

  it('reports no bundled skill when none was placed', async () => {
    const { store, hook } = await minimal(); const wrapper = wrapperFor(join(store.root, '..', 'home'));
    const io = new ScriptedPrompter([], [true]);
    expect(await run({ config: store, hook, wrapper }, io)).toMatchObject({ ok: true, value: { wrapperRemoved: false } });
    expect(io.lines).toContain(`  No /terum-skills Claude Code skill at ${join(wrapper.skillsRoot, 'terum-skills')}`);
  });

  it('leaves settings with no hook byte-identical and writes no settings backup', async () => {
    const { store, hook } = await prepared(); const source = '{ "theme": "dark" }'; await writeFile(hook.settingsFile, source);
    const io = new ScriptedPrompter([], [true]); expect((await run({ config: store, hook }, io)).ok).toBe(true);
    expect(await readFile(hook.settingsFile, 'utf8')).toBe(source);
    expect(io.lines).toContain(`  No session hook in ${hook.settingsFile}`);
    expect((await readdir(hook.backupDir)).filter((name) => name.startsWith('settings.'))).toEqual([]);
  });

  it('cancels without writing when declined or the prompt channel is closed', async () => {
    for (const confirms of [[false], []]) {
      const { store, hook, placements } = await prepared(); const before = await readFile(join(store.root, 'config.json'), 'utf8');
      const declined = confirms.length > 0;
      const error = declined ? 'Uninstall was cancelled.' : new PromptClosedError('Remove terum-skills from this machine?', 'closed').message;
      const result = await run({ config: store, hook }, new ScriptedPrompter([], confirms));
      expect(result).toEqual({ ok: false, error, ...(declined ? { cancelled: true } : {}) });
      await gone(hook.backupDir); await expect(access(store.teamClone('team'))).resolves.toBeUndefined(); await expect(access(placements[0]!)).resolves.toBeUndefined();
      expect(await readFile(join(store.root, 'config.json'), 'utf8')).toBe(before);
    }
  });

  it('preserves freshly quarantined edits and loose quarantine files', async () => {
    const { store, hook, placements } = await prepared(); const quarantine = join(store.root, 'quarantine');
    await mkdir(quarantine); await writeFile(join(quarantine, 'notes.txt'), 'keep notes'); await writeFile(join(placements[0]!, 'SKILL.md'), 'edited');
    const io = new ScriptedPrompter([], [true]); const result = await run({ config: store, hook }, io); expect(result.ok).toBe(true);
    expect(await readFile(join(quarantine, 'notes.txt'), 'utf8')).toBe('keep notes');
    const stamp = (await readdir(quarantine)).find((name) => name !== 'notes.txt')!;
    expect(await readFile(join(quarantine, stamp, 'team', 'SKILL.md'), 'utf8')).toBe('edited');
    expect(io.lines).toContain(`Kept ${quarantine} (2 items).`);
    if (result.ok) expect(result.value.kept).toContain(quarantine);
  });

  it.each([undefined, 'bare'] as const)('stops before tearing down remaining teams when an unconfirmed team appears (§1.8 exact loop) (form=%s)', async (form) => {
    const { fixture, store, hook } = await prepared();
    class JoiningPrompter extends ScriptedPrompter {
      override async confirm(question: string) {
        await cloneWithIdentity(fixture.bare, store.teamClone('late'));
        await store.update((c) => { c.teams.late = { remote: fixture.bare, handle: 'seed' }; });
        return super.confirm(question);
      }
    }
    const io = new JoiningPrompter([], [true]); const result = await run({ config: store, hook, form }, io);
    expect(result.ok ? '' : result.error).toContain(`${form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest'} uninstall`);
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Team late was added while uninstalling') });
    await expect(access(store.teamClone('late'))).resolves.toBeUndefined(); expect((await store.read()).teams.late).toBeDefined();
    expect(io.lines).toContain('Done: nothing'); expect(io.lines).toContain('Remaining: team, late, config.json');
    expect(io.lines).not.toContain(complete);
  });

  it('preserves an authoring source equal to a placement and rescues a dirty clone', async () => {
    const { store, hook, placements } = await prepared(); const path = placements[0]!;
    await store.update((c) => { c.shared.sample = { team: 'team', source: path }; });
    await writeFile(join(store.teamClone('team'), 'untracked.txt'), 'local work');
    const io = new ScriptedPrompter([], [true]); const result = await run({ config: store, hook }, io);
    expect(result.ok).toBe(true); await expect(access(path)).resolves.toBeUndefined(); expect((await store.read()).placements).toEqual({});
    expect(io.lines).toContain(`Connected-skill sources stay where they are: team: ${path}`);
    expect(io.lines).toContain(`${path} is also the authoring source of team; left in place.`);
    if (!result.ok) throw new Error(result.error);
    const destination = result.value.kept.find((item) => item.endsWith('teams-team'))!;
    expect(await readFile(join(destination, 'untracked.txt'), 'utf8')).toBe('local work');
    expect(io.lines).toContain(`Local clone ${store.teamClone('team')} has uncommitted or unpushed work; moved to ${destination}.`);
  });

  it('protects a source shared with one team that is a placement of another, whichever team goes first', async () => {
    const { store, hook, placements } = await prepared(['team', 'other']);
    // `team` is torn down first and its shared record with it; `other`'s placement at that path must still count as an authoring source.
    await store.update((c) => { c.shared.sample = { team: 'team', source: placements[1]! }; });
    const io = new ScriptedPrompter([], [true]); const result = await run({ config: store, hook }, io);
    expect(result.ok).toBe(true);
    await expect(access(join(placements[1]!, 'SKILL.md'))).resolves.toBeUndefined(); await gone(placements[0]!);
    expect((await store.read()).placements).toEqual({});
    expect(io.lines).toContain(`${placements[1]} is also the authoring source of other; left in place.`);
  });

  it('refuses malformed settings before confirming or creating a record', async () => {
    const { store, hook } = await prepared(); await writeFile(hook.settingsFile, '{');
    const io = new ScriptedPrompter([], [true]);
    expect(await run({ config: store, hook }, io)).toMatchObject({ ok: false, error: expect.stringContaining('nothing was removed') });
    expect(io.asked).toEqual([]); await gone(hook.backupDir); await expect(access(store.teamClone('team'))).resolves.toBeUndefined();
    expect((await store.read()).teams.team).toBeDefined();
  });

  it('stops after a hook write failure without tearing down teams', async () => {
    const { store, hook } = await prepared(); await installHook(hook); const before = await readFile(hook.settingsFile, 'utf8');
    const rename = hookFs.rename; hookFs.rename = async () => { throw new Error('hook write refused'); };
    try {
      const io = new ScriptedPrompter([], [true]);
      expect(await run({ config: store, hook }, io)).toMatchObject({ ok: false, error: 'hook write refused; the hook was left in place and nothing else was removed' });
      expect(io.lines).not.toContain(complete);
    } finally { hookFs.rename = rename; }
    expect(await readFile(hook.settingsFile, 'utf8')).toBe(before); await expect(access(store.teamClone('team'))).resolves.toBeUndefined();
  });

  it.each([undefined, 'bare'] as const)('reports completed and remaining teams on clone-lock refusal, then completes on retry (form=%s)', async (form) => {
    const { store, hook, placements } = await prepared(['a', 'b']); const release = await holdCloneLock(store.teamClone('b'));
    try {
      const result = await run({ config: store, hook, form }, new ScriptedPrompter([], [true]));
      expect(result.ok ? '' : result.error).toContain(`${form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest'} uninstall`);
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Done: a\nRemaining: b, config.json') });
      await gone(store.teamClone('a')); for (const path of placements) await gone(path);
      await expect(access(store.teamClone('b'))).resolves.toBeUndefined(); expect((await store.read()).teams.b).toBeDefined();
    } finally { await release(); }
    expect((await run({ config: store, hook, form }, new ScriptedPrompter([], [true]))).ok).toBe(true);
  });

  it.each([undefined, 'bare'] as const)('reports EBUSY and still attempts the remaining empty-directory removals (form=%s)', async (form) => {
    const { store, hook } = await prepared(); const original = fsForTests.rmdir;
    fsForTests.rmdir = async (path) => { if (path === join(store.root, 'run')) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return rmdir(path); };
    try {
      const io = new ScriptedPrompter([], [true]);
      const result = await run({ config: store, hook, form }, io);
      expect(result.ok ? '' : result.error).toContain(`${form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest'} uninstall`);
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`Could not remove ${join(store.root, 'run')}: busy`) });
      expect(io.lines).toContain(`Kept ${join(store.root, 'run')}: busy`); expect(io.lines).not.toContain(complete);
      await gone(join(store.root, 'cache')); await gone(join(store.root, 'teams'));
    } finally { fsForTests.rmdir = original; }
  });

  it('removes a hook with zero teams even when config is already absent', async () => {
    const { store, hook } = await minimal(); await installHook(hook);
    const io = new ScriptedPrompter([], [true]);
    expect(await run({ config: store, hook }, io)).toMatchObject({ ok: true, value: { teams: [], hookRemoved: true, configRemoved: false, launch: null } });
    await gone(join(store.root, 'config.json')); expect(JSON.parse(await readFile(hook.settingsFile, 'utf8'))).toEqual({});
    expect(io.lines.slice(-2)).toEqual(['This copy of terum-skills runs from an unknown location.', 'Remove it with whatever put it there.']);
  });

  it.each([undefined, 'bare'] as const)('keeps config when orphaned shared state remains (form=%s)', async (form) => {
    const { root, store, hook } = await minimal(); const source = join(root, 'source'); await mkdir(source);
    await store.update((c) => { c.shared.sample = { source, team: 'gone' }; });
    const io = new ScriptedPrompter([], [true]);
    const result = await run({ config: store, hook, form }, io);
      expect(result.ok ? '' : result.error).toContain(`${form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest'} uninstall`);
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('still configured — connected: 1') });
    await expect(access(source)).resolves.toBeUndefined(); expect((await store.read()).shared.sample).toBeDefined(); expect(io.lines).not.toContain(complete);
  });
});


it('keeps local uninstall advice with the entry-based launch shape', async () => {
  const { store, hook } = await minimal(); const io = new ScriptedPrompter([], [true]);
  const launch = { kind: 'local' as const, path: '/work/app/node_modules/terum-skills/dist/index.js', root: '/work/app', dependencyKind: 'devDependencies' as const };
  expect(await run({ config: store, hook, launch }, io)).toMatchObject({ ok: true, value: { launch } });
  expect(io.lines.slice(-2)).toEqual([`This copy of terum-skills runs from ${launch.path}.`, 'It is a dependency of /work/app: run npm uninstall terum-skills there, or remove it from that package.json.']);
});

it.each([false, true])('discloses the app and evals before consent, removing only the app when accepted=%s', async accepted => {
  const { root, store, hook } = await minimal();
  const bundle = join(store.root, 'app', '0.1.6', 'Terum.app', 'Contents', 'MacOS');
  const evals = join(store.root, 'evals');
  await mkdir(bundle, { recursive: true }); await writeFile(join(bundle, 'terum'), 'bundle');
  await mkdir(evals); await writeFile(join(evals, 'transcript.json'), 'retained');
  const io = new ScriptedPrompter();
  io.confirm = async () => {
    expect(io.lines).toContain(`  Downloaded desktop app bundle at ${join(store.root, 'app')} (all versions)`);
    expect(io.lines.find(line => line.startsWith('Kept:'))).toContain(`${evals} (eval runs and transcripts)`);
    expect(await readFile(join(bundle, 'terum'), 'utf8')).toBe('bundle');
    return accepted;
  };
  const result = await run({ config: store, hook, wrapper: wrapperFor(join(root, 'home')) }, io);
  expect(result.ok).toBe(accepted);
  expect(await readFile(join(evals, 'transcript.json'), 'utf8')).toBe('retained');
  if (accepted) {
    await gone(join(store.root, 'app'));
    expect(result.ok && result.value.kept).toContain(evals);
  } else expect(await readFile(join(bundle, 'terum'), 'utf8')).toBe('bundle');
});


it('removes a config whose only remaining content is the machine checkout registry', async () => {
  const { root, store, hook } = await minimal();
  await store.update(c => { c.checkouts = [join(root, 'checkout')]; });
  const result = await run({ config: store, hook, wrapper: wrapperFor(join(root, 'home')) }, new ScriptedPrompter([], [true]));
  expect(result).toMatchObject({ ok: true, value: { configRemoved: true } });
  await gone(join(store.root, 'config.json'));
});
