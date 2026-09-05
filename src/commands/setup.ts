import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { creatorAuthenticationError, detectOrOfferGh, teamByRemote } from '../lib/auth.js';
import { COMMUNITY_URL } from '../lib/community.js';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { exists } from '../lib/fs.js';
import { defaultHookOptions, HookOptions, offerHook as defaultOfferHook } from '../lib/hook.js';
import { AGENT_PATHS } from '../lib/placer/agent-paths.js';
import { Prompter } from '../lib/prompt.js';
import { activePeople, readPeople } from '../lib/readme.js';
import { githubOwnerRepo, isGitHubRemote, stripRemoteCredentials } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { parseJson, teamSchema } from '../lib/schema.js';
import { run as invite } from './invite.js';
import { run as share } from './share.js';
import { parseJoinTarget, run as team } from './team.js';

export interface SetupVerbs {
  team: typeof team;
  share: typeof share;
  invite: typeof invite;
  offerHook: typeof defaultOfferHook;
}
export interface SetupArgs {
  target?: string;
  config?: ConfigStore;
  runner?: Runner;
  home?: string;
  hook?: HookOptions;
  communityUrl?: string;
  verbs?: Partial<SetupVerbs>;
}
export type StepOutcome = 'done' | 'skipped' | 'printed';
type Step = 'welcome' | 'github' | 'team' | 'actions' | 'invite' | 'community' | 'hook' | 'done';
export interface SetupResult {
  role: 'creator' | 'joiner';
  team: string;
  remote: string;
  /** Only reached steps are recorded, so an interrupted run names its stopping point. */
  steps: Partial<Record<Step, StepOutcome>>;
}

const WELCOME = [
  'Welcome to terum-skills.',
  "Your team's skills live in one private git repository the team controls; each member installs what they want, edits flow back on sync, and the team endorses the ones everyone should have.",
  'This wizard will check GitHub, set up your team, share a first skill, invite teammates, and offer the session hook. Re-run it any time; finished steps are skipped.',
];

function failed(error: unknown, role: SetupResult['role'], teamName: string, remote: string, steps: SetupResult['steps']): Result<SetupResult> {
  return failure(error instanceof Error ? error.message : String(error), { role, team: teamName, remote, steps });
}

function resolvedHook(store: ConfigStore, home: string | undefined, partial: HookOptions | undefined): Required<HookOptions> {
  return { ...defaultHookOptions(store.root, home), ...partial };
}

async function unsharedSkills(root: string, config: Awaited<ReturnType<ConfigStore['read']>>): Promise<string[]> {
  if (!(await exists(root))) return [];
  const excluded = new Set([...Object.values(config.shared).map((entry) => resolve(entry.source)), ...Object.keys(config.placements).map((path) => resolve(path))]);
  const entries = await readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && await exists(join(path, 'SKILL.md')) && !excluded.has(resolve(path))) names.push(entry.name);
  }
  return names.sort();
}

