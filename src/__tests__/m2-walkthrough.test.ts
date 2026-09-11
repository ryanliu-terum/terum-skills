import { describe, expect, it } from 'vitest';
import { run as refresh } from '../commands/refresh.js';
import { createConfigStore } from '../lib/config.js';
import { bareTeam, cloneWithIdentity, ScriptedPrompter } from '../lib/__tests__/fixtures.js';

describe('M2 walkthrough (§12)', () => {
  it('fetches each configured clone without placing or publishing local skills', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(`${fixture.root}/state`);
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    await expect(refresh({ config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true, value: { teams: [expect.objectContaining({ team: 'team', state: 'refreshed' })] } });
    expect((await store.read()).placements).toEqual({});
  });
});
