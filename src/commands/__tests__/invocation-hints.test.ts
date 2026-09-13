import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getStartedLines } from '../../lib/invocation.js';
import { createConfigStore, selectTeam } from '../../lib/config.js';
import { creatorAuthenticationError } from '../../lib/auth.js';
import { guardRawPush } from '../../lib/guard.js';
import { staleLine } from '../../lib/hook.js';
import { denyingRunner, fakeGh, ghOnlyRunner, ScriptedPrompter, TEAM_JSON, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { run as install, teamForReference } from '../install.js';
import { run as uninstall } from '../uninstall.js';
import { run as publishSkill } from '../publish.js';
import { run as team, workflowUpdate, WORKFLOW } from '../team.js';
import { run as status } from '../status.js';
import { run as search } from '../search.js';
import { run as ls } from '../ls.js';
import { run as setup } from '../setup.js';
import { run as uninstallMachine } from '../uninstallMachine.js';

describe.each([undefined, 'bare'] as const)('current-user remedies, form=%s', (form) => {
  const prefix = form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest';
  it('routes no-team, not-joined, selector, eval, authentication and workflow remedies', async () => {
    const config = createConfigStore(join(await temporaryDirectory(), 'state'));
    expect(() => selectTeam({}, undefined, form)).toThrow(getStartedLines(form).join('\n'));
    await expect(teamForReference(await config.read(), undefined, 'github.com/acme/team', undefined, form)).rejects.toThrow(`run \`${prefix} team join 'acme/team'\` first.`);
    for (const kind of ['member', 'project'] as const) {
      const grammar = kind === 'member' ? 'member <handle>' : 'project <name>';
      expect(await install({ kind, config, form }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining(`\`${prefix} install ${grammar}\``) });
    }
    await config.update((c) => { c.teams.team = { remote: 'github.com/acme/team', handle: 'seed' }; });
    for (const kind of ['member', 'project'] as const) {
      expect(await uninstall({ kind, config, form }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining(`\`${prefix} uninstall-skill ${kind} <${kind === 'member' ? 'handle' : 'name'}>\``) });
    }
    const noHandle = { ...config, read: async () => ({ ...(await config.read()), teams: { team: { remote: 'github.com/acme/team', handle: '' } } }) };
    // D42 made eval best-effort about the team, so the remedy moved to the verb that still needs a
    // joined handle: publish is the only thing that writes to the team.
    expect(await publishSkill({ ref: 'sample', config: noHandle, form }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining(`Team team has no joined handle`) });
    expect(await team({ kind: 'remove', handle: 'other', config: noHandle, form }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining(`run ${prefix} team join first`) });
    for (const gh of [{ installed: false, authenticated: false }, { installed: true, authenticated: false }]) {
      expect(creatorAuthenticationError(gh, form)).toContain(`\`${prefix} team create <name> --remote <url>\``);
    }
    expect(await workflowUpdate({ form }, new ScriptedPrompter())).toEqual({ ok: false, error: `\`${prefix} team workflow-update\` is print-only; pass --print.` });
    const workflow = new ScriptedPrompter(); await workflowUpdate({ print: true, form }, workflow);
    expect(workflow.lines[0]+'\n').toBe(WORKFLOW);
    // D15 deleted the ownership row and its `login` remedy; what the raw-push guard hints at now is
    // the verb that CAN mint a version, and re-arming a hook that predates the repository layout.
    expect(() => guardRawPush({ before: () => undefined, after: () => undefined, changedPaths: ['skills/sample/v1/SKILL.md'] }, { handle: 'seed' }, form)).toThrow(`minted by \`${prefix} publish\``);
    expect(() => guardRawPush({ before: () => 'a', after: () => 'b', changedPaths: ['.github/workflows/terum-skills.yml'] }, { handle: 'seed' }, form)).toThrow(`re-run \`${prefix} team join '<remote>'\``);
  });

  it('routes status, search missing-clone/stale and ls trailer, retaining portable status argument spelling', async () => {
    const config = createConfigStore(join(await temporaryDirectory(), 'state'));
    const io = new ScriptedPrompter(); await status({ config, form }, io);
    expect(io.lines).toContain(`  Create a team: ${prefix} setup`);
    expect(io.lines).toContain(`  Join a team:   ${prefix} setup <org>/<repo>`);
    await config.update((c) => { c.teams.team = { remote: 'github.com/acme/team', handle: 'seed' }; });
    const missing = new ScriptedPrompter(); await status({ config, form }, missing);
    expect(missing.lines).toContain(`  Restore it: ${prefix} team join github.com/acme/team`);
    const query = new ScriptedPrompter(); await search({ term: 'x', config, form }, query);
    expect(query.lines).toContain(`team is not cloned yet; run \`${prefix} sync\`.`);
    expect(await staleLine(config.root, 'team', undefined, form)).toBe(`team may be stale; run \`${prefix} sync\`.`);
    const clone = config.teamClone('team'); await mkdir(join(clone, 'people'), { recursive: true }); await mkdir(join(clone, 'skills'));
    await writeFile(join(clone, 'team.json'), JSON.stringify(TEAM_JSON));
    const listing = new ScriptedPrompter(); expect((await ls({ config, form }, listing)).ok).toBe(true);
    expect(listing.lines.at(-1)).toBe(`Local skills: ${prefix} ls --local`);
  });


  it.each(['incomplete', 'foreign'])('carries install form through quiet setup %s repair failure', async (state) => {
    const config = createConfigStore(join(await temporaryDirectory(), 'state'));
    await config.update((c) => { c.teams.team = { remote: 'github.com/acme/team', handle: 'seed' }; });
    await mkdir(config.teamClone('team'), { recursive: true });
    if (state === 'foreign') { await mkdir(join(config.teamClone('team'), '.git')); await writeFile(join(config.teamClone('team'), 'team.json'), JSON.stringify(TEAM_JSON)); }
    const runner = denyingRunner([{ command: 'git', argsPrefix: ['remote', 'get-url', 'origin'], respond: () => ({ code: 0, stdout: 'https://git.example/other.git', stderr: '' }) }]);
    let first = true;
    const injected = { ...config, read: async () => { const value = await config.read(); if (first) { first = false; return { ...value, teams: {} }; } return value; } };
    const io = new ScriptedPrompter();
    const result = await install({ ref: 'acme/team/sample', config: injected, form, runner }, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`run \`${prefix} team join 'github.com/acme/team'\` to restore it`) });
    expect(io.lines).not.toContain('Next, from any terminal:');
  });

  it('routes configured-team create recovery and keeps the post-removal instruction fixed', async () => {
    const config = createConfigStore(join(await temporaryDirectory(), 'state'));
    await config.update((c) => { c.teams.team = { remote: 'github.com/acme/team', handle: 'seed' }; });
    expect(await team({ kind: 'create', name: 'team', config, form }, new ScriptedPrompter())).toMatchObject({ ok: false, refused: true, error: expect.stringContaining(`run \`${prefix} team leave 'team'\` first`) });
    const io = new ScriptedPrompter([], [false]);
    await uninstallMachine({ config, form, hook: { settingsFile: join(config.root, 'settings.json') } }, io);
    expect(io.details['Remove terum-skills from this machine?']).toContain('Your membership and installed-skill records in the team repo are unchanged. Rejoining does not re-place skills; `npx -y terum-skills@latest install member <handle>` does.');
  });

  it('routes setup authentication failure through its nested helper', async () => {
    const config = createConfigStore(join(await temporaryDirectory(), 'state'));
    const result = await setup({ app: false, config, form, runner: ghOnlyRunner(fakeGh('seed', {}, false)) }, new ScriptedPrompter(['Create a new team']));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`\`${prefix} team create <name> --remote <url>\``) });
  });
});
