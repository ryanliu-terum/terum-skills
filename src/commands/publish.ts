import { ConfigStore, createConfigStore } from '../lib/config.js';
import { ghState } from '../lib/auth.js';
import { Prompter } from '../lib/prompt.js';
import { githubOwnerRepo, isGitHubRemote, stripRemoteCredentials } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { parseJson, parseSkillFrontmatter, Team, teamSchema } from '../lib/schema.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { findSkill, readTeam } from '../lib/skills.js';
import { openTeamRepo, refreshClone, SafeWriteOptions, treeText } from '../lib/teamRepo.js';
import { parseRef, teamForReference } from './install.js';

export interface PublishArgs {
  ref: string;
  project?: string;
  team?: string;
  config?: ConfigStore;
  runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}
export type PublishScope = { kind: 'global' } | { kind: 'project'; project: string };
export interface PublishResult {
  team: string; id: string; name: string; scope: PublishScope;
  policy: 'pr' | 'push'; changed: boolean; branch: string | null;
  prUrl: string | null; compareUrl: string | null;
}

export async function run(args: PublishArgs, io: Prompter): Promise<Result<PublishResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const reference = parseRef(args.ref);
    if (reference.version !== undefined) throw new Error('publish endorses a skill by ID, not a version; drop @<version>.');
    const team = await teamForReference(config, reference.team ?? args.team, reference.remote, reference.name);
    const binding = config.teams[team]!;
    if (!binding.handle) throw new Error(`Team ${team} has no joined handle.`);
    const clone = store.teamClone(team);
    await refreshClone(runner, clone, { label: team });

    const teamJson = await readTeam(clone);
    const record = await findSkill(clone, team, reference.name);
    if (!record) throw new Error(`No skill ${args.ref} in team ${team}.`);
    const scope: PublishScope = args.project === undefined
      ? { kind: 'global' }
      : Object.hasOwn(teamJson.projects, args.project) ? { kind: 'project', project: args.project } : (() => { throw new Error(`Unknown project ${args.project}.`); })();
    const scopeLabel = label(scope);
    const list = scope.kind === 'global' ? teamJson.global : teamJson.projects[scope.project]!.skills;
    const base: Omit<PublishResult, 'changed' | 'branch' | 'prUrl' | 'compareUrl'> = { team, id: record.id, name: record.name, scope, policy: teamJson.policy.publish };
    if (list.includes(record.id)) return alreadyEndorsed(base, scopeLabel, io);
    const destination = teamJson.policy.publish === 'pr' ? `publish/${record.name}` : null;
    // safeWrite retargets a stale-lease push to `<branch>-2` (teamRepo.ts push()), and `foo-2` is a
    // legal skill name with an endorsement branch of its own, so BOTH names are held to the reuse rule.
    if (destination !== null) for (const candidate of [destination, `${destination}-2`]) await assertBranchReusable(runner, clone, candidate, record.id, scope, binding.remote);

    if (teamJson.policy.publish === 'push') {
      printCard(record, scopeLabel, io);
      if (!(await io.confirm(`Publish ${record.name} to ${team} (${scopeLabel})?`))) throw new Error('Publish was cancelled.');
    }

    const repo = openTeamRepo(clone, binding.remote, runner);
    const written = await repo.safeWrite((tree) => {
      const teamSource = tree.before('team.json');
      if (teamSource === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');
      const skillSource = tree.before(`skills/${record.name}/SKILL.md`);
      const parsed = skillSource === undefined ? undefined : parseSkillFrontmatter(treeText(skillSource));
      if (!parsed?.ok || parsed.data.metadata.id !== record.id) throw new Error(`${record.name} is no longer in the repository as ${record.id.slice(0, 8)}; run sync and retry.`);
      const fresh = parseJson(teamSchema, treeText(teamSource), 'team.json');
      // The branch (or the direct push to main) was chosen from the policy read before the loop; the
      // tree being written may be newer, and a policy the team changed meanwhile must win.
      if (fresh.policy.publish !== teamJson.policy.publish) throw new Error(`The team publish policy changed to "${fresh.policy.publish}" while this publish ran; rerun publish.`);
      const next = endorse(fresh, record.id, scope);
      if (next === undefined) return;
      tree.set('team.json', next);
    }, {
      action: 'publish',
      handle: binding.handle,
      message: `${binding.handle}: publish ${record.name}`,
      ...(destination !== null ? { branch: destination } : {}),
      ...args.safeWrite,
    });
    if (!written.changed) return alreadyEndorsed(base, scopeLabel, io);
    if (teamJson.policy.publish === 'push') {
      io.print(`Published ${record.name} to ${team} (${scopeLabel}).`);
      return success({ ...base, changed: true, branch: null, prUrl: null, compareUrl: null });
    }

    const branch = written.pushedTo;
    const compareUrl = compare(binding.remote, branch);
    if (isGitHubRemote(binding.remote) && (await ghState(runner)).authenticated) {
      const ownerRepo = githubOwnerRepo(binding.remote)!;
      const created = await runner.run('gh', [
        'pr', 'create', '-R', ownerRepo, '--base', 'main', '--head', branch,
        '--title', `${binding.handle}: publish ${record.name}`,
        '--body', `Endorse ${record.name} (${record.id.slice(0, 8)}) for ${team}: ${scopeLabel}.\n\nOpened by terum-skills publish; merge to endorse.`,
      ]);
      if (created.code === 0) {
        const prUrl = created.stdout.trim();
        io.print(prUrl);
        return success({ ...base, changed: true, branch, prUrl, compareUrl: null });
      }
      // Re-running while the pull request is still open is not a failure: the branch was refreshed and the PR stands.
      const reason = commandMessage(created.stderr, created.stdout);
      if (/already exists/i.test(reason)) {
        const existing = /https?:\/\/\S+/.exec(reason)?.[0] ?? null;
        io.print(existing ?? `A pull request for ${branch} is already open.`);
        return success({ ...base, changed: true, branch, prUrl: existing, compareUrl: existing ? null : compareUrl });
      }
      io.print(compareUrl!);
      return failure(`The endorsement branch ${branch} was pushed but gh could not open the pull request: ${commandMessage(created.stderr, created.stdout)}. Open it at ${compareUrl}.`, { ...base, changed: true, branch, prUrl: null, compareUrl });
    }
    io.print(`Pushed ${branch}. Open a pull request from ${branch} into main to complete the endorsement:`);
    io.print(compareUrl ?? `${stripRemoteCredentials(binding.remote)} — branch ${branch}`);
    return success({ ...base, changed: true, branch, prUrl: null, compareUrl });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

function alreadyEndorsed(base: Omit<PublishResult, 'changed' | 'branch' | 'prUrl' | 'compareUrl'>, scopeLabel: string, io: Prompter): Result<PublishResult> {
  io.print(`${base.name} is already endorsed (${scopeLabel}) in ${base.team}.`);
  return success({ ...base, changed: false, branch: null, prUrl: null, compareUrl: null });
}

function label(scope: PublishScope): string { return scope.kind === 'global' ? 'global' : `project ${scope.project}`; }
function compare(remote: string, branch: string): string | null {
  const ownerRepo = githubOwnerRepo(remote);
  return ownerRepo ? `https://github.com/${ownerRepo}/compare/main...${branch}?expand=1` : null;
}
function commandMessage(stderr: string, stdout: string): string { return (stderr || stdout).trim(); }

/**
 * The exact team.json this publish writes over `fresh` — the one serialization both the safeWrite
 * mutation and the branch-reuse vet use, so "already carries exactly this endorsement" is a byte
 * compare. Undefined when the ID is already listed (the mutation then writes nothing).
 */
function endorse(fresh: Team, id: string, scope: PublishScope): string | undefined {
  let target: string[];
  if (scope.kind === 'global') target = fresh.global;
  else {
    const project = Object.hasOwn(fresh.projects, scope.project) ? fresh.projects[scope.project] : undefined;
    if (!project) throw new Error(`Unknown project ${scope.project}.`);
    target = project.skills;
  }
  if (target.includes(id)) return undefined;
  target.push(id);
  return `${JSON.stringify(fresh, null, 2)}\n`;
}

/**
 * A pre-existing `publish/<name>` — or the `<name>-2` fallback safeWrite may retarget a stale-lease
 * push to — is reused (the lease then refreshes it) only when it is EXACTLY an abandoned attempt of
 * this same publish (D2, 2026-09-05 close-out walk): its tip forks from main, the fork touches only
 * team.json (plus the derived README.md on a generic remote), and that team.json is byte-for-byte
 * what this publish writes over the fork point's copy. Anything else — a review fixup on the
 * branch, a second endorsement squashed into the file, a project scope, someone else's branch,
 * unreadable content — is refused before anything is committed, because force-replacing it would
 * silently rewrite whoever's pull request is built on it. The lease cannot do this job: safeWrite
 * re-reads it after its own fetch, so it guards a move DURING the write, never a branch that
 * existed before it (§6.0). Existence is checked live on the remote; content from the fetched objects.
 */
async function assertBranchReusable(runner: Runner, clone: string, branch: string, id: string, scope: PublishScope, remote: string): Promise<void> {
  const heads = await runner.run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { cwd: clone });
  if (heads.code !== 0) throw new Error(`Could not check the remote for ${branch}: ${commandMessage(heads.stderr, heads.stdout)}`);
  const sha = heads.stdout.trim().split(/\s+/)[0];
  if (!sha) return;
  if (await isExactlyThisEndorsement(runner, clone, sha, id, scope, remote)) return;
  const where = compare(remote, branch) ?? `${stripRemoteCredentials(remote)} — branch ${branch}`;
  throw new Error(`${branch} already exists on the remote with a different endorsement (${where}). Merge or close its pull request, or delete the branch with \`git push origin --delete ${branch}\`, then retry.`);
}

