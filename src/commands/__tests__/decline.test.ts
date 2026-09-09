import { join } from 'node:path';
import { expect, it } from 'vitest';
import { run } from '../decline.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
const ID = '11111111-1111-4111-8111-111111111111';
async function setup(installed = false) {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`);
  if (installed) await pushFromSeed(fixture.seed, 'people/seed.json', JSON.stringify(person('seed', { installed: [{ id: ID, version: null, scope: { kind: 'global' }, since: 'today' }] })));
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  return { fixture, store };
}
it('appends a resolved ID once, preserving the rest of the people document', async () => {
  const { fixture, store } = await setup();
  const expected = { ok: true, value: { handle: 'seed', id: ID, declined: true } };
  expect(await run({ ref: 'sample', config: store }, new ScriptedPrompter())).toEqual(expected);
  const head = await git(['rev-parse', 'main'], fixture.bare);
  expect(await run({ ref: `team/${ID}`, config: store }, new ScriptedPrompter())).toEqual(expected);
  expect(await git(['rev-parse', 'main'], fixture.bare)).toBe(head);
  expect(JSON.parse(await git(['show', 'main:people/seed.json'], fixture.bare))).toEqual(person('seed', { declined: [ID] }));
});
it('refuses an installed id with uninstall-skill guidance', async () => {
  const { fixture, store } = await setup(true);
  const head = await git(['rev-parse', 'main'], fixture.bare);
  expect(await run({ ref: ID.slice(0, 8), config: store }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('uninstall-skill first') });
  expect(await git(['rev-parse', 'main'], fixture.bare)).toBe(head);
});
