import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { run } from '../profile.js';
import { buildProgram } from '../../cli.js';
import { createConfigStore } from '../../lib/config.js';
import { systemRunner } from '../../lib/runner.js';
import { bareTeam, cloneWithIdentity, git, pushFromSeed, ScriptedPrompter, TEAM_JSON, wrapRunner } from '../../lib/__tests__/fixtures.js';

async function setup() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'team.json', JSON.stringify({ ...TEAM_JSON, projects: { terum: { remotes: [], skills: [] }, second: { remotes: [], skills: [] } } }));
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  return { fixture, store };
}
it.each([
  [{ name: 'New Name' }, 'display_name', 'New Name'],
  [{ bio: 'My bio' }, 'bio', 'My bio'],
  [{ role: 'Platform' }, 'role', 'Platform'],
  [{ projects: ['terum', 'second'] }, 'projects', ['terum', 'second']],
] as const)('writes only the supplied profile field %j', async (args, field, value) => {
  const { fixture, store } = await setup();
  const options = 'projects' in args ? { projects: [...args.projects], config: store } : { ...args, config: store };
  expect(await run(options, new ScriptedPrompter())).toEqual({ ok: true, value: { handle: 'seed', changed: [field] } });
  const after = JSON.parse(await git(['show', 'main:people/seed.json'], fixture.bare));
  expect(after[field]).toEqual(value);
  expect(after.email).toBe('seed@example.com');
  if (field === 'display_name') expect((await store.read()).display_name).toBe(value);
  expect(await run(options, new ScriptedPrompter())).toEqual({ ok: true, value: { handle: 'seed', changed: [] } });
});
it.each(['email', 'github', 'handle'])('refuses binding identity field %s in the CLI and library', async field => {
  const { store } = await setup();
  expect(await run({ config: store, [field]: 'other' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: `profile cannot change ${field}.` });
  const program = buildProgram(async () => { throw new Error('Must not execute'); });
  program.configureOutput({ writeErr: () => {} });
  await expect(program.parseAsync(['profile', `--${field}`, 'other'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownOption' });
});
it('validates project names against the fetched pre-image registry, not a stale clone', async () => {
  const { fixture, store } = await setup();
  await pushFromSeed(fixture.seed, 'team.json', JSON.stringify({ ...TEAM_JSON, projects: { added: { remotes: [], skills: [] } } }));
  expect(await run({ config: store, projects: ['terum'] }, new ScriptedPrompter())).toMatchObject({ ok: false, error: 'Unknown project terum.' });
  expect(await run({ config: store, projects: ['added'] }, new ScriptedPrompter())).toMatchObject({ ok: true });
  expect(await readFile(join(store.teamClone('team'), 'team.json'), 'utf8')).toContain('added');
});
it('R1: two profile writers reapply on conflict without losing role or projects', async () => {
  const { fixture, store } = await setup();
  const other = createConfigStore(join(fixture.root, 'other'));
  await cloneWithIdentity(fixture.bare, other.teamClone('team'));
  await other.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  let pushes = 0;
  const runner = wrapRunner(systemRunner, async (command, args, _options, next) => {
    if (command === 'git' && args[0] === 'push' && ++pushes === 1) {
      expect(await run({ config: other, role: 'Platform' }, new ScriptedPrompter())).toMatchObject({ ok: true });
    }
    return next();
  });
  expect(await run({ config: store, projects: ['terum'], runner, safeWrite: { backoff: () => 0 } }, new ScriptedPrompter())).toMatchObject({ ok: true });
  expect(pushes).toBe(2);
  expect(JSON.parse(await git(['show', 'main:people/seed.json'], fixture.bare))).toMatchObject({ role: 'Platform', projects: ['terum'] });
});
it('commander collects repeated projects and passes explicit empty bio/role', async () => {
  let received: unknown;
  const program = buildProgram(async invoke => { await invoke(new ScriptedPrompter()); }, {
    login: async () => ({ ok: false, error: 'unused' }), team: async () => ({ ok: false, error: 'unused' }),
    profile: async args => { received = args; return { ok: true, value: { handle: 'seed', changed: [] } }; },
  });
  await program.parseAsync(['profile', '--name', 'New', '--bio', '', '--role', '', '--project', 'terum', '--project', 'second'], { from: 'user' });
  expect(received).toMatchObject({ name: 'New', bio: '', role: '', projects: ['terum', 'second'] });
});
