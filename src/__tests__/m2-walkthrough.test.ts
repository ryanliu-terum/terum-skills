import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as install } from '../commands/install.js';
import { run as share } from '../commands/share.js';
import { run as sync } from '../commands/sync.js';
import { createConfigStore } from '../lib/config.js';
import { NonInteractivePrompter } from '../lib/prompt.js';
import { bareTeam, cloneWithIdentity, git, person, pushFromSeed, ScriptedPrompter } from '../lib/__tests__/fixtures.js';

const firstSkill = (description: string, tools: string) => `---\nname: guarded\ndescription: ${description}\nallowed-tools: ${tools}\nmetadata:\n  terum-category: testing\n---\n${description}\n`;
const secondSkill = '---\nname: plain\ndescription: plain\nmetadata:\n  terum-category: testing\n---\nplain\n';

describe('M2 walkthrough (§12)', () => {
  it('keeps B pinned, tracks B unpinned, and defers A’s widened tool grant in hook sync', async () => {
    const fixture = await bareTeam();
    const aHome = join(fixture.root, 'a-home'); const bHome = join(fixture.root, 'b-home');
    const aStore = createConfigStore(join(aHome, '.terum', 'skills'));
    await cloneWithIdentity(fixture.bare, aStore.teamClone('team'), 'Alice', 'alice@example.com');
    await aStore.update((config) => { config.display_name = 'Alice'; config.email = 'alice@example.com'; config.teams.team = { remote: fixture.bare, token: null, handle: 'seed' }; });
    const source = join(fixture.root, 'guarded'); await mkdir(source); await writeFile(join(source, 'SKILL.md'), firstSkill('first', 'Bash(ls)'));
    const sharedFirst = await share({ path: source, team: 'team', config: aStore }, new ScriptedPrompter([], [true]));
    if (!sharedFirst.ok) throw new Error(sharedFirst.error);
    const firstId = sharedFirst.value!.id;
    await pushFromSeed(fixture.seed, 'people/bob.json', `${JSON.stringify(person('bob', { display_name: 'Bob', email: 'bob@example.com', github: 'bob' }))}\n`);
    const bStore = createConfigStore(join(bHome, '.terum', 'skills'));
    const bClone = await cloneWithIdentity(fixture.bare, bStore.teamClone('team'), 'Bob', 'bob@example.com');
    await bStore.update((config) => { config.teams.team = { remote: fixture.bare, token: null, handle: 'bob' }; });
    const tree = (await git(['rev-parse', 'HEAD:skills/guarded'], bClone)).trim();
    expect((await install({ ref: `guarded@${tree}`, config: bStore }, new ScriptedPrompter([], [true]))).ok).toBe(true);
    const pinnedPath = join(bHome, '.claude', 'skills', 'guarded', 'SKILL.md');
    const pinnedBytes = await readFile(pinnedPath, 'utf8');

    await writeFile(join(source, 'SKILL.md'), firstSkill('A edited', 'Bash(ls)'));
    expect((await sync({ config: aStore }, new ScriptedPrompter())).ok).toBe(true);
    const secondSource = join(fixture.root, 'plain'); await mkdir(secondSource); await writeFile(join(secondSource, 'SKILL.md'), secondSkill);
    const sharedSecond = await share({ path: secondSource, team: 'team', config: aStore }, new ScriptedPrompter([], [true]));
    if (!sharedSecond.ok) throw new Error(sharedSecond.error);
    const secondId = sharedSecond.value!.id;
    expect((await sync({ config: bStore }, new ScriptedPrompter())).ok).toBe(true);
    expect((await install({ ref: 'plain', config: bStore }, new ScriptedPrompter())).ok).toBe(true);
    const plainPath = join(bHome, '.claude', 'skills', 'plain', 'SKILL.md');
    const plainBytes = await readFile(plainPath, 'utf8');

    await writeFile(join(source, 'SKILL.md'), firstSkill('grant widened', 'Bash(*)'));
    expect((await sync({ config: aStore }, new ScriptedPrompter())).ok).toBe(true);
    const hook: NonInteractivePrompter & { lines: string[] } = { interactive: false, lines: [], print(line) { this.lines.push(line); } };
    expect(await sync({ hook: true, config: bStore }, hook)).toMatchObject({ ok: true, value: { placed: 0, deferred: [] } });
    expect(hook.lines).toEqual([]);
    expect(await readFile(pinnedPath, 'utf8')).toBe(pinnedBytes);
    expect(await readFile(plainPath, 'utf8')).toBe(plainBytes);
    const bConfig = await bStore.read();
    expect(Object.values(bConfig.placements)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstId, version: tree }), expect.objectContaining({ id: secondId, version: null }),
    ]));
    expect(JSON.parse(await readFile(join(bClone, 'people', 'bob.json'), 'utf8')).installed).toHaveLength(2);
    expect(await git(['show', 'main:skills/guarded/SKILL.md'], fixture.bare)).toContain('Bash(*)');
  });
});