async function isExactlyThisEndorsement(runner: Runner, clone: string, sha: string, id: string, scope: PublishScope, remote: string): Promise<boolean> {
  const git = (args: string[]) => runner.run('git', args, { cwd: clone });
  const fork = await git(['merge-base', sha, 'origin/main']);
  const forkPoint = fork.stdout.trim();
  if (fork.code !== 0 || !forkPoint) return false;
  const touched = await git(['diff', '--name-only', forkPoint, sha]);
  if (touched.code !== 0) return false;
  const paths = touched.stdout.split('\n').filter(Boolean);
  const allowed = new Set(isGitHubRemote(remote) ? ['team.json'] : ['team.json', 'README.md']);
  if (!paths.includes('team.json') || paths.some((path) => !allowed.has(path))) return false;
  const [theirs, base] = await Promise.all([git(['show', `${sha}:team.json`]), git(['show', `${forkPoint}:team.json`])]);
  if (theirs.code !== 0 || base.code !== 0) return false;
  try { return theirs.stdout === endorse(parseJson(teamSchema, base.stdout, `${forkPoint}:team.json`), id, scope); }
  catch { return false; }
}
function printCard(record: Awaited<ReturnType<typeof findSkill>> & {}, scopeLabel: string, io: Prompter): void {
  if (!record) return;
  io.print(`name: ${record.name}`);
  io.print(`id: ${record.id.slice(0, 8)}`);
  io.print(`terum-category: ${record.frontmatter.metadata['terum-category']}`);
  io.print(`description: ${record.frontmatter.description}`);
  io.print(`metadata.author: ${record.frontmatter.metadata.author}`);
  io.print(`allowed-tools: ${record.grants.ok ? record.grants.normalized : 'MALFORMED'}`);
  io.print(`target: ${scopeLabel}`);
}
