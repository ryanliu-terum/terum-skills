import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as publish } from '../commands/publish.js';
import { createConfigStore } from '../lib/config.js';
import { bareTeam, cloneWithIdentity, git, ScriptedPrompter, temporaryDirectory } from '../lib/__tests__/fixtures.js';

describe('M3 publish walkthrough (§5)', () => {
  it('publishes a Library folder into the team as its first version, with no connect and no sync', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(`${fixture.root}/state`);
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    // §5: you publish what is on your machine. The folder carries no managed fields yet — publish
    // injects them — and nothing placed it there: the user simply wrote a skill.
    const home = await temporaryDirectory();
    await mkdir(join(home, '.claude', 'skills', 'sample'), { recursive: true });
    await writeFile(join(home, '.claude', 'skills', 'sample', 'SKILL.md'), '---\nname: sample\ndescription: sample\n---\n');
    await expect(publish({ ref: 'sample', home, config: store, yesProfile: false }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true, value: { version: 'v1', created: true } });
    expect(await git(['show', 'main:skills/sample/v1/SKILL.md'], fixture.bare)).toContain('license: UNLICENSED');
  });
});
