import { ghState, gitState } from '../lib/auth.js';
import type { Config } from '../lib/schema.js';
import { joinCommand, joinLines } from './invite.js';
import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { getStartedLines } from '../lib/invocation.js';
import { stampedAt, staleLine } from '../lib/hook.js';
import { Prompter } from '../lib/prompt.js';
import { githubOwnerRepo, normalizeRemote, repositoryUrl } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { adminLogins } from '../lib/collaborators.js';
import { joinDates, readRoster, readTeam, RosterEntry, SkillProblem, skillRecords } from '../lib/skills.js';
import { packageVersion } from '../lib/package.js';
import { hostArch } from '../lib/platform.js';
import { CloneState, describeClone } from '../lib/teamRepo.js';

export interface StatusArgs extends WithForm { permissions?: boolean; team?: string; config?: ConfigStore; runner?: Runner; now?: () => number; }
export interface TeamStatus {
  team: string; handle: string; repository: string | null; clone: CloneState; readable: boolean;
  members: RosterEntry[]; memberCount: number | null; unreadableMembers: number | null;
  sharedSkills: number | null; unreadableSkills: number | null;
  pending: { op: 'install' | 'uninstall'; id: string; scope: Config['pending'][number]['scope']; version: string | null; destination: NonNullable<Config['pending'][number]['destination']> | null; started: string }[];
  syncedAt: string | null; policy: { publish: 'pr' | 'push'; skill_license: string } | null; categories: string[] | null;
  clonePath: string | null; joinCommand: string | null; joinBlock: readonly string[] | null;
  membership: 'active' | 'inactive' | 'missing' | null; stale: boolean;
}
export interface StatusResult {
  version: string | null; teams: TeamStatus[];
  hostArch: string; processArch: string;
  ledger: {
    placements: { path: string; id: string; team: string; version: string | null; scope: Config['pending'][number]['scope']; placed_at: string }[];
    approvals: { id: string; grants: string; approved_at: string }[];
  };
  identity: { default_handle: string | null; email: string | null; display_name: string | null; github: string | null } | null;
  tools: { git: boolean; gh: boolean };
}

