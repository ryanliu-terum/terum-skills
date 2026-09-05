import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, person, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../ls.js';

const ID = '33333333-3333-4333-8333-333333333333';

describe('ls (§6)', () => {
  it('reads the clone without pulling, computes installs across people, and marks archived members inactive', async () => {
    const fixture = await bareTeam();
    const team = { layout_version: 2, name: 'team', categories: [], global: [ID], projects: { app: { remotes: [], skills: [ID] } }, archived: ['old'], policy: { publish: 'pr', skill_license: 'UNLICENSED' } };
    const installed = [{ id: ID, version: null, scope: { kind: 'global' }, since: '2026-09-04' }];
    await writeFile(join(fixture.seed, 'team.json'), `${JSON.stringify(team, null, 2)}\n`);
    await writeFile(join(fixture.seed, 'people', 'amy.json'), `${JSON.stringify(person('amy', { display_name: 'Amy', installed }), null, 2)}\n`);
    await writeFile(join(fixture.seed, 'people', 'old.json'), `${JSON.stringify(person('old', { installed }), null, 2)}\n`);
    await mkdir(join(fixture.seed, 'skills', 'report'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'report', 'SKILL.md'), `---\nname: report\ndescription: Report writing\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: " amy   <AMY@example.com> "\n  terum-category: docs\n---\n`);
    await git(['add', '--all'], fixture.seed);
    await git(['commit', '-q', '-m', 'skills'], fixture.seed);
    await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const store = createConfigStore(join(fixture.root, 'local'));
    await store.ensureRoot();
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'amy' }; });
    const before = await git(['rev-parse', 'HEAD'], store.teamClone('team'));
    const io = new ScriptedPrompter();
    const result = await run({ config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { skills: [{ name: 'report', installs: 2, endorsement: 'global' }] } });
    expect(io.lines).toContain('  old (inactive)');
    expect(await git(['rev-parse', 'HEAD'], store.teamClone('team'))).toBe(before);
    expect((await git(['status', '--porcelain'], store.teamClone('team'))).trim()).toBe('');
  });

  it('supports member and project forms', async () => {
    const fixture = await bareTeam();
    const team = { layout_version: 2, name: 'team', categories: [], global: [], projects: { app: { remotes: [], skills: [ID] } }, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } };
    await writeFile(join(fixture.seed, 'team.json'), `${JSON.stringify(team)}\n`);
    await writeFile(join(fixture.seed, 'people', 'amy.json'), `${JSON.stringify(person('amy', { display_name: 'Amy', installed: [{ id: ID, version: null, scope: { kind: 'project', project: 'app' }, since: '2026-09-04' }] }))}\n`);
    await mkdir(join(fixture.seed, 'skills', 'report'), { recursive: true });
    await writeFile(join(fixture.seed, 'skills', 'report', 'SKILL.md'), `---\nname: report\ndescription: Report writing\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Amy <amy@example.com>\n  terum-category: docs\n---\n`);
    await git(['add', '--all'], fixture.seed); await git(['commit', '-q', '-m', 'skills'], fixture.seed); await git(['push', '-q', 'origin', 'HEAD:main'], fixture.seed);
    const store = createConfigStore(join(fixture.root, 'local')); await store.ensureRoot(); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'amy' }; });
    const member = await run({ kind: 'member', value: 'Amy', config: store }, new ScriptedPrompter());
    const project = await run({ kind: 'project', value: 'app', config: store }, new ScriptedPrompter());
    expect(member).toMatchObject({ ok: true, value: { skills: [{ name: 'report', installs: 1, endorsement: 'project: app' }] } });
    expect(project).toMatchObject({ ok: true, value: { skills: [{ name: 'report', installs: 1, endorsement: 'project: app' }] } });
  });
});
