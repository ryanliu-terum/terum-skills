import { invocation, type InvocationForm } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { cp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { candidatesOf, localSkillRoots, localSkills } from '../lib/local-skills.js';
import { assertNotInsideStateRoot, assertSkillDirectory, printable, scanSkillFolder, sourceFiles } from '../lib/skill-source.js';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { exists } from '../lib/fs.js';
import { Prompter } from '../lib/prompt.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { isSkillName, teamSchema, parseJson, parseSkillFrontmatter } from '../lib/schema.js';
import { moveDirectory, moveToQuarantine } from '../lib/placer.js';
import { canonicalDigest, DEFAULT_CATEGORY, declaredCategory, injectManagedFields, skillRecords } from '../lib/skills.js';
import { MutableTree, openTeamRepo, shellQuote, treeText } from '../lib/teamRepo.js';
import { assessHygiene, type HygieneAssessment, HygieneRefused, reportHygieneWarnings } from '../lib/evals/hygiene.js';

export interface ConnectArgs extends WithForm {
  path?: string;
  home?: string;
  cwd?: string;
  team?: string;
  keepSource?: string;
  keepRepo?: string;
  relocate?: { id: string; path: string } | string;
  forget?: string;
  allowPrivileged?: boolean;
  config?: ConfigStore;
  runner?: Runner;
}
export interface ConnectResult { id: string; name: string; reconciled?: boolean; }

export interface ConnectBatch { kind: 'batch'; shared: ConnectResult[]; declined: string[]; refused: { name: string; reason: string }[]; }
export type ConnectOutcome = ConnectResult | ConnectBatch;

type ConnectPhase = 'validate' | 'preflight' | 'consent' | 'source-mutated' | 'pushed';
class ConnectStepError extends Error {
  constructor(readonly phase: ConnectPhase, cause: unknown, readonly recoverable: boolean, readonly id?: string) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ConnectStepError';
  }
}

interface ConnectContext {
  args: ConnectArgs;
  store: ConfigStore;
  runner: Runner;
  config: Awaited<ReturnType<ConfigStore['read']>>;
  team: string;
  binding: Awaited<ReturnType<ConfigStore['read']>>['teams'][string];
  io: Prompter;
}

