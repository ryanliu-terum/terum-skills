import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { packageRoot } from './package-root.js';
import { AGENT_PATHS } from './placer/agent-paths.js';
import type { Prompter } from './prompt.js';
import { FRONTMATTER } from './schema.js';

export const MANAGED_BY = 'terum-skills';
export const BUNDLED_SKILLS = join(packageRoot() ?? fileURLToPath(new URL('../../', import.meta.url)), 'dist', 'claude', 'skills');

export type ManagedHost = 'claude' | 'codex';
export interface ManagedRoot { host: ManagedHost; root: string }
/** `skillsRoot` and `source` are transitional single-wrapper compatibility fields. */
export interface WrapperOptions {
  roots?: ManagedRoot[];
  bundle?: string;
  /** @deprecated Task 5 removes this. */ skillsRoot?: string;
  /** @deprecated Task 5 removes this. */ source?: string;
}

export function managedSkillRoots(home = homedir(), env: NodeJS.ProcessEnv = process.env): ManagedRoot[] {
  const codexHome = env['CODEX_HOME'] || join(home, '.codex');
  return [{ host: 'claude', root: AGENT_PATHS['claude-code'].global(home) }, { host: 'codex', root: join(codexHome, 'skills') }];
}

export function defaultWrapperOptions(home = homedir(), env: NodeJS.ProcessEnv = process.env): Required<WrapperOptions> {
  const roots = managedSkillRoots(home, env);
  return { roots, bundle: BUNDLED_SKILLS, skillsRoot: roots[0]!.root, source: join(BUNDLED_SKILLS, 'terum-skills', 'SKILL.md') };
}

export function managedSkillDirectory(root: string, name: string): string { return join(root, name); }

export function isManagedFrontmatter(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const data = parsed as Record<string, unknown>;
  const metadata = data['metadata'];
  return typeof data['name'] === 'string' && data['name'] !== '' && !!metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata as Record<string, unknown>)['managed-by'] === MANAGED_BY;
}

export function isManagedSkill(raw: string): boolean {
  const match = FRONTMATTER.exec(raw);
  if (!match) return false;
  try { return isManagedFrontmatter(YAML.parse(match[1]!)); } catch { return false; }
}

function frontmatterName(raw: string): string | null {
  const match = FRONTMATTER.exec(raw);
  if (!match) return null;
  try {
    const parsed: unknown = YAML.parse(match[1]!);
    return isManagedFrontmatter(parsed) ? (parsed as { name: string }).name : null;
  } catch { return null; }
}

export type SkillPresence = { kind: 'absent' } | { kind: 'managed'; raw: string } | { kind: 'foreign'; why: string };
function isMissing(error: unknown): boolean { const code = (error as NodeJS.ErrnoException).code; return code === 'ENOENT' || code === 'ENOTDIR'; }

export async function inspectManagedSkill(root: string, name: string): Promise<SkillPresence> {
  const directory = managedSkillDirectory(root, name);
  let details;
  try { details = await lstat(directory); } catch (error) { if (isMissing(error)) return { kind: 'absent' }; throw error; }
  if (details.isSymbolicLink()) return { kind: 'foreign', why: 'it is a symbolic link' };
  if (!details.isDirectory()) return { kind: 'foreign', why: 'it is not a directory' };
  const file = join(directory, 'SKILL.md');
  let fileDetails;
  try { fileDetails = await lstat(file); } catch (error) { if (isMissing(error)) return { kind: 'foreign', why: 'it has no SKILL.md' }; throw error; }
  if (!fileDetails.isFile()) return { kind: 'foreign', why: 'its SKILL.md is not a regular file' };
  const raw = await readFile(file, 'utf8');
  return isManagedSkill(raw) ? { kind: 'managed', raw } : { kind: 'foreign', why: 'it is a different skill' };
}

export async function listManagedSkills(root: string): Promise<{ name: string; directory: string }[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if (isMissing(error)) return []; throw error; }
  const managed: { name: string; directory: string }[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const presence = await inspectManagedSkill(root, entry.name);
    if (presence.kind === 'managed') managed.push({ name: entry.name, directory: managedSkillDirectory(root, entry.name) });
  }
  return managed;
}

export async function readBundledSkills(bundle: string): Promise<Map<string, string> | null> {
  let entries;
  try { entries = await readdir(bundle, { withFileTypes: true }); } catch (error) { if (isMissing(error)) return null; throw error; }
  const skills = new Map<string, string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try { raw = await readFile(join(bundle, entry.name, 'SKILL.md'), 'utf8'); } catch (error) { if (isMissing(error)) continue; throw error; }
    if (frontmatterName(raw) === entry.name) skills.set(entry.name, raw);
  }
  return skills.size ? skills : null;
}

