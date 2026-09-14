import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { place } from '../../lib/placer.js';
import { bareTeam, cloneWithIdentity, exists, fakeGh, git, mappedRunner, originSha, pushFromSeed, ScriptedPrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { rememberPlacements, run as move } from '../teamMove.js';
import { run as team } from '../team.js';

const OLD = 'https://github.com/acme/team.git';
const NEW = 'https://github.com/acme/team-2.git';
const ID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const skill = (name: string, id: string) => `---\nname: ${name}\ndescription: ${name}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nbody of ${name}\n`;

/** An old team with two skills placed here (one global, one in a checkout), and a new, unrelated repository that shares only `sample`. */
async function prepared(options: { shareSample?: boolean } = {}) {
  const old = await bareTeam();
  await pushFromSeed(old.seed, 'skills/sample/v1/SKILL.md', skill('sample', ID));
  await pushFromSeed(old.seed, 'skills/other/v1/SKILL.md', skill('other', OTHER));
  const fresh = await bareTeam();
  if (options.shareSample !== false) await pushFromSeed(fresh.seed, 'skills/sample/v1/SKILL.md', skill('sample', ID));
  const store = createConfigStore(pathJoin(old.root, 'state'));
  const home = pathJoin(old.root, 'home');
  await cloneWithIdentity(old.bare, store.teamClone('team'));
  const checkout = pathJoin(old.root, 'checkout'); await mkdir(pathJoin(checkout, '.git'), { recursive: true });
  const globalRoot = pathJoin(home, '.claude', 'skills');
  const projectRoot = pathJoin(checkout, '.claude', 'skills');
  const placedSample = await place(pathJoin(store.teamClone('team'), 'skills', 'sample', 'v1'), globalRoot, 'sample');
  const placedOther = await place(pathJoin(store.teamClone('team'), 'skills', 'other', 'v1'), projectRoot, 'other');
  await store.update((config) => {
    config.default_handle = 'me'; config.github = 'me'; config.display_name = 'Me'; config.email = 'me@example.com';
    config.teams.team = { remote: OLD, handle: 'me' };
    config.placements[placedSample.path] = { id: ID, team: 'team', version: 'v1', scope: { kind: 'global' }, placed_at: '2026-01-01', fingerprint: placedSample.snapshot.fingerprint };
    config.placements[placedOther.path] = { id: OTHER, team: 'team', version: 'v1', scope: { kind: 'project', project: 'Global' }, placed_at: '2026-01-01', fingerprint: placedOther.snapshot.fingerprint };
    config.approvals['sha256:keep'] = { grants: 'sha256:keep', approved_at: '2026-01-01' };
  });
  // git maps both public remotes onto the two bare fixtures; gh answers the invitation lookup for the new one.
  const runner = wrapRunner(mappedRunner(NEW, fresh.bare, fakeGh('me', { 'api user/repository_invitations': { code: 0, stdout: '[]', stderr: '' } })), async (command, args, options, next) => {
    if (command === 'git' && args.includes(OLD)) throw new Error(`the old remote must never be contacted: git ${args.join(' ')}`);
    return next();
  });
  return { old, fresh, store, home, runner, placedSample, placedOther, checkout };
}

describe('team move', () => {
  it('leaves the old team locally, joins the new one, re-places the shared skill at its scope, reports the unshared one, and keeps consent records', async () => {
    const { old, fresh, store, home, runner, placedSample, placedOther } = await prepared();
    const oldSha = await originSha(old.bare);
    const io = new ScriptedPrompter([], [true]);
    const result = await move({ target: 'acme/team-2', config: store, runner, home }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toMatchObject({ from: 'team', to: 'team-2', handle: 'me', restored: ['sample'], missing: ['other'], failed: [] });
    expect(result.value.fromRemote).toBe(OLD); expect(result.value.toRemote).toBe('github.com/acme/team-2');
    expect(io.asked[0]).toBe('Move this machine from team (https://github.com/acme/team) to https://github.com/acme/team-2?');
    expect(io.details[io.asked[0]!]![0]).toBe('2 placed skill(s) from team will be removed, then placed again from the new team where it shares them.');
    const config = await store.read();
    expect(Object.keys(config.teams)).toEqual(['team-2']);
    expect(config.teams['team-2']).toEqual({ remote: 'github.com/acme/team-2', handle: 'me' });
    expect(config.approvals['sha256:keep']).toEqual({ grants: 'sha256:keep', approved_at: '2026-01-01' });
    // The shared skill is back at the same global path, from the new clone; the unshared one is gone with the old team.
    expect(await exists(placedSample.path)).toBe(true);
    expect(await readFile(pathJoin(placedSample.path, 'SKILL.md'), 'utf8')).toContain('body of sample');
    expect(Object.values(config.placements).map((entry) => entry.team)).toEqual(['team-2']);
    expect(await exists(placedOther.path)).toBe(false);
    expect(await exists(store.teamClone('team'))).toBe(false);
    expect(await exists(pathJoin(store.teamClone('team-2'), 'team.json'))).toBe(true);
    // The new roster carries this machine; the old repository was never written to (and never even fetched).
    expect(await git(['show', 'main:people/me.json'], fresh.bare)).toContain('"handle": "me"');
    expect(await originSha(old.bare)).toBe(oldSha);
    expect(io.lines.at(-1)).toBe('Moved to team-2 as me: 1 skill(s) placed again, 1 not shared there (other).');
  });

  it('is one confirmation, declinable, and --yes skips it; a non-interactive run without --yes fails closed before touching anything', async () => {
    const { store, runner, home, placedSample } = await prepared();
    const declined = await move({ target: 'acme/team-2', config: store, runner, home }, new ScriptedPrompter([], [false]));
    expect(declined).toMatchObject({ ok: false, cancelled: true, error: 'Move was cancelled.' });
    expect(Object.keys((await store.read()).teams)).toEqual(['team']);
    expect(await exists(placedSample.path)).toBe(true);
    const closed = await move({ target: 'acme/team-2', config: store, runner, home }, new ScriptedPrompter([], []));
    expect(closed.ok).toBe(false); expect(closed.ok ? '' : closed.error).toMatch(/Input ended before/);
    expect(Object.keys((await store.read()).teams)).toEqual(['team']);
    const yes = await move({ target: 'acme/team-2', config: store, runner, home, yes: true }, new ScriptedPrompter([], []));
    expect(yes).toMatchObject({ ok: true, value: { to: 'team-2', restored: ['sample'] } });
  });

  it('refuses to move a team onto the remote it already has, and names --from when two teams are configured', async () => {
    const { store, runner, home } = await prepared();
    const same = await move({ target: 'acme/team', config: store, runner, home, yes: true }, new ScriptedPrompter());
    expect(same.ok ? '' : same.error).toMatch(/already on https:\/\/github.com\/acme\/team; nothing to move/);
    await store.update((config) => { config.teams.second = { remote: 'https://github.com/acme/second.git', handle: 'me' }; });
    const ambiguous = await move({ target: 'acme/team-2', config: store, runner, home, yes: true }, new ScriptedPrompter());
    expect(ambiguous.ok ? '' : ambiguous.error).toMatch(/configured for teams team, second/);
    expect(Object.keys((await store.read()).teams).sort()).toEqual(['second', 'team']);
  });

  it('reports a re-placement failure without failing the move: the machine is on the new team either way', async () => {
    const { old, store, runner } = await prepared();
    // Placement cannot create its root: `.claude` under this home is a file, not a folder.
    const home = pathJoin(old.root, 'home-broken'); await mkdir(home, { recursive: true }); await writeFile(pathJoin(home, '.claude'), 'in the way');
    const result = await move({ target: 'acme/team-2', config: store, runner, home, yes: true }, new ScriptedPrompter());
    if (!result.ok) throw new Error(result.error);
    expect(result.value.restored).toEqual([]);
    expect(result.value.failed.map((entry) => entry.name)).toEqual(['sample']);
    expect(Object.keys((await store.read()).teams)).toEqual(['team-2']);
  });

  it('runs through the team verb dispatcher as kind move', async () => {
    const { store, runner, home } = await prepared({ shareSample: false });
    const result = await team({ kind: 'move', target: 'acme/team-2', config: store, runner, home, yes: true }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { to: 'team-2', restored: [], missing: ['other', 'sample'] } });
  });
});

describe('rememberPlacements', () => {
  it('turns the ledger into install inputs: names from the folder, checkout roots two levels above .claude/skills, sorted', () => {
    const config = { teams: {}, approvals: {}, pending: [], placements: {
      '/home/me/.claude/skills/zeta': { id: ID, team: 'team', version: null, scope: { kind: 'global' as const }, placed_at: '', fingerprint: '' },
      '/work/app/.claude/skills/alpha': { id: OTHER, team: 'team', version: null, scope: { kind: 'project' as const, project: 'App' }, placed_at: '', fingerprint: '' },
      '/home/me/.claude/skills/other-team': { id: OTHER, team: 'elsewhere', version: null, scope: { kind: 'global' as const }, placed_at: '', fingerprint: '' },
    } };
    expect(rememberPlacements(config, 'team')).toEqual([
      { name: 'alpha', scope: { kind: 'project', project: 'App' }, destination: { kind: 'checkout', root: '/work/app' } },
      { name: 'zeta', scope: { kind: 'global' }, destination: { kind: 'global' } },
    ]);
  });
});