export function run(args: ConnectArgs & { path: string }, io: Prompter): Promise<Result<ConnectResult | undefined>>;
export function run(args: ConnectArgs & ({ keepSource: string } | { keepRepo: string } | { relocate: NonNullable<ConnectArgs['relocate']> } | { forget: string }), io: Prompter): Promise<Result<ConnectResult | undefined>>;
export function run(args: ConnectArgs, io: Prompter): Promise<Result<ConnectOutcome | undefined>>;
export async function run(args: ConnectArgs, io: Prompter): Promise<Result<ConnectOutcome | undefined>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    if (args.forget) return success(await forget(store, args.forget, io));
    if (args.relocate) return success(await relocate(store, args.relocate));
    if (args.keepSource || args.keepRepo) return success(await resolveDivergence(store, runner, args.team, args.keepSource ?? args.keepRepo!, Boolean(args.keepSource), Boolean(args.allowPrivileged), io));
    const initial = await store.read();
    const [team, binding] = selectTeam(initial.teams, args.team, args.form);
    if (args.path) return success(await connectOne(resolve(args.path), { args, store, runner, config: initial, team, binding, io }));

    const batch: ConnectBatch = { kind: 'batch', shared: [], declined: [], refused: [] };
    const attempted = new Map<string, 'declined' | 'refused'>();
    const reasons = new Map<string, string>();
    let qualify: Set<string> | undefined;
    let menuStarted = false;
    let selectedPath: string | undefined;
    const summarize = (): void => {
      batch.declined = []; batch.refused = [];
      const notConnected: string[] = [];
      for (const [path, outcome] of attempted) {
        const name = basename(path);
        const reason = outcome === 'declined' ? 'declined' : reasons.get(path)!;
        if (outcome === 'declined') batch.declined.push(name);
        else batch.refused.push({ name, reason });
        notConnected.push(`${name} (${reason})`);
      }
      const count = batch.shared.length;
      io.print(count ? `Connected ${count} ${count === 1 ? 'skill' : 'skills'} to team ${printable(team)}: ${batch.shared.map((skill) => printable(skill.name)).join(', ')}.` : 'Nothing connected.');
      if (notConnected.length) io.print(`Not connected: ${notConnected.join(', ')}.`);
    };
    try {
      while (true) {
        selectedPath = undefined;
        const config = await store.read();
        const { roots } = await localSkillRoots(args.home ?? homedir(), args.cwd);
        const inventories = await Promise.all(roots.map((root) => localSkills(root.root, config, { scope: root.scope, stateRoot: store.root })));
        const candidates = inventories.flatMap((inventory) => candidatesOf(inventory, args.allowPrivileged).map((entry) => ({ ...entry, scope: inventory.scope })));
        if (!qualify) {
          const omitted = inventories.flatMap((inventory) => {
            const offered = candidatesOf(inventory, args.allowPrivileged);
            return inventory.entries.filter((entry) => !entry.shared.length && !entry.placement && !offered.includes(entry));
          });
          if (omitted.length) io.print(`Skipped ${omitted.length} local folders that cannot be connected. Run \`${invocation(args.form, 'ls --local')}\` for paths and reasons.`);
          if (!candidates.length) {
            io.print(`No local candidates to connect under ${roots.map((root) => printable(root.root)).join(' or ')}. Skills elsewhere can be connected by passing their folder path.`);
            return success(undefined);
          }
          if (!io.interactive) {
            for (const inventory of inventories) {
              io.print(`Local candidates under ${printable(inventory.root)}:`);
              for (const candidate of candidatesOf(inventory, args.allowPrivileged)) io.print(`  ${printable(candidate.path)}`);
            }
            throw new Error(`No skill selected. In an interactive terminal, run \`${printable(invocation(args.form, 'connect'))} --team ${printable(shellQuote(team))}\`, or pass an explicit skill folder path.`);
          }
          qualify = new Set(candidates.filter((candidate) => candidates.some((other) => other.name === candidate.name && other.scope !== candidate.scope)).map((candidate) => candidate.name));
        }
        if (!candidates.length) break;
        const choices = new Map(candidates.map((candidate) => [`Connect ${printable(candidate.name)}${qualify!.has(candidate.name) ? ` (${candidate.scope})` : ''}`, candidate.path]));
        const exit = batch.shared.length ? 'Done' : 'Skip';
        menuStarted = true;
        const choice = await io.select(`Connect a local skill folder to team ${printable(team)}?`, [...choices.keys(), exit]);
        if (choice === exit) break;
        selectedPath = choices.get(choice);
        if (selectedPath === undefined) throw new Error(`Unknown choice ${printable(choice)}.`);
        try {
          const connected = await connectOne(resolve(selectedPath), { args, store, runner, config, team, binding, io });
          batch.shared.push(connected);
          attempted.delete(selectedPath); reasons.delete(selectedPath);
        } catch (error) {
          if (!(error instanceof ConnectStepError) || !error.recoverable) throw error;
          io.print(error.message);
          attempted.set(selectedPath, error.phase === 'consent' ? 'declined' : 'refused');
          reasons.set(selectedPath, error.cause instanceof HygieneRefused ? hygieneReason(error.cause) : error.message);
        }
      }
    } catch (error) {
      // Discovery/non-TTY failures before the first menu retain their existing output contract.
      if (!menuStarted) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      let message = `Stopped: ${detail}${detail.endsWith('.') ? '' : '.'}`;
      if (error instanceof ConnectStepError && error.phase === 'source-mutated') {
        message = `Stopped: ${detail}. ${basename(selectedPath!)}'s SKILL.md at ${selectedPath} already carries the managed fields (license, metadata.id, metadata.author); the team repository was not changed. Fix the cause and run \`${invocation(args.form, 'connect', selectedPath!)}\` again.`;
      } else if (error instanceof ConnectStepError && error.phase === 'pushed') {
        message = `Stopped: ${detail}. ${basename(selectedPath!)} was pushed to team ${team} as ${error.id} but is not tracked on this machine; run \`${invocation(args.form, 'sync')}\` and, if it is still not listed by \`ls --local\`, report this — the local ledger entry is missing.`;
      }
      io.print(message);
      summarize();
      // Preserve the existing first-menu unknown-choice error for callers, too.
      return failure(batch.shared.length || error instanceof ConnectStepError ? message : detail, batch.shared.length ? batch : undefined);
    }
    summarize();
    return success(batch.shared.length ? batch : undefined);
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

