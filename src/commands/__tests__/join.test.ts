import { readdir, readFile } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import { join, MAX_HANDLE_ATTEMPTS, parseJoinTarget } from '../team.js';
import { PromptClosedError } from '../../lib/prompt.js';
import { createConfigStore } from '../../lib/config.js';
import { systemRunner } from '../../lib/runner.js';
import { bareTeam, fakeGh, git, mappedRunner, person, pushFromSeed, ScriptedPrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';

const REMOTE = 'https://git.example/team.git';
const answers = (handle = 'me', name = 'Me', email = 'me@example.com') => ['me', handle, name, email];

async function setup(extra?: { archived?: string[]; people?: Record<string, object> }) {
  const fixture = await bareTeam();
  if (extra?.people) for (const [handle, record] of Object.entries(extra.people)) await pushFromSeed(fixture.seed, `people/${handle}.json`, `${JSON.stringify(record, null, 2)}\n`);
  if (extra?.archived) await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ ...JSON.parse(await readFile(pathJoin(fixture.seed, 'team.json'), 'utf8')), archived: extra.archived }, null, 2)}\n`);
  const store = createConfigStore(pathJoin(fixture.root, 'local'));
  return { fixture, store, runner: mappedRunner(REMOTE, fixture.bare) };
}

describe('team join (§6, §5.4 identity)', () => {
  it('a live collision re-prompts, the per-team handle diverges, and team one is untouched', async () => {
    const { fixture, store, runner } = await setup({ people: { ajay: person('ajay', { display_name: 'Existing' }) } });
    await store.update((config) => { config.default_handle = 'ajay'; config.github = 'me'; config.display_name = 'Me'; config.email = 'me@example.com'; config.teams.first = { remote: 'github.com/example/first', token: null, handle: 'ajay' }; });
    const io = new ScriptedPrompter(['me', 'ajay', 'Ajay Two', 'ajay.two@example.com', 'ajay-t']);
    const result = await join({ target: REMOTE, config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toMatchObject({ team: 'team', handle: 'ajay-t', rejoined: false });
    expect(io.lines).toContain('Handle ajay is already in use by an active member.');
    const after = await store.read();
    expect(after.teams.first?.handle).toBe('ajay');
    expect(after.teams.team).toEqual({ remote: 'git.example/team', token: null, handle: 'ajay-t' });
    expect(JSON.parse(await git(['show', 'main:people/ajay-t.json'], fixture.bare)).email).toBe('ajay.two@example.com');
    expect(JSON.parse(await git(['show', 'main:people/ajay.json'], fixture.bare)).display_name).toBe('Existing');
    expect((await git(['log', '-1', '--format=%s', 'main'], fixture.bare)).trim()).toBe('ajay-t: join');
  });

  it('prints the roster of active members after joining', async () => {
    const { store, runner } = await setup({ people: { ghost: person('ghost') }, archived: ['ghost'] });
    const io = new ScriptedPrompter(answers());
    const result = await join({ target: REMOTE, config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.roster.map((entry) => entry.handle)).toEqual(['me', 'seed']);
    expect(io.lines.join('\n')).toMatch(/Joined team as me\nMembers:\n  me  Me\n  seed  seed/);
  });

  it('an archived handle is a rejoin: the existing people file is reused and the handle leaves archived (guard row e)', async () => {
    const { fixture, store, runner } = await setup({ people: { ghost: person('ghost', { bio: 'old bio', installed: [] }) }, archived: ['ghost'] });
    const result = await join({ target: REMOTE, config: store, runner }, new ScriptedPrompter(answers('ghost', 'Ghost Again', 'ghost@example.com')));
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toMatchObject({ handle: 'ghost', rejoined: true });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).archived).toEqual([]);
    expect(JSON.parse(await git(['show', 'main:people/ghost.json'], fixture.bare))).toMatchObject({ bio: 'old bio', display_name: 'Ghost Again' });
  });

  it('a repeat join on the same machine keeps the bound handle, asks no handle question, and creates no second people file', async () => {
    const { fixture, store, runner } = await setup();
    expect((await join({ target: REMOTE, config: store, runner }, new ScriptedPrompter(answers()))).ok).toBe(true);
    const io = new ScriptedPrompter(['me', 'Me Again', 'me@example.com']);
    const again = await join({ target: REMOTE, config: store, runner, as: 'other' }, io);
    if (!again.ok) throw new Error(again.error);
    expect(again.value.handle).toBe('me');
    expect(io.askedAbout('Team handle')).toBe(false);
    expect(io.lines.some((line) => line.includes('ignoring --as other'))).toBe(true);
    expect((await readdir(pathJoin(store.teamClone('team'), 'people'))).sort()).toEqual(['me.json', 'seed.json']);
    expect(Object.keys((await store.read()).teams)).toEqual(['team']);
    expect(JSON.parse(await git(['show', 'main:people/me.json'], fixture.bare)).display_name).toBe('Me Again');
  });

  it('a handle taken between the preflight read and the push is caught inside the replayed mutation, never overwritten', async () => {
    const { fixture, store } = await setup();
    let pushes = 0;
    const runner = wrapRunner(mappedRunner(REMOTE, fixture.bare), async (command, args, _options, next) => {
      if (command === 'git' && args[0] === 'push' && pushes++ === 0) await pushFromSeed(fixture.seed, 'people/me.json', `${JSON.stringify(person('me', { display_name: 'First Mover' }))}\n`);
      return next();
    });
    const io = new ScriptedPrompter([...answers(), 'me-2']);
    const result = await join({ target: REMOTE, config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.handle).toBe('me-2');
    expect(JSON.parse(await git(['show', 'main:people/me.json'], fixture.bare)).display_name).toBe('First Mover');
    expect((await store.read()).teams.team?.handle).toBe('me-2');
    expect((await git(['status', '--porcelain'], store.teamClone('team'))).trim()).toBe('');
  });

  it('never reuses a clone that belongs to another remote, and never reuses a team name bound to another remote', async () => {
    const { fixture, store, runner } = await setup();
    const other = await bareTeam();
    await git(['clone', '-q', other.bare, store.teamClone('team')]);
    expect(await join({ target: REMOTE, config: store, runner }, new ScriptedPrompter(answers()))).toMatchObject({ ok: false, error: expect.stringContaining('is a clone of') });
    expect((await git(['ls-tree', '--name-only', 'main:people'], other.bare))).not.toContain('me.json');
    expect((await git(['ls-tree', '--name-only', 'main:people'], fixture.bare))).not.toContain('me.json');
    const store2 = createConfigStore(pathJoin(fixture.root, 'local2'));
    await store2.update((config) => { config.teams.team = { remote: 'github.com/someone/team', token: null, handle: 'me' }; });
    expect(await join({ target: REMOTE, config: store2, runner }, new ScriptedPrompter(answers()))).toMatchObject({ ok: false, error: expect.stringContaining('--as') });
  });

  it('GitHub targets: with gh, list-then-PATCH the invitation; without gh, print the URL and wait for a y', async () => {
    const { fixture, store } = await setup();
    const target = 'Acme/Team';
    const github = 'https://github.com/Acme/Team.git';
    const withGh = mappedRunner(github, fixture.bare, fakeGh('me', {
      'api user/repository_invitations': { code: 0, stdout: JSON.stringify([{ id: 7, repository: { full_name: 'other/repo' } }, { id: 42, repository: { full_name: 'acme/team' } }]), stderr: '' },
      'api --method PATCH user/repository_invitations/42': { code: 0, stdout: '{}', stderr: '' },
    }));
    const result = await join({ target, config: store, runner: withGh }, new ScriptedPrompter(['', 'me', 'Me', 'me@example.com']));
    if (!result.ok) throw new Error(result.error);
    expect(withGh.calls.some((call) => call.args.join(' ') === 'api --method PATCH user/repository_invitations/42')).toBe(true);
    expect(result.value.team).toBe('team');

    const store2 = createConfigStore(pathJoin(fixture.root, 'local2'));
    const io = new ScriptedPrompter(answers('me2'), [true]);
    const noGh = await join({ target, config: store2, runner: mappedRunner(github, fixture.bare) }, io);
    if (!noGh.ok) throw new Error(noGh.error);
    expect(noGh.value.handle).toBe('me2');
    expect(io.lines[0]).toBe('Accept the invitation at https://github.com/Acme/Team/invitations before continuing.');
    expect(io.askedAbout('Continue after accepting')).toBe(true);
    expect(io.asked.some((question) => /PAT|token/i.test(question))).toBe(false);
    const declined = await join({ target, config: createConfigStore(pathJoin(fixture.root, 'local3')), runner: mappedRunner(github, fixture.bare) }, new ScriptedPrompter([], [false]));
    expect(declined).toMatchObject({ ok: false, error: expect.stringContaining('declined') });
  });

  it('three consecutive collisions give up with the collision message, and an invalid re-prompt answer is re-asked with the rule', async () => {
    const { fixture, store, runner } = await setup({ people: { a: person('a'), b: person('b'), c: person('c') } });
    const io = new ScriptedPrompter([...answers('a'), 'b', 'c']);
    const result = await join({ target: REMOTE, config: store, runner }, io);
    expect(result).toMatchObject({ ok: false, error: 'Handle c is already in use by an active member.' });
    expect(io.countAsked('Team handle')).toBe(MAX_HANDLE_ATTEMPTS);
    expect((await git(['ls-tree', '--name-only', 'main:people'], fixture.bare)).split('\n').filter(Boolean).sort()).toEqual(['a.json', 'b.json', 'c.json', 'seed.json']);
    const io2 = new ScriptedPrompter([...answers('a'), 'Bad Handle', 'fine']);
    const ok = await join({ target: REMOTE, config: createConfigStore(pathJoin(fixture.root, 'local2')), runner }, io2);
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.value.handle).toBe('fine');
    expect(io2.lines.some((line) => line.includes('single internal hyphens'))).toBe(true);
  });

  it('a login-bound remote with no handle yet still runs the collision check; a bound handle only counts with matching identity', async () => {
    const { fixture, store, runner } = await setup({ people: { ajay: person('ajay', { github: 'real-ajay', email: 'real@example.com' }) } });
    await store.update((config) => { config.teams.team = { remote: 'git.example/team', token: null, handle: null }; config.default_handle = 'ajay'; });
    const io = new ScriptedPrompter([...answers('ajay'), 'ajay-2']);
    const result = await join({ target: REMOTE, config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.handle).toBe('ajay-2');
    expect(JSON.parse(await git(['show', 'main:people/ajay.json'], fixture.bare)).github).toBe('real-ajay');
    // A config that claims the handle but whose identity does not match the live file is still a collision.
    const store2 = createConfigStore(pathJoin(fixture.root, 'local2'));
    await store2.update((config) => { config.teams.team = { remote: 'git.example/team', token: null, handle: 'ajay' }; });
    const io2 = new ScriptedPrompter(['impostor', 'Impostor', 'imp@example.com', 'ajay-3']);
    const second = await join({ target: REMOTE, config: store2, runner }, io2);
    if (!second.ok) throw new Error(second.error);
    expect(second.value.handle).toBe('ajay-3');
    expect(JSON.parse(await git(['show', 'main:people/ajay.json'], fixture.bare)).email).toBe('real@example.com');
  });

  it('an archived handle is only a rejoin for the same person; someone else gets the collision prompt', async () => {
    const { fixture, store, runner } = await setup({ people: { ghost: person('ghost', { github: 'ghost-gh', email: 'ghost@example.com' }) }, archived: ['ghost'] });
    const io = new ScriptedPrompter(['other', 'ghost', 'Other', 'other@example.com', 'other']);
    const result = await join({ target: REMOTE, config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toMatchObject({ handle: 'other', rejoined: false });
    expect(JSON.parse(await git(['show', 'main:team.json'], fixture.bare)).archived).toEqual(['ghost']);
  });

  it('a closed prompt surfaces as a clean failure, not a hang', async () => {
    const { store, runner } = await setup();
    const result = await join({ target: REMOTE, config: store, runner }, new ScriptedPrompter(['me']));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Input ended before') });
    expect(new PromptClosedError('x', 'closed').name).toBe('PromptClosedError');
  });

  it('a GitHub remote typed in different case is the same team', async () => {
    const fixture = await bareTeam();
    const store = createConfigStore(pathJoin(fixture.root, 'local'));
    const first = await join({ target: 'https://github.com/Acme/Team.git', config: store, runner: mappedRunner('https://github.com/Acme/Team.git', fixture.bare) }, new ScriptedPrompter(answers()));
    if (!first.ok) throw new Error(first.error);
    const again = await join({ target: 'https://github.com/acme/team.git', config: store, runner: mappedRunner('https://github.com/acme/team.git', fixture.bare) }, new ScriptedPrompter(['me', 'Me', 'me@example.com']));
    if (!again.ok) throw new Error(again.error);
    expect(Object.keys((await store.read()).teams)).toEqual(['team']);
  });

  it('parses targets: <org>/<repo> is GitHub; every URL form, including scp-style, is a plain remote', () => {
    expect(parseJoinTarget('acme/team')).toEqual({ remote: 'https://github.com/acme/team.git', github: true, ownerRepo: 'acme/team' });
    expect(parseJoinTarget('acme/team.git')).toMatchObject({ ownerRepo: 'acme/team' });
    expect(parseJoinTarget('git@github.com:acme/team.git')).toEqual({ remote: 'git@github.com:acme/team.git', github: false });
    expect(parseJoinTarget('https://gitlab.com/acme/team.git')).toEqual({ remote: 'https://gitlab.com/acme/team.git', github: false });
    expect(() => parseJoinTarget('not a target')).toThrow('Unsupported remote');
    expect(parseJoinTarget('https://me:ghp_leak@gitlab.com/acme/team.git')).toEqual({ remote: 'https://gitlab.com/acme/team.git', github: false });
    expect(parseJoinTarget(' https://me:gh@p_leak@gitlab.com/acme/team.git')).toEqual({ remote: 'https://gitlab.com/acme/team.git', github: false });
    for (const hostile of ['--upload-pack=touch:pwned', 'ext::sh -c id', 'git@-evil:acme/team.git']) expect(() => parseJoinTarget(hostile), hostile).toThrow('Unsupported remote');
  });

  it('a credential pasted into the join target (with `@` in the password and leading whitespace) never reaches git argv, the clone, config, or output; the user is told once; the remote sits behind --', async () => {
    const { fixture, store, runner } = await setup();
    const io = new ScriptedPrompter(answers());
    const result = await join({ target: ' https://me:gh@p_leak@git.example/team.git', config: store, runner }, io);
    if (!result.ok) throw new Error(result.error);
    const everything = JSON.stringify([runner.calls, io.lines, await store.read()]);
    expect(everything).not.toContain('p_leak');
    expect(everything).not.toContain('gh@');
    expect(io.lines.filter((line) => line.includes('Ignored the credential'))).toHaveLength(1);
    expect((await git(['remote', 'get-url', 'origin'], store.teamClone('team'))).trim()).toBe(fixture.bare);
    const clone = runner.calls.find((call) => call.command === 'git' && call.args[0] === 'clone');
    expect(clone?.args.slice(-3)).toEqual(['--', REMOTE, store.teamClone('team')]);
  });

  it('a partial clone directory is reported, not silently reused or deleted', async () => {
    const { fixture, store, runner } = await setup();
    await git(['init', '-q', store.teamClone('team')]);
    await git(['remote', 'add', 'origin', fixture.bare], store.teamClone('team'));
    expect(await join({ target: REMOTE, config: store, runner }, new ScriptedPrompter(answers()))).toMatchObject({ ok: false, error: expect.stringContaining('not a complete clone') });
    expect(await systemRunner.run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: store.teamClone('team') })).toMatchObject({ code: 0 });
  });
});
