import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { createExecute } from '../../lib/execute.js';
import { run } from '../validate.js';

const ID = '11111111-1111-4111-8111-111111111111';
const skill = (body = '') => `---\nname: sample\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${body}`;

describe('validate (§9)', () => {
  it('validates a selected clone skill and exits non-zero with all hygiene findings', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const clean = new ScriptedPrompter(); expect(await run({ target: 'sample', config: store }, clean)).toMatchObject({ ok: true, value: { findings: 0 } });
    await writeFile(join(clone, 'skills', 'sample', 'v1', 'SKILL.md'), skill('bad\u202Etext ghp_abcdefghijklmnopqrstuvwxyz third@company.com'));
    await mkdir(join(clone, 'skills', 'sample', 'v1', 'bin')); await writeFile(join(clone, 'skills', 'sample', 'v1', 'bin', 'bad.exe'), 'x');
    const rejected = new ScriptedPrompter();
    expect(await run({ target: 'sample', config: store }, rejected)).toMatchObject({ ok: false, error: expect.stringContaining('HYG2') });
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
