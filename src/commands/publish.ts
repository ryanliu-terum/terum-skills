import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { canonicalLedger, localRootLabel, candidatesOf, localSkillRoots, localSkills } from '../lib/local-skills.js';
import { registerCheckout, writableCheckout } from '../lib/checkouts.js';
import type { Config } from '../lib/schema.js';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { ghState } from '../lib/auth.js';
import { Prompter } from '../lib/prompt.js';
import { githubOwnerRepo, isGitHubRemote, stripRemoteCredentials } from '../lib/remote.js';
import { fromError, CancelledError, failure, Result, success } from '../lib/result.js';
import { parseJson, parseSkillFrontmatter, Team, teamSchema } from '../lib/schema.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { findSkill, readTeam } from '../lib/skills.js';
import { openTeamRepo, refreshClone, SafeWriteOptions, shellQuote, treeText } from '../lib/teamRepo.js';
import { parseRef, teamForReference } from './install.js';
import { sourceFiles } from '../lib/skill-source.js';
import { assessHygiene, formatHygieneWarnings, HygieneRefused, reportHygieneWarnings } from '../lib/evals/hygiene.js';

export interface PublishArgs extends WithForm {
  ref: string;
  project?: string;
  team?: string;
  /** The home the local skills root is derived from (tests); defaults to homedir(). */
  home?: string;
  cwd?: string;
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
    const register = async (): Promise<void> => {
      const root = await writableCheckout(args.cwd, args.home ?? homedir(), store.root);
      if (root) await registerCheckout(store, root, io, { home: args.home ?? homedir() });
    };
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const reference = parseRef(args.ref);
    if (reference.version !== undefined) throw new Error('publish endorses a skill by ID, not a version; drop @<version>.');
    const team = await teamForReference(config, reference.team ?? args.team, reference.remote, reference.name, args.form);
    const binding = config.teams[team]!;
    if (!binding.handle) throw new Error(`Team ${team} has no joined handle.`);
    const clone = store.teamClone(team);
    await refreshClone(runner, clone, { label: team });

    const teamJson = await readTeam(clone);
    const record = await findSkill(clone, team, reference.name);
    if (!record) throw new Error(await notInTeam(args, config, team, reference.name, store.root));
    const scope: PublishScope = args.project === undefined
      ? { kind: 'global' }
      : Object.hasOwn(teamJson.projects, args.project) ? { kind: 'project', project: args.project } : (() => { throw new Error(`Unknown project ${args.project}.`); })();
    const scopeLabel = label(scope);
    const list = scope.kind === 'global' ? teamJson.global : teamJson.projects[scope.project]!.skills;
    const base: Omit<PublishResult, 'changed' | 'branch' | 'prUrl' | 'compareUrl'> = { team, id: record.id, name: record.name, scope, policy: teamJson.policy.publish };
    if (list.includes(record.id)) return alreadyEndorsed(base, scopeLabel, io);
    // Avoid displaying the direct-push endorsement card for content hygiene refuses. The same
    // inspector is replayed below against safeWrite's freshly reset tree to close the race.
    const preflight = assessHygiene(record.name, await sourceFiles(record.directory), teamJson.policy.skill_license, true);
    reportHygieneWarnings((line) => io.print(line), preflight);
    const preflightWarnings = new Set(preflight.warnings.map((warning) => formatHygieneWarnings([warning])));
    // One fresh branch and one fresh PR per publish (rulings walk R2, 2026-09-06): the name is unique,
    // the push is create-only (teamRepo.ts push()), and an endorsement already open for this skill is a
    // note and a y/N — never a refusal, never a force-push. Two competing PRs are two PRs; GitHub flags
    // the second as conflicting once the first merges.
    const destination = teamJson.policy.publish === 'pr' ? `publish/${record.name}-${binding.handle}-${randomUUID().slice(0, 8)}` : null;
    if (destination !== null) {
      const open = await openEndorsements(runner, clone, record.name, binding.remote);
      if (open.length) {
        for (const entry of open) io.print(`An endorsement of ${record.name} is already open: ${entry.url ?? entry.branch}${entry.by ? ` (by ${entry.by})` : ''}.`);
        if (!(await io.confirm(`Open another pull request for ${record.name}? If both merge, GitHub will flag the second as conflicting.`))) {
          io.print(`Nothing pushed; ${record.name} keeps its open endorsement.`);
          return success({ ...base, changed: false, branch: null, prUrl: open[0]!.url, compareUrl: null });
        }
      }
    }

