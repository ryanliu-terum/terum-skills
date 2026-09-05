import { AuthDependencies, collectIdentity, detectOrOfferGh, GhState, setIdentity } from '../lib/auth.js';
import { createConfigStore } from '../lib/config.js';
import { Prompter } from '../lib/prompt.js';
import { Result, failure, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';

/**
 * §6 `login` (rev 9, Decision 4): bare, and it writes no team entry. gh detection, the gh login
 * offer, then first-run identity (GitHub login, default handle, name, email) into config. Team
 * entries come only from `team create`/`team join`, which prove the handle against the roster —
 * so the early-binding bugs of a `login --team --remote` cannot exist. Nobody is asked for a
 * token (Decision 2).
 */
export type LoginArgs = AuthDependencies;
export interface LoginResult { gh: GhState; handle: string; }

export async function run(args: LoginArgs, io: Prompter): Promise<Result<LoginResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner: Runner = args.runner ?? systemRunner;
    const gh = await detectOrOfferGh(io, runner);
    const identity = await collectIdentity(io, await store.read(), runner, { gh });
    await store.update((fresh) => setIdentity(fresh, identity));
    if (!gh.installed) io.print('GitHub CLI (gh) is not installed. A GitHub team needs it (https://cli.github.com); a generic-git remote uses your ambient git credentials and needs nothing more.');
    else if (!gh.authenticated) io.print('gh is installed but logged out. Run `gh auth login` before creating a GitHub team; joining one needs only ordinary repository access.');
    else io.print('gh is logged in.');
    io.print(`Identity saved: ${identity.displayName} <${identity.email}>${identity.github ? ` (@${identity.github})` : ''}, default handle ${identity.handle}.`);
    return success({ gh, handle: identity.handle });
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
