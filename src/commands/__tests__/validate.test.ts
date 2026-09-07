import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../validate.js';

const ID = '11111111-1111-4111-8111-111111111111';
const skill = (body = '') => `---\nname: sample\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${body}`;

describe('validate (§9)', () => {
  it('validates a selected clone skill and exits non-zero with all hygiene findings', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const clean = new ScriptedPrompter(); expect(await run({ target: 'sample', config: store }, clean)).toMatchObject({ ok: true, value: { findings: 0 } });
    await writeFile(join(clone, 'skills', 'sample', 'SKILL.md'), skill('bad\u202Etext ghp_abcdefghijklmnopqrstuvwxyz third@company.com'));
    await mkdir(join(clone, 'skills', 'sample', 'bin')); await writeFile(join(clone, 'skills', 'sample', 'bin', 'bad.exe'), 'x');
    const rejected = new ScriptedPrompter();
    expect(await run({ target: 'sample', config: store }, rejected)).toMatchObject({ ok: false, error: expect.stringContaining('HYG2') });
    expect(rejected.lines.join('\n')).toEqual(expect.stringMatching(/HYG2[\s\S]*HYG3[\s\S]*HYG4/));
  });
});