    if (teamJson.policy.publish === 'push') {
      printCard(record, scopeLabel, io);
      if (!(await io.confirm(`Publish ${record.name} to ${team} (${scopeLabel})?`))) throw new CancelledError('Publish was cancelled.');
    }

    const repo = openTeamRepo(clone, binding.remote, runner);
    const written = await repo.safeWrite((tree) => {
      const teamSource = tree.before('team.json');
      if (teamSource === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');
      const skillSource = tree.before(`skills/${record.name}/SKILL.md`);
      const parsed = skillSource === undefined ? undefined : parseSkillFrontmatter(treeText(skillSource));
      if (!parsed?.ok || parsed.data.metadata.id !== record.id) throw new Error(`${record.name} is no longer in the repository as ${record.id.slice(0, 8)}; run sync and retry.`);
      const fresh = parseJson(teamSchema, treeText(teamSource), 'team.json');
      const prefix = `skills/${record.name}/`;
      const files = new Map<string, Buffer>();
      for (const path of tree.paths(prefix)) {
        const contents = tree.after(path);
        if (contents !== undefined) files.set(path.slice(prefix.length), Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
      }
      const executable = new Set([...tree.executablePaths(prefix)].map((path) => path.slice(prefix.length)));
      const assessment = assessHygiene(record.name, { files, executable }, fresh.policy.skill_license, true);
      // The branch (or the direct push to main) was chosen from the policy read before the loop; the
      // tree being written may be newer, and a policy the team changed meanwhile must win.
      if (fresh.policy.publish !== teamJson.policy.publish) throw new Error(`The team publish policy changed to "${fresh.policy.publish}" while this publish ran; rerun publish.`);
      const next = endorse(fresh, record.id, scope);
      if (next === undefined) return assessment;
      tree.set('team.json', next);
      return assessment;
    }, {
      action: 'publish',
      handle: binding.handle,
      message: `${binding.handle}: publish ${record.name}`,
      ...(destination !== null ? { branch: destination } : {}),
      ...args.safeWrite,
    });
    if (!written.changed) return alreadyEndorsed(base, scopeLabel, io);
    reportHygieneWarnings((line) => { if (!preflightWarnings.has(line)) io.print(line); }, written.returned);
    if (teamJson.policy.publish === 'push') {
      await register();
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
        await register();
        const prUrl = created.stdout.trim();
        io.print(prUrl);
        return success({ ...base, changed: true, branch, prUrl, compareUrl: null });
      }
      io.print(compareUrl!);
      return failure(`The endorsement branch ${branch} was pushed but gh could not open the pull request: ${commandMessage(created.stderr, created.stdout)}. Open it at ${compareUrl}.`, { ...base, changed: true, branch, prUrl: null, compareUrl });
    }
    await register();
    io.print(`Pushed ${branch}. Open a pull request from ${branch} into main to complete the endorsement:`);
    io.print(compareUrl ?? `${stripRemoteCredentials(binding.remote)} — branch ${branch}`);
    return success({ ...base, changed: true, branch, prUrl: null, compareUrl });
  } catch (error) {
    if (error instanceof HygieneRefused) reportHygieneWarnings((line) => io.print(line), error.assessment);
    return fromError(error);
  }
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

interface OpenEndorsement { branch: string; by: string | null; url: string | null; }

/**
 * Endorsement branches already on the remote for this skill: the fresh form `publish/<name>-<handle>-<id8>`
 * plus the pre-R2 forms `publish/<name>` and `publish/<name>-2` a team may still carry — one `ls-remote`
 * round trip, before anything is committed. With gh on a GitHub remote, each branch's open PR URL is
 * looked up and a branch whose PR is no longer open is dropped as a leftover; without gh every match is
 * listed. A sibling skill named `<name>-<x>` can match the glob: the list feeds a note and a y/N, never
 * a refusal, so a false match costs one line.
 */
async function openEndorsements(runner: Runner, clone: string, name: string, remote: string): Promise<OpenEndorsement[]> {
  const heads = await runner.run('git', ['ls-remote', '--heads', 'origin', `refs/heads/publish/${name}`, `refs/heads/publish/${name}-*`], { cwd: clone });
  if (heads.code !== 0) throw new Error(`Could not check the remote for open endorsements of ${name}: ${commandMessage(heads.stderr, heads.stdout)}`);
  const branches = heads.stdout.split('\n').map((line) => line.trim().split(/\s+/)[1]).filter((ref): ref is string => Boolean(ref)).map((ref) => ref.replace(/^refs\/heads\//, ''));
  const ownerRepo = isGitHubRemote(remote) && (await ghState(runner)).authenticated ? githubOwnerRepo(remote) : null;
  const open: OpenEndorsement[] = [];
  for (const branch of branches) {
    const fresh = branch.startsWith(`publish/${name}-`) && /-[0-9a-f]{8}$/.test(branch);
    const by = fresh ? branch.slice(`publish/${name}-`.length, -9) : null;
    let url: string | null = null;
    if (ownerRepo) {
      const listed = await runner.run('gh', ['pr', 'list', '-R', ownerRepo, '--head', branch, '--state', 'open', '--json', 'url', '-q', '.[0].url']);
      if (listed.code === 0) { url = listed.stdout.trim() || null; if (!url) continue; }
    }
    open.push({ branch, by: by || null, url });
  }
  return open;
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

/** The miss supplies read-only local discovery guidance, never an import or tracking write. */
async function notInTeam(args: PublishArgs, config: Config, team: string, name: string, stateRoot: string): Promise<string> {
  const discovery = await localSkillRoots(args.home ?? homedir(), args.cwd, config.checkouts ?? []);
  const ledger = await canonicalLedger(config);
  const inventories = await Promise.all(discovery.roots.map((root) => localSkills(root.root, config, { scope: root.scope, stateRoot, ledger })));
  const found = inventories.flatMap((inventory, index) => candidatesOf(inventory).filter((entry) => entry.name === name).map((entry) => ({ ...entry, scope: inventory.scope, label: localRootLabel(discovery.roots[index]!), repoRoot: discovery.roots[index]!.repoRoot })));
  const unreadable = discovery.problems.length + inventories.reduce((count, inventory) => count + inventory.problems.length + inventory.entries.filter((entry) => entry.inspection.kind === 'failed').length, 0);
  const retry = invocation(args.form, 'publish', args.ref) + (args.project === undefined ? '' : ` --project ${shellQuote(args.project)}`);
  const note = unreadable ? ` (${unreadable} local folder(s) under ${discovery.roots.map((root) => root.root).join(' or ')} could not be read.)` : '';
  if (found.length) {
    return found.map(({ path, scope }) => `No skill ${args.ref} in team ${team}. Found a local folder at ${path}${found.length > 1 ? ` (${scope})` : ''} that is not tracked as a connected source or placement on this machine. To connect it to ${team}, run \`${invocation(args.form, 'connect', path)}\`, then retry \`${retry}\`.`).join('\n') + note;
  }
  return `No skill ${args.ref} in team ${team}. Run \`${invocation(args.form, 'ls')}\` to check the team's skill names. To add a local skill, run \`${invocation(args.form, 'connect', { raw: '<path-to-skill>' })}\`, then publish its name.${note}`;
}
