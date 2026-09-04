import { AuthDependencies, authenticateCreator, bindTeam, collectIdentity, ghState, setIdentity, teamByRemote } from '../lib/auth.js';
import { createConfigStore } from '../lib/config.js';
import { Prompter } from '../lib/prompt.js';
import { hostOperationAllowed, normalizeRemote } from '../lib/remote.js';
import { Result, failure, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { parseOrExplain, teamNameSchema } from '../lib/schema.js';

/**
 * §6 `login` — the admin path. Joiners never run it (D8). Tokens are per team (§5.4), so the
 * verb names the team and its remote. It never binds a handle: only `team create`/`team join`
 * prove one against the roster. On a non-GitHub remote there is nothing to authenticate with —
 * access is ambient git credentials — so only identity is collected.
 */
export interface LoginArgs extends AuthDependencies { team: string; remote: string; }

export async function run(args: LoginArgs, io: Prompter): Promise<Result<{ authenticated: boolean; github: boolean }>> {
  try {
    const team = parseOrExplain(teamNameSchema, args.team, 'team name');
    const remote = normalizeRemote(args.remote);
    const store = args.config ?? createConfigStore();
    const runner: Runner = args.runner ?? systemRunner;
    const snapshot = await store.read();
    const byRemote = teamByRemote(snapshot, remote);
    if (byRemote && byRemote[0] !== team) throw new Error(`${remote} is already configured as team ${byRemote[0]}; run \`login --team ${byRemote[0]}\`.`);
    const existing = snapshot.teams[team];
    if (existing && existing.remote !== remote) throw new Error(`Team ${team} is configured for ${existing.remote}, not ${remote}.`);

    const github = hostOperationAllowed(remote).ok;
    const fixedHandle = existing?.handle ?? undefined;
    const auth = github
      ? await authenticateCreator(io, { config: store, runner }, { remote, fixedHandle })
      : { identity: await collectIdentity(io, snapshot, runner, { fixedHandle, gh: await ghState(runner) }), gh: { installed: false, authenticated: false }, token: null };
    if (!github) io.print(`${remote} is not on GitHub: access uses your ambient git credentials; nothing to store.`);

    await store.update((fresh) => {
      // Re-check against the locked, freshly read config: another verb may have run while we prompted.
      const current = fresh.teams[team];
      if (current && current.remote !== remote) throw new Error(`Team ${team} is configured for ${current.remote}, not ${remote}.`);
      setIdentity(fresh, auth.identity);
      bindTeam(fresh, team, { remote, token: auth.token ?? current?.token ?? null });
    });
    return success({ authenticated: auth.gh.authenticated || auth.token !== null, github });
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
