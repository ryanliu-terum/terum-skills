import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore, type ConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, originSha, person, pushFromSeed, ScriptedPrompter, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { run } from '../publish.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { DEFAULT_CATEGORY, skillContentDigest } from '../../lib/skills.js';
import { sourceFiles } from '../../lib/skill-source.js';
import { systemRunner, type Runner } from '../../lib/runner.js';

const ID = '11111111-1111-4111-8111-111111111111';

/** A Library folder, exactly as an author would leave it: no managed fields unless asked for. */
async function librarySkill(home: string, name = 'sample', body = `---\nname: ${name}\ndescription: useful skill\n---\n\n# ${name}\n`): Promise<string> {
  const directory = join(home, '.claude', 'skills', name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), body);
  return directory;
}

const published = (name = 'sample', id = ID) => `---\nname: ${name}\ndescription: useful skill\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n\n# ${name}\n`;

async function prepared(options: { projects?: Record<string, { remotes: string[]; skills: string[] }> } = {}) {
  const fixture = await bareTeam();
  if (options.projects) await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ ...TEAM_JSON, projects: options.projects }, null, 2)}\n`);
  const home = await (await import('../../lib/__tests__/fixtures.js')).temporaryDirectory();
  const store = createConfigStore(join(fixture.root, 'state'));
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => {
    config.teams.team = { remote: fixture.bare, handle: 'seed' };
    config.display_name = 'Seed'; config.email = 'seed@example.com';
  });
  return { fixture, store, clone, home };
}

/** A local receipt for exactly these bytes, in the content-keyed store §6.2 defines. */
async function localReceipt(store: ConfigStore, folder: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const digest = skillContentDigest((await sourceFiles(folder)).files);
  const receipt = receiptSchema.parse({
    schema_version: 2, skill_id: null, skill_name: 'sample', version: null, content_digest: digest,
    run_id: '20260101T000000Z', verdict: 'PASS', attribution: 'test receipt', execution_status: 'complete',
    expected_rows: 0, scored_rows: 0, comparisons: {}, arm_scores: {}, triggers: null, efficiency: {},
    provenance: { engine_version: 'test', engine_commit: 'unknown', cc_version: 'test', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-01-01T00:00:00Z', runner_handle: 'seed' },
    ...overrides,
  });
  const dir = join(store.root, 'evals', 'local', digest.replace(/^sha256:/, ''), String(receipt.run_id));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'receipt.json'), JSON.stringify(receipt));
  return digest;
}

const show = async (bare: string, path: string) => git(['show', `main:${path}`], bare);

describe('publish (§5) — the only bridge between the two mirrors', () => {
  it('mints v1 from the LOCAL folder, injects the managed fields, and lands on main', async () => {
    const { fixture, store, home } = await prepared();
    const folder = await librarySkill(home);
    const io = new ScriptedPrompter([], [false]);
    const result = await run({ ref: 'sample', home, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { team: 'team', name: 'sample', project: 'Global', version: 'v1', created: true, identicalTo: null, attachedEvals: 0, projectAdded: true } });
    // §5.1 step 4: the four managed fields are written by publish, into the version AND back into the
    // folder — an author's folder carries none of them until their first publish.
    const committed = await show(fixture.bare, 'skills/sample/v1/SKILL.md');
    expect(committed).toContain('license: UNLICENSED');
    expect(committed).toContain('author: Seed <seed@example.com>');
    expect(committed).toContain(`terum-category: ${DEFAULT_CATEGORY}`);
    expect(await readFile(join(folder, 'SKILL.md'), 'utf8')).toBe(committed);
    // §4.1: the push collapsed onto main. No branch, no pull request.
    expect((await git(['branch', '--list'], fixture.bare)).trim()).toBe('* main');
    expect(JSON.parse(await show(fixture.bare, 'team.json')).projects.Global.skills).toEqual([result.ok ? result.value.id : '']);
    expect(io.lines.join('\n')).toContain('Published sample as Version 1 in Global.');
  });

  it('category precedence is declared > --category > the default, and only the default announces itself', async () => {
    const { fixture, store, home } = await prepared();
    await librarySkill(home, 'sample');
    const flagged = await run({ ref: 'sample', home, config: store, category: 'docs', yesProfile: false }, new ScriptedPrompter());
    expect(flagged).toMatchObject({ ok: true });
    expect(await show(fixture.bare, 'skills/sample/v1/SKILL.md')).toContain('terum-category: docs');

    const second = await prepared();
    await librarySkill(second.home, 'declared', `---\nname: declared\ndescription: d\nmetadata:\n  terum-category: testing\n---\n`);
    const io = new ScriptedPrompter();
    expect(await run({ ref: 'declared', home: second.home, config: second.store, category: 'docs', yesProfile: false }, io)).toMatchObject({ ok: true });
    expect(await show(second.fixture.bare, 'skills/declared/v1/SKILL.md')).toContain('terum-category: testing');
    expect(io.lines.filter((line) => line.startsWith('metadata.terum-category:'))).toEqual([]);
  });

  it('keeps a declared metadata.id and mints one only when the folder has none', async () => {
    const { fixture, store, home } = await prepared();
    await librarySkill(home, 'sample', published());
    const result = await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { id: ID } });
    expect(await show(fixture.bare, 'skills/sample/v1/SKILL.md')).toContain(`id: ${ID}`);
  });

  it('a byte-identical republish mints nothing — the §5.1 step 7 prefix strip is what makes this reachable', async () => {
    const { fixture, store, home } = await prepared();
    await librarySkill(home);
    expect(await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { version: 'v1' } });
    const afterFirst = await originSha(fixture.bare);
    const io = new ScriptedPrompter();
    const again = await run({ ref: 'sample', home, config: store, yesProfile: false }, io);
    expect(again).toMatchObject({ ok: true, value: { version: null, created: false, identicalTo: 'v1', projectAdded: false } });
    expect(await originSha(fixture.bare)).toBe(afterFirst);
    expect(io.lines.join('\n')).toContain('Nothing to publish: sample is identical to Version 1 and already in Global.');
  });

  it('changed bytes mint the next ordinal from the HIGHEST version, never from the count', async () => {
    const { fixture, store, home } = await prepared();
    const folder = await librarySkill(home);
    await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter());
    await writeFile(join(folder, 'SKILL.md'), `---\nname: sample\ndescription: useful skill\n---\n\n# changed\n`);
    expect(await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { version: 'v2' } });
    // A version folder is immutable, but history can still lose one (a repo surgery, a bad import).
    // Counting would then re-mint v2 over different bytes; the highest ordinal + 1 cannot.
    await git(['rm', '-r', '-q', 'skills/sample/v1'], fixture.seed).catch(async () => {
      await git(['fetch', '-q', 'origin'], fixture.seed); await git(['reset', '-q', '--hard', 'origin/main'], fixture.seed);
      await git(['rm', '-r', '-q', 'skills/sample/v1'], fixture.seed);
    });
    await git(['commit', '-q', '-m', 'drop v1'], fixture.seed);
    await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    await writeFile(join(folder, 'SKILL.md'), `---\nname: sample\ndescription: useful skill\n---\n\n# changed again\n`);
    expect(await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { version: 'v3' } });
  });

  it('publishes the folder whole — eval assets are ordinary version bytes (D9), not a separate row', async () => {
    const { fixture, store, home } = await prepared();
    const folder = await librarySkill(home);
    await mkdir(join(folder, 'evals', 'cases'), { recursive: true });
    await writeFile(join(folder, 'evals', 'cases', 'happy.yaml'), 'task: t\n');
    await writeFile(join(folder, 'evals', 'triggers.yaml'), 'should_trigger: []\n');
    await mkdir(join(folder, 'references'), { recursive: true });
    await writeFile(join(folder, 'references', 'a.md'), 'aux\n');
    expect(await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { version: 'v1' } });
    expect(await show(fixture.bare, 'skills/sample/v1/evals/cases/happy.yaml')).toBe('task: t\n');
    expect(await show(fixture.bare, 'skills/sample/v1/evals/triggers.yaml')).toBe('should_trigger: []\n');
    expect(await show(fixture.bare, 'skills/sample/v1/references/a.md')).toBe('aux\n');
  });

  it('attaches every local receipt of these exact bytes as a stamped COPY, and reports the ones it could not', async () => {
    const { fixture, store, home } = await prepared();
    const folder = await librarySkill(home);
    // Taken BEFORE publish, so it has no version and (for a first publish) no skill id: §6.1's
    // whole ordering problem, and the reason the store is keyed on content.
    await localReceipt(store, folder);
    // A run of DIFFERENT bytes — the pre-injection folder, say — must not ride along.
    await localReceipt(store, folder, { content_digest: `sha256:${'c'.repeat(64)}`, run_id: '20260102T000000Z' });
    const io = new ScriptedPrompter();
    const result = await run({ ref: 'sample', home, config: store, yesProfile: false }, io);
    expect(result).toMatchObject({ ok: true, value: { version: 'v1', attachedEvals: 0 } });
    // Injection changes the bytes, so a receipt taken before the FIRST publish legitimately misses.
    expect(io.lines.join('\n')).not.toContain('Attached 1 eval run');

    // After the first publish the folder carries its managed fields, so every later run matches.
    await writeFile(join(folder, 'SKILL.md'), `${await readFile(join(folder, 'SKILL.md'), 'utf8')}\nmore\n`);
    const digest = await localReceipt(store, folder, { run_id: '20260103T000000Z' });
    const second = await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter());
    expect(second).toMatchObject({ ok: true, value: { version: 'v2', attachedEvals: 1 } });
    const attached = JSON.parse(await show(fixture.bare, `evals/${second.ok ? second.value.id : ''}/v2/20260103T000000Z.json`));
    // Stamped, not copied: this is what makes §8.1's misfiled check mean anything.
    expect(attached).toMatchObject({ skill_id: second.ok ? second.value.id : '', version: 'v2', content_digest: digest });
    // The local run itself is untouched — it is local state, not testimony the team owns.
    const local = JSON.parse(await readFile(join(store.root, 'evals', 'local', digest.replace(/^sha256:/, ''), '20260103T000000Z', 'receipt.json'), 'utf8'));
    expect(local).toMatchObject({ version: null, skill_id: null });
  });

  it('D19: a failing local eval of these exact bytes asks once, and a decline leaves the folder byte-identical', async () => {
    const { fixture, store, home } = await prepared();
    const folder = await librarySkill(home);
    await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter());
    await writeFile(join(folder, 'SKILL.md'), `${await readFile(join(folder, 'SKILL.md'), 'utf8')}\nchanged\n`);
    const before = await readFile(join(folder, 'SKILL.md'), 'utf8');
    const mainBefore = await originSha(fixture.bare);
    await localReceipt(store, folder, { verdict: 'FAIL', run_id: '20260104T000000Z' });

    const declined = new ScriptedPrompter([], [false]);
    expect(await run({ ref: 'sample', home, config: store }, declined)).toMatchObject({ ok: false });
    expect(declined.asked.join('\n')).toContain('Your latest eval of these exact bytes failed');
    // OF-2: the write-back sits AFTER the last refusal, so a cancelled publish changes nothing.
    expect(await readFile(join(folder, 'SKILL.md'), 'utf8')).toBe(before);
    expect(await originSha(fixture.bare)).toBe(mainBefore);

    expect(await run({ ref: 'sample', home, config: store, allowRegression: true, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { version: 'v2' } });
  });

  it('injects BEFORE hygiene, so a folder that has never been published is not refused for the fields publish is about to write', async () => {
    const { store, home } = await prepared();
    await librarySkill(home, 'sample', `---\nname: sample\ndescription: useful skill\n---\n`);
    expect(await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true });
  });

  it('still refuses hygiene failures, an unknown project, a missing folder, a symlink, and state-root content', async () => {
    const { store, home } = await prepared();
    await librarySkill(home, 'hostile', `---\nname: hostile\ndescription: has a credential\n---\n\nAWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLEKEYX\n`);
    expect(await run({ ref: 'hostile', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('HYG3') });

    await librarySkill(home, 'sample');
    expect(await run({ ref: 'sample', home, config: store, project: 'nope', yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Unknown project nope.' });
    expect(await run({ ref: 'ghost', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('No local skill folder named ghost in your library.') });

    const linked = join(home, '.claude', 'skills', 'linked');
    await symlink(join(home, '.claude', 'skills', 'sample'), linked, 'dir');
    expect(await lstat(linked)).toMatchObject({});
    expect(await run({ ref: 'linked', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: false });
  });

  it('adds the skill to a chosen project without minting when the bytes are unchanged', async () => {
    const { fixture, store, home } = await prepared({ projects: { Global: { remotes: [], skills: [] }, product: { remotes: [], skills: [] } } });
    await librarySkill(home);
    expect(await run({ ref: 'sample', home, config: store, project: 'Global', yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { version: 'v1', projectAdded: true } });
    const io = new ScriptedPrompter();
    const second = await run({ ref: 'sample', home, config: store, project: 'product', yesProfile: false }, io);
    expect(second).toMatchObject({ ok: true, value: { version: null, identicalTo: 'v1', projectAdded: true } });
    expect(io.lines.join('\n')).toContain('Added sample to product. It is identical to Version 1');
    const teamJson = JSON.parse(await show(fixture.bare, 'team.json'));
    expect(teamJson.projects.product.skills).toEqual([second.ok ? second.value.id : '']);
    expect(teamJson.projects.Global.skills).toEqual([second.ok ? second.value.id : '']);
  });

  it('asks which project only when the team has more than one, defaulting to Global', async () => {
    const { store, home } = await prepared({ projects: { Global: { remotes: [], skills: [] }, product: { remotes: [], skills: [] } } });
    await librarySkill(home);
    const io = new ScriptedPrompter(['product']);
    const result = await run({ ref: 'sample', home, config: store, yesProfile: false }, io);
    expect(result).toMatchObject({ ok: true, value: { project: 'product' } });
    expect(io.asked.join('\n')).toContain('Which project?');
  });

  it('D5: publishing is not installing — the only people-file write is the profile prompt, and it defaults to no', async () => {
    const { fixture, store, home } = await prepared();
    await librarySkill(home);
    const declined = new ScriptedPrompter([], [false]);
    expect(await run({ ref: 'sample', home, config: store }, declined)).toMatchObject({ ok: true, value: { profileAdded: false } });
    expect(declined.asked.join('\n')).toContain('Add sample to your profile?');
    expect(JSON.parse(await show(fixture.bare, 'people/seed.json'))).toEqual(person('seed'));

    const accepted = new ScriptedPrompter([], [true]);
    await writeFile(join(home, '.claude', 'skills', 'sample', 'SKILL.md'), `---\nname: sample\ndescription: useful skill\n---\n\n# v2\n`);
    const result = await run({ ref: 'sample', home, config: store }, accepted);
    expect(result).toMatchObject({ ok: true, value: { profileAdded: true, version: 'v2' } });
    const file = JSON.parse(await show(fixture.bare, 'people/seed.json'));
    expect(file.installed).toEqual([]);
    expect(file.profile).toEqual([{ id: result.ok ? result.value.id : '', name: 'sample', version: 'v2', added: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), via: 'publish' }]);
  });

  it('resolves a folder the user already installed — the commonest thing publish is pointed at', async () => {
    const { store, home } = await prepared();
    const folder = await librarySkill(home, 'sample', published());
    await store.update((config) => { config.placements[folder] = { id: ID, team: 'team', version: 'v1', scope: { kind: 'global' }, placed_at: '2026-01-01', fingerprint: '' }; });
    await writeFile(join(folder, 'SKILL.md'), `${published()}\nlocal edit\n`);
    expect(await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { id: ID, version: 'v1' } });
  });

  it('a refused push leaves origin/main where it was and the clone clean', async () => {
    const { fixture, store, clone, home } = await prepared();
    await librarySkill(home);
    const before = await originSha(fixture.bare);
    const denied: Runner = { run(command, args, options) {
      if (command === 'git' && args[0] === 'push') return Promise.resolve({ code: 1, stdout: '', stderr: 'remote: Permission to acme/team.git denied to seed.' });
      return systemRunner.run(command, args, options);
    } };
    expect(await run({ ref: 'sample', home, config: store, runner: denied, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('denied') });
    expect(await originSha(fixture.bare)).toBe(before);
    expect((await git(['status', '--porcelain'], clone)).trim()).toBe('');
    // The §5.1 step 6b write-back is deliberately on the other side of this line: it already ran, and
    // re-deriving the same managed fields on the next attempt reproduces it byte for byte.
    expect(await readFile(join(home, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toContain('license: UNLICENSED');
  });

  // --- B3 review fixes. Each of these fails on the pre-fix tree; see the comment on each. ---

  it('keeps a published name on its OWN uuid when the local SKILL.md has lost a managed field', async () => {
    const { fixture, store, home } = await prepared();
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', published());
    // The author deleted the injected `license:` line. `skillFrontmatterSchema` is .strict(), so the
    // old `existingId` read this as not-ok and minted a FRESH uuid, orphaning every receipt, install
    // and profile entry keyed to ID.
    await librarySkill(home, 'sample', `---\nname: sample\ndescription: useful skill\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n\n# changed\n`);
    const result = await run({ ref: 'sample', home, config: store }, new ScriptedPrompter([], [false]));
    expect(result).toMatchObject({ ok: true, value: { id: ID, version: 'v2' } });
  });

  it('mints a fresh uuid for a folder COPIED from another skill rather than grafting onto its identity', async () => {
    const { fixture, store, home } = await prepared();
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', published());
    // `copy` is `sample`'s folder duplicated and renamed — it still declares sample's uuid. Publishing
    // it under the declared id put this skill's receipts into sample's eval history.
    await librarySkill(home, 'copy', published('copy'));
    const result = await run({ ref: 'copy', home, config: store }, new ScriptedPrompter([], [false]));
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.id).not.toBe(ID);
    expect(await show(fixture.bare, 'skills/sample/v1/SKILL.md')).toContain(`id: ${ID}`);
  });

  it('leaves the folder byte-identical when --project names a project that does not exist (OF-2)', async () => {
    const { store, home } = await prepared();
    const folder = await librarySkill(home);
    const before = await readFile(join(folder, 'SKILL.md'), 'utf8');
    const result = await run({ ref: 'sample', project: 'Nope', home, config: store }, new ScriptedPrompter([], [false]));
    expect(result.ok).toBe(false);
    // Pre-fix the write-back ran BEFORE chooseProject, so a typo rewrote the user's file on a publish
    // that never happened.
    expect(await readFile(join(folder, 'SKILL.md'), 'utf8')).toBe(before);
  });

  it('lets a newer PASS clear the D19 regression gate an older FAIL opened', async () => {
    const { store, home } = await prepared();
    const folder = await librarySkill(home);
    // v1 first: only after publish injects the managed fields do later receipts of this folder match
    // the digest publish computes (the existing §6.1 test above relies on the same ordering).
    expect(await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter())).toMatchObject({ ok: true });
    await writeFile(join(folder, 'SKILL.md'), `${await readFile(join(folder, 'SKILL.md'), 'utf8')}\nmore\n`);
    await localReceipt(store, folder, { run_id: '20260101T000000Z', verdict: 'FAIL' });
    await localReceipt(store, folder, { run_id: '20260202T000000Z', verdict: 'PASS' });
    // Run ids sort ascending, so the old `.find(FAIL)` matched the OLDEST run: once any eval of these
    // bytes failed, no passing re-run could clear the gate. The prompter has no scripted confirm, so
    // if the gate still asks, this fails loudly rather than silently publishing.
    const result = await run({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { version: 'v2' } });
  });
});
