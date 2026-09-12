import { describe, expect, it } from 'vitest';
import { run as publish } from '../commands/publish.js';
import { createConfigStore } from '../lib/config.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter } from '../lib/__tests__/fixtures.js';

describe('M3 publish walkthrough (§12)', () => {
  it('publishes an existing team skill without connect or sync placement', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', '---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n');
    const store = createConfigStore(`${fixture.root}/state`);
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    await expect(publish({ ref: 'sample', config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true });
  });
});
