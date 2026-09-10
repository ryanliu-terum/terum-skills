import type { WithForm } from '../lib/invocation.js';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { Prompter } from '../lib/prompt.js';
import { normalizeRemote } from '../lib/remote.js';
import { fromError, Result, success } from '../lib/result.js';
import { parseJson, PROJECT_NAME_RULE, projectNameSchema, Team, teamSchema } from '../lib/schema.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { openTeamRepo, refreshClone, SafeWriteOptions, treeText, lockWait } from '../lib/teamRepo.js';
import { teamForReference } from './install.js';

export interface ProjectArgs extends WithForm {
  kind: 'create';
  /** Prompted when absent and interactive; a non-interactive caller must pass it. */
  name?: string;
  /** The repository whose checkout this project's skills place into. Optional: a project may be named before it has a home. */
  remote?: string;
  team?: string;
  config?: ConfigStore;
  runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}

export interface ProjectCreated { team: string; name: string; remotes: string[]; skills: number; }

/**
 * `project create` — the act that names a team project. Guard row (i): one new key, born empty.
 *
 * Direct to `main`, never a pull request, under either publish policy (spec §2 D1, Ryan 2026-09-09):
 * a project with no skills endorses nothing, so there is nothing for a reviewer to weigh, and the
 * card has to exist before anyone can add to it. Endorsing into it stays on `publish` and keeps the
 * team's `policy.publish`.
 */
export async function run(args: ProjectArgs, io: Prompter): Promise<Result<ProjectCreated>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const team = await teamForReference(config, args.team, undefined, undefined, args.form);
    const binding = config.teams[team]!;
    if (!binding.handle) throw new Error(`Team ${team} has no joined handle.`);
    const clone = store.teamClone(team);
    // The clone is where the collision check reads from, so it is refreshed before anything is asked.
    await refreshClone(runner, clone, { label: team, ...lockWait(io) });

    const typed = args.name ?? (io.interactive ? await io.text('Project name?') : undefined);
    if (typed === undefined || typed.trim() === '') throw new Error('Specify a project name.');
    const parsed = projectNameSchema.safeParse(typed);
    if (!parsed.success) throw new Error(PROJECT_NAME_RULE);
    const name = parsed.data;
    const remotes = args.remote === undefined || args.remote.trim() === '' ? [] : [normalizeRemote(args.remote)];

    const repo = openTeamRepo(clone, binding.remote, runner);
    const written = await repo.safeWrite((tree) => {
      const source = tree.before('team.json');
      if (source === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');
      // Re-read inside the loop: a project another member created between the refresh above and this
      // attempt must be seen, or safeWrite's re-apply would push a second card with the same name.
      const fresh = parseJson(teamSchema, treeText(source), 'team.json');
      const clash = Object.keys(fresh.projects).find((key) => key.toLowerCase() === name.toLowerCase());
      if (clash !== undefined) throw new Error(`${team} already has a project named ${clash}.`);
      const claimed = claimant(fresh, remotes[0]);
      if (claimed !== undefined) throw new Error(`${claimed} already claims ${remotes[0]}; a repository belongs to one project.`);
      fresh.projects[name] = { remotes, skills: [] };
      tree.set('team.json', `${JSON.stringify(fresh, null, 2)}\n`);
    }, {
      action: 'project',
      handle: binding.handle,
      message: `${binding.handle}: create project ${name}`,
      ...args.safeWrite,
      ...lockWait(io),
    });
    // The mutation either writes or throws, so an unchanged tree here is a bug, not a no-op create.
    if (!written.changed) throw new Error(`Nothing was written for project ${name}; rerun the command.`);

    io.print(`Created project ${name} in ${team}.`);
    io.print(remotes.length
      ? `Its skills place when a teammate syncs inside ${remotes[0]}.`
      : 'No repository yet — its skills place nowhere automatically until it has one.');
    return success({ team, name, remotes, skills: 0 });
  } catch (error) {
    return fromError(error);
  }
}

/**
 * The project already listing this remote, if any. Two projects on one repository is not a tie the
 * readers arbitrate: `install` (destination preselection) and `eval` (which project am I inside)
 * both take the first match, so the second project would be silently unreachable.
 */
function claimant(team: Team, remote: string | undefined): string | undefined {
  if (remote === undefined) return undefined;
  return Object.entries(team.projects).find(([, project]) => project.remotes.some((candidate) => {
    try { return normalizeRemote(candidate) === remote; } catch { return false; }
  }))?.[0];
}
