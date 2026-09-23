import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { NPX_PREFIX, pinnedPrefix, type InvocationForm } from './invocation.js';
import { packageRoot } from './package-root.js';
import { AGENT_PATHS } from './placer/agent-paths.js';
import type { Prompter } from './prompt.js';
import { FRONTMATTER } from './schema.js';

export const MANAGED_BY = 'terum-skills';
export const BUNDLED_SKILLS = join(packageRoot() ?? fileURLToPath(new URL('../../', import.meta.url)), 'dist', 'claude', 'skills');

export type ManagedHost = 'claude' | 'codex';
export interface ManagedRoot { host: ManagedHost; root: string }
export interface WrapperOptions {
  roots?: ManagedRoot[];
  bundle?: string;
  /** The command spelling every placed copy teaches (lib/invocation.ts pinnedPrefix); the bundled copies say `npx -y terum-skills@latest`. */
  prefix?: string;
}

export function managedSkillRoots(home = homedir(), env: NodeJS.ProcessEnv = process.env): ManagedRoot[] {
  const codexHome = env['CODEX_HOME'] || join(home, '.codex');
  return [{ host: 'claude', root: AGENT_PATHS['claude-code'].global(home) }, { host: 'codex', root: join(codexHome, 'skills') }];
}

export function defaultWrapperOptions(home = homedir(), form?: InvocationForm, env: NodeJS.ProcessEnv = process.env): Required<WrapperOptions> {
  const roots = managedSkillRoots(home, env);
  return { roots, bundle: BUNDLED_SKILLS, prefix: pinnedPrefix(form) };
}

export function managedSkillDirectory(root: string, name: string): string { return join(root, name); }

/** Test seam: a failing `open` simulates an interrupted install (the file system itself is not mocked). */
export const fsForTests = { open };

/**
 * A bundled skill with every `npx -y terum-skills@latest` replaced by this machine's spelling. The
 * bundle stays canonical (this repository's own harness loads it); what a session runs is the copy
 * the user installed, so every placed copy names that copy, never the registry's latest.
 */
export function renderWrapper(bundled: string, prefix: string): string { return bundled.split(NPX_PREFIX).join(prefix); }

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
/** `bundled` holds every skill already rendered in this machine's spelling (options.prefix): what a placed copy must equal to be current, and what an install writes. */
export type ManagedStates = { kind: 'unavailable'; bundle: string } | { kind: 'ready'; bundled: Map<string, string>; roots: RootStatus[] };

async function isDirectory(path: string): Promise<boolean> { try { return (await stat(path)).isDirectory(); } catch (error) { if (isMissing(error)) return false; throw error; } }
async function eligible(root: ManagedRoot): Promise<boolean> { return root.host === 'claude' ? true : isDirectory(dirname(root.root)); }

