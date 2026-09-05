import { createConfigStore, ConfigStore, selectTeam } from '../lib/config.js';
import { gitAuthEnv } from '../lib/auth.js';
import { Prompter } from '../lib/prompt.js';
import { githubOwnerRepo, hostOperationAllowed } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { githubLoginSchema, parseOrExplain } from '../lib/schema.js';

export interface InviteArgs { logins: readonly string[]; team?: string; config?: ConfigStore; runner?: Runner; }
export interface InviteResult { team: string; invited: readonly string[]; already: readonly string[]; failed?: readonly { login: string; error: string }[]; }

/** §6 GitHub-only collaborator invitations. It deliberately has no team-repo write path. */
export async function run(args: InviteArgs, io: Prompter): Promise<Result<InviteResult>> {
  try {
    if (args.logins.length === 0) throw new Error('Provide at least one GitHub login.');
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const [team, binding] = selectTeam(config.teams, args.team);
    const allowed = hostOperationAllowed(binding.remote);
    if (!allowed.ok) throw new Error(allowed.error);
    const runner = args.runner ?? systemRunner;
    const endpoint = githubRepository(binding.remote);
    const invited: string[] = [];
    const already: string[] = [];
    const failed: { login: string; error: string }[] = [];
    for (const rawLogin of args.logins) {
      const login = parseOrExplain(githubLoginSchema, rawLogin.trim(), 'GitHub login');
      const response = await runner.run('gh', ['api', '-X', 'PUT', '--include', `repos/${endpoint}/collaborators/${login}`], { env: gitAuthEnv(binding.token) });
      const status = httpStatus(response.code, response.stdout, response.stderr);
      if (status === 201) { invited.push(login); io.print(`Invited @${login}.`); continue; }
      if (status === 204) { already.push(login); io.print(`@${login} already has access.`); continue; }
      // GitHub returns 422 when adding the repository owner, but other 422 responses are failures.
      if (status === 422 && login.toLowerCase() === endpoint.split('/')[0]!.toLowerCase()) { already.push(login); io.print(`@${login} already has access (owner).`); continue; }
      if (response.code === 0 && status === null) { invited.push(login); io.print(`Invited @${login}.`); continue; }
      const error = `Could not invite @${login} (GitHub status ${status ?? 'unknown'}). GitHub caps invitations at 50 per repository per day. ${(response.stderr || response.stdout).trim()}`.trim();
      failed.push({ login, error });
      io.print(error);
    }
    io.print(slackBlock(endpoint));
    if (failed.length) return failure(failed.map((outcome) => outcome.error).join('\n'), { team, invited, already, failed });
    return success({ team, invited, already, failed });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

export function slackBlock(ownerRepo: string): string {
  return [`Share this with your teammate:`, '```', `npx -y terum-skills@latest setup ${ownerRepo}`, '', `Bare equivalent: npx -y terum-skills@latest team join ${ownerRepo}`, '```'].join('\n');
}

export function githubRepository(remote: string): string {
  const repository = githubOwnerRepo(remote);
  if (repository === null) throw new Error(`${remote} is not a GitHub repository.`);
  return repository;
}
function httpStatus(code: number, stdout: string, stderr: string): number | null {
  const header = /^HTTP\/\S+\s+(\d{3})/m.exec(stdout);
  if (header) return Number(header[1]);
  const stderrStatus = /\(HTTP\s+(\d{3})\)/.exec(stderr);
  return stderrStatus ? Number(stderrStatus[1]) : code === 0 ? null : null;
}
