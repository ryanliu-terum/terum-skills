import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, mappedRunner, originSha, pushFromSeed, ScriptedPrompter, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import type { Runner } from '../../lib/runner.js';
import { run } from '../team.js';

const REMOTE = 'https://github.com/acme/team.git';

async function prepared(projects: Record<string, { remotes: string[]; skills: string[] }> = {}) {
  const fixture = await bareTeam();
  if (Object.keys(projects).length) await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ ...TEAM_JSON, projects })}\n`);
  const store = createConfigStore(join(fixture.root, 'state'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: REMOTE, handle: 'seed' }; });
  return { fixture, store, runner: mappedRunner(REMOTE, fixture.bare) };
}

/** `team.json` as it stands on the bare origin, read without disturbing the seed clone's worktree. */
async function teamOnOrigin(seed: string): Promise<{ projects: Record<string, { remotes: string[]; skills: string[] }> }> {
  await git(['fetch', '-q', 'origin'], seed);
  return JSON.parse(await git(['show', 'origin/main:team.json'], seed)) as { projects: Record<string, { remotes: string[]; skills: string[] }> };
}

describe('team project create (spec §3, §7.1)', () => {
  it('commits a new empty project straight to main', async () => {
    const { fixture, store, runner } = await prepared();
    const before = await originSha(fixture.bare);
    const io = new ScriptedPrompter();

    const result = await run({ kind: 'project-create', name: 'Payments', remote: 'https://github.com/acme/payments', config: store, runner }, io);

    expect(result).toMatchObject({ ok: true, value: { team: 'team', name: 'Payments', skills: 0 } });
    expect(await originSha(fixture.bare)).not.toBe(before);
    const team = await teamOnOrigin(fixture.seed);
    expect(team.projects.Payments).toEqual({ remotes: ['github.com/acme/payments'], skills: [] });
    expect(io.lines).toContain('Created project Payments in team.');
  });

  it('accepts a project with no repository yet', async () => {
    const { fixture, store, runner } = await prepared();
    const io = new ScriptedPrompter();

    const result = await run({ kind: 'project-create', name: 'Platform', config: store, runner }, io);

    expect(result.ok).toBe(true);
    const team = await teamOnOrigin(fixture.seed);
    expect(team.projects.Platform).toEqual({ remotes: [], skills: [] });
    expect(io.lines).toContain('No repository yet — its skills place nowhere automatically until it has one.');
  });

  it('refuses a name that differs only in case, because every reader matches exactly', async () => {
    const { fixture, store, runner } = await prepared({ Payments: { remotes: [], skills: [] } });
    const before = await originSha(fixture.bare);

    const result = await run({ kind: 'project-create', name: 'payments', config: store, runner }, new ScriptedPrompter());

    expect(result).toMatchObject({ ok: false, error: 'team already has a project named Payments.' });
    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('refuses a repository another project already claims', async () => {
    const { fixture, store, runner } = await prepared({ Payments: { remotes: ['github.com/acme/payments'], skills: [] } });
    const before = await originSha(fixture.bare);

    const result = await run({ kind: 'project-create', name: 'Billing', remote: 'git@github.com:acme/payments.git', config: store, runner }, new ScriptedPrompter());

    expect(result).toMatchObject({ ok: false, error: 'Payments already claims github.com/acme/payments; a repository belongs to one project.' });
    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('refuses a malformed name and a malformed remote before writing', async () => {
    const { fixture, store, runner } = await prepared();
    const before = await originSha(fixture.bare);

    const bad = await run({ kind: 'project-create', name: '.hidden', config: store, runner }, new ScriptedPrompter());
    expect(bad).toMatchObject({ ok: false });
    expect(bad.ok ? '' : bad.error).toContain('a project name is 1-64 characters');

    const badRemote = await run({ kind: 'project-create', name: 'Payments', remote: 'not a url', config: store, runner }, new ScriptedPrompter());
    expect(badRemote.ok).toBe(false);

    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('asks for the name only when it is interactive, and refuses otherwise', async () => {
    const { store, runner } = await prepared();

    const closed = await run({ kind: 'project-create', config: store, runner }, new ScriptedPrompter());
    expect(closed).toMatchObject({ ok: false, error: 'Specify a project name.' });

    const io = new ScriptedPrompter(['Payments'], [], true);
    const asked = await run({ kind: 'project-create', config: store, runner }, io);
    expect(asked).toMatchObject({ ok: true, value: { name: 'Payments' } });
    expect(io.askedAbout('Project name?')).toBe(true);
  });

  it('sees a project another member created while this one was running', async () => {
    const { fixture, store, runner } = await prepared();
    let raced = false;
    const racing: Runner = {
      run: async (command, args, options) => {
        // Land a competing Payments on origin between the refresh and the push, so the re-apply
        // must re-read team.json rather than replay its own decision.
        if (!raced && command === 'git' && args[0] === 'push') {
          raced = true;
          await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ ...TEAM_JSON, projects: { Payments: { remotes: [], skills: [] } } })}\n`);
        }
        return runner.run(command, args, options);
      },
    };

    const result = await run({ kind: 'project-create', name: 'Payments', config: store, runner: racing }, new ScriptedPrompter());

    expect(result).toMatchObject({ ok: false, error: 'team already has a project named Payments.' });
  });
});

