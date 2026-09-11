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
import { openTeamRepo, refreshClone, SafeWriteOptions, shellQuote, treeText, lockWait } from '../lib/teamRepo.js';
import { parseRef, teamForReference } from './install.js';
import { sourceFiles } from '../lib/skill-source.js';
import { assessHygiene, formatHygieneWarnings, HygieneRefused, reportHygieneWarnings } from '../lib/evals/hygiene.js';
import type { HygieneAssessment } from '../lib/evals/hygiene.js';

const AUTO_MERGE_DEADLINE_MS = 180_000;
const CHECK_APPEAR_GRACE_MS = 20_000;
const AUTO_MERGE_POLL_MS = 1_000;

export interface PublishArgs extends WithForm {
  /** Kept for public library callers from before publish accepted a variadic CLI ref. */
  ref: string;
  /** The variadic CLI form. Supplying this requests the batched result, even when it has one ref. */
  refs?: readonly string[];
  project?: string;
  team?: string;
  home?: string;
  cwd?: string;
  config?: ConfigStore;
  runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
  /** Internal deterministic clock seam; there is deliberately no CLI flag for the bounded wait. */
  autoMerge?: { now?: () => number; sleep?: (ms: number) => Promise<void> };
}
export type PublishScope = { kind: 'global' } | { kind: 'project'; project: string };
export type PublishOutcome = 'added' | 'already-endorsed' | 'not-found' | 'hygiene-failed' | 'open-endorsement' | 'needs-github' | 'conflicted' | 'blocked' | 'check-failed';
export interface PublishSkillResult { name: string; outcome: PublishOutcome; detail?: string; }
export interface PublishResult {
  team: string; id: string; name: string; scope: PublishScope;
  policy: 'pr' | 'push'; changed: boolean; branch: string | null;
  prUrl: string | null; compareUrl: string | null;
  /** Present for the variadic entrypoint; the original fields above remain for one-ref consumers. */
  outcomes?: PublishSkillResult[];
}

type Resolved = NonNullable<Awaited<ReturnType<typeof findSkill>>>;
interface Candidate { raw: string; name: string; record: Resolved; }
interface Base { team: string; scope: PublishScope; policy: 'pr' | 'push'; }