export type SkillState = 'absent' | 'current' | 'outdated' | 'foreign';
export interface ManagedSkillStatus { name: string; root: string; directory: string; state: SkillState; why?: string }
export interface RootStatus { host: ManagedHost; root: string; eligible: boolean; skills: ManagedSkillStatus[] }
export type ManagedStates = { kind: 'unavailable'; bundle: string } | { kind: 'ready'; bundled: Map<string, string>; roots: RootStatus[] };

async function isDirectory(path: string): Promise<boolean> { try { return (await stat(path)).isDirectory(); } catch (error) { if (isMissing(error)) return false; throw error; } }
async function eligible(root: ManagedRoot): Promise<boolean> { return root.host === 'claude' ? true : isDirectory(dirname(root.root)); }

export async function managedSkillStates(options: Required<WrapperOptions>): Promise<ManagedStates> {
  const bundled = await readBundledSkills(options.bundle);
  if (bundled === null) return { kind: 'unavailable', bundle: options.bundle };
  const roots: RootStatus[] = [];
  for (const root of options.roots) {
    const skills: ManagedSkillStatus[] = [];
    for (const [name, raw] of bundled) {
      const directory = managedSkillDirectory(root.root, name);
      const presence = await inspectManagedSkill(root.root, name);
      if (presence.kind === 'absent') skills.push({ name, root: root.root, directory, state: 'absent' });
      else if (presence.kind === 'foreign') skills.push({ name, root: root.root, directory, state: 'foreign', why: presence.why });
      else skills.push({ name, root: root.root, directory, state: presence.raw === raw ? 'current' : 'outdated' });
    }
    roots.push({ host: root.host, root: root.root, eligible: await eligible(root), skills });
  }
  return { kind: 'ready', bundled, roots };
}

