import { access, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';
import { refreshClone } from '../../lib/teamRepo.js';
import { run, type AdoptStage } from '../install.js';

const ID = '81818181-8181-4181-8181-818181818181';

function skill(name = 'sample', description = 'sample skill', allowedTools = ''): string {
  return `---\nname: ${name}\ndescription: ${description}\nlicense: UNLICENSED\n${allowedTools}metadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nBody\n`;
}

async function adoptFixture(options: { project?: boolean; allowedTools?: string } = {}) {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill('sample', 'sample skill', options.allowedTools ?? ''));
  const home = join(fixture.root, 'home');
  const store = createConfigStore(join(home, '.terum', 'skills'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  const projectRoot = join(fixture.root, 'work');
  const path = options.project ? join(projectRoot, '.claude', 'skills', 'sample') : join(home, '.claude', 'skills', 'sample');
  await mkdir(dirname(path), { recursive: true });
  await cp(join(clone, 'skills', 'sample', 'v1'), path, { recursive: true });
  await store.update(config => {
    config.teams.team = { remote: fixture.bare, handle: 'seed' };
    if (options.project) config.projects = [{ root: projectRoot, label: 'work' }];
  });
  return { ...fixture, home, store, clone, projectRoot, path };
}

async function installedRows(clone: string) {
  return (JSON.parse(await readFile(join(clone, 'people', 'seed.json'), 'utf8')) as { installed: unknown[] }).installed;
}

describe('install --adopt grammar and preconditions', () => {
  it('refuses both a selector and adopt, neither, and a destination with adopt using the exact grammar lines', async () => {
    const fixture = await adoptFixture();
    const io = new ScriptedPrompter();
    expect(await run({ ref: 'sample', adopt: fixture.path, config: fixture.store, home: fixture.home }, io))
      .toMatchObject({ ok: false, error: 'Give a skill to install or --adopt <path>, not both.' });
    expect(await run({ config: fixture.store, home: fixture.home }, io))
      .toMatchObject({ ok: false, error: 'Nothing to install: give a skill, or --adopt <path> for a folder you already have.' });
    expect(await run({ adopt: fixture.path, into: 'global', config: fixture.store, home: fixture.home }, io))
      .toMatchObject({ ok: false, error: '--adopt records a folder where it is; it takes no destination.' });
  });

  it('refuses a folder outside the Library and a nested folder', async () => {
    const fixture = await adoptFixture();
    expect(await run({ adopt: 'sample', cwd: fixture.root, config: fixture.store, home: fixture.home }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: 'sample is not a folder in your Library.' });
    const outside = join(fixture.root, 'outside', 'sample');
    await mkdir(dirname(outside), { recursive: true });
    await cp(join(fixture.clone, 'skills', 'sample', 'v1'), outside, { recursive: true });
    expect(await run({ adopt: outside, config: fixture.store, home: fixture.home }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: `${outside} is not a folder in your Library.` });
    const nested = join(fixture.path, 'nested');
    await mkdir(nested);
    await writeFile(join(nested, 'SKILL.md'), skill('nested'));
    expect(await run({ adopt: nested, config: fixture.store, home: fixture.home }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: `${nested} is not a folder in your Library.` });
  });

  it('refuses differing bytes, renamed identical bytes and a recorded folder; several identical versions resolve by folder name, newest first', async () => {
    const differing = await adoptFixture();
    await writeFile(join(differing.path, 'SKILL.md'), skill('sample', 'locally changed'));
    expect(await run({ adopt: differing.path, config: differing.store, home: differing.home }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: `${differing.path} does not match any published version of a team skill byte for byte; publish it instead.` });

    const renamed = await adoptFixture();
    const renamedPath = join(renamed.home, '.claude', 'skills', 'renamed');
    await cp(renamed.path, renamedPath, { recursive: true });
    expect(await run({ adopt: renamedPath, config: renamed.store, home: renamed.home }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: `${renamedPath} holds the bytes of sample Version 1 under a different folder name; rename it to sample first.` });

    const ambiguous = await adoptFixture();
    await pushFromSeed(ambiguous.seed, 'skills/sample/v2/SKILL.md', skill());
    await refreshClone(systemRunner, ambiguous.clone, { label: 'team' });
    expect(await run({ adopt: ambiguous.path, config: ambiguous.store, home: ambiguous.home }, new ScriptedPrompter()))
      .toMatchObject({ ok: true, value: { version: 'v2', adopted: true } });

    const recorded = await adoptFixture();
    expect((await run({ adopt: recorded.path, config: recorded.store, home: recorded.home }, new ScriptedPrompter())).ok).toBe(true);
    expect(await run({ adopt: recorded.path, config: recorded.store, home: recorded.home }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: `${recorded.path} is already recorded as installed.` });
  });

  it('runs the ordinary allowed-tools consent predicate before recording', async () => {
    const fixture = await adoptFixture({ allowedTools: 'allowed-tools: Bash(*)\n' });
    const declined = new ScriptedPrompter([], [false], true);
    expect(await run({ adopt: fixture.path, config: fixture.store, home: fixture.home }, declined))
      .toMatchObject({ ok: false, cancelled: true, error: 'Consent was declined for sample.' });
    expect((await fixture.store.read()).placements).toEqual({});
    const accepted = new ScriptedPrompter([], [true], true);
    expect((await run({ adopt: fixture.path, config: fixture.store, home: fixture.home }, accepted)).ok).toBe(true);
    expect(accepted.asked).toEqual(['Approve these tools for sample?']);
  });
});

describe('install --adopt effects and recovery order', () => {
  // `scope` names a TEAM project, never the Library root — `install <ref> --into <checkout>` records `global` too; the
  // root the folder sits in is the pending note's destination (spec §4.5, code-wins rule).
  it.each([
    { project: false, scope: { kind: 'global' } },
    { project: true, scope: { kind: 'global' } },
  ] as const)('records a folder under a $project project root with global scope, copying or moving nothing', async ({ project, scope }) => {
    const fixture = await adoptFixture({ project });
    const before = await stat(fixture.path);
    const bytes = await readFile(join(fixture.path, 'SKILL.md'), 'utf8');
    const stages: AdoptStage[] = [];
    const result = await run({ adopt: fixture.path, config: fixture.store, home: fixture.home, afterAdoptStage: stage => { stages.push(stage); } }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { id: ID, team: 'team', path: fixture.path, version: 'v1', profiled: false, adopted: true } });
    expect(stages).toEqual(['consent', 'pending', 'people', 'ledger', 'cleared']);
    expect(await readFile(join(fixture.path, 'SKILL.md'), 'utf8')).toBe(bytes);
    expect((await stat(fixture.path)).mtimeMs).toBe(before.mtimeMs);
    await expect(access(join(project ? fixture.projectRoot : fixture.home, '.claude', 'old-skills'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Object.values((await fixture.store.read()).placements)).toEqual([expect.objectContaining({ id: ID, team: 'team', version: 'v1', scope })]);
    expect(await installedRows(fixture.clone)).toEqual([expect.objectContaining({ id: ID, version: 'v1', scope })]);
  });

  it.each<AdoptStage>(['consent', 'pending', 'people', 'ledger', 'cleared'])('replays cleanly after interruption at %s', async stage => {
    const fixture = await adoptFixture();
    const interrupted = await run({
      adopt: fixture.path,
      config: fixture.store,
      home: fixture.home,
      afterAdoptStage: reached => { if (reached === stage) throw new Error(`killed after ${stage}`); },
    }, new ScriptedPrompter());
    expect(interrupted).toMatchObject({ ok: false, error: `killed after ${stage}` });

    const afterInterruption = await fixture.store.read();
    expect(afterInterruption.pending).toHaveLength(['pending', 'people', 'ledger'].includes(stage) ? 1 : 0);
    expect(Object.keys(afterInterruption.placements)).toHaveLength(['ledger', 'cleared'].includes(stage) ? 1 : 0);
    expect(await installedRows(fixture.clone)).toHaveLength(['people', 'ledger', 'cleared'].includes(stage) ? 1 : 0);

    // Review walk D5: once the ledger row exists the job is finished — the re-run drains the leftover note and REFUSES;
    // it never returns a second success (the rejected "resumable adopt").
    const replay = await run({ adopt: fixture.path, config: fixture.store, home: fixture.home }, new ScriptedPrompter());
    if (stage === 'ledger' || stage === 'cleared') expect(replay).toMatchObject({ ok: false, error: `${fixture.path} is already recorded as installed.` });
    else expect(replay).toMatchObject({ ok: true, value: { adopted: true } });

    const final = await fixture.store.read();
    expect(final.pending).toEqual([]);
    expect(Object.entries(final.placements)).toEqual([[fixture.path, expect.objectContaining({ id: ID, team: 'team', version: 'v1' })]]);
    expect(await installedRows(fixture.clone)).toEqual([expect.objectContaining({ id: ID, version: 'v1' })]);
  });

  it('drains a note left by a placing install that died before its people-file write, then still refuses', async () => {
    const fixture = await adoptFixture();
    // `install` writes the ledger first and the people file second; a crash between them leaves this exact state.
    await fixture.store.update(config => {
      config.placements[fixture.path] = { id: ID, team: 'team', version: 'v1', scope: { kind: 'global' }, placed_at: '2026-09-14', fingerprint: 'placed' };
      config.pending.push({ op: 'install', id: ID, team: 'team', scope: { kind: 'global' }, destination: { kind: 'global' }, version: 'v1', started: '2026-09-14T00:00:00Z' } as (typeof config.pending)[number]);
    });
    expect(await installedRows(fixture.clone)).toEqual([]);
    expect(await run({ adopt: fixture.path, config: fixture.store, home: fixture.home }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: `${fixture.path} is already recorded as installed.` });
    const after = await fixture.store.read();
    expect(after.pending).toEqual([]);
    expect(Object.keys(after.placements)).toEqual([fixture.path]);
    expect(await installedRows(fixture.clone)).toEqual([expect.objectContaining({ id: ID, version: 'v1', scope: { kind: 'global' } })]);
  });
});
