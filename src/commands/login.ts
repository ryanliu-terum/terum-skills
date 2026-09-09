import { AuthDependencies, collectIdentity, detectOrOfferGh, GhState, setIdentity } from '../lib/auth.js';
import { configSchema, parseOrExplain } from '../lib/schema.js';
import type { Identity } from '../lib/auth.js';
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
export interface LoginArgs extends AuthDependencies { set?: string[]; }
export interface LoginResult { gh: GhState | null; handle: string | null; updated: { key: string; value: string }[]; notice: string | null; }

export async function run(args: LoginArgs, io: Prompter): Promise<Result<LoginResult>> {
  try {
    const store = args.config ?? createConfigStore();
    if (args.set !== undefined) {
      const identity: Partial<Identity> = {};
      const updated = args.set.map((pair) => {
        const separator = pair.indexOf('=');
        const key = separator < 0 ? pair : pair.slice(0, separator);
        const raw = pair.slice(separator + 1);
        if (!['name', 'email', 'default-handle'].includes(key)) throw new Error('Accepted keys: name, email, default-handle.');
        if (separator < 0) throw new Error('Use --set <key>=<value>. Accepted keys: name, email, default-handle.');
        let value: string;
        switch (key) {
          case 'name': value = parseOrExplain(configSchema.shape.display_name.unwrap(), raw, 'name'); identity.displayName = value; break;
          case 'email': value = parseOrExplain(configSchema.shape.email.unwrap(), raw, 'email'); identity.email = value; break;
          default: value = parseOrExplain(configSchema.shape.default_handle.unwrap(), raw, 'default-handle'); identity.handle = value;
        }
        return { key, value };
      });
      if (!updated.length) throw new Error('Use --set <key>=<value>. Accepted keys: name, email, default-handle.');
      let notice: string | null = null;
      const config = await store.update((fresh) => {
        setIdentity(fresh, identity);
        notice = `This changes the author line (${fresh.display_name ?? '<display_name>'} <${fresh.email ?? 'email'}>) that the next sync writes into the skills you have connected on this machine; skills you authored elsewhere keep their recorded author.`;
        io.print(notice);
      }, { preserveUnchanged: true });
      return success({ gh: null, handle: config.default_handle ?? null, updated, notice });
    }
    const runner: Runner = args.runner ?? systemRunner;
    const gh = await detectOrOfferGh(io, runner);
    const identity = await collectIdentity(io, await store.read(), runner, { gh });
    await store.update((fresh) => setIdentity(fresh, identity));
    if (!gh.installed) io.print('GitHub CLI (gh) is not installed. A GitHub team needs it (https://cli.github.com); a generic-git remote uses your ambient git credentials and needs nothing more.');
    else if (!gh.authenticated) io.print('gh is installed but logged out. Run `gh auth login` before creating a GitHub team; joining one needs only ordinary repository access.');
    else io.print('gh is logged in.');
    io.print(`Identity saved: ${identity.displayName} <${identity.email}>${identity.github ? ` (@${identity.github})` : ''}, default handle ${identity.handle}.`);
    return success({ gh, handle: identity.handle, updated: [], notice: null });
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
