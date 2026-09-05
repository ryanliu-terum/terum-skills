import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { askHandle, AuthDependencies, authenticateCreator, bindTeam, collectIdentity, detectOrOfferGh, ghState, GhState, gitAuthEnv, Identity, identityForJoiner, setIdentity, teamByRemote } from '../lib/auth.js';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { exists, mkdirPrivate } from '../lib/fs.js';
import { Prompter } from '../lib/prompt.js';
import { githubOwnerRepo, hasEmbeddedCredentials, hostOperationAllowed, normalizeRemote, remoteName, remoteToGitUrl, stripRemoteCredentials } from '../lib/remote.js';
import { activePeople, readPeople } from '../lib/readme.js';
import { Result, failure, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { githubLoginSchema, Person, Team, handleSchema, parseJson, parseOrExplain, personSchema, teamNameSchema, teamSchema } from '../lib/schema.js';
import { cloneOrigin, cloneTeam, MutableTree, openTeamRepo, treeText } from '../lib/teamRepo.js';
import { endorsedCandidates } from '../lib/skills.js';
import { installOne } from './install.js';

/**
 * §6 `team create` and `team join` (milestone M1). Both are `run(args, io)` over the Prompter.
 * The §8 hook offer and the §6 endorsed-set install offer arrive with M4 and M2 respectively.
 */
export interface TeamDependencies extends AuthDependencies { config?: ConfigStore; runner?: Runner; }
export interface CreateArgs extends TeamDependencies { name: string; org?: string; remote?: string; }
export interface JoinArgs extends TeamDependencies { target: string; as?: string; }
export interface RemoveArgs extends TeamDependencies { handle: string; team?: string; archiveOnly?: boolean; }
export type TeamArgs = ({ kind: 'create' } & CreateArgs) | ({ kind: 'join' } & JoinArgs) | ({ kind: 'remove' } & RemoveArgs);
export type CreateResult = { team: string; remote: string };
export type JoinResult = { team: string; handle: string; rejoined: boolean; roster: RosterEntry[] };
export interface RosterEntry { handle: string; displayName: string; }
export interface RemoveResult { team: string; handle: string; archiveOnly: boolean; }

export class HandleCollisionError extends Error {
  constructor(readonly handle: string) { super(`Handle ${handle} is already in use by an active member.`); this.name = 'HandleCollisionError'; }
}

const CATEGORIES = ['debugging', 'testing', 'docs', 'workflow', 'research', 'infra', 'misc'];
export const MAX_HANDLE_ATTEMPTS = 3;

export async function run(args: TeamArgs, io: Prompter): Promise<Result<CreateResult | JoinResult | RemoveResult>> {
  if (args.kind === 'create') return create(args, io);
  if (args.kind === 'join') return join(args, io);
  return remove(args, io);
}

/** §6 `team remove`: GitHub access revocation plus the guarded, historical roster archive. */
export async function remove(args: RemoveArgs, io: Prompter): Promise<Result<RemoveResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const [teamName, binding] = selectTeam(config.teams, args.team);
    if (!binding.handle) throw new Error(`This machine has no member handle for ${teamName}; run team join first.`);
    const targetHandle = parseOrExplain(handleSchema, args.handle, 'member handle');
    if (targetHandle === binding.handle) throw new Error('You cannot remove yourself; use team leave when that command is available.');
    const allowed = hostOperationAllowed(binding.remote, Boolean(args.archiveOnly));
    if (!allowed.ok) throw new Error(allowed.error);
    const clone = store.teamClone(teamName);
    const env = gitAuthEnv(binding.token);
    // Resolve the target against origin/main, not the possibly stale clone: a member who joined
    // after this machine last synced must be removable, and the GitHub login must be current.
    const fetched = await runner.run('git', ['fetch', '-q', 'origin'], { cwd: clone, env });
    if (fetched.code !== 0) throw new Error(`Could not fetch ${binding.remote}: ${(fetched.stderr || fetched.stdout).trim()}`);
    const shown = await runner.run('git', ['show', `origin/main:people/${targetHandle}.json`], { cwd: clone });
    if (shown.code !== 0) throw new Error(`No member ${targetHandle} in ${teamName}: people/${targetHandle}.json is not on origin/main.`);
    // Validate from the raw document as well as personSchema: legacy repositories can contain a
    // login written before the schema existed, and it must never reach a gh API path.
    const targetRaw = JSON.parse(shown.stdout) as { github?: unknown };
    const login = parseOrExplain(githubLoginSchema, targetRaw.github, `GitHub login for ${targetHandle}`);
    parseJson(personSchema, shown.stdout, `people/${targetHandle}.json`);
    const ownerRepo = githubOwnerRepo(binding.remote);
    let collaborator = false;
    let pending: Array<{ id?: number; invitee?: { login?: string } }> = [];
    if (ownerRepo !== null) {
      const admin = await runner.run('gh', ['api', `repos/${ownerRepo}`, '-q', '.permissions.admin'], { env });
      if (admin.code !== 0 || admin.stdout.trim() !== 'true') throw new Error('Team removal requires GitHub repository admin permission.');
      if (!args.archiveOnly) {
        const admins = await runner.run('gh', ['api', `repos/${ownerRepo}/collaborators?permission=admin`, '--paginate', '--slurp'], { env });
        if (admins.code !== 0) throw new Error(`Could not list repository admins: ${(admins.stderr || admins.stdout).trim()}`);
        const adminLogins = paginatedItems<{ login?: string }>(admins.stdout).map((member) => member.login?.toLowerCase()).filter((value): value is string => Boolean(value));
        if (adminLogins.length <= 1 && adminLogins.includes(login.toLowerCase())) throw new Error(`Refusing to remove ${targetHandle}: they are the last remaining admin.`);
        const collaborators = await runner.run('gh', ['api', `repos/${ownerRepo}/collaborators`, '--paginate', '--slurp'], { env });
        if (collaborators.code !== 0) throw new Error(`Could not list repository collaborators: ${(collaborators.stderr || collaborators.stdout).trim()}`);
        collaborator = paginatedItems<{ login?: string }>(collaborators.stdout).some((member) => member.login?.toLowerCase() === login.toLowerCase());
        const invitations = await runner.run('gh', ['api', `repos/${ownerRepo}/invitations`, '--paginate', '--slurp'], { env });
        if (invitations.code !== 0) throw new Error(`Could not list pending invitations: ${(invitations.stderr || invitations.stdout).trim()}`);
        pending = paginatedItems<{ id?: number; invitee?: { login?: string } }>(invitations.stdout).filter((invite) => invite.invitee?.login?.toLowerCase() === login.toLowerCase());
      }
    }
    const question = args.archiveOnly ? `Archive ${targetHandle}? (y/N)` : `Revoke GitHub access for @${login} and archive ${targetHandle}? (y/N)`;
    if (!(await io.confirm(question))) throw new Error('Team removal was cancelled.');
    const repo = openTeamRepo(clone, binding.remote, runner);
    await repo.safeWrite((tree) => archiveMutation(tree, targetHandle), { action: 'team-remove', handle: binding.handle, targetHandle, token: binding.token, message: `${binding.handle}: remove ${targetHandle}` });
    if (ownerRepo !== null && !args.archiveOnly) {
      try {
        if (collaborator) {
          const revoked = await runner.run('gh', ['api', '-X', 'DELETE', `repos/${ownerRepo}/collaborators/${login}`], { env });
          if (revoked.code !== 0) throw new Error((revoked.stderr || revoked.stdout).trim());
        }
        for (const invitation of pending) {
          if (invitation.id === undefined) continue;
          const cancelled = await runner.run('gh', ['api', '-X', 'DELETE', `repos/${ownerRepo}/invitations/${invitation.id}`], { env });
          if (cancelled.code !== 0) throw new Error((cancelled.stderr || cancelled.stdout).trim());
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${targetHandle} is archived; @${login}'s access could not be revoked: ${reason}. Re-run team remove ${targetHandle} to retry.`);
      }
      if (!collaborator && pending.length === 0) io.print(`@${login} is neither a current collaborator nor a pending invitee.`);
    }
    io.print(`${args.archiveOnly ? 'Archived' : 'Removed'} ${targetHandle} from ${teamName}.${args.archiveOnly ? ' Access remains managed on the host.' : ''}`);
    return success({ team: teamName, handle: targetHandle, archiveOnly: Boolean(args.archiveOnly) });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

/** gh --paginate --slurp returns an array of response pages; accept one-page fixture output too. */
function paginatedItems<T>(source: string): T[] {
  const parsed = JSON.parse(source || '[]') as unknown;
  if (!Array.isArray(parsed)) throw new Error('GitHub returned an invalid paginated response.');
  return parsed.flatMap((page) => Array.isArray(page) ? page : [page]) as T[];
}

/** Pure safeWrite mutation: people and authored skills remain as history; only active membership changes. */
export function archiveMutation(tree: MutableTree, targetHandle: string): void {
  const source = tree.before('team.json');
  if (source === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');
  const team = parseJson(teamSchema, treeText(source), 'team.json');
  if (team.archived.includes(targetHandle)) return;
  tree.set('team.json', `${JSON.stringify({ ...team, archived: [...team.archived, targetHandle] }, null, 2)}\n`);
}

export async function create(args: CreateArgs, io: Prompter): Promise<Result<CreateResult>> {
  try {
    const name = parseOrExplain(teamNameSchema, args.name, 'team name');
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const clone = store.teamClone(name);
    if (config.teams[name]) throw new Error(`Team ${name} is already configured for ${config.teams[name].remote}; run \`team join\` for it or pick another name.`);
    if (await exists(clone)) throw new Error(`A clone already exists at ${clone}; run \`team join\` for that team or pick another name.`);

    let remote: string;
    let token: string | null = null;
    let identity: Identity;
    if (args.remote) {
      // Generic-git path: an existing EMPTY remote the user already has credentials for. A credential
      // pasted into the URL is dropped here, before the remote reaches git, config, or a message.
      remote = stripRemoteCredentials(args.remote);
      const bound = teamByRemote(config, remote);
      if (bound) throw new Error(`${normalizeRemote(remote)} is already configured as team ${bound[0]}.`);
      if (hasEmbeddedCredentials(args.remote)) io.print(credentialNotice(remote));
      identity = await collectIdentity(io, config, runner, { gh: await ghState(runner) });
      const heads = await runner.run('git', ['ls-remote', '--heads', '--', remoteToGitUrl(remote)]);
      if (heads.code !== 0) throw new Error(`Cannot reach ${remote}: ${(heads.stderr || heads.stdout).trim()}`);
      if (heads.stdout.trim()) throw new Error(`${remote} already has branches; \`team create --remote\` needs an empty repository. To join an existing team run \`team join ${remote}\`.`);
    } else {
      const auth = await authenticateCreator(io, { config: store, runner }, { requireGh: true });
      identity = auth.identity;
      token = auth.token;
      const spec = args.org ? `${args.org}/${name}` : name;
      const env = gitAuthEnv(token);
      const created = await runner.run('gh', ['repo', 'create', spec, '--private'], { env });
      if (created.code !== 0) throw new Error(`Could not create the GitHub repository ${spec}: ${(created.stderr || created.stdout).trim()}`);
      // gh resolves a bare name to the authenticated login; ask it for the owner rather than guessing.
      const view = await runner.run('gh', ['repo', 'view', spec, '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { env });
      if (view.code !== 0 || !view.stdout.trim()) throw new Error(`Created ${spec} but could not resolve its owner: ${(view.stderr || view.stdout).trim()}`);
      remote = `https://github.com/${view.stdout.trim()}.git`;
    }

    await store.ensureRoot();
    try {
      await bootstrap(remote, clone, name, identity, runner, token);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${reason}\nThe repository ${remote} exists but holds no scaffold. Fix the cause and retry with \`team create ${name} --remote ${remote}\`, or delete the repository.`);
    }
    await store.update((fresh) => {
      if (fresh.teams[name]) throw new Error(`Team ${name} was configured by another process while this create ran; the repository ${remote} is scaffolded, run \`team join ${remote} --as <other-name>\` to use it.`);
      setIdentity(fresh, identity);
      bindTeam(fresh, name, { remote, token, handle: identity.handle });
    });
    io.print(`Created team ${name} at ${remote}`);
    return success({ team: name, remote });
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function join(args: JoinArgs, io: Prompter): Promise<Result<JoinResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const target = parseJoinTarget(args.target);
    const normalized = normalizeRemote(target.remote);
    if (hasEmbeddedCredentials(args.target)) io.print(credentialNotice(normalized));
    const configBefore = await store.read();

    // §6: a second join of an already-configured remote updates that entry; it never creates a duplicate team.
    const existing = teamByRemote(configBefore, normalized);
    if (existing && args.as && args.as !== existing[0]) io.print(`This remote is already configured as team ${existing[0]}; ignoring --as ${args.as}.`);
    const team = parseOrExplain(teamNameSchema, existing?.[0] ?? args.as ?? remoteName(target.remote), 'team name');
    if (!existing && configBefore.teams[team]) {
      throw new Error(`Team name ${team} is already used for ${configBefore.teams[team].remote}; pass --as <other-name>.`);
    }
    // §5.4: the per-team handle is immutable once its people file exists — and only join/create bind it.
    const boundHandle = existing?.[1].handle ?? undefined;
    const token = existing?.[1].token ?? null;

    // gh detection (and the login offer) comes first, so credentials are in place before the clone.
    const gh = await detectOrOfferGh(io, runner);
    if (target.github) await acceptOrDirect(target.ownerRepo!, io, runner, gh);
    await store.ensureRoot();
    const clone = store.teamClone(team);
    await ensureClone(clone, target.remote, normalized, runner, token);

    const { identity: suggested } = await identityForJoiner(io, { config: store, runner }, { fixedHandle: boundHandle, gh });
    await requireGitConfig(runner, clone, suggested);
    const repo = openTeamRepo(clone, target.remote, runner);

    let identity = suggested;
    let rejoined = false;
    for (let attempt = 1; ; attempt++) {
      try {
        await repo.safeWrite((tree) => { rejoined = joinMutation(tree, identity, boundHandle); }, { action: 'join', handle: identity.handle, token, message: `${identity.handle}: join` });
        break;
      } catch (error) {
        if (!(error instanceof HandleCollisionError) || attempt >= MAX_HANDLE_ATTEMPTS) throw error;
        io.print(error.message);
        identity = { ...identity, handle: await askHandle(io) };
      }
    }

    await store.update((fresh) => {
      setIdentity(fresh, identity);
      bindTeam(fresh, team, { remote: normalized, handle: identity.handle });
    });
    io.print(`${rejoined ? 'Rejoined' : 'Joined'} ${team} as ${identity.handle}`);
    // The join is durable once safeWrite returned; a read-back problem must not turn it into a failure.
    let roster: RosterEntry[] = [];
    try {
      roster = await readRoster(clone);
      io.print('Members:');
      for (const member of roster) io.print(`  ${member.handle}  ${member.displayName}`);
    } catch (error) {
      io.print(`Joined, but the member list could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    // M2: the post-join endorsement offer deliberately reuses installOne, including its
    // individual allowed-tools consent and persisted approval record. The set prompt itself is
    // one question, as §6 requires.
    const endorsed = await endorsedCandidates(clone, team, identity.handle, { onProblem: (problem) => io.print(`Skipping ${problem.name}: ${problem.message}`) });
    if (endorsed.length && await io.confirm(`Install ${endorsed.length} team-endorsed skill(s)?`)) {
      for (const skill of endorsed) {
        try { await installOne({ team, id: skill.id, store, runner }, io); }
        catch (error) { io.print(`Could not install endorsed skill ${skill.name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    return success({ team, handle: identity.handle, rejoined, roster });
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The PURE join mutation (§6.0 step 2): decides collision, rejoin, and the people file from the
 * tree it is handed — the freshly reset origin/main — never from a preflight snapshot. An existing
 * live file is only ours when this machine is bound to the handle AND the file carries our GitHub
 * login or email; an archived file is only a rejoin under the same test. Throws
 * HandleCollisionError so the caller can re-prompt; safeWrite's `finally` leaves the clone clean.
 */
export function joinMutation(tree: MutableTree, identity: Identity, boundHandle: string | undefined): boolean {
  const handle = identity.handle;
  const path = `people/${handle}.json`;
  const teamJson = tree.before('team.json');
  if (teamJson === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');
  const teamDocument = parseJson(teamSchema, treeText(teamJson), 'team.json');
  const archived = teamDocument.archived.includes(handle);
  const existingJson = tree.before(path);
  const existing = existingJson === undefined ? undefined : parseJson(personSchema, treeText(existingJson), path);
  if (existing) {
    const samePerson = existing.github.toLowerCase() === identity.github.toLowerCase() || existing.email.toLowerCase() === identity.email.toLowerCase();
    if (!archived && !(boundHandle === handle && samePerson)) throw new HandleCollisionError(handle);
    if (archived && !samePerson) throw new HandleCollisionError(handle);
  }
  const person: Person = {
    ...(existing ?? {}),
    handle,
    display_name: identity.displayName,
    email: identity.email,
    github: identity.github,
    bio: existing?.bio ?? '',
    installed: existing?.installed ?? [],
    declined: existing?.declined ?? [],
  };
  tree.set(path, `${JSON.stringify(person, null, 2)}\n`);
  if (archived) {
    const restored: Team = { ...teamDocument, archived: teamDocument.archived.filter((item) => item !== handle) };
    tree.set('team.json', `${JSON.stringify(restored, null, 2)}\n`);
  }
  return archived;
}

async function ensureClone(clone: string, remote: string, normalized: string, runner: Runner, token: string | null): Promise<void> {
  if (!(await exists(clone))) { await cloneTeam(remote, clone, runner, token); return; }
  const origin = await cloneOrigin(clone, runner);
  if (origin === null || !(await exists(pathJoin(clone, 'team.json')))) {
    throw new Error(`${clone} exists but is not a complete clone of ${remote}; move it aside and retry.`);
  }
  if (origin !== normalized) throw new Error(`${clone} is a clone of ${origin}, not ${normalized}; pass --as <other-name> to keep both teams.`);
}

async function readRoster(clone: string): Promise<RosterEntry[]> {
  const team = parseJson(teamSchema, await readFile(pathJoin(clone, 'team.json'), 'utf8'), 'team.json');
  return activePeople(await readPeople(clone), team.archived).map((person) => ({ handle: person.handle, displayName: person.display_name }));
}

async function requireGitConfig(runner: Runner, cwd: string, identity: { displayName: string; email: string }): Promise<void> {
  for (const [key, value] of [['user.name', identity.displayName], ['user.email', identity.email]] as const) {
    const result = await runner.run('git', ['config', key, value], { cwd });
    if (result.code !== 0) throw new Error(`Could not configure the git identity in ${cwd}: ${(result.stderr || result.stdout).trim()}`);
  }
}

/**
 * §6: `<org>/<repo>` is the GitHub form (invitation API); anything else is a remote joined with
 * ambient git credentials and no invitation API — even when the URL happens to be on github.com.
 * `git@host:org/repo` has a colon, so it is a URL, never an owner/repo pair.
 */
export function parseJoinTarget(value: string): { remote: string; github: boolean; ownerRepo?: string } {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    const ownerRepo = trimmed.replace(/\.git$/i, '');
    return { remote: `https://github.com/${ownerRepo}.git`, github: true, ownerRepo };
  }
  normalizeRemote(trimmed);
  return { remote: stripRemoteCredentials(trimmed), github: false };
}

/** Printed once when a pasted remote carried a credential (§5.1): it was dropped, and the user should know where access comes from instead. */
export function credentialNotice(remote: string): string {
  return `Ignored the credential embedded in the remote URL: terum-skills never stores one or passes one to git. Access to ${normalizeRemote(remote)} comes from gh on GitHub, or from your git credential helper elsewhere.`;
}

/** GitHub invitations: gh logged in → list then PATCH; empty list means already a collaborator. Without gh → print the URL and wait. */
async function acceptOrDirect(ownerRepo: string, io: Prompter, runner: Runner, gh: GhState): Promise<void> {
  if (!gh.authenticated) {
    io.print(`Accept the invitation at https://github.com/${ownerRepo}/invitations before continuing.`);
    if (!(await io.confirm('Continue after accepting the invitation?'))) throw new Error('Invitation acceptance was declined.');
    return;
  }
  const invitations = await runner.run('gh', ['api', 'user/repository_invitations']);
  if (invitations.code !== 0) throw new Error(`Could not list GitHub invitations: ${(invitations.stderr || invitations.stdout).trim()}`);
  const list = JSON.parse(invitations.stdout || '[]') as Array<{ id: number; repository?: { full_name?: string } }>;
  const invitation = list.find((item) => item.repository?.full_name?.toLowerCase() === ownerRepo.toLowerCase());
  if (!invitation) return;
  const accepted = await runner.run('gh', ['api', '--method', 'PATCH', `user/repository_invitations/${invitation.id}`]);
  if (accepted.code !== 0) throw new Error(`Could not accept the invitation: ${(accepted.stderr || accepted.stdout).trim()}`);
}

/**
 * The one write outside safeWrite: an EMPTY remote has no origin/main to fetch and reset, so the
 * scaffold is committed in a staging repo, pushed with `-u`, and the staging repo becomes the clone.
 * Every later write goes through safeWrite (open question for the spec, recorded in the M1 report).
 */
async function bootstrap(remote: string, clone: string, teamName: string, identity: Identity, runner: Runner, token: string | null): Promise<void> {
  const staging = `${clone}.bootstrap-${randomUUID()}`;
  const env = gitAuthEnv(token);
  const git = async (...parts: string[]) => {
    const result = await runner.run('git', parts, { cwd: staging, env });
    if (result.code !== 0) throw new Error(`git ${parts.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  };
  await mkdirPrivate(staging);
  try {
    await git('init', '-q');
    await git('checkout', '-q', '-b', 'main');
    await git('remote', 'add', 'origin', '--', remoteToGitUrl(remote));
    await git('config', 'user.name', identity.displayName);
    await git('config', 'user.email', identity.email);
    const team: Team = { layout_version: 2, name: teamName, categories: CATEGORIES, global: [], projects: {}, archived: [], policy: { publish: 'pr', skill_license: 'UNLICENSED' } };
    const person: Person = { handle: identity.handle, display_name: identity.displayName, email: identity.email, github: identity.github, bio: '', installed: [], declined: [] };
    await writeFile(pathJoin(staging, 'team.json'), `${JSON.stringify(team, null, 2)}\n`);
    await mkdir(pathJoin(staging, 'people'), { recursive: true });
    await writeFile(pathJoin(staging, 'people', `${identity.handle}.json`), `${JSON.stringify(person, null, 2)}\n`);
    await mkdir(pathJoin(staging, 'skills'), { recursive: true });
    await writeFile(pathJoin(staging, 'skills', '.gitkeep'), '');
    await mkdir(pathJoin(staging, 'evals'), { recursive: true });
    await writeFile(pathJoin(staging, 'evals', '.gitkeep'), '');
    await mkdir(pathJoin(staging, '.github', 'workflows'), { recursive: true });
    await writeFile(pathJoin(staging, 'README.md'), `# ${teamName} skills\n\n<!-- terum-skills:begin -->\n<!-- terum-skills:end -->\n`);
    await writeFile(pathJoin(staging, '.github', 'workflows', 'terum-skills.yml'), WORKFLOW);
    await git('add', '--all');
    await git('commit', '-q', '-m', `${identity.handle}: create team ${teamName}`);
    await git('push', '-q', '-u', 'origin', 'main');
    await rename(staging, clone);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** §9 GitHub Action. It becomes executable once this package is published to npm in M4. */
export const WORKFLOW = `# This workflow requires published terum-skills npm artifacts (M4).
name: terum-skills
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]
jobs:
  readme:
    if: github.event_name == 'push'
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx -y terum-skills@latest readme
      - run: |
          if ! git diff --quiet -- README.md; then
            git config user.name 'github-actions[bot]'
            git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
            git add README.md
            git commit -m 'chore: regenerate skills README'
            git push
          fi
  publish-comment:
    if: github.event_name == 'pull_request' && startsWith(github.head_ref, 'publish/')
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - id: comment
        run: npx -y terum-skills@latest readme --pr-comment origin/main > /tmp/terum-skills-comment.md
      - env:
          GH_TOKEN: \${{ github.token }}
          PR: \${{ github.event.pull_request.number }}
        run: |
          existing=$(gh api "repos/\${{ github.repository }}/issues/$PR/comments" --paginate --jq '.[] | select(.body | contains("<!-- terum-skills:pr-comment -->")) | .id' | head -n 1)
          body=$(cat /tmp/terum-skills-comment.md)
          if [ -n "$existing" ]; then
            gh api -X PATCH "repos/\${{ github.repository }}/issues/comments/$existing" -f body="$body"
          else
            gh api -X POST "repos/\${{ github.repository }}/issues/$PR/comments" -f body="$body"
          fi
`;
