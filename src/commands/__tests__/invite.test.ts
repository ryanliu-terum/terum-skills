import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { ScriptedPrompter, fakeGh, ghOnlyRunner, noGhRunner, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { joinCommand, run } from '../invite.js';

describe('invite (§6 host scoping)', () => {
  it('formats the setup command the owner sends to a teammate', () => {
    expect(joinCommand('acme/team')).toBe('npx -y terum-skills@latest setup acme/team');
  });

  it('parses real gh status headers for invited, existing, and repository-owner responses and prints one join block', async () => {
    const store = createConfigStore(await temporaryDirectory());
    await store.update((config) => { config.teams.team = { remote: 'github.com/acme/team', handle: 'admin' }; });
    const runner = ghOnlyRunner((args) => {
      const endpoint = args.at(-1)!;
      if (endpoint.endsWith('/new')) return { code: 0, stdout: 'HTTP/2.0 201 Created\r\n', stderr: '' };
      if (endpoint.endsWith('/member')) return { code: 0, stdout: 'HTTP/2.0 204 No Content\r\n', stderr: '' };
      return { code: 1, stdout: 'HTTP/2.0 422 Unprocessable Entity\r\n', stderr: 'gh: Validation Failed (HTTP 422)' };
    });
    const io = new ScriptedPrompter();
    const result = await run({ logins: ['new', 'member', 'acme'], config: store, runner }, io);
    expect(result).toMatchObject({ ok: true, value: { invited: ['new'], already: ['member', 'acme'] } });
    expect(io.lines.join('\n')).toContain('npx -y terum-skills@latest setup acme/team');
    // The global install line comes first inside the fence so a teammate gets the bare command as well (Ryan, 2026-09-06).
    expect(io.lines.join('\n')).toContain('```\nnpm install -g terum-skills\nnpx -y terum-skills@latest setup acme/team');
    expect(io.lines.join('\n')).toContain('npx -y terum-skills@latest team join acme/team');
  });

  it('validates every API-path login and reports non-owner failures without stopping later invitations', async () => {
    const store = createConfigStore(await temporaryDirectory());
    await store.update((config) => { config.teams.team = { remote: 'github.com/acme/team', handle: 'admin' }; });
    const runner = ghOnlyRunner((args) => {
      const endpoint = args.at(-1)!;
      if (endpoint.endsWith('/bad')) return { code: 1, stdout: 'HTTP/2.0 422 Unprocessable Entity\r\n', stderr: 'gh: Validation Failed (HTTP 422)' };
      return { code: 0, stdout: 'HTTP/2.0 201 Created\r\n', stderr: '' };
    });
    const io = new ScriptedPrompter();
    const result = await run({ logins: ['bad', 'later'], config: store, runner }, io);
    expect(result).toMatchObject({ ok: false, value: { invited: ['later'], already: [], failed: [{ login: 'bad' }] } });
    expect(io.lines.join('\n')).toContain('Could not invite @bad');
    await expect(run({ logins: ['x/../repos/acme/other'], config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('Invalid GitHub login') });
    expect(runner.calls.filter((call) => call.args.includes('x/../repos/acme/other'))).toHaveLength(0);
  });

  it('refuses a generic remote before it invokes gh', async () => {
    const store = createConfigStore(await temporaryDirectory());
    await store.update((config) => { config.teams.team = { remote: 'git.example/acme/team', handle: 'admin' }; });
    const runner = ghOnlyRunner(() => ({ code: 0, stdout: '', stderr: '' }));
    await expect(run({ logins: ['new'], config: store, runner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('Access is managed on the host') });
    expect(runner.calls).toEqual([]);
  });
  it('says gh is missing or logged out instead of blaming the invitation cap, now that no per-team token stands in', async () => {
    const store = createConfigStore(await temporaryDirectory());
    await store.update((config) => { config.teams.team = { remote: 'github.com/acme/team', handle: 'admin' }; });
    await expect(run({ logins: ['new'], config: store, runner: ghOnlyRunner(fakeGh('admin', {}, false)) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('gh auth login') });
    await expect(run({ logins: ['new'], config: store, runner: noGhRunner }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('not installed') });
  });

});


it.each([['new'], ['member'], ['bad', 'new']])('invitation block stays conditional after %j (issue 11)', async (...logins) => {
  const store = createConfigStore(await temporaryDirectory());
  await store.update((config) => { config.teams.team = { remote: 'github.com/acme/team', handle: 'admin' }; });
  const runner = ghOnlyRunner((args) => {
    if (args.at(-1)!.endsWith('/bad')) return { code: 1, stdout: 'HTTP/2.0 422 Unprocessable Entity\r\n', stderr: 'failed' };
    return { code: 0, stdout: args.at(-1)!.endsWith('/member') ? 'HTTP/2.0 204 No Content\r\n' : 'HTTP/2.0 201 Created\r\n', stderr: '' };
  });
  const io = new ScriptedPrompter();
  await run({ logins, config: store, runner }, io);
  expect(io.lines.join('\n')).toContain('```\nIf you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.');
});

it('issue 5 labels the teammate invitation as Send', async () => {
  const store = createConfigStore(await temporaryDirectory());
  await store.update((config) => { config.teams.team = { remote: 'github.com/acme/team', handle: 'admin' }; });
  const io = new ScriptedPrompter();
  const result = await run({ logins: ['new'], config: store, runner: ghOnlyRunner(() => ({ code: 0, stdout: 'HTTP/2.0 201 Created\r\n', stderr: '' })) }, io);
  expect(result.ok).toBe(true);
  expect(io.lines.join('\n').split('\n')).toContain('Send this to your teammate:');
});