export async function managedSkillStates(options: Required<WrapperOptions>): Promise<ManagedStates> {
  const canonical = await readBundledSkills(options.bundle);
  if (canonical === null) return { kind: 'unavailable', bundle: options.bundle };
  const bundled = new Map([...canonical].map(([name, raw]) => [name, renderWrapper(raw, options.prefix)] as const));
  const roots: RootStatus[] = [];
  for (const root of options.roots) {
    const skills: ManagedSkillStatus[] = [];
    // An ineligible root has no parent folder, so nothing can be under it: every copy is absent by definition and nothing is probed.
    const isEligible = await eligible(root);
    for (const [name, rendered] of bundled) {
      const directory = managedSkillDirectory(root.root, name);
      const presence: SkillPresence = isEligible ? await inspectManagedSkill(root.root, name) : { kind: 'absent' };
      if (presence.kind === 'absent') skills.push({ name, root: root.root, directory, state: 'absent' });
      else if (presence.kind === 'foreign') skills.push({ name, root: root.root, directory, state: 'foreign', why: presence.why });
      else skills.push({ name, root: root.root, directory, state: presence.raw === rendered ? 'current' : 'outdated' });
    }
    roots.push({ host: root.host, root: root.root, eligible: isEligible, skills });
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
    const handle = await fsForTests.open(temporary, 'w');
    try { await handle.writeFile(raw, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    // A folder this call created and never filled would read as foreign ("it has no SKILL.md") on every later
    // attempt; remove it (only when empty, only when it was absent before) so the retry starts clean.
    if (presence.kind === 'absent') {
      try { await rmdir(directory); }
      catch (cleanup) { const code = (cleanup as NodeJS.ErrnoException).code; if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'ENOENT') throw cleanup; }
    }
    throw error;
  }
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

/**
 * `installed` and `replaced`: something was written. `present`: nothing needed writing because every copy of
 * ours is current. `foreign`: nothing of ours is in place anywhere and nothing could be written, because every
 * name in every eligible root is taken by something else. `failed`: nothing was written and at least one write
 * failed. `unavailable`: this copy of the package carries no bundle.
 */
export type ManagedSkillsPlacement = 'installed' | 'replaced' | 'present' | 'foreign' | 'failed' | 'unavailable';
const listNames = (skills: ManagedSkillStatus[]): string => skills.map((skill) => skill.name).join(', ');
const reason = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** What one root received: the copies written, the outdated copies rewritten, and the writes that failed. */
export interface RootPlacement { root: RootStatus; written: ManagedSkillStatus[]; refreshed: ManagedSkillStatus[]; failed: { skill: ManagedSkillStatus; error: unknown }[] }

/**
 * The one write loop behind setup and the session hook: every absent or outdated copy in each given root is
 * written from the rendered bundle. A failed write is recorded against its skill and the loop goes on, so one
 * unwritable root (a read-only Codex profile, a full disk, a folder that appeared since the states were read)
 * never blocks the copies that can be written; the caller decides what a failure means.
 */
async function placeInto(states: Extract<ManagedStates, { kind: 'ready' }>, roots: RootStatus[]): Promise<RootPlacement[]> {
  const placements: RootPlacement[] = [];
  for (const root of roots) {
    const placement: RootPlacement = { root, written: [], refreshed: [], failed: [] };
    for (const skill of root.skills) {
      if (skill.state !== 'absent' && skill.state !== 'outdated') continue;
      try {
        const outcome = await installManagedSkill(root.root, skill.name, states.bundled.get(skill.name)!);
        (outcome === 'installed' ? placement.written : placement.refreshed).push(skill);
      } catch (error) { placement.failed.push({ skill, error }); }
    }
    placements.push(placement);
  }
  return placements;
}

/**
 * Setup's skills step: place the bundled skills into every eligible global root without asking
 * (Teddy, 2026-09-21; until then this was a y/N offer defaulting to No). Absent copies are written,
 * outdated marked copies are rewritten, current ones are left as they are, and anything foreign is
 * named and left alone. A write that fails is named and is never fatal: the team work before this step
 * is durable, and a re-run places whatever it can. The Prompter is only printed to: nothing here asks,
 * so the step is the same over a pipe, over frames and in `install`'s quiet bootstrap.
 */
export async function placeManagedSkills(io: Prompter, options: Required<WrapperOptions>): Promise<ManagedSkillsPlacement> {
  const states = await managedSkillStates(options);
  if (states.kind === 'unavailable') { io.print(`The terum-skills skills are not bundled in this copy of terum-skills (expected under ${states.bundle}); skipped.`); return 'unavailable'; }
  for (const root of states.roots) if (!root.eligible) io.print(`No ${dirname(root.root)} on this machine; Codex skills skipped.`);
  const roots = states.roots.filter((root) => root.eligible);
  for (const root of roots) for (const skill of root.skills) if (skill.state === 'foreign') io.print(`${skill.directory} exists and is not a bundled terum-skills skill (${skill.why}); left alone. Move it aside and re-run setup to install the bundled one.`);
  const placements = await placeInto(states, roots);
  for (const { root, written, refreshed, failed } of placements) {
    if (written.length) io.print(`Installed the terum-skills skills at ${root.root}: ${listNames(written)}.`);
    if (refreshed.length) io.print(`Updated the terum-skills skills at ${root.root}: ${listNames(refreshed)}.`);
    for (const { skill, error } of failed) io.print(`Could not install the terum-skills skill ${skill.name} at ${root.root}: ${reason(error)}`);
  }
  if (placements.some((placement) => placement.written.length)) return 'installed';
  if (placements.some((placement) => placement.refreshed.length)) return 'replaced';
  if (placements.some((placement) => placement.failed.length)) return 'failed';
  // Nothing needed writing: every name in every root is either our current copy or somebody else's, so only
  // the roots that hold a copy of ours are reported as current.
  const current = roots.filter((root) => root.skills.some((skill) => skill.state === 'current'));
  if (!current.length) return 'foreign';
  io.print(`The terum-skills skills at ${current.map((root) => root.root).join(' and ')} are current.`);
  return 'present';
}

/**
 * `sync --hook`'s half of the same loop: only a root that already holds a marked copy qualifies (a root
 * holding none is setup's to fill), and a failed write comes back as a line for the caller to report.
 */
export async function refreshManagedSkills(options: Required<WrapperOptions>): Promise<{ written: string[]; failed: string[] }> {
  const states = await managedSkillStates(options);
  if (states.kind === 'unavailable') return { written: [], failed: [] };
  const placements = await placeInto(states, states.roots.filter((root) => root.skills.some((skill) => skill.state === 'current' || skill.state === 'outdated')));
  return {
    written: placements.flatMap((placement) => [...placement.written, ...placement.refreshed].map((skill) => skill.directory)),
    failed: placements.flatMap((placement) => placement.failed.map(({ skill, error }) => `${skill.directory}: ${reason(error)}`)),
  };
}

export interface ManagedInventory {
  roots: { host: ManagedHost; root: string; managed: { name: string; directory: string }[]; foreign: { name: string; directory: string; why: string }[] }[];
  skipped: ManagedRoot[];
}
export async function managedSkillInventory(options: Required<WrapperOptions>): Promise<ManagedInventory> {
  const bundled = await readBundledSkills(options.bundle);
  const roots: ManagedInventory['roots'] = [];
  const skipped: ManagedRoot[] = [];
  for (const root of options.roots) {
    if (!(await eligible(root))) { skipped.push(root); continue; }
    const managed = await listManagedSkills(root.root);
    const foreign: { name: string; directory: string; why: string }[] = [];
    for (const name of bundled?.keys() ?? []) {
      const presence = await inspectManagedSkill(root.root, name);
      if (presence.kind === 'foreign') foreign.push({ name, directory: managedSkillDirectory(root.root, name), why: presence.why });
    }
    roots.push({ host: root.host, root: root.root, managed, foreign });
  }
  return { roots, skipped };
}
