import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { createExecute } from '../../lib/execute.js';
import { run } from '../validate.js';

const ID = '11111111-1111-4111-8111-111111111111';
const skill = (body = '', name = 'sample') => `---\nname: ${name}\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${body}`;
/** Pin what `path.resolve` sees as the runner's cwd for one call — the Action's `--cwd .` runs at the checkout root; vitest runs at this repository's root. */
async function atCwd<T>(cwd: string, call: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  try { return await call(); } finally { spy.mockRestore(); }
}

describe('validate (§9)', () => {
  it('validates a selected clone skill and exits non-zero with all hygiene findings', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const clean = new ScriptedPrompter(); expect(await run({ target: 'sample', config: store }, clean)).toMatchObject({ ok: true, value: { findings: 0, repairable: 0, repairs: [] } });
    await writeFile(join(clone, 'skills', 'sample', 'v1', 'SKILL.md'), skill('bad\u202Etext ghp_abcdefghijklmnopqrstuvwxyz third@company.com'));
    await mkdir(join(clone, 'skills', 'sample', 'v1', 'bin')); await writeFile(join(clone, 'skills', 'sample', 'v1', 'bin', 'bad.exe'), 'x');
    const rejected = new ScriptedPrompter();
    // `repairable` counts only the bidi character, and `repairs` says so in the sentence the app shows before
    // fixing: the credential, the stranger's email and bad.exe need a person.
    expect(await run({ target: 'sample', config: store }, rejected)).toMatchObject({ ok: false, error: expect.stringContaining('HYG2'), value: { findings: 3, repairable: 1, repairs: ['Removed 1 invisible character from SKILL.md.'] } });
    expect(rejected.lines.join('\n')).toEqual(expect.stringMatching(/HYG2[\s\S]*HYG3[\s\S]*HYG4/));
  });

  it('uses only --cwd checkout state, including its team policy, when no teams are configured', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const checkout = await cloneWithIdentity(fixture.bare, join(fixture.root, 'checkout'));
    await writeFile(join(checkout, 'team.json'), `${JSON.stringify({ ...TEAM_JSON, policy: { publish: 'pr', skill_license: 'Apache-2.0' } }, null, 2)}\n`);
    await writeFile(join(checkout, 'skills', 'sample', 'v1', 'SKILL.md'), skill().replace('license: UNLICENSED', 'license: Apache-2.0'));
    const clean = new ScriptedPrompter();
    expect(await run({ target: 'sample', cwd: checkout }, clean)).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
    await writeFile(join(checkout, 'skills', 'sample', 'v1', 'SKILL.md'), skill('bad\u202Etext'));
    const dirty = new ScriptedPrompter();
    expect(await run({ target: 'sample', cwd: checkout }, dirty)).toMatchObject({ ok: false, error: expect.stringContaining('HYG2') });
    expect(dirty.lines.join('\n')).toContain('HYG2');
  });

  it('with --cwd a bare name is the skill in that checkout, never a folder at the runner cwd or the checkout root (D72)', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/src/v1/SKILL.md', skill('', 'src'));
    await pushFromSeed(fixture.seed, 'skills/evals/v1/SKILL.md', skill('', 'evals'));
    const checkout = await cloneWithIdentity(fixture.bare, join(fixture.root, 'checkout'));
    // A runner whose cwd holds `src/` (this repository under vitest), and the Action itself: `--cwd .` at the checkout root, where `evals/` is a real folder.
    const runner = join(fixture.root, 'runner'); await mkdir(join(runner, 'src'), { recursive: true });
    for (const [cwd, name] of [[runner, 'src'], [checkout, 'evals']] as const) {
      const io = new ScriptedPrompter();
      expect(await atCwd(cwd, () => run({ target: name, cwd: checkout }, io))).toMatchObject({ ok: true, value: { name, findings: 0 } });
      expect(io.lines).toEqual([`${name}: hygiene passed.`]);
    }
  });

  it('the container skills/<name> descends to the newest version in both modes (D71 :30, folded into D72)', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill('bad‮text'));
    await pushFromSeed(fixture.seed, 'skills/sample/v2/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    // The documented path invocation, relative to the checkout (not to the runner's cwd) — v1 would fail HYG2, so passing proves v2 was chosen.
    expect(await atCwd(fixture.root, () => run({ target: 'skills/sample', cwd: clone }, new ScriptedPrompter()))).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
    const container = join(clone, 'skills', 'sample');
    expect(await run({ target: container, cwd: clone }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
    expect(await run({ target: container, config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
  });

  it('an absolute path to a real skill folder validates that folder as-is in both modes', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill('bad‮text'));
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    // The published version is dirty, so passing proves the folder was validated, not the name.
    const folder = join(fixture.root, 'sample'); await mkdir(folder); await writeFile(join(folder, 'SKILL.md'), skill());
    expect(await run({ target: folder, cwd: clone }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
    expect(await run({ target: folder, config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
  });

  it('a directly-targeted version folder skills/<name>/v<N> validates that version under <name>, in both modes', async () => {
    // Confirmation-review HIGH 1 on refactor/b3-versions-keystone: the has-SKILL.md branch of atPath
    // named the target by its basename, `v2`, so HYG1 ("SKILL.md name sample does not equal folder
    // v2") failed every valid published skill reached by the path `ls`/`listVersions` print. v1 is
    // dirty and v2 clean: a green v2 proves the TARGETED folder was checked under the right name, and
    // a HYG2-only v1 proves the target was checked, not the newest version.
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill('bad‮text'));
    await pushFromSeed(fixture.seed, 'skills/sample/v2/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const v2 = join(clone, 'skills', 'sample', 'v2');
    expect(await run({ target: v2, cwd: clone }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
    expect(await run({ target: v2, config: store }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
    // The documented relative spelling, `validate skills/sample/v2 --cwd .`, read against the checkout.
    expect(await atCwd(fixture.root, () => run({ target: 'skills/sample/v2', cwd: clone }, new ScriptedPrompter()))).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
    const v1 = await run({ target: join(clone, 'skills', 'sample', 'v1'), cwd: clone }, new ScriptedPrompter());
    expect(v1).toMatchObject({ ok: false, error: expect.stringContaining('HYG2') });
    expect(v1.ok ? '' : v1.error).not.toContain('HYG1');
  });

  it('without --cwd a folder at the user cwd wins, otherwise a bare name resolves through the configured team clone', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill('bad‮text'));
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const wip = join(fixture.root, 'wip'); await mkdir(join(wip, 'sample'), { recursive: true }); await writeFile(join(wip, 'sample', 'SKILL.md'), skill());
    expect(await atCwd(wip, () => run({ target: 'sample', config: store }, new ScriptedPrompter()))).toMatchObject({ ok: true, value: { name: 'sample', findings: 0 } });
    expect(await atCwd(fixture.root, () => run({ target: 'sample', config: store }, new ScriptedPrompter()))).toMatchObject({ ok: false, error: expect.stringContaining('HYG2') });
    expect(await atCwd(fixture.root, () => run({ target: 'missing', config: store }, new ScriptedPrompter()))).toMatchObject({ ok: false, error: 'skills/missing holds no v<N> folder.' });
  });
});

it.each([false, true])('reports size warnings before errors and preserves exit semantics (cwd: %s)', async (cwd) => {
  const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
  const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const args = cwd ? { target: 'sample', cwd: clone } : { target: 'sample', config: store };
  for (const mixed of [false, true]) {
    await writeFile(join(clone, 'skills/sample/v1/SKILL.md'), skill('x'.repeat(20_001) + (mixed ? '\u202E' : '')));
    const io = new ScriptedPrompter(); const exits: number[] = [];
    const result = await run(args, io);
    expect(result).toMatchObject({ ok: !mixed, value: { findings: mixed ? 1 : 0, warnings: 1 } });
    expect(io.lines[0]).toMatch(/^warning HYG6/);
    if (mixed) expect(io.lines[1]).toMatch(/^HYG2/);
    else expect(io.lines[1]).toBe('sample: hygiene passed (1 warning).');
    await createExecute({ io, stderr: () => undefined, setExitCode: (code) => exits.push(code) })(async () => result, { verb: 'validate', notices: false });
    expect(exits).toEqual(mixed ? [1] : []);
  }
});
