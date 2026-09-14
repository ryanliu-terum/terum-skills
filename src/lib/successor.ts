/**
 * When a team's GitHub repository stops existing (an owner deleted it and created a fresh one, as
 * happened on 2026-09-13 with terum-shared-skills -> shared-skills), every machine still bound to the
 * old remote fails every fetch with "Repository not found" and nothing on the machine can tell the
 * person where the team went. This module asks GitHub the two questions that usually answer it:
 * a pending invitation from the same owner, or a repository of that owner the account already
 * collaborates on which carries a team.json at its root. It is read-only, never throws, and is
 * bounded per call so an unattended sync can afford it.
 */
import { githubOwnerRepo, isRepositoryNotFound, remoteToGitUrl } from './remote.js';
import type { Runner } from './runner.js';
import { paginatedItems } from './collaborators.js';

export interface Successor {
  /** `owner/repo` on github.com. */
  ownerRepo: string;
  /** How it was found: an invitation still to accept, or a repository the account already has access to. */
  source: 'invitation' | 'member';
  /** GitHub's invitation id, so a join can accept it without a second lookup. */
  invitationId?: number;
  /** The `name` in the candidate's team.json when it could be read; null for an invitation (its contents are not readable before acceptance). */
  teamName: string | null;
  /** ISO timestamp: when the invitation was created, or when the repository was last pushed. */
  at: string | null;
}

export interface SuccessorSearch {
  successors: Successor[];
  /** Why the lookup could not run or was cut short; absent when GitHub answered. An empty list with no reason means GitHub knows of nothing. */
  reason?: string;
}

/** Each gh call is bounded so a background sync never wedges on GitHub; expiry reads as "unavailable". */
export const SUCCESSOR_LOOKUP_DEADLINE_MS = 10_000;
/** How many collaborator repositories of the owner are probed for a team.json, newest push first. */
export const SUCCESSOR_PROBE_LIMIT = 8;

interface Invitation { id?: number; created_at?: string; repository?: { full_name?: string; owner?: { login?: string } } }
interface Repository { full_name?: string; archived?: boolean; pushed_at?: string | null; owner?: { login?: string } }

/**
 * Successors of `oldRemote`, best first: invitations before repositories already accessible, each
 * group newest first. A non-GitHub remote, a missing or logged-out gh, and a failed API call all
 * come back as an empty list with a reason.
 */