describe('team project delete — the list goes, the skills stay', () => {
  const ID = '11111111-1111-4111-8111-111111111111';

  it('removes the key and leaves every other project and the skills untouched', async () => {
    const { fixture, store, runner } = await prepared({ Global: { remotes: [], skills: [ID] }, Payments: { remotes: ['github.com/acme/payments'], skills: [] } });
    const io = new ScriptedPrompter([], [true]);

    const result = await run({ kind: 'project-delete', name: 'Global', config: store, runner }, io);

    expect(result).toMatchObject({ ok: true, value: { team: 'team', name: 'Global', skills: 1 } });
    const team = await teamOnOrigin(fixture.seed);
    expect(team.projects).toEqual({ Payments: { remotes: ['github.com/acme/payments'], skills: [] } });
    // The question is the whole safety story, so it is asserted verbatim.
    expect(io.asked).toContain('Delete project Global from team? Its 1 skill stays in the marketplace; only the project list is removed.');
    expect(io.lines).toContain('Deleted project Global from team.');
  });

  it('a declined confirmation writes nothing', async () => {
    const { fixture, store, runner } = await prepared({ Global: { remotes: [], skills: [] } });
    const before = await originSha(fixture.bare);

    const result = await run({ kind: 'project-delete', name: 'Global', config: store, runner }, new ScriptedPrompter([], [false]));

    expect(result).toMatchObject({ ok: false, cancelled: true, error: 'Project Global was not deleted.' });
    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('--yes skips the question, which is what the app and a script need', async () => {
    const { fixture, store, runner } = await prepared({ Global: { remotes: [], skills: [] } });
    const io = new ScriptedPrompter();

    expect(await run({ kind: 'project-delete', name: 'Global', yes: true, config: store, runner }, io)).toMatchObject({ ok: true });
    expect(io.asked).toEqual([]);
    expect(await teamOnOrigin(fixture.seed)).toMatchObject({ projects: {} });
  });

  it('refuses a name the team does not have, matched exactly, before anything is written', async () => {
    const { fixture, store, runner } = await prepared({ Global: { remotes: [], skills: [] } });
    const before = await originSha(fixture.bare);

    expect(await run({ kind: 'project-delete', name: 'global', config: store, runner }, new ScriptedPrompter([], [true])))
      .toMatchObject({ ok: false, error: 'team has no project named global.' });
    expect(await originSha(fixture.bare)).toBe(before);
  });

  it('asks for the name only when it is interactive, and refuses otherwise', async () => {
    const { store, runner } = await prepared({ Global: { remotes: [], skills: [] } });

    expect(await run({ kind: 'project-delete', config: store, runner }, new ScriptedPrompter()))
      .toMatchObject({ ok: false, error: 'Specify a project name.' });

    const io = new ScriptedPrompter(['Global'], [true], true);
    expect(await run({ kind: 'project-delete', config: store, runner }, io)).toMatchObject({ ok: true, value: { name: 'Global' } });
    expect(io.askedAbout('Project name?')).toBe(true);
  });
});
