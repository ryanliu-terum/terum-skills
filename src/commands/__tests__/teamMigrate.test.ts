import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../cli.js';
import { createConfigStore } from '../../lib/config.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { FRAME_VERBS } from '../../lib/frames.js';
import { applyReadme } from '../../lib/readme.js';
import { personSchema, parseJson, teamSchema } from '../../lib/schema.js';
import { systemRunner } from '../../lib/runner.js';
import { openTeamRepo } from '../../lib/teamRepo.js';
import { bareTeam, cloneWithIdentity, git, mappedRunner, person, pushFromSeed, ScriptedPrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { run } from '../team.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OLD = 'a'.repeat(40);
const RUN = '20260907T010000Z';
const REMOTE = 'https://github.com/acme/team.git';
const skill = `---\nname: sample\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nbody\n`;
const legacyTeam = { layout_version: 2, name: 'team', categories: ['testing'], global: [ID], projects: { global: { remotes: ['example.com/a/b'], skills: [OTHER], future: true } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED', future: true }, future: true };
const entry = (id: string, version: string | null) => ({ id, version, scope: { kind: 'project', project: 'global', future: true }, since: '2026-09-07', future: true });
function receipt(hash: string) {
  return receiptSchema.parse({
    schema_version: 1, skill_id: ID, skill_name: 'sample', version: hash, run_id: RUN,
    verdict: 'PASS', attribution: 'test', execution_status: 'complete', expected_rows: 1, scored_rows: 1,
    comparisons: {}, arm_scores: {}, triggers: null, efficiency: {}, future: { retained: true },
    provenance: { engine_version: '0.1.7', engine_commit: 'unknown', cc_version: 'stub', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-09-07T00:00:00Z', runner_handle: 'seed' },
  });
}

// Every repository and config is created under bareTeam's temporary directory. No ambient team,
// remote, config, or home path may enter this test; the public-looking remote is locally mapped.
async function prepared(github = false) {
  const fixture = await bareTeam();
  const files = new Map<string, string | Buffer>([
    ['team.json', JSON.stringify(legacyTeam)], ['skills/sample/SKILL.md', skill],
    ['skills/sample/scripts/run.sh', '#!/bin/sh\nexit 0\n'],
    ['skills/sample/evals/cases/a.yaml', 'name: a\n'],
    ['skills/sample/evals/triggers.yaml', 'positive: []\n'],
    ['skills/sample/.DS_Store', Buffer.from([0, 255, 1])],
    ['.github/workflows/terum-skills.yml', 'name: legacy workflow\n'],
    ['README.md', '<!-- terum-skills:begin -->\nExisting sample catalogue\n<!-- terum-skills:end -->\n'],
  ]);
  for (const [path, bytes] of files) { await mkdir(dirname(join(fixture.seed, path)), { recursive: true }); await writeFile(join(fixture.seed, path), bytes); }
  await chmod(join(fixture.seed, 'skills/sample/scripts/run.sh'), 0o755);
  await git(['add', '-A'], fixture.seed);
  await git(['commit', '-qm', 'legacy skill'], fixture.seed);
  const hash = (await git(['rev-parse', 'HEAD:skills/sample'], fixture.seed)).trim();
  const archived = `  ${JSON.stringify(receipt(OLD))}\n\n`;
  const records = {
    [`evals/${ID}/${hash}/${RUN}.json`]: JSON.stringify(receipt(hash)),
    [`evals/${ID}/${OLD}/${RUN}.json`]: archived,
    'people/seed.json': JSON.stringify(person('seed', { installed: [entry(ID, hash), entry(OTHER, hash)], projects: ['global'], future: true })),
    'people/other.json': JSON.stringify(person('other', { installed: [entry(ID, OLD), entry(ID, 'v2'), entry(ID, null)], projects: ['global', 'App'], future: true })),
  };
  for (const [path, bytes] of Object.entries(records)) { await mkdir(dirname(join(fixture.seed, path)), { recursive: true }); await writeFile(join(fixture.seed, path), bytes); }
  await git(['add', '-A'], fixture.seed);
  await git(['commit', '-qm', 'legacy people and receipts'], fixture.seed);
  await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
  const store = createConfigStore(join(fixture.root, 'state'));
  await store.ensureRoot();
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update(config => { config.teams.team = { remote: github ? REMOTE : fixture.bare, handle: 'seed' }; });
  const runner = github ? mappedRunner(REMOTE, fixture.bare) : systemRunner;
  const invoke = () => run({ kind: 'migrate', config: store, runner }, new ScriptedPrompter());
  return { fixture, store, clone, hash, archived, files, invoke, runner };
}

describe('§13 migration (temporary bare repositories only)', () => {
  it.each([false, true])('moves the complete diff in one safeWrite commit (GitHub=%s), preserves bytes/modes, and re-arms idempotently', async github => {
    const p = await prepared(github);
    const before = (await git(['rev-parse', 'main'], p.fixture.bare)).trim();
    expect(await p.invoke()).toMatchObject({ ok: true, value: { changed: true, layoutVersion: 3, skills: 1, people: 2, rekeyedReceipts: 1, archivedReceipts: 1 } });
    expect((await git(['rev-list', '--count', `${before}..main`], p.fixture.bare)).trim()).toBe('1');
    const team = JSON.parse(await git(['show', 'main:team.json'], p.fixture.bare));
    expect(team).toEqual({ ...legacyTeam, layout_version: 3, global: undefined, projects: { Global: { ...legacyTeam.projects.global, skills: [OTHER, ID] } }, policy: { skill_license: 'UNLICENSED', future: true } });
    expect(teamSchema.safeParse(team).success).toBe(true);
    const paths = (await git(['ls-tree', '-r', '--name-only', 'main'], p.fixture.bare)).trim().split('\n');
    expect(paths).not.toContain('skills/sample/SKILL.md');
    expect(paths).not.toContain(`evals/${ID}/${p.hash}/${RUN}.json`);
    expect(paths).not.toContain(`evals/${ID}/${OLD}/${RUN}.json`);
    const moved = [...p.files.keys()].filter(path => path.startsWith('skills/'));
    const diff = (await git(['diff', '--name-only', '--no-renames', before, 'main'], p.fixture.bare)).trim().split('\n').sort();
    expect(diff).toEqual([
      ...moved, ...moved.map(path => path.replace('skills/sample/', 'skills/sample/v1/')),
      `evals/${ID}/${p.hash}/${RUN}.json`, `evals/${ID}/${OLD}/${RUN}.json`,
      `evals/${ID}/v1/${RUN}.json`, `evals/${ID}/archive/${OLD}/${RUN}.json`,
      'people/seed.json', 'people/other.json', 'team.json', ...(github ? [] : ['README.md']),
    ].sort());
    expect(await readFile(join(p.clone, '.github/workflows/terum-skills.yml'), 'utf8')).toBe('name: legacy workflow\n');
    for (const [path, bytes] of p.files) {
      if (!path.startsWith('skills/')) continue;
      const moved = path.replace('skills/sample/', 'skills/sample/v1/');
      expect(await readFile(join(p.clone, moved))).toEqual(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    }
    expect(await git(['ls-tree', 'main', '--', 'skills/sample/v1/scripts/run.sh'], p.fixture.bare)).toMatch(/^100755 blob /);
    const migrated = receiptSchema.parse(JSON.parse(await git(['show', `main:evals/${ID}/v1/${RUN}.json`], p.fixture.bare)));
    expect(migrated).toEqual({ ...receipt(p.hash), version: 'v1', version_tree: p.hash });
    expect(await git(['show', `main:evals/${ID}/archive/${OLD}/${RUN}.json`], p.fixture.bare)).toBe(p.archived);
    const seed = personSchema.parse(JSON.parse(await git(['show', 'main:people/seed.json'], p.fixture.bare)));
    const other = personSchema.parse(JSON.parse(await git(['show', 'main:people/other.json'], p.fixture.bare)));
    expect(seed.installed.map(item => item.version)).toEqual(['v1', null]);
    expect(other.installed.map(item => item.version)).toEqual([null, 'v2', null]);
    for (const member of [seed, other]) {
      expect(member.future).toBe(true);
      expect(member.installed.every(item => item.scope.project === 'Global' && item.scope.future === true)).toBe(true);
      expect(member.projects?.[0]).toBe('Global');
    }
    if (!github) expect(await readFile(join(p.clone, 'README.md'), 'utf8')).toContain('Version 1');
    expect(await readFile(join(p.clone, '.git/hooks/pre-push'), 'utf8')).toContain('guard-push');
    expect((await git(['config', 'core.hooksPath'], p.clone)).trim()).toBe('.git/hooks');
    const migratedHead = (await git(['rev-parse', 'main'], p.fixture.bare)).trim();
    expect(await p.invoke()).toMatchObject({ ok: true, value: { changed: false } });
    expect((await git(['rev-parse', 'main'], p.fixture.bare)).trim()).toBe(migratedHead);
  });

  it('re-reads HEAD tree identities when a concurrent skill change forces a retry', async () => {
    const p = await prepared();
    let raced = false;
    const runner = wrapRunner(systemRunner, async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && !raced) {
        raced = true;
        await pushFromSeed(p.fixture.seed, 'skills/sample/evals/cases/new.yaml', 'name: new\n');
      }
      return next();
    });
    expect(await run({ kind: 'migrate', config: p.store, runner, safeWrite: { backoff: () => 0 } }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { rekeyedReceipts: 0, archivedReceipts: 2 } });
    const member = personSchema.parse(JSON.parse(await git(['show', 'main:people/seed.json'], p.fixture.bare)));
    expect(member.installed.map(item => item.version)).toEqual([null, null]);
    expect(await git(['show', 'main:skills/sample/v1/evals/cases/new.yaml'], p.fixture.bare)).toBe('name: new\n');
  });

  it.each([
    ['people/other.json', JSON.stringify(person('other', { installed: [entry(ID, OLD)], local_skills: -1 })), 'people/other.json'],
    ['team.json', JSON.stringify({ ...legacyTeam, projects: { ...legacyTeam.projects, GLOBAL: { remotes: [], skills: [] } } }), 'multiple projects'],
    ['skills/sample/v1/already.txt', 'existing version', 'already contains a version'],
  ])('refuses %s loudly without a migration commit or partial conversion', async (path, bytes, message) => {
    const p = await prepared();
    await pushFromSeed(p.fixture.seed, path, bytes);
    const before = (await git(['rev-parse', 'main'], p.fixture.bare)).trim();
    expect(await p.invoke()).toMatchObject({ ok: false, error: expect.stringContaining(message) });
    expect((await git(['rev-parse', 'main'], p.fixture.bare)).trim()).toBe(before);
    expect(await readFile(join(p.clone, 'skills/sample/SKILL.md'), 'utf8')).toBe(skill);
    expect(JSON.parse(await readFile(join(p.clone, 'team.json'), 'utf8')).layout_version).toBe(2);
  });

  it('creates Global when absent and folds duplicate IDs once', async () => {
    const p = await prepared();
    await pushFromSeed(p.fixture.seed, 'team.json', JSON.stringify({ ...legacyTeam, global: [ID, ID], projects: {} }));
    expect(await p.invoke()).toMatchObject({ ok: true });
    expect(JSON.parse(await git(['show', 'main:team.json'], p.fixture.bare)).projects).toEqual({ Global: { remotes: [], skills: [ID] } });
  });

  it('the mode overlay also counts a mode-only change in the staged-diff proof', async () => {
    const p = await prepared();
    expect(await p.invoke()).toMatchObject({ ok: true });
    const before = await readFile(join(p.clone, 'people/seed.json'));
    await expect(openTeamRepo(p.clone, p.fixture.bare).safeWrite(tree => {
      tree.setExecutable('people/seed.json', true);
    }, { action: 'profile', handle: 'seed' })).resolves.toMatchObject({ changed: true });
    expect(await readFile(join(p.clone, 'people/seed.json'))).toEqual(before);
    expect(await git(['ls-tree', 'main', '--', 'people/seed.json'], p.fixture.bare)).toMatch(/^100755 blob /);
  });
});

it('keeps migrate registered for the terminal and absent from frame verbs', async () => {
  let received: unknown;
  const program = buildProgram(async invoke => { await invoke(new ScriptedPrompter()); }, {
    login: async () => ({ ok: false, error: 'Unexpected login in migration routing test.' }),
    team: async args => { received = args; return { ok: true, value: { team: 'team', remote: 'unused' } }; },
  });
  await program.parseAsync(['node', 'cli', 'team', 'migrate', '--team', 'team']);
  expect(received).toMatchObject({ kind: 'migrate', team: 'team' });
  expect(FRAME_VERBS).not.toContain('team migrate');
});

it('the layout-3 reader gives the upgrade sentence for unmigrated input', () => {
  expect(() => parseJson(teamSchema, JSON.stringify(legacyTeam), 'team.json')).toThrow(/admin should run `team migrate`/);
});

it('refuses migration over frames before invoking the team command', async () => {
  let called = false;
  let result: unknown;
  const program = buildProgram(async invoke => { result = await invoke(new ScriptedPrompter()); }, {
    login: async () => ({ ok: false, error: 'Unexpected login.' }),
    team: async () => { called = true; return { ok: false, error: 'Unexpected migration.' }; },
  }, { frames: true });
  await program.parseAsync(['node', 'cli', 'team', 'migrate']);
  expect(called).toBe(false);
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining('terminal-only') });
});

it('§13.1 refuses a catalogue wipe and preserves the existing README', () => {
  const existing = '<!-- terum-skills:begin -->\nShared sample catalogue\n<!-- terum-skills:end -->\n';
  const empty = '<!-- terum-skills:begin -->\nNo shared skills yet.\n<!-- terum-skills:end -->\n';
  // §13.1(a): refuse the replacement and leave the block UNTOUCHED -- deliberately not a throw.
  // A throw fires identically when a team legitimately removes its last shared skill, which would
  // wedge README regeneration for that team forever. A stale catalogue is recoverable; a blanked
  // one that the Action has already committed and pushed is not.
  const refused = applyReadme(existing, empty);
  expect(refused).toBe(existing);
  expect(refused).toContain('Shared sample catalogue');
  expect(refused).not.toContain('No shared skills yet.');
  // A catalogue with real content still replaces normally -- the guard is narrow, not a freeze.
  const populated = '<!-- terum-skills:begin -->\nShared: two skills\n<!-- terum-skills:end -->\n';
  const replaced = applyReadme(existing, populated);
  expect(replaced).toContain('Shared: two skills');
  expect(replaced).not.toContain('Shared sample catalogue');
  expect(applyReadme('', empty)).toBe(empty);       // first generation: nothing to preserve
  expect(applyReadme(empty, empty)).toBe(empty);    // empty -> empty is not a wipe
});
