import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../search.js';
import { createConfigStore, ConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, originSha, person, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';

interface SearchSkill { name: string; description: string; category: string; author: string; id: string; }

describe('search (§6)', () => {
  it('matches category read-only and reports a stale clone', async () => {
    const { store } = await searchFixture('team', [{ name: 'sample', description: 'concise', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    const io = new ScriptedPrompter();
    const result = await run({ term: 'testing', config: store }, io);
    expect(result).toMatchObject({ ok: true });
    expect(io.lines.join('\n')).toContain('sample');
    expect(io.lines.join('\n')).toContain('may be stale');
  });

  it('leaves the clone and bare repository byte-identical without invoking a write path', async () => {
    const { fixture, store, clone } = await searchFixture('team', [{ name: 'sample', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await freshStamp(store, 'team');
    const head = (await git(['rev-parse', 'HEAD'], clone)).trim();
    const status = await git(['status', '--porcelain'], clone);
    const bare = await originSha(fixture.bare);
    expect((await run({ term: 'needle', config: store }, new ScriptedPrompter())).ok).toBe(true);
    expect((await git(['rev-parse', 'HEAD'], clone)).trim()).toBe(head);
    expect(await git(['status', '--porcelain'], clone)).toBe(status);
    expect(await originSha(fixture.bare)).toBe(bare);
  });

  it('ANDs category, author, and project filters so a partial match is excluded', async () => {
    const skills: SearchSkill[] = [
      { name: 'target', description: 'all filters', category: 'docs', author: 'Alice <alice@example.com>', id: '11111111-1111-4111-8111-111111111111' },
      { name: 'wrong-author', description: 'two filters', category: 'docs', author: 'Bob <bob@example.com>', id: '22222222-2222-4222-8222-222222222222' },
      { name: 'wrong-category', description: 'two filters', category: 'testing', author: 'Alice <alice@example.com>', id: '33333333-3333-4333-8333-333333333333' },
    ];
    const { store } = await searchFixture('team', skills, { product: skills.map((skill) => skill.id) });
    await freshStamp(store, 'team');
    const result = await run({ term: '', category: 'docs', author: 'alice', project: 'product', config: store }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'target' })] });
  });

  it('groups hits below their configured team headers when more than one team is searched', async () => {
    const first = await searchFixture('alpha', [{ name: 'alpha-skill', description: 'needle', category: 'docs', author: 'Alice <alice@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    const second = await searchFixture('beta', [{ name: 'beta-skill', description: 'needle', category: 'testing', author: 'Bob <bob@example.com>', id: '22222222-2222-4222-8222-222222222222' }], undefined, first.store);
    await freshStamp(first.store, 'alpha'); await freshStamp(first.store, 'beta');
    const io = new ScriptedPrompter();
    expect((await run({ term: 'needle', config: first.store }, io)).ok).toBe(true);
    expect(io.lines).toEqual(['alpha:', expect.stringContaining('alpha-skill'), 'beta:', expect.stringContaining('beta-skill')]);
    expect(second.clone).toBe(first.store.teamClone('beta'));
  });

  it('returns ok and prints exactly one line for zero hits', async () => {
    const { store } = await searchFixture('team', [{ name: 'sample', description: 'present', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await freshStamp(store, 'team');
    const io = new ScriptedPrompter();
    expect((await run({ term: 'missing', config: store }, io)).ok).toBe(true);
    expect(io.lines).toEqual(['No skills found.']);
  });

  it('omits the stale notice when its stamp is younger than one hour', async () => {
    const { store } = await searchFixture('team', [{ name: 'sample', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await freshStamp(store, 'team');
    const io = new ScriptedPrompter();
    expect((await run({ term: 'needle', config: store }, io)).ok).toBe(true);
    expect(io.lines.join('\n')).not.toContain('may be stale');
  });

  it('reports install count, endorsement, and the latest version, one hit per line in ls format', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { fixture, store, clone } = await searchFixture('team', [{ name: 'sample', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id }]);
    await pushFromSeed(fixture.seed, 'people/seed.json', `${JSON.stringify(person('seed', { installed: [{ id, version: null, scope: { kind: 'global' }, since: '2026-09-04' }] }), null, 2)}\n`);
    const teamJson = JSON.parse(await git(['show', 'main:team.json'], fixture.bare)); teamJson.global = [id];
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify(teamJson, null, 2)}\n`);
    await git(['fetch', '-q', 'origin'], clone); await git(['reset', '-q', '--hard', 'origin/main'], clone);
    await freshStamp(store, 'team');
    const io = new ScriptedPrompter();
    const result = await run({ term: 'needle', config: store }, io);
    const tree = (await git(['rev-parse', 'HEAD:skills/sample'], clone)).trim().slice(0, 8);
    expect(result).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'sample', installs: 1, endorsed: 'global', latest: tree })] });
    expect(io.lines).toEqual([`  sample — Seed <seed@example.com>; testing; 1 installs; ${tree}; global`]);
  });

  it('matches a skill name even when the term is absent from its description and category', async () => {
    const { store } = await searchFixture('team', [{ name: 'name-needle', description: 'plain description', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await freshStamp(store, 'team');
    expect(await run({ term: 'name-needle', config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'name-needle' })] });
  });

  it('matches a description even when the term is absent from the skill name and category', async () => {
    const { store } = await searchFixture('team', [{ name: 'sample', description: 'description needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await freshStamp(store, 'team');
    expect(await run({ term: 'description needle', config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'sample' })] });
  });

  it('skips and reports a malformed skill folder while returning healthy matches', async () => {
    const { store, clone } = await searchFixture('team', [{ name: 'healthy', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await mkdir(join(clone, 'skills', 'broken')); await writeFile(join(clone, 'skills', 'broken', 'README.md'), 'no skill frontmatter');
    const io = new ScriptedPrompter();
    expect(await run({ term: 'needle', config: store }, io)).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'healthy' })] });
    expect(io.lines.join('\n')).toContain('team/broken:');
  });

  it('continues after an unreadable team and fails only when every team is unreadable', async () => {
    const first = await searchFixture('healthy', [{ name: 'sample', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    const second = await searchFixture('broken', [], undefined, first.store);
    await rm(second.clone, { recursive: true, force: true });
    const io = new ScriptedPrompter();
    expect(await run({ term: 'needle', config: first.store }, io)).toMatchObject({ ok: true, value: [expect.objectContaining({ team: 'healthy' })] });
    expect(io.lines).toEqual(expect.arrayContaining(['broken:', 'broken is not cloned yet; run `terum-skills sync`.']));
    await rm(first.clone, { recursive: true, force: true });
    expect(await run({ term: 'needle', config: first.store }, new ScriptedPrompter())).toMatchObject({ ok: false });
  });
});

async function searchFixture(team: string, skills: SearchSkill[], projects?: Record<string, string[]>, store?: ConfigStore): Promise<{ fixture: Awaited<ReturnType<typeof bareTeam>>; store: ConfigStore; clone: string }> {
  const fixture = await bareTeam();
  const actualStore = store ?? createConfigStore(join(fixture.root, 'state'));
  for (const skill of skills) await pushFromSeed(fixture.seed, `skills/${skill.name}/SKILL.md`, skillFile(skill));
  if (projects) {
    const teamJson = JSON.parse(await git(['show', 'main:team.json'], fixture.bare));
    teamJson.projects = Object.fromEntries(Object.entries(projects).map(([name, ids]) => [name, { remotes: [], skills: ids }]));
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify(teamJson, null, 2)}\n`);
  }
  const clone = await cloneWithIdentity(fixture.bare, actualStore.teamClone(team));
  await actualStore.update((config) => { config.teams[team] = { remote: fixture.bare, handle: 'seed' }; });
  return { fixture, store: actualStore, clone };
}

function skillFile(skill: SearchSkill): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\nlicense: UNLICENSED\nmetadata:\n  id: ${skill.id}\n  author: ${skill.author}\n  terum-category: ${skill.category}\n---\n`;
}

async function freshStamp(store: ConfigStore, team: string): Promise<void> {
  await mkdir(join(store.root, 'run'), { recursive: true });
  await writeFile(join(store.root, 'run', `${team}.stamp`), new Date().toISOString());
}
