import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, git, mappedRunner, person, pushFromSeed, ScriptedPrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { run } from '../team.js';

const REMOTE = 'https://github.com/acme/team.git';

async function prepared() {
  const fixture = await bareTeam();
  await pushFromSeed(fixture.seed, 'people/admin.json', `${JSON.stringify(person('admin'), null, 2)}\n`);
  await pushFromSeed(fixture.seed, 'people/member.json', `${JSON.stringify(person('member', { github: 'member-gh' }), null, 2)}\n`);
  const store = createConfigStore(join(fixture.root, 'local'));
  await store.ensureRoot();
  await cloneWithIdentity(fixture.bare, store.teamClone('team'), 'Admin', 'admin@example.com');
  await store.update((config) => { config.teams.team = { remote: REMOTE, token: null, handle: 'admin' }; });
  return { fixture, store };
}

describe('team remove (§6)', () => {
  it('checks admin, archives, then revokes access and cancels a page-two pending invitation', async () => {
    const { fixture, store } = await prepared();
    const runner = mappedRunner(REMOTE, fixture.bare, (args) => {
      const key = args.join(' ');
      if (key === 'api repos/acme/team -q .permissions.admin') return { code: 0, stdout: 'true\n', stderr: '' };
      if (key === 'api repos/acme/team/collaborators?permission=admin --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'admin' }], [{ login: 'member-gh' }]]), stderr: '' };
      if (key === 'api repos/acme/team/collaborators --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'member-gh' }]]), stderr: '' };
      if (key === 'api -X DELETE repos/acme/team/collaborators/member-gh') return { code: 0, stdout: '', stderr: '' };
      if (key === 'api repos/acme/team/invitations --paginate --slurp') return { code: 0, stdout: JSON.stringify([[], [{ id: 9, invitee: { login: 'member-gh' } }]]), stderr: '' };
      if (key === 'api -X DELETE repos/acme/team/invitations/9') return { code: 0, stdout: '', stderr: '' };
      return { code: 1, stdout: '', stderr: `unexpected gh ${key}` };
    });
    const result = await run({ kind: 'remove', handle: 'member', config: store, runner }, new ScriptedPrompter([], [true]));
    expect(result).toMatchObject({ ok: true, value: { handle: 'member' } });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).archived).toEqual(['member']);
    expect(runner.calls.some((call) => call.args.join(' ') === 'api -X DELETE repos/acme/team/invitations/9')).toBe(true);
    expect(runner.calls.some((call) => call.args.includes('--paginate'))).toBe(true);
  });

  it('refuses self and the last remaining admin before access changes', async () => {
    const { fixture, store } = await prepared();
    const runner = mappedRunner(REMOTE, fixture.bare, (args) => {
      const key = args.join(' ');
      if (key === 'api repos/acme/team -q .permissions.admin') return { code: 0, stdout: 'true', stderr: '' };
      if (key === 'api repos/acme/team/collaborators?permission=admin --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'member-gh' }]]), stderr: '' };
      return { code: 1, stdout: '', stderr: 'unexpected' };
    });
    await expect(run({ kind: 'remove', handle: 'admin', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('cannot remove yourself') });
    await expect(run({ kind: 'remove', handle: 'member', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('last remaining admin') });
    expect(runner.calls.some((call) => call.args.includes('DELETE'))).toBe(false);
  });

  it('generic remotes fail without mutation except archive-only, which preserves people history', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'people/admin.json', `${JSON.stringify(person('admin'), null, 2)}\n`);
    await pushFromSeed(fixture.seed, 'people/member.json', `${JSON.stringify(person('member'), null, 2)}\n`);
    const store = createConfigStore(join(fixture.root, 'local'));
    await store.ensureRoot();
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, token: null, handle: 'admin' }; });
    const before = (await git(['rev-parse', 'main'], fixture.bare)).trim();
    await expect(run({ kind: 'remove', handle: 'member', config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('Access is managed on the host') });
    expect((await git(['rev-parse', 'main'], fixture.bare)).trim()).toBe(before);
    await expect(run({ kind: 'remove', handle: 'member', archiveOnly: true, config: store }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).archived).toEqual(['member']);
    expect(await git(['show', 'main:people/member.json'], fixture.bare)).toContain('member');
    expect(await git(['show', 'main:README.md'], fixture.bare)).not.toContain('- @member — member');
  });

  it('removes a member who joined after this machine last synced (reads origin/main, not the stale clone)', async () => {
    const { fixture, store } = await prepared();
    await pushFromSeed(fixture.seed, 'people/late.json', `${JSON.stringify(person('late', { github: 'late-gh' }), null, 2)}\n`);
    const runner = mappedRunner(REMOTE, fixture.bare, (args) => {
      const key = args.join(' ');
      if (key === 'api repos/acme/team -q .permissions.admin') return { code: 0, stdout: 'true\n', stderr: '' };
      if (key === 'api repos/acme/team/collaborators?permission=admin --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'admin' }]]), stderr: '' };
      if (key === 'api repos/acme/team/collaborators --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'late-gh' }]]), stderr: '' };
      if (key === 'api -X DELETE repos/acme/team/collaborators/late-gh') return { code: 0, stdout: '', stderr: '' };
      if (key === 'api repos/acme/team/invitations --paginate --slurp') return { code: 0, stdout: '[[]]', stderr: '' };
      return { code: 1, stdout: '', stderr: `unexpected gh ${key}` };
    });
    const result = await run({ kind: 'remove', handle: 'late', config: store, runner }, new ScriptedPrompter([], [true]));
    expect(result).toMatchObject({ ok: true, value: { handle: 'late' } });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).archived).toEqual(['late']);
  });

  it('rejects malformed legacy GitHub logins before any gh call or team write', async () => {
    for (const github of ['', 'x/../repos/acme/other', 'bad--login']) {
      const { fixture, store } = await prepared();
      await pushFromSeed(fixture.seed, 'people/member.json', `${JSON.stringify(person('member', { github }), null, 2)}\n`);
      const before = (await git(['rev-parse', 'main'], fixture.bare)).trim();
      const runner = mappedRunner(REMOTE, fixture.bare, () => ({ code: 1, stdout: '', stderr: 'gh must not run' }));
      await expect(run({ kind: 'remove', handle: 'member', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('GitHub login for member') });
      expect(runner.calls.filter((call) => call.command === 'gh')).toHaveLength(0);
      expect((await git(['rev-parse', 'main'], fixture.bare)).trim()).toBe(before);
    }
    const { fixture, store } = await prepared();
    await pushFromSeed(fixture.seed, 'people/ghost.json', `${JSON.stringify(person('ghost', { github: '' }), null, 2)}\n`);
    const runner = mappedRunner(REMOTE, fixture.bare, () => ({ code: 1, stdout: '', stderr: 'gh must not run' }));
    await expect(run({ kind: 'remove', handle: 'ghost', config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('GitHub login for ghost') });
    expect(runner.calls.filter((call) => call.command === 'gh')).toHaveLength(0);
  });

  it('requires the GitHub admin probe even for GitHub archive-only, but keeps generic archive-only available', async () => {
    const { fixture, store } = await prepared();
    const before = (await git(['rev-parse', 'main'], fixture.bare)).trim();
    const runner = mappedRunner(REMOTE, fixture.bare, (args) => args.join(' ') === 'api repos/acme/team -q .permissions.admin'
      ? { code: 0, stdout: 'false\n', stderr: '' }
      : { code: 1, stdout: '', stderr: 'unexpected gh' });
    await expect(run({ kind: 'remove', handle: 'member', archiveOnly: true, config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('admin permission') });
    expect((await git(['rev-parse', 'main'], fixture.bare)).trim()).toBe(before);
  });

  it('does not mutate the host when the confirmation is declined, and archives before a host failure', async () => {
    const { fixture, store } = await prepared();
    const host = (args: readonly string[]) => {
      const key = args.join(' ');
      if (key === 'api repos/acme/team -q .permissions.admin') return { code: 0, stdout: 'true\n', stderr: '' };
      if (key === 'api repos/acme/team/collaborators?permission=admin --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'admin' }]]), stderr: '' };
      if (key === 'api repos/acme/team/collaborators --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'member-gh' }]]), stderr: '' };
      if (key === 'api repos/acme/team/invitations --paginate --slurp') return { code: 0, stdout: '[[]]', stderr: '' };
      if (key === 'api -X DELETE repos/acme/team/collaborators/member-gh') return { code: 1, stdout: '', stderr: 'host denied revoke' };
      return { code: 1, stdout: '', stderr: `unexpected gh ${key}` };
    };
    const denied = mappedRunner(REMOTE, fixture.bare, host);
    const before = (await git(['rev-parse', 'main'], fixture.bare)).trim();
    await expect(run({ kind: 'remove', handle: 'member', config: store, runner: denied }, new ScriptedPrompter([], [false]))).resolves.toMatchObject({ ok: false, error: 'Team removal was cancelled.' });
    expect(denied.calls.some((call) => call.args.includes('DELETE'))).toBe(false);
    expect((await git(['rev-parse', 'main'], fixture.bare)).trim()).toBe(before);

    const failing = mappedRunner(REMOTE, fixture.bare, host);
    await expect(run({ kind: 'remove', handle: 'member', config: store, runner: failing }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: false, error: expect.stringContaining("member is archived; @member-gh's access could not be revoked") });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).archived).toEqual(['member']);
  });

  it('does not revoke access when the archive push is refused', async () => {
    const { fixture, store } = await prepared();
    const base = mappedRunner(REMOTE, fixture.bare, (args) => {
      const key = args.join(' ');
      if (key === 'api repos/acme/team -q .permissions.admin') return { code: 0, stdout: 'true\n', stderr: '' };
      if (key === 'api repos/acme/team/collaborators?permission=admin --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'admin' }]]), stderr: '' };
      if (key === 'api repos/acme/team/collaborators --paginate --slurp') return { code: 0, stdout: JSON.stringify([[{ login: 'member-gh' }]]), stderr: '' };
      if (key === 'api repos/acme/team/invitations --paginate --slurp') return { code: 0, stdout: '[[]]', stderr: '' };
      return { code: 1, stdout: '', stderr: `unexpected gh ${key}` };
    });
    const runner = wrapRunner(base, async (command, args, _options, next) => command === 'git' && args[0] === 'push'
      ? { code: 1, stdout: '', stderr: 'remote: Permission denied' }
      : next());
    await expect(run({ kind: 'remove', handle: 'member', config: store, runner }, new ScriptedPrompter([], [true]))).resolves.toMatchObject({ ok: false, error: expect.stringContaining('Permission denied') });
    expect(base.calls.some((call) => call.command === 'gh' && call.args.includes('DELETE'))).toBe(false);
  });
});
