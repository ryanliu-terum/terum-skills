import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../search.js';
import { createConfigStore, ConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, originSha, person, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { Runner } from '../../lib/runner.js';

interface SearchSkill { name: string; description: string; category: string; author: string; id: string; }

describe('search (§6)', () => {
  it('matches category read-only and reports a stale clone', async () => {
    const { store } = await searchFixture('team', [{ name: 'sample', description: 'concise', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    const io = new ScriptedPrompter();
    const result = await run({ term: 'testing', config: store }, io);
    expect(result).toMatchObject({ ok: true });
    expect(io.lines.join('\n')).toContain('sample');
    expect(io.lines.join('\n')).toContain('may be stale; run `npx -y terum-skills@latest sync`.');
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

  it('omits the stale notice when its stamp is younger than one hour, and prints it for a stamp dated in the future (the same rule the hook applies)', async () => {
    const { store } = await searchFixture('team', [{ name: 'sample', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await freshStamp(store, 'team');
    const io = new ScriptedPrompter();
    expect((await run({ term: 'needle', config: store }, io)).ok).toBe(true);
    expect(io.lines.join('\n')).not.toContain('may be stale');
    // A clock stepped back a day: the stamp claims a sync that has not happened yet, and the notice must not go quiet.
    const backwards = new ScriptedPrompter();
    expect((await run({ term: 'needle', config: store, now: () => Date.now() - 24 * 3_600_000 }, backwards)).ok).toBe(true);
    expect(backwards.lines.join('\n')).toContain('may be stale');
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

  it('a skill folder present on disk but not in HEAD costs one row and one reported line, never the team\'s other hits', async () => {
    const { store, clone } = await searchFixture('team', [{ name: 'healthy', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    // A safeWrite that lost its clone lock skips its cleanup, and `reset --hard` never removes an untracked folder.
    await mkdir(join(clone, 'skills', 'ghost')); await writeFile(join(clone, 'skills', 'ghost', 'SKILL.md'), skillFile({ name: 'ghost', description: 'needle too', category: 'testing', author: 'Seed <seed@example.com>', id: '33333333-3333-4333-8333-333333333333' }));
    await freshStamp(store, 'team');
    const io = new ScriptedPrompter();
    const tree = (await git(['rev-parse', 'HEAD:skills/healthy'], clone)).trim().slice(0, 8);
    // Both halves of the title are counts, so both are pinned exactly: two rows in filter order
    // (`ghost` sorts first) and one report line. An extra or duplicated row, a report printed per
    // skill, or a dropped `formatSkill` row for the degraded hit has to fail here.
    expect(await run({ term: 'needle', config: store }, io)).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'ghost', latest: '—', unresolved: true }), expect.objectContaining({ name: 'healthy', latest: tree, unresolved: false })] });
    expect(io.lines).toEqual([expect.stringContaining('team/ghost: Could not resolve the latest version of ghost'), '  ghost — Seed <seed@example.com>; testing; 0 installs; —; —', `  healthy — Seed <seed@example.com>; testing; 0 installs; ${tree}; —`]);
  });

  it('fails instead of returning a page of dashes when no team could resolve any hit', async () => {
    const { store, clone } = await searchFixture('team', [{ name: 'healthy', description: 'plain description', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await mkdir(join(clone, 'skills', 'ghost')); await writeFile(join(clone, 'skills', 'ghost', 'SKILL.md'), skillFile({ name: 'ghost', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '33333333-3333-4333-8333-333333333333' }));
    // The only match is the folder git cannot resolve, so the team resolved nothing at all: a
    // script gating on the exit code must not read that as a clean search.
    expect(await run({ term: 'needle', config: store }, new ScriptedPrompter())).toMatchObject({ ok: false });
  });

  it('resolves hits eight at a time and keeps every row aligned with its own skill across the slice boundary', async () => {
    const { store, clone } = await searchFixture('team', []);
    // Ten untracked folders and a fake git: the match list is two slices (skill-01…skill-08, then
    // skill-09 and skill-10) with no pushes. Every name is eight characters, so a hit's shortHash IS
    // its name when the fake answers each rev-parse with that name padded to a 40-character hash —
    // a row reading another skill's hash across the slice boundary cannot pass.
    const names = Array.from({ length: 10 }, (_, index) => `skill-${String(index + 1).padStart(2, '0')}`);
    for (const [index, name] of names.entries()) {
      await mkdir(join(clone, 'skills', name));
      await writeFile(join(clone, 'skills', name, 'SKILL.md'), skillFile({ name, description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: `${(index + 1).toString(16).repeat(8)}-1111-4111-8111-111111111111` }));
    }
    await freshStamp(store, 'team');
    let inFlight = 0; let peak = 0;
    const fake: Runner = {
      async run(command, args) {
        inFlight++; peak = Math.max(peak, inFlight);
        try {
          await new Promise((done) => setImmediate(done));
          const name = command === 'git' && args[0] === 'rev-parse' ? String(args[1]).replace('HEAD:skills/', '') : '';
          if (name === 'skill-09') return { code: 1, stdout: '', stderr: 'not in HEAD' };
          return { code: 0, stdout: `${name}${'0'.repeat(32)}\n`, stderr: '' };
        } finally { inFlight--; }
      },
    };
    const io = new ScriptedPrompter();
    expect(await run({ term: 'needle', config: store, runner: fake }, io)).toMatchObject({ ok: true, value: names.map((name) => expect.objectContaining({ name, latest: name === 'skill-09' ? '—' : name })) });
    expect(io.lines.filter((line) => line.startsWith('team/'))).toEqual(['team/skill-09: Could not resolve the latest version of skill-09: not in HEAD']);
    // The only assertion an unbounded Promise.all fails: ten would be in flight at once.
    expect(peak).toBe(8);
  });

  it('skips and reports a malformed skill folder while returning healthy matches', async () => {
    const { store, clone } = await searchFixture('team', [{ name: 'healthy', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await mkdir(join(clone, 'skills', 'broken')); await writeFile(join(clone, 'skills', 'broken', 'README.md'), 'no skill frontmatter');
    const io = new ScriptedPrompter();
    expect(await run({ term: 'needle', config: store }, io)).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'healthy' })] });
    expect(io.lines.join('\n')).toContain('team/broken:');
  });

  it('reports one malformed member file and still returns the team\'s matches, counting installs from the files that parse', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { store, clone } = await searchFixture('team', [{ name: 'healthy', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id }]);
    await freshStamp(store, 'team');
    // The surviving member must own an install of the match, or `installs` would read 0 whether the
    // roster skipped one file or was discarded whole — and the test could not tell those apart.
    await writeFile(join(clone, 'people', 'seed.json'), `${JSON.stringify(person('seed', { installed: [{ id, version: null, scope: { kind: 'global' }, since: '2026-09-04' }] }), null, 2)}\n`);
    await writeFile(join(clone, 'people', 'broken.json'), '{ "handle": "broken" }');
    const io = new ScriptedPrompter();
    expect(await run({ term: 'needle', config: store }, io)).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'healthy', installs: 1 })] });
    expect(io.lines.join('\n')).toContain('team/people/broken.json: Invalid people/broken.json');
  });

  it('does not take an inherited object key for a project filter', async () => {
    const { store } = await searchFixture('team', [{ name: 'sample', description: 'needle', category: 'testing', author: 'Seed <seed@example.com>', id: '11111111-1111-4111-8111-111111111111' }]);
    await freshStamp(store, 'team');
    const io = new ScriptedPrompter();
    expect(await run({ term: 'needle', project: 'constructor', config: store }, io)).toMatchObject({ ok: true, value: [] });
    expect(io.lines).toEqual(['No skills found.']);
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