export async function installManagedSkill(root: string, name: string, raw: string): Promise<'installed' | 'replaced'> {
  const directory = managedSkillDirectory(root, name);
  const presence = await inspectManagedSkill(root, name);
  if (presence.kind === 'foreign') throw new Error(`${directory} exists and is not a bundled terum-skills skill (${presence.why}); move it aside and re-run.`);
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'SKILL.md');
  const temporary = join(directory, `.SKILL.md.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'w');
    try { await handle.writeFile(raw, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  return presence.kind === 'managed' ? 'replaced' : 'installed';
}

export async function removeManagedSkill(root: string, name: string): Promise<'removed' | 'absent' | 'foreign'> {
  const presence = await inspectManagedSkill(root, name);
  if (presence.kind !== 'managed') return presence.kind;
  const directory = managedSkillDirectory(root, name);
  await rm(join(directory, 'SKILL.md'));
  try { await rmdir(directory); }
  catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error; }
  return 'removed';
}

export type WrapperOffer = 'installed' | 'replaced' | 'present' | 'declined' | 'foreign' | 'unavailable';
const HOST_LABEL: Record<ManagedHost, string> = { claude: 'Claude Code', codex: 'Codex' };
const listNames = (skills: ManagedSkillStatus[]): string => skills.map((skill) => skill.name).join(', ');

export async function offerWrapper(io: Prompter, options: Required<WrapperOptions>): Promise<WrapperOffer> {
  const states = await managedSkillStates(options);
  if (states.kind === 'unavailable') { io.print(`The terum-skills skills are not bundled in this copy of terum-skills (expected under ${states.bundle}); skipped.`); return 'unavailable'; }
  const roots = states.roots.filter((root) => root.eligible);
  for (const root of states.roots) if (!root.eligible) io.print(`No ${dirname(root.root)} on this machine; Codex skills skipped.`);
  for (const root of roots) for (const skill of root.skills) if (skill.state === 'foreign') io.print(`${skill.directory} exists and is not a bundled terum-skills skill (${skill.why}); left alone. Move it aside and re-run setup to install the bundled one.`);
  const consented = roots.some((root) => root.skills.some((skill) => skill.state === 'current' || skill.state === 'outdated'));
  if (!consented) {
    const targets = roots.map((root) => ({ root, absent: root.skills.filter((skill) => skill.state === 'absent') })).filter((target) => target.absent.length);
    if (!targets.length) return 'foreign';
    const hosts = targets.map((target) => HOST_LABEL[target.root.host]).join(' and ');
    const where = targets.map((target) => `${target.root.root}/{${listNames(target.absent)}}`).join(' and ');
    if (!(await io.confirm(`Install the terum-skills skills for ${hosts} so ${targets.length > 1 ? 'they' : 'it'} can run terum-skills for you? (writes ${where})`))) {
      io.print('Skipped the terum-skills skills; re-run setup to install them later.');
      return 'declined';
    }
  }
  let installed = 0, replaced = 0;
  for (const root of roots) {
    const written: ManagedSkillStatus[] = [], refreshed: ManagedSkillStatus[] = [];
    for (const skill of root.skills) {
      if (skill.state !== 'absent' && skill.state !== 'outdated') continue;
      const outcome = await installManagedSkill(root.root, skill.name, states.bundled.get(skill.name)!);
      if (outcome === 'installed') written.push(skill); else refreshed.push(skill);
    }
    if (written.length) io.print(`Installed the terum-skills skills at ${root.root}: ${listNames(written)}.`);
    if (refreshed.length) io.print(`Updated the terum-skills skills at ${root.root}: ${listNames(refreshed)}.`);
    installed += written.length; replaced += refreshed.length;
  }
  if (installed) return 'installed';
  if (replaced) return 'replaced';
  io.print(`The terum-skills skills at ${roots.map((root) => root.root).join(' and ')} are current.`);
  return 'present';
}

export async function refreshManagedSkills(options: Required<WrapperOptions>): Promise<string[]> {
  const states = await managedSkillStates(options);
  if (states.kind === 'unavailable') return [];
  const written: string[] = [];
  for (const root of states.roots) {
    if (!root.skills.some((skill) => skill.state === 'current' || skill.state === 'outdated')) continue;
    for (const skill of root.skills) {
      if (skill.state !== 'absent' && skill.state !== 'outdated') continue;
      await installManagedSkill(root.root, skill.name, states.bundled.get(skill.name)!);
      written.push(skill.directory);
    }
  }
  return written;
}

export interface ManagedInventory { roots: { host: ManagedHost; root: string; managed: { name: string; directory: string }[]; foreign: { name: string; directory: string; why: string }[] }[] }
export async function managedSkillInventory(options: Required<WrapperOptions>): Promise<ManagedInventory> {
  const bundled = await readBundledSkills(options.bundle);
  const roots: ManagedInventory['roots'] = [];
  for (const root of options.roots) {
    const managed = await listManagedSkills(root.root);
    const foreign: { name: string; directory: string; why: string }[] = [];
    for (const name of bundled?.keys() ?? []) {
      const presence = await inspectManagedSkill(root.root, name);
      if (presence.kind === 'foreign') foreign.push({ name, directory: managedSkillDirectory(root.root, name), why: presence.why });
    }
    roots.push({ host: root.host, root: root.root, managed, foreign });
  }
  return { roots };
}

/** @deprecated Task 5 removes this. */ export const WRAPPER_NAME = 'terum-skills';
/** @deprecated Task 5 removes this. */ export const BUNDLED_WRAPPER = join(BUNDLED_SKILLS, WRAPPER_NAME, 'SKILL.md');
/** @deprecated Task 5 removes this. */ export function wrapperDestination(skillsRoot: string): string { return managedSkillDirectory(skillsRoot, WRAPPER_NAME); }
/** @deprecated Task 5 removes this. */ export const isManagedWrapper = isManagedSkill;
/** @deprecated Task 5 removes this. */ export type WrapperPresence = SkillPresence;
/** @deprecated Task 5 removes this. */ export async function inspectWrapper(skillsRoot: string): Promise<WrapperPresence> { return inspectManagedSkill(skillsRoot, WRAPPER_NAME); }
/** @deprecated Task 5 removes this. */ export type WrapperState = SkillState | 'unavailable';
/** @deprecated Task 5 removes this. */
export async function wrapperState(options: Required<WrapperOptions>): Promise<WrapperState> {
  const bundle = options.source === BUNDLED_WRAPPER ? options.bundle : dirname(dirname(options.source));
  const bundled = await readBundledSkills(bundle);
  if (bundled === null) return 'unavailable';
  const presence = await inspectManagedSkill(options.skillsRoot, WRAPPER_NAME);
  if (presence.kind !== 'managed') return presence.kind;
  return presence.raw === bundled.get(WRAPPER_NAME) ? 'current' : 'outdated';
}
/** @deprecated Task 5 removes this. */
export async function installWrapper(options: Required<WrapperOptions>): Promise<'installed' | 'replaced'> {
  let raw: string;
  try { raw = await readFile(options.source, 'utf8'); } catch (error) {
    if (isMissing(error)) throw new Error(`The terum-skills skills are not bundled in this copy of terum-skills (expected under ${dirname(dirname(options.source))}).`);
    throw error;
  }
  if (!isManagedSkill(raw)) throw new Error(`The terum-skills skills are not bundled in this copy of terum-skills (expected under ${dirname(dirname(options.source))}).`);
  return installManagedSkill(options.skillsRoot, WRAPPER_NAME, raw);
}
/** @deprecated Task 5 removes this. */ export async function removeWrapper(options: Pick<Required<WrapperOptions>, 'skillsRoot'>): Promise<'removed' | 'absent' | 'foreign'> { return removeManagedSkill(options.skillsRoot, WRAPPER_NAME); }
