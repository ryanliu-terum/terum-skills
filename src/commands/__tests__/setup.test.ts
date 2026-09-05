import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { fakeGh, bareTeam, cloneWithIdentity, mappedRunner, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../setup.js';

describe('setup (§6.1)', () => {
  it('resumes an already configured creator without a team-repository write and forwards the original prompter', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const seen: unknown[] = [];
    const io = new ScriptedPrompter();
    const result = await run({ config: store, home: join(fixture.root, 'home'), runner: mappedRunner(fixture.bare, fixture.bare, fakeGh('seed', {}, true)), communityUrl: '', verbs: {
      offerHook: async (received) => { seen.push(received); return 'present'; },
    } }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.steps).toMatchObject({ welcome: 'printed', github: 'done', team: 'skipped', actions: 'skipped', invite: 'skipped', community: 'skipped', hook: 'skipped', done: 'printed' });
    expect(seen).toEqual([io]);
    expect(io.lines.join('\n')).not.toMatch(/\b(eval|ui)\b/i);
    expect(io.lines).toContain(`Team team is already configured on this machine.`);
  });
});
