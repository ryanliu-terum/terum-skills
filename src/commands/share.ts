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
import { formatHygieneFindings, hygieneFrontmatter, inspectHygiene } from '../lib/evals/hygiene.js';

export interface ShareArgs {
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
export interface ShareResult { id: string; name: string; reconciled?: boolean; }

export async function run(args: ShareArgs, io: Prompter): Promise<Result<ShareResult | undefined>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    if (args.forget) return success(await forget(store, args.forget, io));
    if (args.relocate) return success(await relocate(store, args.relocate));
    if (args.keepSource || args.keepRepo) return success(await resolveDivergence(store, runner, args.team, args.keepSource ?? args.keepRepo!, Boolean(args.keepSource), Boolean(args.allowPrivileged), io));
    const config = await store.read();
    const [team, binding] = selectTeam(config.teams, args.team);
    let selectedPath = args.path;
    if (!selectedPath) {
      const { roots } = await localSkillRoots(args.home ?? homedir(), args.cwd);
      const inventories = await Promise.all(roots.map((root) => localSkills(root.root, config, { scope: root.scope, stateRoot: store.root })));
      const candidates = inventories.flatMap((inventory) => candidatesOf(inventory, args.allowPrivileged).map((entry) => ({ ...entry, scope: inventory.scope })));
      const omitted = inventories.flatMap((inventory) => {
        const offered = candidatesOf(inventory, args.allowPrivileged);
        return inventory.entries.filter((entry) => !entry.shared.length && !entry.placement && !offered.includes(entry));
      });
      if (omitted.length) io.print(`Skipped ${omitted.length} local folders that cannot be offered for sharing. Run \`npx -y terum-skills@latest ls --local\` for paths and reasons.`);
      if (!candidates.length) {
        io.print(`No local candidates to share under ${roots.map((root) => printable(root.root)).join(' or ')}. Skills elsewhere can be shared by passing their folder path.`);
        return success(undefined);
      }
      if (!io.interactive) {
        for (const inventory of inventories) {
          io.print(`Local candidates under ${printable(inventory.root)}:`);
          for (const candidate of candidatesOf(inventory, args.allowPrivileged)) io.print(`  ${printable(candidate.path)}`);
        }
        throw new Error(`No skill selected. In an interactive terminal, run \`npx -y terum-skills@latest share --team ${printable(shellQuote(team))}\`, or pass an explicit skill folder path.`);
      }
      const choices = new Map(candidates.map((candidate) => [`Share ${printable(candidate.name)}${candidates.filter((entry) => entry.name === candidate.name).length > 1 ? ` (${candidate.scope})` : ''}`, candidate.path]));
      const choice = await io.select(`Share a local skill with team ${printable(team)}?`, [...choices.keys(), 'Skip']);
      if (choice === 'Skip') { io.print('Nothing shared.'); return success(undefined); }
      selectedPath = choices.get(choice);
      if (selectedPath === undefined) throw new Error(`Unknown choice ${printable(choice)}.`);
    }
    if (!binding.handle || !config.email || !config.display_name) throw new Error('Share needs your joined team identity, name, and email.');
    const source = resolve(selectedPath);
    assertNotInsideStateRoot(source, store.root);
    const name = basename(source);
    if (!(await exists(join(source, 'SKILL.md')))) throw new Error(`${source} has no SKILL.md.`);
    const scan = await assertSkillDirectory(source);
    if (!isSkillName(name)) throw new Error(`Skill name ${name} must be 1–64 lowercase alphanumerics or single hyphens.`);
    if (!args.allowPrivileged && scan.privileged) throw new Error(`${name} contains plugin or hook definitions; retry with --allow-privileged after reviewing them.`);
    const raw = await readFile(join(source, 'SKILL.md'), 'utf8');
    // Hygiene owns the post-injection frontmatter gate. This source can legitimately lack the
    // managed fields that injection supplies, so validating it before assembly would be wrong.
    const description = raw;
    const clone = store.teamClone(team);
    const author = `${config.display_name} <${config.email}>`;
    const repo = openTeamRepo(clone, binding.remote, runner);
    // Refresh before changing the user's source so an upstream collision is a no-write refusal;
    // the mutation-time assertion below still protects a race after this preflight.
    await repo.safeWrite(() => undefined, { action: 'share', handle: binding.handle, author, message: `${binding.handle}: share ${name}` });
    const records = await skillRecords(clone, team);
    if (records.some((record) => record.name === name)) throw new Error(`Skill name ${name} already exists in team ${team}; choose a unique name.`);
    const id = randomUUID(); // minted before safeWrite, never inside its re-applied mutation
    const teamDoc = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    const updated = injectManagedFields(raw, { license: teamDoc.policy.skill_license, id, author });
    const candidate = await sourceFiles(source);
    candidate.files.set('SKILL.md', Buffer.from(updated));
    assertHygiene(name, candidate, teamDoc.policy.skill_license, Boolean(args.allowPrivileged));
    // Every field the tool writes is shown before the y/N — the category too, on the one kind of file
    // that has none (every off-the-shelf skill): it is generated, not asked for, and edited any time.
    const categoryLine = declaredCategory(raw) === undefined ? `\nmetadata.terum-category: ${DEFAULT_CATEGORY} (no category was set; edit SKILL.md any time)` : '';
    io.print(`Will add:\nlicense: ${teamDoc.policy.skill_license}\nmetadata.id: ${id}\nmetadata.author: ${author}${categoryLine}`);
    if (!(await io.confirm(`Share ${name}?`))) throw new Error('Share was declined.');
    await writeFile(join(source, 'SKILL.md'), updated, 'utf8');
    // Push the exact bytes hygiene inspected — a re-read here would open a window where a
    // concurrent editor save lands uninspected content in the team repo (cross-model review P1).
    await repo.safeWrite((tree) => {
      // The preflight clone can be stale; only the freshly reset tree handed to safeWrite is
      // authoritative for the repo-wide name invariant.
      if (tree.paths(`skills/${name}/`).length) throw new Error(`Skill name ${name} already exists in team ${team}; choose a unique name.`);
      mirrorToTree(tree, `skills/${name}`, candidate.files);
    }, { action: 'share', handle: binding.handle, author, message: `${binding.handle}: share ${name}` });
    const baseline = await canonicalDigest(source);
    await store.update((fresh) => { fresh.shared[id] = { source, team, baseline }; });
    return success({ id, name, reconciled: description.length > 0 });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

/**
 * §5.3 three-way reconciler, called by sync after its pending replay; `skipTeams` are the clones sync
 * could not refresh this run. Every report-and-continue exit is undone work: it is handed to `defer`
 * with its team and the skill's label, so the team is not stamped "fully synced" and the hook's review
 * count includes it — the same rule the placement loop follows (rulings walk R6, 2026-09-06). Before,
 * a diverged shared skill printed its remedy once and the hourly stamp silenced it.
 */
export async function reconcileShared(store: ConfigStore, runner: Runner, io: Prompter, skipTeams: ReadonlySet<string> = new Set(), defer: (team: string, label: string) => void = () => undefined): Promise<void> {
  const config = await store.read();
  for (const [id, tracked] of Object.entries(config.shared)) {
    if (skipTeams.has(tracked.team)) continue;
    try {
      const clone = store.teamClone(tracked.team);
      if (!(await exists(tracked.source))) { io.print(`Shared source for ${id.slice(0, 8)} is missing; keeping the repository copy. Use share --relocate or --forget.`); defer(tracked.team, id.slice(0, 8)); continue; }
      let record;
      try { record = (await skillRecords(clone, tracked.team)).find((item) => item.id === id); }
      catch (error) { io.print(`Could not read shared ${id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`); defer(tracked.team, id.slice(0, 8)); continue; }
      if (!record) { io.print(`Repository copy for shared ${id.slice(0, 8)} is missing; run share again to restore it.`); defer(tracked.team, id.slice(0, 8)); continue; }
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
    if ((await scanSkillFolder(tracked.source)).privileged && !((await scanSkillFolder(record.directory)).privileged)) { io.print(`Shared skill ${record.name} now contains plugin or hook definitions; run share --keep-source ${id} --allow-privileged after reviewing them.`); defer(tracked.team, record.name); continue; }
    // §5.3: a changed `name` is a rename, not a new skill — the ID carries across it. The source's
    // declared name is the target; the repository folder follows on the local-edit row below.
    // (The folder basename is not consulted: `share --relocate` may legitimately point anywhere.)
    const declared = parseSkillFrontmatter(repaired);
    const targetName = declared.ok ? declared.data.name : record.name;
    const candidate = await sourceFiles(tracked.source);
    candidate.files.set('SKILL.md', Buffer.from(repaired));
    // A repo copy already carrying hooks means consent was given at share time; new privileged
    // additions were already deferred to `share --keep-source --allow-privileged` above (walk D5).
    try { assertHygiene(targetName, candidate, team.license, (await scanSkillFolder(record.directory)).privileged); }
    catch (error) { io.print(`Shared skill ${record.name} failed hygiene:\n${error instanceof Error ? error.message : String(error)}`); defer(tracked.team, record.name); continue; }
    if (repaired !== sourceContents) await writeFile(sourceSkill, repaired, 'utf8');
    if (targetName !== record.name) {
      if (!isSkillName(targetName)) { io.print(`Shared skill ${record.name}: cannot rename to ${targetName}; a skill name is 1–64 lowercase alphanumerics or single hyphens.`); defer(tracked.team, record.name); continue; }
      if ((await skillRecords(clone, tracked.team)).some((item) => item.name === targetName && item.id !== id)) { io.print(`Shared skill ${record.name}: cannot rename to ${targetName}; another skill already uses that name.`); defer(tracked.team, record.name); continue; }
    }
    const sourceDigest = await canonicalDigest(tracked.source);
    const repoDigest = await canonicalDigest(record.directory);
    const baseline = tracked.baseline;
    if (!baseline || (sourceDigest !== baseline && repoDigest !== baseline)) {
      io.print(`Shared skill ${record.name} diverged (source ${sourceDigest}, repo ${repoDigest}); choose share --keep-source ${id} or --keep-repo ${id}.`);
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
      if (targetName !== record.name) io.print(`Renamed shared skill ${record.name} to ${targetName}.`);
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
      io.print(`Could not reconcile shared ${id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
      defer(tracked.team, id.slice(0, 8));
    }
  }
}

async function resolveDivergence(store: ConfigStore, runner: Runner, teamOverride: string | undefined, id: string, keepSource: boolean, allowPrivileged: boolean, io: Prompter): Promise<ShareResult> {
  const config = await store.read();
  const tracked = config.shared[id];
  if (!tracked) throw new Error(`No shared skill ${id}.`);
  const clone = store.teamClone(teamOverride ?? tracked.team);
  const record = (await skillRecords(clone, tracked.team)).find((skill) => skill.id === id);
  if (!record) throw new Error(`Repository copy for ${id} is missing.`);
  if (keepSource) {
    const binding = config.teams[tracked.team];
    if (!binding?.handle) throw new Error(`Team ${tracked.team} has no joined handle.`);
    // Same gate as the first share and the sync reconciler: privileged content the repository copy
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
    // consented privileged form from an earlier share (walk D5).
    assertHygiene(record.name, candidate, team.license, allowPrivileged || (await scanSkillFolder(record.directory)).privileged);
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
  await store.update((config) => { const shared = config.shared[parsed.id]; if (!shared) throw new Error(`No shared skill ${parsed.id}.`); shared.source = resolve(parsed.path); });
  return undefined;
}
function splitRelocate(value: string): { id: string; path: string } { const index = value.indexOf(':'); if (index < 1) throw new Error('Use --relocate <id>:<path>.'); return { id: value.slice(0, index), path: value.slice(index + 1) }; }
function mirrorToTree(tree: MutableTree, destination: string, files: Map<string, Buffer>): void { for (const path of tree.paths(`${destination}/`)) if (!files.has(path.slice(destination.length + 1))) tree.remove(path); for (const [path, content] of files) tree.set(`${destination}/${path}`, content); }
function assertHygiene(name: string, input: Awaited<ReturnType<typeof sourceFiles>>, license: string, allowExecutable = false): void {
  const skill = input.files.get('SKILL.md');
  const findings = inspectHygiene({ name, frontmatter: skill === undefined ? undefined : hygieneFrontmatter(skill), files: input.files, executable: input.executable, policy: { skill_license: license }, allowExecutable });
  if (findings.length) throw new Error(formatHygieneFindings(findings));
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
