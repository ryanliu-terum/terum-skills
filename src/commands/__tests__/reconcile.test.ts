import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { CancelledError, success } from '../../lib/result.js';
import { bareTeam, cloneWithIdentity, git, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../reconcile.js';

const IDS = {
  a: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  b: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  c: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  d: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  e: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
} as const;

function managedSkill(name: string, id: string, description: string, author = 'Seed <seed@example.com>'): string {
  return `---\nname: ${name}\ndescription: ${description}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: ${author}\n  terum-category: testing\n---\n${description}\n`;
}

function localSkill(name: string, description: string, id?: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n${id ? `metadata:\n  id: ${id}\n` : ''}---\n${description}\n`;
}

async function copyVersion(clone: string, home: string, teamName: string, version: string, localName = teamName): Promise<string> {
  const target = join(home, '.claude', 'skills', localName);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(clone, 'skills', teamName, version), target, { recursive: true });
  return target;
}

async function classificationFixture() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/a/v4/SKILL.md', managedSkill('a', IDS.a, 'exact a'));
  await pushFromSeed(fixture.seed, 'skills/b/v2/SKILL.md', managedSkill('b', IDS.b, 'team b'));
  await pushFromSeed(fixture.seed, 'skills/c/v5/SKILL.md', managedSkill('c', IDS.c, 'team c', 'Outside Author <outside@example.com>'));
  await pushFromSeed(fixture.seed, 'skills/d/v3/SKILL.md', managedSkill('d', IDS.d, 'renamed d'));
  await pushFromSeed(fixture.seed, 'skills/e/v1/SKILL.md', managedSkill('e', IDS.e, 'ledgered e'));
  const home = join(fixture.root, 'home');
  const store = createConfigStore(join(home, '.terum', 'skills'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  const exact = await copyVersion(clone, home, 'a', 'v4');
  const differingSameId = join(home, '.claude', 'skills', 'b');
  const differingByName = join(home, '.claude', 'skills', 'c');
  await mkdir(differingSameId, { recursive: true });
  await mkdir(differingByName, { recursive: true });
  await writeFile(join(differingSameId, 'SKILL.md'), localSkill('b', 'local b', IDS.b));
  await writeFile(join(differingByName, 'SKILL.md'), localSkill('c', 'local c'));
  const renamed = await copyVersion(clone, home, 'd', 'v3', 'alias');
  const ledgered = await copyVersion(clone, home, 'e', 'v1');
  const unrelated = join(home, '.claude', 'skills', 'unrelated');
  await mkdir(unrelated, { recursive: true });
  await writeFile(join(unrelated, 'SKILL.md'), localSkill('unrelated', 'not on team'));
  await store.update(config => {
    config.teams.team = { remote: fixture.bare, handle: 'seed' };
    config.placements[ledgered] = { id: IDS.e, team: 'team', version: 'v1', scope: { kind: 'global' }, placed_at: '2026-09-13', fingerprint: 'recorded' };
  });
  return { ...fixture, home, store, clone, exact, differingSameId, differingByName, renamed, ledgered, unrelated };
}

async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(path: string, relative = ''): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const next = join(path, entry.name);
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(next, key);
      else if (entry.isFile()) files[key] = (await readFile(next)).toString('base64');
    }
  }
  await walk(root);
  return files;
}

describe('reconcile classification and dialogue', () => {
  it('--list classifies identical, same-id/name-only differing, renamed, and ledgered-skip without writes', async () => {
    const fixture = await classificationFixture();
    const configPath = join(fixture.store.root, 'config.json');
    const beforeConfig = await readFile(configPath, 'utf8');
    const beforeClone = await snapshotFiles(fixture.clone);
    const beforeHead = await git(['rev-parse', 'HEAD'], fixture.clone);
    const io = new ScriptedPrompter();
    const result = await run({ list: true, config: fixture.store, home: fixture.home }, io);

    expect(result).toMatchObject({ ok: true, value: {
      identical: [{ path: fixture.exact, name: 'a', team: 'team', skillId: IDS.a, version: 'v4' }],
      differing: [
        { path: fixture.differingSameId, name: 'b', team: 'team', skillId: IDS.b, teamVersion: 'v2', nextVersion: 'v3', sameId: true, teamAuthor: 'seed' },
        { path: fixture.differingByName, name: 'c', team: 'team', skillId: null, teamVersion: 'v5', nextVersion: 'v6', sameId: false, teamAuthor: 'Outside Author <outside@example.com>' },
      ],
      renamed: [{ path: fixture.renamed, name: 'alias', team: 'team', skillId: IDS.d, version: 'v3', teamName: 'd' }],
      adopted: [],
      published: [],
    } });
    expect(result.ok && result.value.identical.some(row => row.path === fixture.ledgered)).toBe(false);
    expect(result.ok && result.value.differing.some(row => row.path === fixture.unrelated)).toBe(false);
    expect(io.asked).toEqual([]);
    expect(io.lines.slice(0, 3)).toEqual([
      'Checking your library against the team…',
      "1 of your skills match the team's exactly; 2 share a name with a team skill but differ.",
      `${fixture.renamed} holds the bytes of d Version 3 under a different folder name; nothing is offered for it.`,
    ]);
    // A terminal reader sees only what is printed: list mode names every row with its version and path.
    expect([...io.lines.slice(3)].sort()).toEqual([
      `  a — matches Version 4 (${fixture.exact})`,
      `  b — differs from the team's Version 2 (${fixture.differingSameId})`,
      `  c — differs from the team's Version 5 (${fixture.differingByName})`,
    ].sort());
    expect(await readFile(configPath, 'utf8')).toBe(beforeConfig);
    expect(await snapshotFiles(fixture.clone)).toEqual(beforeClone);
    expect(await git(['rev-parse', 'HEAD'], fixture.clone)).toBe(beforeHead);
    expect(await git(['status', '--porcelain'], fixture.clone)).toBe('');
  });

  it('asks once per offered row and routes yes to adopt/publish while no writes nothing', async () => {
    const fixture = await classificationFixture();
    const install = vi.fn(async (input: { team: string; adopt: string }) => ({ id: IDS.a, team: input.team, path: input.adopt, version: 'v4', profiled: false, adopted: true as const }));
    const publish = vi.fn(async () => success({ team: 'team', id: IDS.b, name: 'b', project: 'Global', version: 'v3', created: false, identicalTo: null, attachedEvals: 0, evalAssets: 0, profileAdded: false, projectAdded: false }));
    const io = new ScriptedPrompter([], [true, true, false], true);
    const acted = await run({ config: fixture.store, home: fixture.home, verbs: { install: install as never, publish: publish as never } }, io);
    expect(acted).toMatchObject({ ok: true, value: { adopted: [fixture.exact], published: [fixture.differingSameId] } });
    expect(install).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ team: 'team', adopt: fixture.exact, store: fixture.store }), io);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ team: 'team', ref: fixture.differingSameId, config: fixture.store }), io);
    expect(io.asked).toEqual([
      'Record a as installed (Version 4)?',
      "Publish your version of b as Version 3 of the team's b? Your folder carries the team's id for b.",
      `Publish your version of c as Version 6 of the team's c? Your folder carries no team id for this name, and the team's copy was published by Outside Author <outside@example.com>; publishing makes your content the next version of their skill. To keep them separate, rename yours first: npx -y terum-skills@latest skill rename '${fixture.differingByName}' --to <new-name>.`,
    ]);
    expect(io.lines.at(-1)).toBe('Recorded 1 install. Published 1 skill.');

    install.mockClear(); publish.mockClear();
    const declined = await run({ config: fixture.store, home: fixture.home, verbs: { install: install as never, publish: publish as never } }, new ScriptedPrompter([], [false, false, false], true));
    expect(declined).toMatchObject({ ok: true, value: { adopted: [], published: [] } });
    expect(install).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps offering the remaining rows when one adopt is declined at consent or one publish refuses', async () => {
    const fixture = await classificationFixture();
    const install = vi.fn(async () => { throw new CancelledError('Consent was declined for a.'); });
    const publish = vi.fn(async (input: { ref: string }) => input.ref === fixture.differingSameId
      ? success({ team: 'team', id: IDS.b, name: 'b', project: 'Global', version: 'v3', created: false, identicalTo: null, attachedEvals: 0, evalAssets: 0, profileAdded: false, projectAdded: false })
      : { ok: false as const, error: 'c is not a usable skill folder.', refused: true as const });
    const io = new ScriptedPrompter([], [true, true, true], true);
    const result = await run({ config: fixture.store, home: fixture.home, verbs: { install: install as never, publish: publish as never } }, io);
    expect(result).toMatchObject({ ok: true, value: { adopted: [], published: [fixture.differingSameId] } });
    expect(io.asked).toHaveLength(3);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(io.lines).toContain('Consent was declined for a.');
    expect(io.lines).toContain('c is not a usable skill folder.');
    expect(io.lines.at(-1)).toBe('Recorded 0 installs. Published 1 skill.');
  });

  it('admits a name-mismatch folder only for the renamed group, never as a publish candidate', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/f/v1/SKILL.md', managedSkill('f', IDS.a, 'team f'));
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(home, '.terum', 'skills'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const folder = join(home, '.claude', 'skills', 'f');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'SKILL.md'), localSkill('g', 'frontmatter renamed, bytes differ'));
    await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    expect(await run({ list: true, config: store, home }, io)).toMatchObject({ ok: true, value: { identical: [], differing: [], renamed: [] } });
    expect(io.lines).toContain('Nothing to reconcile: none of your skills match a team skill by bytes or by name.');
  });

  it('prints the exact empty summary when nothing ties a Library folder to the team', async () => {
    const fixture = await classificationFixture();
    await fixture.store.update(config => {
      for (const path of [fixture.exact, fixture.differingSameId, fixture.differingByName, fixture.renamed]) {
        config.placements[path] = { id: IDS.a, team: 'team', version: null, scope: { kind: 'global' }, placed_at: '2026-09-13', fingerprint: 'skip' };
      }
    });
    const io = new ScriptedPrompter();
    expect(await run({ list: true, config: fixture.store, home: fixture.home }, io)).toMatchObject({ ok: true, value: { identical: [], differing: [], renamed: [] } });
    expect(io.lines).toEqual(['Checking your library against the team…', 'Nothing to reconcile: none of your skills match a team skill by bytes or by name.']);
  });
});