export async function findSuccessors(runner: Runner, oldRemote: string, options: { deadlineMs?: number; probeLimit?: number } = {}): Promise<SuccessorSearch> {
  const old = githubOwnerRepo(oldRemote);
  if (!old) return { successors: [], reason: 'The team repository is not on github.com, so no replacement can be looked up.' };
  const [owner, oldRepo] = old.split('/') as [string, string];
  const sameOwner = (login: string | undefined): boolean => login !== undefined && login.toLowerCase() === owner.toLowerCase();
  const isOld = (fullName: string | undefined): boolean => fullName !== undefined && fullName.toLowerCase() === `${owner}/${oldRepo}`.toLowerCase();
  const deadlineMs = options.deadlineMs ?? SUCCESSOR_LOOKUP_DEADLINE_MS;
  const gh = async (endpoint: string, paginate = false) => {
    try { return await runner.run('gh', ['api', endpoint, ...(paginate ? ['--paginate', '--slurp'] : [])], { deadlineMs }); }
    catch (error) {
      // spawn ENOENT: gh is not installed. Any other throw is equally "unavailable"; the reason names it.
      return { code: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
    }
  };

  const invitations = await gh('user/repository_invitations');
  if (invitations.code !== 0) return { successors: [], reason: unavailable(invitations.stderr) };
  const found: Successor[] = [];
  try {
    for (const invitation of parseArray<Invitation>(invitations.stdout)) {
      const fullName = invitation.repository?.full_name;
      if (!fullName || !sameOwner(invitation.repository?.owner?.login ?? fullName.split('/')[0]) || isOld(fullName) || typeof invitation.id !== 'number') continue;
      found.push({ ownerRepo: fullName, source: 'invitation', invitationId: invitation.id, teamName: null, at: invitation.created_at ?? null });
    }
  } catch (error) { return { successors: [], reason: `GitHub returned an unreadable invitation list: ${error instanceof Error ? error.message : String(error)}` }; }
  found.sort(newestFirst);

  const repositories = await gh('user/repos?affiliation=collaborator,organization_member,owner&sort=pushed&per_page=100', true);
  if (repositories.code !== 0) return { successors: found, reason: unavailable(repositories.stderr) };
  let candidates: Repository[];
  try {
    candidates = paginatedItems<Repository>(repositories.stdout)
      .filter((repo) => repo.full_name && sameOwner(repo.owner?.login ?? repo.full_name.split('/')[0]) && !isOld(repo.full_name) && !repo.archived)
      .filter((repo) => !found.some((entry) => entry.ownerRepo.toLowerCase() === repo.full_name!.toLowerCase()))
      .sort((a, b) => (b.pushed_at ?? '').localeCompare(a.pushed_at ?? ''))
      .slice(0, options.probeLimit ?? SUCCESSOR_PROBE_LIMIT);
  } catch (error) { return { successors: found, reason: `GitHub returned an unreadable repository list: ${error instanceof Error ? error.message : String(error)}` }; }
  const members: Successor[] = [];
  for (const repo of candidates) {
    const contents = await gh(`repos/${repo.full_name}/contents/team.json`);
    if (contents.code !== 0) continue; // 404: not a team repository; anything else: not provably one either
    members.push({ ownerRepo: repo.full_name!, source: 'member', teamName: teamNameOf(contents.stdout), at: repo.pushed_at ?? null });
  }
  members.sort(newestFirst);
  return { successors: [...found, ...members] };
}

/**
 * Whether `remote` answers "repository not found" to a read-only probe. Used by setup when a machine already
 * bound to one team is handed another: a dead current repository turns the one-team refusal into a move.
 * Bounded like the lookups above; anything but a clear "not found" (offline, denied, a timeout) is false,
 * because only that answer justifies leaving a team on the person's behalf.
 */
export async function repositoryIsGone(runner: Runner, remote: string, options: { deadlineMs?: number } = {}): Promise<boolean> {
  if (!githubOwnerRepo(remote)) return false;
  try {
    const probe = await runner.run('git', ['ls-remote', '--exit-code', remoteToGitUrl(remote), 'HEAD'], {
      deadlineMs: options.deadlineMs ?? SUCCESSOR_LOOKUP_DEADLINE_MS,
      env: { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.interactive', GIT_CONFIG_VALUE_0: 'false' },
    });
    return probe.code !== 0 && isRepositoryNotFound(probe.stderr);
  } catch { return false; } // no git at all: not evidence the repository is gone
}

/** One line for the person: a repository that no longer exists, and what (if anything) was found to replace it. */
export function successorSummary(team: string, ownerRepo: string, search: SuccessorSearch): string {
  const head = `${team}'s repository ${ownerRepo} no longer exists on GitHub.`;
  if (search.successors.length === 0) {
    return search.reason
      ? `${head} ${search.reason}`
      : `${head} No replacement was found: no pending invitation from ${ownerRepo.split('/')[0]} and no repository of theirs you can reach carries a team.json. Ask the team owner where the team moved, then run team move <owner>/<repo>.`;
  }
  const first = search.successors[0]!;
  const how = first.source === 'invitation' ? 'you were invited to it' : 'you already have access to it';
  return `${head} A replacement from the same owner is available: ${first.ownerRepo} (${how}${first.at ? ` on ${first.at.slice(0, 10)}` : ''}).`;
}

function unavailable(stderr: string): string {
  const trimmed = stderr.trim();
  if (/ENOENT/.test(trimmed)) return 'gh is not installed, so no replacement could be looked up on GitHub.';
  if (/Requires authentication|not logged in|HTTP 401/i.test(trimmed)) return 'gh is logged out, so no replacement could be looked up on GitHub; run `gh auth login`, then sync again.';
  if (/exceeded .* s$/.test(trimmed)) return 'GitHub did not answer in time, so no replacement could be looked up.';
  return `GitHub could not be asked for a replacement: ${trimmed || 'gh returned no output'}.`;
}

function parseArray<T>(source: string): T[] {
  const parsed = JSON.parse(source || '[]') as unknown;
  if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
  return parsed as T[];
}

/** team.json arrives base64-encoded in a contents response; a name that cannot be read is null, never a guess. */
function teamNameOf(contents: string): string | null {
  try {
    const body = JSON.parse(contents) as { content?: string; encoding?: string };
    if (typeof body.content !== 'string') return null;
    const text = body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content;
    const team = JSON.parse(text) as { name?: unknown };
    return typeof team.name === 'string' && team.name.length > 0 ? team.name : null;
  } catch { return null; }
}

function newestFirst(a: Successor, b: Successor): number { return (b.at ?? '').localeCompare(a.at ?? ''); }