/** Offline local team summary; a successful query is not a setup-readiness or membership test. */
export async function run(args: StatusArgs, io: Prompter): Promise<Result<StatusResult>> {
  const version = packageVersion();
  const architecture = { hostArch: hostArch({ platform: process.platform, arch: process.arch, env: process.env }), processArch: process.arch };
  const teams: TeamStatus[] = [];
  const ledger: StatusResult['ledger'] = { placements: [], approvals: [] };
  let identity: StatusResult['identity'] = null;
  const tools = { git: false, gh: false };
  try {
    io.print(version === null ? 'terum-skills (version unknown)' : `terum-skills ${version}`);
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    ledger.placements = Object.entries(config.placements).map(([path, e]) => ({ path, id: e.id, team: e.team, version: e.version ?? null, scope: e.scope.kind === 'global' ? { kind: 'global' } : { kind: 'project', project: e.scope.project }, placed_at: e.placed_at }));
    ledger.approvals = Object.entries(config.approvals).map(([id, e]) => ({ id, grants: e.grants, approved_at: e.approved_at }));
    if ([config.default_handle, config.email, config.display_name, config.github].some(value => value !== undefined)) {
      identity = { default_handle: config.default_handle ?? null, email: config.email ?? null, display_name: config.display_name ?? null, github: config.github ?? null };
    }
    const runner = args.runner ?? systemRunner;
    const [git, gh] = await Promise.all([gitState(runner), ghState(runner, { presenceOnly: true })]);
    tools.git = git.installed;
    tools.gh = gh.installed;
    const selected = args.team !== undefined ? [selectTeam(config.teams, args.team, args.form)] : Object.entries(config.teams);
    if (!selected.length) for (const line of getStartedLines(args.form)) io.print(line);
    const lines: string[] = [];
    for (const [team, binding] of selected) {
      if (teams.length) io.print('');
      const detail: TeamStatus = {
        team, handle: binding.handle, repository: null, clone: { state: 'incomplete', reason: 'unverifiable' }, readable: false,
        members: [], memberCount: null, unreadableMembers: null, sharedSkills: null, unreadableSkills: null, membership: null, stale: false,
        pending: config.pending.filter(e => e.team === team).map(e => ({ op: e.op, id: e.id, scope: e.scope.kind === 'global' ? { kind: 'global' } : { kind: 'project', project: e.scope.project }, version: typeof e.version === 'string' ? e.version : null, destination: e.destination ?? null, started: e.started })),
        syncedAt: null, policy: null, categories: null, clonePath: null, joinCommand: null, joinBlock: null,
      };
      teams.push(detail);
      let headerPrinted = false;
      try {
        const clone = store.teamClone(team);
        detail.clonePath = clone;
        detail.syncedAt = await stampedAt(store.root, team);
        detail.repository = repositoryUrl(binding.remote);
        const ownerRepo = githubOwnerRepo(binding.remote);
        detail.joinCommand = ownerRepo === null ? null : joinCommand(ownerRepo);
        detail.joinBlock = ownerRepo === null ? null : joinLines(ownerRepo);
        const remote = normalizeRemote(binding.remote);
        detail.clone = await describeClone(clone, remote, args.runner ?? systemRunner);
        io.print(`Team ${team} (${detail.clone.state === 'ok' ? 'you are' : 'configured handle'} @${binding.handle})`);
        headerPrinted = true;
        io.print(`  Repository: ${detail.repository}`);
        if (detail.clone.state !== 'ok') {
          const state = detail.clone;
          if (state.state === 'incomplete' && state.reason === 'unverifiable') {
            io.print(`  Clone: ${clone} could not be verified (${state.error}); check that git is installed before repairing anything.`);
          } else {
            io.print(state.state === 'absent' ? `  Clone: ${clone} is missing.` : state.state === 'foreign' ? `  Clone: ${clone} is a clone of ${state.origin}, not ${remote}.` : `  Clone: ${clone} exists but is not a complete clone.`);
            io.print(`  Restore it: ${state.state === 'absent' ? '' : `move ${clone} aside, then run `}${invocation(args.form, 'team join')} ${remote}`);
          }
        } else {
          io.print('  From the local clone; GitHub access is not checked.');
          // Best-effort host truth for the member permission chip: null (unknown) when gh is absent, when
          // the lookup fails, or when --permissions was not passed — status stays an offline-tolerant read
          // and never throws for it.
          const admins = args.permissions && tools.gh && ownerRepo !== null ? await adminLogins(runner, ownerRepo) : null;
          // Join dates come from the clone's own history (one git pass for the whole roster); an
          // unreadable history leaves every `joined` null, exactly as an absent gh leaves `admin` null.
          const { roster, problems } = await readRoster(clone, { adminLogins: admins, joined: tools.git ? await joinDates(clone, runner) : undefined });
          detail.members = roster;
          detail.memberCount = roster.length;
          detail.unreadableMembers = problems.length;
          io.print(`  Members: ${roster.length}${problems.length ? ` readable; ${problems.length} unreadable` : ''}`);
          for (const member of roster.slice(0, 5)) io.print(`    @${member.handle} — ${member.displayName}${member.handle === binding.handle ? ' (you)' : ''}`);
          if (roster.length > 5) io.print(`    … and ${roster.length - 5} more`);
          for (const problem of problems) io.print(`    ${problem.file}: ${problem.message}`);
          const teamJson = await readTeam(clone);
          detail.policy = teamJson.policy ?? null;
          detail.categories = teamJson.categories ?? null;
          if (teamJson.archived.includes(binding.handle)) detail.membership = 'inactive';
          else {
            try { await access(join(clone, 'people', `${binding.handle}.json`)); detail.membership = 'active'; }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') detail.membership = 'missing'; else throw error; }
          }
          if (detail.membership === 'inactive') io.print('  Your membership: inactive in the local roster.');
          if (detail.membership === 'missing') io.print('  Your membership: no entry in the local roster.');
          const skillProblems: SkillProblem[] = [];
          const skills = await skillRecords(clone, team, { onProblem: (problem) => skillProblems.push(problem) });
          detail.sharedSkills = skills.length;
          detail.unreadableSkills = skillProblems.length;
          io.print(`  Shared skills: ${skills.length}${skillProblems.length ? ` readable; ${skillProblems.length} unreadable` : ''}`);
          for (const problem of skillProblems) io.print(`    ${problem.name}: ${problem.message}`);
          io.print('  Evaluated skills: not yet available');
          const stale = await staleLine(store.root, team, args.now, args.form);
          detail.stale = stale !== null;
          if (stale) io.print(`  ${stale}`);
          detail.readable = true;
        }
      } catch (error) {
        detail.policy = null;
        detail.categories = null;
        const message = error instanceof Error ? error.message : String(error);
        if (!headerPrinted) {
          io.print(`Team ${team} (configured handle @${binding.handle})`);
          detail.clone = { state: 'incomplete', reason: 'unverifiable', error: message };
        }
        io.print(`  Team details could not be read: ${message}`);
      }
      if (!detail.readable) lines.push(`${team}: local team details could not be read.`);
    }
    return lines.length ? failure(lines.join('\n'), { version, teams, ledger, identity, tools, ...architecture }) : success({ version, teams, ledger, identity, tools, ...architecture });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error), { version, teams, ledger, identity, tools, ...architecture }); }
}