describe('reconcile in-process root boundary', () => {
  it('includes only the registered requested project and refuses a non-registered root', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/a/v1/SKILL.md', managedSkill('a', IDS.a, 'root exact'));
    const home = join(fixture.root, 'home');
    const store = createConfigStore(join(home, '.terum', 'skills'));
    const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    const first = join(fixture.root, 'first');
    const second = join(fixture.root, 'second');
    const unregistered = join(fixture.root, 'unregistered');
    for (const root of [first, second, unregistered]) {
      const target = join(root, '.claude', 'skills', 'a');
      await mkdir(dirname(target), { recursive: true });
      await cp(join(clone, 'skills', 'a', 'v1'), target, { recursive: true });
    }
    await copyVersion(clone, home, 'a', 'v1');
    await store.update(config => {
      config.teams.team = { remote: fixture.bare, handle: 'seed' };
      config.projects = [{ root: first, label: 'first' }, { root: second, label: 'second' }];
    });

    const result = await run({ list: true, root: first, config: store, home }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { identical: [{ path: join(first, '.claude', 'skills', 'a') }] } });
    expect(result.ok && result.value.identical).toHaveLength(1);
    expect(await run({ list: true, root: unregistered, config: store, home }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: `${unregistered} is not one of your registered projects.` });
  });
});