async function connectOne(source: string, ctx: ConnectContext): Promise<ConnectResult> {
  const { args, store, runner, config, team, binding, io } = ctx;
  let phase: ConnectPhase = 'validate';
  let recoverable = false;
  let id: string | undefined;
  try {
    if (!binding.handle || !config.email || !config.display_name) throw new Error('Connect needs your joined team identity, name, and email.');
    recoverable = true;
    assertNotInsideStateRoot(source, store.root);
    const name = basename(source);
    if (!(await exists(join(source, 'SKILL.md')))) throw new Error(`${source} has no SKILL.md.`);
    const scan = await assertSkillDirectory(source);
    if (!isSkillName(name)) throw new Error(`Skill name ${name} must be 1–64 lowercase alphanumerics or single hyphens.`);
    if (!args.allowPrivileged && scan.privileged) throw new Error(`${name} contains plugin or hook definitions; retry with --allow-privileged after reviewing them.`);
    const raw = await readFile(join(source, 'SKILL.md'), 'utf8');
    // Hygiene owns connect's post-injection frontmatter gate. This source can legitimately lack the
    // managed fields that injection supplies, so validating it before assembly would be wrong.
    const description = raw;
    const clone = store.teamClone(team);
    const author = `${config.display_name} <${config.email}>`;
    phase = 'preflight'; recoverable = false;
    const repo = openTeamRepo(clone, binding.remote, runner);
    // Connect refreshes before changing the user's source so an upstream collision is a no-write refusal;
    // the mutation-time assertion below still protects a race after this preflight.
    await repo.safeWrite(() => undefined, { action: 'connect', handle: binding.handle, author, message: `${binding.handle}: connect ${name}` });
    const records = await skillRecords(clone, team);
    phase = 'validate'; recoverable = true;
    if (records.some((record) => record.name === name)) throw new Error(`Skill name ${name} already exists in team ${team}; choose a unique name.`);
    recoverable = false;
    id = randomUUID(); // minted before safeWrite, never inside its re-applied mutation
    const teamDoc = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    recoverable = true;
    const updated = injectManagedFields(raw, { license: teamDoc.policy.skill_license, id, author });
    const candidate = await sourceFiles(source);
    candidate.files.set('SKILL.md', Buffer.from(updated));
    reportHygieneWarnings((line) => io.print(line), assessHygiene(name, candidate, teamDoc.policy.skill_license, Boolean(args.allowPrivileged)));
    // Every field connect writes is shown before the y/N — the category too, on the one kind of file
    // that has none (every off-the-shelf skill): it is generated, not asked for, and edited any time.
    const categoryLine = declaredCategory(raw) === undefined ? `\nmetadata.terum-category: ${DEFAULT_CATEGORY} (no category was set; edit SKILL.md any time)` : '';
    phase = 'consent'; recoverable = false;
    io.print(`Will add:\nlicense: ${teamDoc.policy.skill_license}\nmetadata.id: ${id}\nmetadata.author: ${author}${categoryLine}`);
    if (!(await io.confirm(`Connect ${name}?`))) {
      recoverable = true;
      throw new Error('Connect was declined.');
    }
    phase = 'source-mutated';
    await writeFile(join(source, 'SKILL.md'), updated, 'utf8');
    // Push the exact bytes hygiene inspected — a re-read here would open a window where a
    // concurrent editor save lands uninspected content in the team repo (cross-model review P1).
    await repo.safeWrite((tree) => {
      // The preflight clone can be stale; only the freshly reset tree handed to safeWrite is
      // authoritative for the repo-wide name invariant.
      if (tree.paths(`skills/${name}/`).length) throw new Error(`Skill name ${name} already exists in team ${team}; choose a unique name.`);
      mirrorToTree(tree, `skills/${name}`, candidate.files);
    }, { action: 'connect', handle: binding.handle, author, message: `${binding.handle}: connect ${name}` });
    phase = 'pushed';
    const baseline = await canonicalDigest(source);
    await store.update((fresh) => { fresh.shared[id!] = { source, team, baseline }; });
    return { id, name, reconciled: description.length > 0 };
  } catch (cause) {
    if (cause instanceof HygieneRefused) reportHygieneWarnings((line) => io.print(line), cause.assessment);
    throw new ConnectStepError(phase, cause, recoverable, id);
  }
}

