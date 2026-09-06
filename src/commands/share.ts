import { cp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { exists } from '../lib/fs.js';
import { Prompter } from '../lib/prompt.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { teamSchema, parseJson, parseSkillFrontmatter } from '../lib/schema.js';
import { canonicalDigest, injectManagedFields, skillRecords } from '../lib/skills.js';
import { MutableTree, openTeamRepo } from '../lib/teamRepo.js';

export interface ShareArgs {
  path?: string;
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
    if (args.keepSource || args.keepRepo) return success(await resolveDivergence(store, runner, args.team, args.keepSource ?? args.keepRepo!, Boolean(args.keepSource), io));
    if (!args.path) throw new Error('Provide a skill folder path.');
    const config = await store.read();
    const team = selectTeam(config.teams, args.team);
    const binding = config.teams[team]!;
    if (!binding.handle || !config.email || !config.display_name) throw new Error('Share needs your joined team identity, name, and email.');
    const source = resolve(args.path);
    const name = basename(source);
    if (!(await exists(join(source, 'SKILL.md')))) throw new Error(`${source} has no SKILL.md.`);
    await assertSkillDirectory(source);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error(`Skill name ${name} must be 1–64 lowercase alphanumerics or single hyphens.`);
    if (!args.allowPrivileged && await hasPrivilegedContent(source)) throw new Error(`${name} contains plugin or hook definitions; retry with --allow-privileged after reviewing them.`);
    const raw = await readFile(join(source, 'SKILL.md'), 'utf8');
    const description = inspectSource(raw, name);
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
    io.print(`Will add:\nlicense: ${teamDoc.policy.skill_license}\nmetadata.id: ${id}\nmetadata.author: ${author}`);
    if (!(await io.confirm(`Share ${name}?`))) throw new Error('Share was declined.');
    await writeFile(join(source, 'SKILL.md'), updated, 'utf8');
    const files = await sourceFiles(source);
    await repo.safeWrite((tree) => {
      // The preflight clone can be stale; only the freshly reset tree handed to safeWrite is
      // authoritative for the repo-wide name invariant.
      if (tree.paths(`skills/${name}/`).length) throw new Error(`Skill name ${name} already exists in team ${team}; choose a unique name.`);
      mirrorToTree(tree, `skills/${name}`, files);
    }, { action: 'share', handle: binding.handle, author, message: `${binding.handle}: share ${name}` });
    const baseline = await canonicalDigest(source);
    await store.update((fresh) => { fresh.shared[id] = { source, team, baseline }; });
    return success({ id, name, reconciled: description.length > 0 });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

/** §5.3 three-way reconciler, called by sync after its pending replay. */
export async function reconcileShared(store: ConfigStore, runner: Runner, io: Prompter): Promise<void> {
  const config = await store.read();
  for (const [id, tracked] of Object.entries(config.shared)) {
    try {
      const clone = store.teamClone(tracked.team);
      if (!(await exists(tracked.source))) { io.print(`Shared source for ${id.slice(0, 8)} is missing; keeping the repository copy. Use share --relocate or --forget.`); continue; }
      let record;
      try { record = (await skillRecords(clone, tracked.team)).find((item) => item.id === id); }
      catch (error) { io.print(`Could not read shared ${id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`); continue; }
      if (!record) { io.print(`Repository copy for shared ${id.slice(0, 8)} is missing; run share again to restore it.`); continue; }
      const team = await readTeamPolicy(clone);
      const fresh = await store.read();
      const author = `${fresh.display_name ?? ''} <${fresh.email ?? ''}>`;
    // A locally changed id is never trusted; repo identity and current policy always win. The
    // canonical digest omits these repairs, so this cannot manufacture a user edit.
    const sourceSkill = join(tracked.source, 'SKILL.md');
    const sourceContents = await readFile(sourceSkill, 'utf8');
    const repaired = injectManagedFields(sourceContents, { license: team.license, id, author });
    if (repaired !== sourceContents) await writeFile(sourceSkill, repaired, 'utf8');
    const repoSkill = join(record.directory, 'SKILL.md');
    const repoContents = await readFile(repoSkill, 'utf8');
    const repairedRepo = injectManagedFields(repoContents, { license: team.license, id, author });
    const sourceDigest = await canonicalDigest(tracked.source);
    const repoDigest = await canonicalDigest(record.directory);
    const baseline = tracked.baseline;
    if (!baseline || (sourceDigest !== baseline && repoDigest !== baseline)) {
      io.print(`Shared skill ${record.name} diverged (source ${sourceDigest}, repo ${repoDigest}); choose share --keep-source ${id} or --keep-repo ${id}.`);
      continue;
    }
    const binding = fresh.teams[tracked.team];
    const refreshRepo = async (content: string): Promise<void> => {
      if (content === repoContents) return;
      if (!binding?.handle) throw new Error(`Team ${tracked.team} has no joined handle.`);
      await openTeamRepo(clone, binding.remote, runner).safeWrite((tree) => tree.set(`skills/${record!.name}/SKILL.md`, content), { action: 'sync', handle: binding.handle, author, previousAuthor: record!.frontmatter.metadata.author, message: `${binding.handle}: update ${record!.name}` });
    };
      if (sourceDigest === baseline && repoDigest === baseline) {
        await refreshRepo(repairedRepo);
        continue;
      }
      if (sourceDigest !== baseline) {
        if (!binding?.handle) throw new Error(`Team ${tracked.team} has no joined handle.`);
      // A pre-image with the prior author can only receive a managed-field refresh. Land that
      // narrow write first, then the normal author-owned content mirror on the replayed tree.
      await refreshRepo(repairedRepo);
      const files = await sourceFiles(tracked.source);
      await openTeamRepo(clone, binding.remote, runner).safeWrite((tree) => mirrorToTree(tree, `skills/${record!.name}`, files), { action: 'sync', handle: binding.handle, author, previousAuthor: record!.frontmatter.metadata.author, message: `${binding.handle}: update ${record.name}` });
      await store.update((next) => { if (next.shared[id]) next.shared[id].baseline = sourceDigest; });
      } else {
        await replaceDirectory(record.directory, tracked.source);
        const copiedSource = await readFile(sourceSkill, 'utf8');
        const refreshedSource = injectManagedFields(copiedSource, { license: team.license, id, author });
        if (refreshedSource !== copiedSource) await writeFile(sourceSkill, refreshedSource, 'utf8');
        await refreshRepo(repairedRepo);
        await store.update((next) => { if (next.shared[id]) next.shared[id].baseline = repoDigest; });
      }
    } catch (error) {
      io.print(`Could not reconcile shared ${id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function resolveDivergence(store: ConfigStore, runner: Runner, teamOverride: string | undefined, id: string, keepSource: boolean, io: Prompter): Promise<ShareResult> {
  const config = await store.read();
  const tracked = config.shared[id];
  if (!tracked) throw new Error(`No shared skill ${id}.`);
  const clone = store.teamClone(teamOverride ?? tracked.team);
  const record = (await skillRecords(clone, tracked.team)).find((skill) => skill.id === id);
  if (!record) throw new Error(`Repository copy for ${id} is missing.`);
  if (keepSource) {
    const binding = config.teams[tracked.team];
    if (!binding?.handle) throw new Error(`Team ${tracked.team} has no joined handle.`);
    const team = await readTeamPolicy(clone);
    const author = `${config.display_name ?? ''} <${config.email ?? ''}>`;
    const sourceSkill = join(tracked.source, 'SKILL.md');
    const sourceContents = await readFile(sourceSkill, 'utf8');
    const repairedSource = injectManagedFields(sourceContents, { license: team.license, id, author });
    if (repairedSource !== sourceContents) await writeFile(sourceSkill, repairedSource, 'utf8');
    const repoSkill = join(record.directory, 'SKILL.md');
    const repoContents = await readFile(repoSkill, 'utf8');
    const repairedRepo = injectManagedFields(repoContents, { license: team.license, id, author });
    const repo = openTeamRepo(clone, binding.remote, runner);
    if (repairedRepo !== repoContents) {
      await repo.safeWrite((tree) => tree.set(`skills/${record.name}/SKILL.md`, repairedRepo), { action: 'sync', handle: binding.handle, author, previousAuthor: record.frontmatter.metadata.author, message: `${binding.handle}: update ${record.name}` });
    }
    const files = await sourceFiles(tracked.source);
    await repo.safeWrite((tree) => mirrorToTree(tree, `skills/${record.name}`, files), { action: 'sync', handle: binding.handle, author, previousAuthor: record.frontmatter.metadata.author, message: `${binding.handle}: update ${record.name}` });
    const digest = await canonicalDigest(tracked.source);
    await store.update((fresh) => { fresh.shared[id]!.baseline = digest; });
  } else {
    await replaceDirectory(record.directory, tracked.source);
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
function selectTeam(teams: Record<string, unknown>, explicit?: string): string { if (explicit) { if (!teams[explicit]) throw new Error(`Team ${explicit} is not configured.`); return explicit; } const names = Object.keys(teams); if (names.length !== 1) throw new Error('Select a team with --team.'); return names[0]!; }
function inspectSource(raw: string, name: string): string {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(raw); if (!match) throw new Error('SKILL.md has no YAML frontmatter.');
  const parsed = YAML.parse(match[1]!) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || parsed.name !== name || typeof parsed.description !== 'string') throw new Error(`SKILL.md name must equal folder ${name} and description is required.`);
  return parsed.description;
}
async function hasPrivilegedContent(root: string): Promise<boolean> {
  async function visit(current: string, relative = ''): Promise<boolean> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === '.claude-plugin' || /^hooks?$/i.test(entry.name)) return true;
        if (await visit(join(current, entry.name), path)) return true;
      } else if (entry.isFile() && (path.split('/').includes('.claude-plugin') || /(^|\/)hooks?(\/|$)/i.test(path))) return true;
    }
    return false;
  }
  return visit(root);
}
async function sourceFiles(root: string): Promise<Map<string, Buffer>> { const result = new Map<string, Buffer>(); async function walk(current: string, relative = ''): Promise<void> { for (const entry of await readdir(current, { withFileTypes: true })) { const next = join(current, entry.name); const key = relative ? `${relative}/${entry.name}` : entry.name; if (entry.isDirectory()) await walk(next, key); else if (entry.isFile()) result.set(key, await readFile(next)); } } await walk(root); return result; }
function mirrorToTree(tree: MutableTree, destination: string, files: Map<string, Buffer>): void { for (const path of tree.paths(`${destination}/`)) if (!files.has(path.slice(destination.length + 1))) tree.remove(path); for (const [path, content] of files) tree.set(`${destination}/${path}`, content); }
async function replaceDirectory(from: string, to: string): Promise<void> { await assertSkillDirectory(to); const temporary = `${to}.terum-${randomUUID()}`; await cp(from, temporary, { recursive: true }); await rm(to, { recursive: true, force: true }); await rename(temporary, to); }
async function readTeamPolicy(clone: string): Promise<{ license: string }> { const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json'); return { license: team.policy.skill_license }; }

async function assertSkillDirectory(path: string): Promise<void> {
  let details;
  try { details = await stat(path); } catch { throw new Error(`${path} is not a skill folder.`); }
  if (!details.isDirectory()) throw new Error(`${path} is not a skill folder.`);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const next = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill folder contains symlink ${next}.`);
    if (entry.isDirectory()) await assertNoSymlink(next);
  }
}
async function assertNoSymlink(path: string): Promise<void> { for (const entry of await readdir(path, { withFileTypes: true })) { const next = join(path, entry.name); if (entry.isSymbolicLink()) throw new Error(`Skill folder contains symlink ${next}.`); if (entry.isDirectory()) await assertNoSymlink(next); } }
async function assertRelocation(path: string, id: string): Promise<void> {
  await assertSkillDirectory(path);
  const parsed = parseSkillFrontmatter(await readFile(join(path, 'SKILL.md'), 'utf8'));
  if (!parsed.ok) throw new Error(`Relocation source ${path} has no valid SKILL.md.`);
  if (parsed.data.metadata.id !== id) throw new Error(`Relocation source ${path} does not carry skill id ${id}.`);
}