export async function run(args: SetupArgs, io: Prompter): Promise<Result<SetupResult>> {
  const role: SetupResult['role'] = args.target === undefined ? 'creator' : 'joiner';
  const store = args.config ?? createConfigStore();
  const runner = args.runner ?? systemRunner;
  const verbs: SetupVerbs = { team, share, invite, offerHook: defaultOfferHook, ...args.verbs };
  const steps: SetupResult['steps'] = {};
  let teamName = '';
  let remote = '';

  try {
    for (const line of WELCOME) io.print(line);
    steps.welcome = 'printed';

    const gh = await detectOrOfferGh(io, runner);
    if (role === 'creator') {
      const error = creatorAuthenticationError(gh);
      if (error) return failed(error, role, teamName, remote, steps);
      io.print('GitHub: gh is logged in.');
    } else if (gh.authenticated) io.print('GitHub: gh is logged in; the invitation will be accepted for you.');
    else if (gh.installed) io.print('GitHub: gh is installed but logged out; you will be asked to accept the invitation in your browser.');
    else io.print('GitHub: gh is not installed; you will be asked to accept the invitation in your browser.');
    steps.github = 'done';

    const before = await store.read();
    if (role === 'creator') {
      const configured = Object.entries(before.teams)[0];
      if (configured) {
        teamName = configured[0]; remote = configured[1].remote;
        io.print(`Team ${teamName} is already configured on this machine.`);
        steps.team = 'skipped';
      } else {
        const result = await verbs.team({ kind: 'create', offerHook: false, config: store, runner }, io);
        if (!result.ok) return failed(result.error, role, teamName, remote, steps);
        teamName = result.value.team;
        remote = 'remote' in result.value ? result.value.remote : (await store.read()).teams[teamName]!.remote;
        steps.team = 'done';
      }
    } else {
      const target = parseJoinTarget(args.target!);
      const configured = teamByRemote(before, target.remote);
      if (configured?.[1].handle) {
        teamName = configured[0]; remote = configured[1].remote;
        io.print(`Team ${teamName} is already configured on this machine.`);
        steps.team = 'skipped';
      } else {
        const result = await verbs.team({ kind: 'join', target: args.target!, offerHook: false, config: store, runner }, io);
        if (!result.ok) return failed(result.error, role, teamName, remote, steps);
        teamName = result.value.team;
        remote = (await store.read()).teams[teamName]!.remote;
        steps.team = 'done';
      }
    }

    if (role === 'creator') {
      const root = AGENT_PATHS['claude-code'].global(args.home ?? homedir());
      const available = await unsharedSkills(root, await store.read());
      if (available.length === 0) {
        io.print(`No unshared skills under ${root}.`);
        steps.actions = 'skipped';
      } else {
        const choice = await io.select('Share a skill with the team?', [...available, 'skip']);
        if (choice === 'skip') steps.actions = 'skipped';
        else {
          const result = await verbs.share({ path: join(root, choice), team: teamName, config: store, runner }, io);
          if (!result.ok) return failed(result.error, role, teamName, remote, steps);
          steps.actions = 'done';
        }
      }
    } else steps.actions = 'skipped';
    io.print('Next, from any terminal:');
    io.print(`  terum-skills install ${teamName}/<skill>   — install a shared skill (add @<version> to pin it)`);
    io.print('  terum-skills ls                       — list members and shared skills');
    io.print('  terum-skills search <term>            — find a skill by name, description, or category');
    io.print('  terum-skills sync                     — pull updates and finish pending work');
    io.print('  terum-skills publish <skill>          — endorse a skill for the whole team');

    if (role === 'joiner') steps.invite = 'skipped';
    else if (isGitHubRemote(remote)) {
      const answer = await io.text('GitHub logins to invite (space or comma separated; blank to skip)', '');
      const logins = answer.split(/[\s,]+/).filter(Boolean);
      if (logins.length === 0) steps.invite = 'skipped';
      else {
        const result = await verbs.invite({ logins, team: teamName, config: store, runner }, io);
        if (!result.ok) return failed(result.error, role, teamName, remote, steps);
        steps.invite = 'done';
      }
    } else {
      const clean = stripRemoteCredentials(remote);
      io.print(`Access to ${clean} is managed on the host; grant it there, then send teammates: npx -y terum-skills@latest setup ${clean}`);
      steps.invite = 'skipped';
    }

    const communityUrl = args.communityUrl ?? COMMUNITY_URL;
    if (communityUrl === '') steps.community = 'skipped';
    else { io.print(`Feedback and requests: ${communityUrl}`); steps.community = 'printed'; }

    const hookOutcome = await verbs.offerHook(io, resolvedHook(store, args.home, args.hook));
    steps.hook = hookOutcome === 'installed' || hookOutcome === 'replaced' ? 'done' : 'skipped';

    const clone = store.teamClone(teamName);
    const document = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    io.print('Members:');
    for (const person of activePeople(await readPeople(clone), document.archived)) io.print(`  @${person.handle} — ${person.display_name}`);
    const ownerRepo = githubOwnerRepo(remote);
    const repositoryUrl = ownerRepo ? `https://github.com/${ownerRepo}` : stripRemoteCredentials(remote);
    io.print(`Repository: ${repositoryUrl}`);
    io.print(`README: ${ownerRepo ? `${repositoryUrl}/blob/main/README.md` : repositoryUrl}`);
    steps.done = 'printed';
    return success({ role, team: teamName, remote, steps });
  } catch (error) { return failed(error, role, teamName, remote, steps); }
}