/**
 * §5.3 three-way reconciler, called by sync after its pending replay; `skipTeams` are the clones sync
 * could not refresh this run. Every report-and-continue exit is undone work: it is handed to `defer`
 * with its team and the skill's label, so the team is not stamped "fully synced" and the hook's review
 * count includes it — the same rule the placement loop follows (rulings walk R6, 2026-09-06). Before,
 * a diverged shared skill printed its remedy once and the hourly stamp silenced it.
 */
export async function reconcileShared(store: ConfigStore, runner: Runner, io: Prompter, skipTeams: ReadonlySet<string> = new Set(), defer: (team: string, label: string) => void = () => undefined, form?: InvocationForm): Promise<void> {
  const config = await store.read();
  for (const [id, tracked] of Object.entries(config.shared)) {
    if (skipTeams.has(tracked.team)) continue;
    try {
      const clone = store.teamClone(tracked.team);
      if (!(await exists(tracked.source))) { io.print(`Connected source for ${id.slice(0, 8)} is missing; keeping the repository copy. Use ${invocation(form, 'connect --relocate')} or ${invocation(form, 'connect --forget')}.`); defer(tracked.team, id.slice(0, 8)); continue; }
      let record;
      try { record = (await skillRecords(clone, tracked.team)).find((item) => item.id === id); }
      catch (error) { io.print(`Could not read connected ${id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`); defer(tracked.team, id.slice(0, 8)); continue; }
      if (!record) { io.print(`Repository copy for connected ${id.slice(0, 8)} is missing; run ${invocation(form, 'connect')} again to restore it.`); defer(tracked.team, id.slice(0, 8)); continue; }
      const team = await readTeamPolicy(clone);
      const fresh = await store.read();
      const author = `${fresh.display_name ?? ''} <${fresh.email ?? ''}>`;
    // A locally changed id is never trusted; repo identity and current policy always win. The
    // canonical digest omits these repairs, so this cannot manufacture a user edit.
    const sourceSkill = join(tracked.source, 'SKILL.md');
    const sourceContents = await readFile(sourceSkill, 'utf8');
    const repaired = injectManagedFields(sourceContents, { license: team.license, id, author });
    const repoSkill = join(record.directory, 'SKILL.md');
    const repoContents = await readFile(repoSkill, 'utf8');
    const repairedRepo = injectManagedFields(repoContents, { license: team.license, id, author });
    // The existing privileged-content consent gate is orthogonal to HYG4. Keep its actionable
    // remediation ahead of hygiene; either refusal occurs before any source or team-repo write.
    if ((await scanSkillFolder(tracked.source)).privileged && !((await scanSkillFolder(record.directory)).privileged)) { io.print(`Connected skill ${record.name} now contains plugin or hook definitions; run ${invocation(form, 'connect --keep-source', id)} --allow-privileged after reviewing them.`); defer(tracked.team, record.name); continue; }
    // §5.3: a changed `name` is a rename, not a new skill — the ID carries across it. The source's
    // declared name is the target; the repository folder follows on the local-edit row below.
    // (The folder basename is not consulted: `connect --relocate` may legitimately point anywhere.)
    const declared = parseSkillFrontmatter(repaired);
    const targetName = declared.ok ? declared.data.name : record.name;
    const candidate = await sourceFiles(tracked.source);
    candidate.files.set('SKILL.md', Buffer.from(repaired));
    // A repo copy already carrying hooks means consent was given at connect time; new privileged
    // additions were already deferred to `connect --keep-source --allow-privileged` above (walk D5).
    let assessment: HygieneAssessment;
    try { assessment = assessHygiene(targetName, candidate, team.license, (await scanSkillFolder(record.directory)).privileged); }
    catch (error) { if (error instanceof HygieneRefused) reportHygieneWarnings((line) => io.print(line), error.assessment); io.print(`Connected skill ${record.name} failed hygiene:\n${error instanceof Error ? error.message : String(error)}`); defer(tracked.team, record.name); continue; }
    if (repaired !== sourceContents) await writeFile(sourceSkill, repaired, 'utf8');
    if (targetName !== record.name) {
      if (!isSkillName(targetName)) { io.print(`Connected skill ${record.name}: cannot rename to ${targetName}; a skill name is 1–64 lowercase alphanumerics or single hyphens.`); defer(tracked.team, record.name); continue; }
      if ((await skillRecords(clone, tracked.team)).some((item) => item.name === targetName && item.id !== id)) { io.print(`Connected skill ${record.name}: cannot rename to ${targetName}; another skill already uses that name.`); defer(tracked.team, record.name); continue; }
    }
    const sourceDigest = await canonicalDigest(tracked.source);
    const repoDigest = await canonicalDigest(record.directory);
    const baseline = tracked.baseline;
    if (!baseline || (sourceDigest !== baseline && repoDigest !== baseline)) {
      io.print(`Connected skill ${record.name} diverged (source ${sourceDigest}, repo ${repoDigest}); choose ${invocation(form, 'connect --keep-source', id)} or ${invocation(form, 'connect --keep-repo', id)}.`);
      defer(tracked.team, record.name);
      continue;
    }
    const binding = fresh.teams[tracked.team];
    // The clone copy read above is a preflight: safeWrite fetches and resets before the mutation
    // runs, so the repair is re-derived from the fresh pre-image inside it (as every other mutation
    // in this tree does), never written from bytes that may already be behind the remote. The
    // preflight comparison only skips the write when nothing is due locally.
    const refreshRepo = async (): Promise<void> => {
      if (repairedRepo === repoContents) return;
      if (!binding?.handle) throw new Error(`Team ${tracked.team} has no joined handle.`);
      await openTeamRepo(clone, binding.remote, runner).safeWrite((tree) => refreshManagedFieldsInTree(tree, `skills/${record!.name}/SKILL.md`, { license: team.license, id, author }), { action: 'sync', handle: binding.handle, author, previousAuthor: record!.frontmatter.metadata.author, message: `${binding.handle}: update ${record!.name}` });
    };
      if (sourceDigest === baseline && repoDigest === baseline) {
        await refreshRepo();
        continue;
      }
      if (sourceDigest !== baseline) {
        if (!binding?.handle) throw new Error(`Team ${tracked.team} has no joined handle.`);
      // A pre-image with the prior author can only receive a managed-field refresh. Land that
      // narrow write first, then the normal author-owned content mirror on the replayed tree.
      await refreshRepo();
      const files = await sourceFiles(tracked.source);
      await openTeamRepo(clone, binding.remote, runner).safeWrite((tree) => {
        if (targetName !== record!.name) {
          // The preflight list can be stale; only the freshly reset tree is authoritative for the name invariant.
          if (tree.paths(`skills/${targetName}/`).length) throw new Error(`Skill name ${targetName} already exists in team ${tracked.team}; choose a unique name.`);
          for (const path of tree.paths(`skills/${record!.name}/`)) tree.remove(path);
        }
        mirrorToTree(tree, `skills/${targetName}`, files.files);
      }, { action: 'sync', handle: binding.handle, author, previousAuthor: record!.frontmatter.metadata.author, message: targetName === record!.name ? `${binding.handle}: update ${record.name}` : `${binding.handle}: rename ${record.name} to ${targetName}` });
      reportHygieneWarnings((line) => io.print(line), assessment);
      if (targetName !== record.name) io.print(`Renamed connected skill ${record.name} to ${targetName}.`);
      await store.update((next) => { if (next.shared[id]) next.shared[id].baseline = sourceDigest; });
      } else {
        const displaced = await replaceDirectory(record.directory, tracked.source, join(store.root, 'quarantine'));
        io.print(`Previous source at ${tracked.source} moved to ${displaced}.`);
        const copiedSource = await readFile(sourceSkill, 'utf8');
        const refreshedSource = injectManagedFields(copiedSource, { license: team.license, id, author });
        if (refreshedSource !== copiedSource) await writeFile(sourceSkill, refreshedSource, 'utf8');
        await refreshRepo();
        await store.update((next) => { if (next.shared[id]) next.shared[id].baseline = repoDigest; });
      }
    } catch (error) {
      io.print(`Could not reconcile connected ${id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
      defer(tracked.team, id.slice(0, 8));
    }
  }
}

async function resolveDivergence(store: ConfigStore, runner: Runner, teamOverride: string | undefined, id: string, keepSource: boolean, allowPrivileged: boolean, io: Prompter): Promise<ConnectResult> {
  const config = await store.read();
  const tracked = config.shared[id];
  if (!tracked) throw new Error(`No connected skill ${id}.`);
  const clone = store.teamClone(teamOverride ?? tracked.team);
  const record = (await skillRecords(clone, tracked.team)).find((skill) => skill.id === id);
  if (!record) throw new Error(`Repository copy for ${id} is missing.`);
  if (keepSource) {
    const binding = config.teams[tracked.team];
    if (!binding?.handle) throw new Error(`Team ${tracked.team} has no joined handle.`);
    // Same gate as the first connect and the sync reconciler: privileged content the repository copy
    // does not already carry needs the explicit flag. It runs before every write this branch makes —
    // the source managed-field repair and the managed-field commit included — so a refusal is no-write.
    if (!allowPrivileged && (await scanSkillFolder(tracked.source)).privileged && !((await scanSkillFolder(record.directory)).privileged)) throw new Error(`${record.name} contains plugin or hook definitions; retry with --allow-privileged after reviewing them.`);
    const team = await readTeamPolicy(clone);
    const author = `${config.display_name ?? ''} <${config.email ?? ''}>`;
    const sourceSkill = join(tracked.source, 'SKILL.md');
    const sourceContents = await readFile(sourceSkill, 'utf8');
    const repairedSource = injectManagedFields(sourceContents, { license: team.license, id, author });
    const repoSkill = join(record.directory, 'SKILL.md');
    const repoContents = await readFile(repoSkill, 'utf8');
    const repairedRepo = injectManagedFields(repoContents, { license: team.license, id, author });
    const repo = openTeamRepo(clone, binding.remote, runner);
    const candidate = await sourceFiles(tracked.source);
    candidate.files.set('SKILL.md', Buffer.from(repairedSource));
    // Consent carries: --allow-privileged now, or a repository copy that already holds the
    // consented privileged form from an earlier connect (walk D5).
    reportHygieneWarnings((line) => io.print(line), assessHygiene(record.name, candidate, team.license, allowPrivileged || (await scanSkillFolder(record.directory)).privileged));
    if (repairedSource !== sourceContents) await writeFile(sourceSkill, repairedSource, 'utf8');
    if (repairedRepo !== repoContents) {
      await repo.safeWrite((tree) => refreshManagedFieldsInTree(tree, `skills/${record.name}/SKILL.md`, { license: team.license, id, author }), { action: 'sync', handle: binding.handle, author, previousAuthor: record.frontmatter.metadata.author, message: `${binding.handle}: update ${record.name}` });
    }
    const files = await sourceFiles(tracked.source);
    await repo.safeWrite((tree) => mirrorToTree(tree, `skills/${record.name}`, files.files), { action: 'sync', handle: binding.handle, author, previousAuthor: record.frontmatter.metadata.author, message: `${binding.handle}: update ${record.name}` });
    const digest = await canonicalDigest(tracked.source);
    await store.update((fresh) => { fresh.shared[id]!.baseline = digest; });
  } else {
    const displaced = await replaceDirectory(record.directory, tracked.source, join(store.root, 'quarantine'));
    io.print(`Previous source at ${tracked.source} moved to ${displaced}.`);
    const digest = await canonicalDigest(record.directory);
    await store.update((fresh) => { fresh.shared[id]!.baseline = digest; });
  }
  io.print(`Resolved ${record.name} with ${keepSource ? 'source' : 'repository'} content.`);
  return { id, name: record.name, reconciled: true };
}
async function forget(store: ConfigStore, id: string, io: Prompter): Promise<undefined> {
  if (!(await io.confirm(`Forget local tracking for ${id}? The repository copy remains.`))) throw new Error('Forget was declined.');
  await store.update((config) => { delete config.shared[id]; });
  return undefined;
}
async function relocate(store: ConfigStore, value: { id: string; path: string } | string): Promise<undefined> {
  const parsed = typeof value === 'string' ? splitRelocate(value) : value;
  await assertRelocation(parsed.path, parsed.id);
  await store.update((config) => { const shared = config.shared[parsed.id]; if (!shared) throw new Error(`No connected skill ${parsed.id}.`); shared.source = resolve(parsed.path); });
  return undefined;
}
function splitRelocate(value: string): { id: string; path: string } { const index = value.indexOf(':'); if (index < 1) throw new Error('Use --relocate <id>:<path>.'); return { id: value.slice(0, index), path: value.slice(index + 1) }; }
function mirrorToTree(tree: MutableTree, destination: string, files: Map<string, Buffer>): void { for (const path of tree.paths(`${destination}/`)) if (!files.has(path.slice(destination.length + 1))) tree.remove(path); for (const [path, content] of files) tree.set(`${destination}/${path}`, content); }
/** The batch summary's one-line reason for a hygiene refusal: `Not connected: <name> (hygiene: …)`. */
function hygieneReason(refused: HygieneRefused): string {
  return `hygiene: ${refused.assessment.errors.map((finding) => finding.message.replace(/\.$/, '')).join('; ')}`;
}

/** The managed-field refresh as a mutation: re-derived from the fresh pre-image safeWrite hands it, so it can only ever change the managed lines of whatever is actually upstream (and restore a missing category, as injectManagedFields does everywhere). */
function refreshManagedFieldsInTree(tree: MutableTree, path: string, values: { license: string; id: string; author: string }): void {
  const current = tree.before(path);
  if (current === undefined) return;
  const text = treeText(current);
  const repaired = injectManagedFields(text, values);
  if (repaired !== text) tree.set(path, repaired);
}
/**
 * Replace the author's folder `to` with the repository copy `from`. `to` is the user's own authoring
 * tree — possibly holding edits no commit has — so the displaced folder goes to quarantine, never to
 * rm (AGENTS.md; spec invariants 27/34), in the same order place() uses for its own copies: stage
 * the winner beside the target, move the loser aside, rename the winner in; a failure moves the
 * loser back. moveToQuarantine handles an authoring folder on another volume (copy, then remove).
 * Returns the quarantine path so the caller can say where the previous source went.
 */
async function replaceDirectory(from: string, to: string, quarantineRoot: string): Promise<string> {
  await assertSkillDirectory(to);
  const temporary = `${to}.terum-${randomUUID()}`;
  await cp(from, temporary, { recursive: true });
  let displaced: string | undefined;
  try {
    displaced = await moveToQuarantine(to, quarantineRoot, basename(to));
    await rename(temporary, to);
    return displaced;
  } catch (error) {
    // Undo the move-aside the way it went: back across the volume if that is where it came from.
    if (displaced !== undefined) await moveDirectory(displaced, to);
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function readTeamPolicy(clone: string): Promise<{ license: string }> { const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json'); return { license: team.policy.skill_license }; }

async function assertRelocation(path: string, id: string): Promise<void> {
  await assertSkillDirectory(path);
  const parsed = parseSkillFrontmatter(await readFile(join(path, 'SKILL.md'), 'utf8'));
  if (!parsed.ok) throw new Error(`Relocation source ${path} has no valid SKILL.md.`);
  if (parsed.data.metadata.id !== id) throw new Error(`Relocation source ${path} does not carry skill id ${id}.`);
}