/** One active endorsement path. A variadic caller gets one refresh, mutation, branch, PR and merge gate. */
export async function run(args: PublishArgs, io: Prompter): Promise<Result<PublishResult>> {
  try {
    const refs = args.refs === undefined ? (args.ref === undefined ? [] : [args.ref]) : [...args.refs];
    if (!refs.length) throw new Error('publish needs at least one skill ref.');
    const batched = args.refs !== undefined;
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const parsed = refs.map(raw => ({ raw, reference: parseRef(raw) }));
    const invalid = parsed.filter(({ reference }) => reference.version !== undefined);
    const usable = parsed.filter(({ reference }) => reference.version === undefined);
    if (!usable.length) throw new Error('publish endorses a skill by ID, not a version; drop @<version>.');
    const initial = usable[0]!.reference;
    const team = await teamForReference(config, initial.team ?? args.team, initial.remote, initial.name, args.form);
    for (const { reference } of usable) {
      const selected = reference.team ?? args.team;
      if (selected !== undefined && selected !== team) throw new Error('A publish batch can endorse skills from only one team.');
    }
    const binding = config.teams[team]!;
    if (!binding.handle) throw new Error(`Team ${team} has no joined handle.`);
    const clone = store.teamClone(team);
    await refreshClone(runner, clone, { label: team, ...lockWait(io) });
    const teamJson = await readTeam(clone);
    const outcomes: PublishSkillResult[] = invalid.map(({ raw }) => ({ name: raw, outcome: 'not-found', detail: 'publish endorses a skill by ID, not a version; drop @<version>.' }));
    const candidates: Candidate[] = [];
    for (const { raw, reference } of usable) {
      const record = await findSkill(clone, team, reference.name);
      if (!record) {
        const hint = await notInTeam({ ...args, ref: raw }, config, team, reference.name, store.root);
        // The legacy single-ref form fails fast with the recovery hint, and does so before the
        // project name is validated: "no such skill, here is how to connect it" is the line the
        // caller can act on, and an unknown --project would otherwise mask it. The batch form has
        // no single skill to fail for, so it collects the hint and reports it per skill.
        if (!batched) throw new Error(hint);
        outcomes.push({ name: reference.name, outcome: 'not-found', detail: hint });
        continue;
      }
      candidates.push({ raw, name: record.name, record });
    }
    const scope: PublishScope = args.project === undefined
      ? { kind: 'global' }
      : Object.hasOwn(teamJson.projects, args.project) ? { kind: 'project', project: args.project } : (() => { throw new Error(`Unknown project ${args.project}.`); })();
    const base: Base = { team, scope, policy: teamJson.policy.publish };
    const target = scope.kind === 'global' ? teamJson.global : teamJson.projects[scope.project]!.skills;
    const preflightWarnings = new Set<string>();
    const unique = new Set<string>();
    const pending: Candidate[] = [];
    for (const candidate of candidates) {
      if (target.includes(candidate.record.id) || unique.has(candidate.record.id)) {
        outcomes.push({ name: candidate.name, outcome: 'already-endorsed' });
        io.print(`${candidate.name} is already endorsed (${label(scope)}) in ${team}.`);
        continue;
      }
      unique.add(candidate.record.id);
      const preflight = assessHygiene(candidate.name, await sourceFiles(candidate.record.directory), teamJson.policy.skill_license, true);
      reportHygieneWarnings(line => io.print(line), preflight);
      // Remember exactly what was printed here, from THIS assessment. The post-write pass below
      // reports only lines absent from this set, so a warning the source already had is stated
      // once and a warning the written tree introduced is still surfaced.
      for (const warning of preflight.warnings) preflightWarnings.add(formatHygieneWarnings([warning]));
      pending.push(candidate);
    }
    if (!pending.length) {
      const result = batchResult(base, candidates[0]?.record, false, null, null, null, outcomes, batched);
      // A single-ref publish keeps its own recovery hint: `notInTeam` already names the exact
      // connect/ls commands for that skill, and collapsing it to a batch-shaped sentence would
      // strip the one actionable line the caller needs (spec §2: the single-ref shape keeps working).
      const only = outcomes.length === 1 ? outcomes[0]?.detail : undefined;
      return candidates.length ? success(result) : failure(only ?? 'No selected skills could be resolved.', result);
    }

    const destination = teamJson.policy.publish === 'pr'
      ? batched ? `publish/batch-${binding.handle}-${randomUUID().slice(0, 8)}` : `publish/${pending[0]!.name}-${binding.handle}-${randomUUID().slice(0, 8)}`
      : null;
    if (destination !== null) {
      const open = await openEndorsements(runner, clone, pending.map(item => item.name), binding.remote, batched);
      for (const entry of open) {
        const linked = entry.url ?? entry.branch;
        io.print(batched ? `An endorsement is already open: ${linked}${entry.by ? ` (by ${entry.by})` : ''}.` : `An endorsement of ${pending[0]!.name} is already open: ${linked}${entry.by ? ` (by ${entry.by})` : ''}.`);
        for (const candidate of pending) outcomes.push({ name: candidate.name, outcome: 'open-endorsement', detail: linked });
      }
      if (!batched && open.length && !(await io.confirm(`Open another pull request for ${pending[0]!.name}? If both merge, GitHub will flag the second as conflicting.`))) {
        io.print(`Nothing pushed; ${pending[0]!.name} keeps its open endorsement.`);
        return success(batchResult(base, pending[0]!.record, false, null, open[0]!.url, null, outcomes, false));
      }
    }
    if (teamJson.policy.publish === 'push') {
      for (const candidate of pending) printCard(candidate.record, label(scope), io);
      const question = pending.length === 1 && !batched
        ? `Publish ${pending[0]!.name} to ${team} (${label(scope)})?`
        : `Publish ${pending.length} skills to ${team} (${label(scope)})?`;
      if (!(await io.confirm(question))) throw new CancelledError('Publish was cancelled.');
    }

    const repo = openTeamRepo(clone, binding.remote, runner);
    const written = await repo.safeWrite((tree): HygieneAssessment[] => {
      // Collected inside the mutation because safeWrite may replay it after a losing race; only the
      // winning attempt's assessments reach the caller, so a retried write cannot double-report.
      const assessed: HygieneAssessment[] = [];
      const teamSource = tree.before('team.json');
      if (teamSource === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');
      const fresh = parseJson(teamSchema, treeText(teamSource), 'team.json');
      if (fresh.policy.publish !== teamJson.policy.publish) throw new Error(`The team publish policy changed to "${fresh.policy.publish}" while this publish ran; rerun publish.`);
      for (const candidate of pending) {
        const source = tree.before(`skills/${candidate.name}/SKILL.md`);
        const checked = source === undefined ? undefined : parseSkillFrontmatter(treeText(source));
        if (!checked?.ok || checked.data.metadata.id !== candidate.record.id) throw new Error(`${candidate.name} is no longer in the repository as ${candidate.record.id.slice(0, 8)}; run sync and retry.`);
        const prefix = `skills/${candidate.name}/`;
        const files = new Map<string, Buffer>();
        for (const path of tree.paths(prefix)) {
          const contents = tree.after(path);
          if (contents !== undefined) files.set(path.slice(prefix.length), Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
        }
        const executable = new Set([...tree.executablePaths(prefix)].map(path => path.slice(prefix.length)));
        assessed.push(assessHygiene(candidate.name, { files, executable }, fresh.policy.skill_license, true));
      }
      const next = endorseAll(fresh, pending.map(candidate => candidate.record.id), scope);
      if (next !== undefined) tree.set('team.json', next);
      return assessed;
    }, { action: 'publish', handle: binding.handle, message: `${binding.handle}: publish ${pending.map(item => item.name).join(', ')}`, ...(destination === null ? {} : { branch: destination }), ...args.safeWrite, ...lockWait(io) });
    if (!written.changed) {
      // Another publisher endorsed these between our read and our write. Say so per skill: the
      // single-ref path printed this line before batching, and a silent success reads as if
      // nothing happened when in fact the skill is already where the caller wanted it.
      for (const candidate of pending) {
        outcomes.push({ name: candidate.name, outcome: 'already-endorsed' });
        io.print(`${candidate.name} is already endorsed (${label(scope)}) in ${team}.`);
      }
      return success(batchResult(base, pending[0]!.record, false, null, null, null, outcomes, batched));
    }
    for (const assessment of written.returned ?? []) reportHygieneWarnings(line => { if (!preflightWarnings.has(line)) io.print(line); }, assessment);
    if (teamJson.policy.publish === 'push') {
      await registerCheckoutIfNeeded(args, store, io);
      for (const candidate of pending) outcomes.push({ name: candidate.name, outcome: 'added' });
      io.print(`Published ${pending.length === 1 ? pending[0]!.name : `${pending.length} skills`} to ${team} (${label(scope)}).`);
      return success(batchResult(base, pending[0]!.record, true, null, null, null, outcomes, batched));
    }
    const branch = written.pushedTo;
    const compareUrl = compare(binding.remote, branch);
    if (!isGitHubRemote(binding.remote) || !(await ghState(runner)).authenticated) {
      await registerCheckoutIfNeeded(args, store, io);
      for (const candidate of pending) outcomes.push({ name: candidate.name, outcome: 'needs-github', detail: compareUrl ?? branch });
      io.print(`Pushed ${branch}. Finish the endorsement on GitHub.`);
      io.print(compareUrl ?? `${stripRemoteCredentials(binding.remote)} — branch ${branch}`);
      return success(batchResult(base, pending[0]!.record, true, branch, null, compareUrl, outcomes, batched));
    }
    const ownerRepo = githubOwnerRepo(binding.remote)!;
    const created = await runner.run('gh', ['pr', 'create', '-R', ownerRepo, '--base', 'main', '--head', branch, '--title', `${binding.handle}: publish ${pending.length === 1 ? pending[0]!.name : `${pending.length} skills`}`, '--body', `Endorse ${pending.map(item => `${item.name} (${item.record.id.slice(0, 8)})`).join(', ')} for ${team}: ${label(scope)}.\n\nOpened by terum-skills publish; merge to endorse.`]);
    if (created.code !== 0) {
      const message = `The endorsement branch ${branch} was pushed but gh could not open the pull request: ${commandMessage(created.stderr, created.stdout)}. Open it at ${compareUrl}.`;
      return failure(message, batchResult(base, pending[0]!.record, true, branch, null, compareUrl, outcomes, batched));
    }
    await registerCheckoutIfNeeded(args, store, io);
    const prUrl = created.stdout.trim();
    io.print(prUrl);
    if (!batched) return success(batchResult(base, pending[0]!.record, true, branch, prUrl, null, outcomes, false));
    const merge = await autoMerge(runner, ownerRepo, prUrl, args.autoMerge);
    if (merge.kind === 'merged') {
      for (const candidate of pending) outcomes.push({ name: candidate.name, outcome: 'added' });
      return success(batchResult(base, pending[0]!.record, true, branch, prUrl, null, outcomes, batched));
    }
    const failed = merge.kind === 'check-failed' ? `${pending[0]!.name} did not pass ${merge.check}.` : merge.kind === 'conflicted'
      ? `Someone changed ${scope.kind === 'project' ? scope.project : 'the team'} first, so these could not be added automatically. Resolve it on GitHub.`
      : "Your organization requires checks this app can't complete. Finish the endorsement on GitHub.";
    for (const candidate of pending) outcomes.push({ name: candidate.name, outcome: merge.kind, detail: merge.kind === 'check-failed' ? merge.check : prUrl });
    return failure(failed, batchResult(base, pending[0]!.record, true, branch, prUrl, null, outcomes, batched));
  } catch (error) {
    if (error instanceof HygieneRefused) reportHygieneWarnings(line => io.print(line), error.assessment);
    return fromError(error);
  }
}

async function registerCheckoutIfNeeded(args: PublishArgs, store: ConfigStore, io: Prompter): Promise<void> {
  const root = await writableCheckout(args.cwd, args.home ?? homedir(), store.root);
  if (root) await registerCheckout(store, root, io, { home: args.home ?? homedir() });
}
function batchResult(base: Base, first: Resolved | undefined, changed: boolean, branch: string | null, prUrl: string | null, compareUrl: string | null, outcomes: PublishSkillResult[], batched: boolean): PublishResult {
  return { team: base.team, id: first?.id ?? '', name: first?.name ?? outcomes[0]?.name ?? '', scope: base.scope, policy: base.policy, changed, branch, prUrl, compareUrl, ...(batched ? { outcomes } : {}) };
}
function label(scope: PublishScope): string { return scope.kind === 'global' ? 'global' : `project ${scope.project}`; }
function compare(remote: string, branch: string): string | null { const ownerRepo = githubOwnerRepo(remote); return ownerRepo ? `https://github.com/${ownerRepo}/compare/main...${branch}?expand=1` : null; }
function commandMessage(stderr: string, stdout: string): string { return (stderr || stdout).trim(); }
function endorseAll(fresh: Team, ids: readonly string[], scope: PublishScope): string | undefined {
  const target = scope.kind === 'global' ? fresh.global : fresh.projects[scope.project]?.skills;
  if (!target) throw new Error(`Unknown project ${scope.kind === 'project' ? scope.project : ''}.`);
  const additions = ids.filter(id => !target.includes(id));
  if (!additions.length) return undefined;
  target.push(...additions);
  return `${JSON.stringify(fresh, null, 2)}\n`;
}

interface OpenEndorsement { branch: string; by: string | null; url: string | null; }
async function openEndorsements(runner: Runner, clone: string, names: readonly string[], remote: string, batched: boolean): Promise<OpenEndorsement[]> {
  const heads = await runner.run('git', batched ? ['ls-remote', '--heads', 'origin', 'refs/heads/publish/*'] : ['ls-remote', '--heads', 'origin', `refs/heads/publish/${names[0]}`, `refs/heads/publish/${names[0]}-*`], { cwd: clone });
  if (heads.code !== 0) throw new Error(`Could not check the remote for open endorsements: ${commandMessage(heads.stderr, heads.stdout)}`);
  const branches = heads.stdout.split('\n').map(line => line.trim().split(/\s+/)[1]).filter((ref): ref is string => Boolean(ref)).map(ref => ref.replace(/^refs\/heads\//, '')).filter(branch => branch === 'publish/batch' || branch.startsWith('publish/batch-') || names.some(name => branch === `publish/${name}` || branch.startsWith(`publish/${name}-`)));
  const ownerRepo = isGitHubRemote(remote) && (await ghState(runner)).authenticated ? githubOwnerRepo(remote) : null;
  if (!ownerRepo || !branches.length) return branches.map(branch => ({ branch, by: branch.startsWith('publish/batch-') ? null : branch.slice('publish/'.length).replace(/-[0-9a-f]{8}$/, '').split('-').slice(1).join('-') || null, url: null }));
  if (!batched) {
    const open: OpenEndorsement[] = [];
    for (const branch of branches) {
      const listed = await runner.run('gh', ['pr', 'list', '-R', ownerRepo, '--head', branch, '--state', 'open', '--json', 'url', '-q', '.[0].url']);
      const url = listed.code === 0 ? listed.stdout.trim() || null : null;
      if (listed.code === 0 && !url) continue;
      open.push({ branch, by: branch.slice(`publish/${names[0]}-`.length).replace(/-[0-9a-f]{8}$/, '') || null, url });
    }
    return open;
  }
  const listed = await runner.run('gh', ['pr', 'list', '-R', ownerRepo, '--state', 'open', '--json', 'headRefName,url', '--limit', '100']);
  const urls = listed.code === 0 ? new Map((parseArray(listed.stdout)).map(value => [string(parseObject(value).headRefName), string(parseObject(value).url)]).filter((entry): entry is [string, string] => entry[0] !== null && entry[1] !== null)) : new Map<string, string>();
  return branches.filter(branch => !urls.size || urls.has(branch)).map(branch => ({ branch, by: branch.startsWith('publish/batch-') ? null : branch.slice('publish/'.length).replace(/-[0-9a-f]{8}$/, '').split('-').slice(1).join('-') || null, url: urls.get(branch) ?? null }));
}

type MergeResult = { kind: 'merged' } | { kind: 'conflicted' } | { kind: 'blocked' } | { kind: 'check-failed'; check: string };
async function autoMerge(runner: Runner, ownerRepo: string, pr: string, control: PublishArgs['autoMerge']): Promise<MergeResult> {
  const now = control?.now ?? Date.now;
  const sleep = control?.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const started = now();
  for (;;) {
    const view = await runner.run('gh', ['pr', 'view', pr, '-R', ownerRepo, '--json', 'mergeable,statusCheckRollup']);
    if (view.code !== 0) return { kind: 'blocked' };
    const data = parseObject(view.stdout);
    const mergeable = string(data.mergeable);
    const checks = ownChecks(data.statusCheckRollup);
    const failed = checks.find(check => check.conclusion === 'FAILURE');
    if (failed) return { kind: 'check-failed', check: failed.name };
    if (mergeable === 'CONFLICTING') return { kind: 'conflicted' };
    const complete = checks.length > 0 && checks.every(check => check.conclusion === 'SUCCESS');
    const absentLongEnough = checks.length === 0 && now() - started >= CHECK_APPEAR_GRACE_MS;
    if ((complete || absentLongEnough) && mergeable === 'MERGEABLE') {
      const merged = await runner.run('gh', ['pr', 'merge', pr, '-R', ownerRepo, '--squash']);
      return merged.code === 0 ? { kind: 'merged' } : { kind: 'blocked' };
    }
    if (now() - started >= AUTO_MERGE_DEADLINE_MS) return { kind: 'blocked' };
    await sleep(AUTO_MERGE_POLL_MS);
  }
}
interface Check { name: string; conclusion: string | null; }
function ownChecks(raw: unknown): Check[] { return parseArray(raw).flatMap(value => { const check = parseObject(value); const name = string(check.name); const workflow = string(check.workflowName); return workflow === 'terum-skills' && (name === 'hygiene' || name === 'receipt-check') ? [{ name, conclusion: string(check.conclusion) }] : []; }); }
function parseObject(value: unknown): Record<string, unknown> { try { return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; } }
function parseArray(value: unknown): unknown[] { try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null; }

function printCard(record: Resolved, scopeLabel: string, io: Prompter): void {
  io.print(`name: ${record.name}`); io.print(`id: ${record.id.slice(0, 8)}`); io.print(`terum-category: ${record.frontmatter.metadata['terum-category']}`); io.print(`description: ${record.frontmatter.description}`); io.print(`metadata.author: ${record.frontmatter.metadata.author}`); io.print(`allowed-tools: ${record.grants.ok ? record.grants.normalized : 'MALFORMED'}`); io.print(`target: ${scopeLabel}`);
}

/** The miss supplies read-only local discovery guidance, never an import or tracking write. */
async function notInTeam(args: PublishArgs, config: Config, team: string, name: string, stateRoot: string): Promise<string> {
  const discovery = await localSkillRoots(args.home ?? homedir(), args.cwd, config.checkouts ?? []);
  const ledger = await canonicalLedger(config);
  const inventories = await Promise.all(discovery.roots.map(root => localSkills(root.root, config, { scope: root.scope, stateRoot, ledger })));
  const found = inventories.flatMap((inventory, index) => candidatesOf(inventory).filter(entry => entry.name === name).map(entry => ({ ...entry, scope: inventory.scope, label: localRootLabel(discovery.roots[index]!), repoRoot: discovery.roots[index]!.repoRoot })));
  const unreadable = discovery.problems.length + inventories.reduce((count, inventory) => count + inventory.problems.length + inventory.entries.filter(entry => entry.inspection.kind === 'failed').length, 0);
  const ref = args.ref ?? name;
  const retry = invocation(args.form, 'publish', ref) + (args.project === undefined ? '' : ` --project ${shellQuote(args.project)}`);
  const note = unreadable ? ` (${unreadable} local folder(s) under ${discovery.roots.map(root => root.root).join(' or ')} could not be read.)` : '';
  if (found.length) return found.map(({ path, scope }) => `No skill ${ref} in team ${team}. Found a local folder at ${path}${found.length > 1 ? ` (${scope})` : ''} that is not tracked as a connected source or placement on this machine. To connect it to ${team}, run \`${invocation(args.form, 'connect', path)}\`, then retry \`${retry}\`.`).join('\n') + note;
  return `No skill ${ref} in team ${team}. Run \`${invocation(args.form, 'ls')}\` to check the team's skill names. To add a local skill, run \`${invocation(args.form, 'connect', { raw: '<path-to-skill>' })}\`, then publish its name.${note}`;
}
