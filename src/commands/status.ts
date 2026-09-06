import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { GET_STARTED_LINES } from '../lib/hints.js';
import { staleLine } from '../lib/hook.js';
import { Prompter } from '../lib/prompt.js';
import { normalizeRemote, repositoryUrl } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { readRoster, readTeam, RosterEntry, SkillProblem, skillRecords } from '../lib/skills.js';
import { CloneState, describeClone, packageVersion } from '../lib/teamRepo.js';

export interface StatusArgs { team?: string; config?: ConfigStore; runner?: Runner; now?: () => number; }
export interface TeamStatus {
  team: string; handle: string; repository: string | null; clone: CloneState; readable: boolean;
  members: RosterEntry[]; memberCount: number | null; unreadableMembers: number | null;
  sharedSkills: number | null; unreadableSkills: number | null;
  membership: 'active' | 'inactive' | 'missing' | null; stale: boolean;
}
export interface StatusResult { version: string | null; teams: TeamStatus[]; }

/** Offline local team summary; a successful query is not a setup-readiness or membership test. */
export async function run(args: StatusArgs, io: Prompter): Promise<Result<StatusResult>> {
  const version = packageVersion();
  const teams: TeamStatus[] = [];
  try {
    io.print(version === null ? 'terum-skills (version unknown)' : `terum-skills ${version}`);
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const selected = args.team !== undefined ? [selectTeam(config.teams, args.team)] : Object.entries(config.teams);
    if (!selected.length) for (const line of GET_STARTED_LINES) io.print(line);
    const lines: string[] = [];
    for (const [team, binding] of selected) {
      if (teams.length) io.print('');
      const detail: TeamStatus = {
        team, handle: binding.handle, repository: null, clone: { state: 'incomplete', reason: 'unverifiable' }, readable: false,
        members: [], memberCount: null, unreadableMembers: null, sharedSkills: null, unreadableSkills: null, membership: null, stale: false,
      };
      teams.push(detail);
      let headerPrinted = false;
      try {
        const clone = store.teamClone(team);
        detail.repository = repositoryUrl(binding.remote);
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
            io.print(`  Restore it: ${state.state === 'absent' ? '' : `move ${clone} aside, then run `}npx -y terum-skills@latest team join ${remote}`);
          }
        } else {
          io.print('  From the local clone; GitHub access is not checked.');
          const { roster, problems } = await readRoster(clone);
          detail.members = roster;
          detail.memberCount = roster.length;
          detail.unreadableMembers = problems.length;
          io.print(`  Members: ${roster.length}${problems.length ? ` readable; ${problems.length} unreadable` : ''}`);
          for (const member of roster.slice(0, 5)) io.print(`    @${member.handle} — ${member.displayName}${member.handle === binding.handle ? ' (you)' : ''}`);
          if (roster.length > 5) io.print(`    … and ${roster.length - 5} more`);
          for (const problem of problems) io.print(`    ${problem.file}: ${problem.message}`);
          const teamJson = await readTeam(clone);
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
          const stale = await staleLine(store.root, team, args.now);
          detail.stale = stale !== null;
          if (stale) io.print(`  ${stale}`);
          detail.readable = true;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!headerPrinted) {
          io.print(`Team ${team} (configured handle @${binding.handle})`);
          detail.clone = { state: 'incomplete', reason: 'unverifiable', error: message };
        }
        io.print(`  Team details could not be read: ${message}`);
      }
      if (!detail.readable) lines.push(`${team}: local team details could not be read.`);
    }
    return lines.length ? failure(lines.join('\n'), { version, teams }) : success({ version, teams });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error), { version, teams }); }
}
