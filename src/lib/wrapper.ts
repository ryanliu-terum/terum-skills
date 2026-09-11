import { packageRoot } from './package-root.js';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { AGENT_PATHS } from './placer/agent-paths.js';
import { Prompter } from './prompt.js';
import { FRONTMATTER } from './schema.js';

/**
 * The `/terum-skills` Claude Code skill: the SKILL.md that teaches Claude Code which verbs it may
 * run in a session and which to hand to a terminal. It ships inside this package (bundled by
 * `scripts/bundle-skill.mjs` into dist/claude/skills/terum-skills/SKILL.md at build time, from the
 * one canonical copy at .claude/skills/terum-skills/SKILL.md) and is placed under the user's global
 * Claude Code skills root by `setup`, the way the session hook is offered there. Same contract as
 * the hook: one offer with its own y/N, an idempotency key the tool can recognise later (the
 * frontmatter marker below), an in-place refresh of its own copy, removal on machine uninstall, and
 * hands off anything else found at that path.
 */
export const WRAPPER_NAME = 'terum-skills';
export const MANAGED_BY = 'terum-skills';
/** Where `npm run build` puts the bundled copy, resolved from the package root for dist/lib, a bundled entry, and a checkout. */
export const BUNDLED_WRAPPER = join(packageRoot() ?? fileURLToPath(new URL('../../', import.meta.url)), 'dist', 'claude', 'skills', 'terum-skills', 'SKILL.md');

export interface WrapperOptions { skillsRoot?: string; source?: string; }

export function defaultWrapperOptions(home = homedir()): Required<WrapperOptions> {
  return { skillsRoot: AGENT_PATHS['claude-code'].global(home), source: BUNDLED_WRAPPER };
}

export function wrapperDestination(skillsRoot: string): string { return join(skillsRoot, WRAPPER_NAME); }

/** The idempotency key on parsed frontmatter: `name: terum-skills` plus `metadata.managed-by: terum-skills`. */
export function isManagedFrontmatter(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const data = parsed as Record<string, unknown>;
  const metadata = data.metadata;
  return data.name === WRAPPER_NAME && !!metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata as Record<string, unknown>)['managed-by'] === MANAGED_BY;
}

/** The same key read from a whole SKILL.md; anything unparseable is not ours. */
export function isManagedWrapper(raw: string): boolean {
  const match = FRONTMATTER.exec(raw);
  if (!match) return false;
  try { return isManagedFrontmatter(YAML.parse(match[1]!)); } catch { return false; }
}

export type WrapperPresence = { kind: 'absent' } | { kind: 'managed'; raw: string } | { kind: 'foreign'; why: string };

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

/**
 * What sits at `<skillsRoot>/terum-skills`. Judged without following links (the repo's rule for
 * symlinks everywhere: refuse, never follow): a link, a file, a folder without a regular SKILL.md,
 * or a SKILL.md without the marker is `foreign` and is never written to or removed.
 */
export async function inspectWrapper(skillsRoot: string): Promise<WrapperPresence> {
  const directory = wrapperDestination(skillsRoot);
  let details;
  try { details = await lstat(directory); } catch (error) { if (isMissing(error)) return { kind: 'absent' }; throw error; }
  if (details.isSymbolicLink()) return { kind: 'foreign', why: 'it is a symbolic link' };
  if (!details.isDirectory()) return { kind: 'foreign', why: 'it is not a directory' };
  const file = join(directory, 'SKILL.md');
  let fileDetails;
  try { fileDetails = await lstat(file); } catch (error) { if (isMissing(error)) return { kind: 'foreign', why: 'it has no SKILL.md' }; throw error; }
  if (!fileDetails.isFile()) return { kind: 'foreign', why: 'its SKILL.md is not a regular file' };
  const raw = await readFile(file, 'utf8');
  return isManagedWrapper(raw) ? { kind: 'managed', raw } : { kind: 'foreign', why: 'it is a different skill' };
}

/** The bundled copy, or null when this copy of the package was not built with it (a source checkout, a test run from src/). */
async function readBundled(source: string): Promise<string | null> {
  let raw: string;
  try { raw = await readFile(source, 'utf8'); } catch (error) { if (isMissing(error)) return null; throw error; }
  return isManagedWrapper(raw) ? raw : null;
}

export type WrapperState = 'absent' | 'current' | 'outdated' | 'foreign' | 'unavailable';

export async function wrapperState(options: Required<WrapperOptions>): Promise<WrapperState> {
  const bundled = await readBundled(options.source);
  if (bundled === null) return 'unavailable';
  const presence = await inspectWrapper(options.skillsRoot);
  if (presence.kind === 'absent') return 'absent';
  if (presence.kind === 'foreign') return 'foreign';
  return presence.raw === bundled ? 'current' : 'outdated';
}

/** Write the bundled copy atomically (temp file beside the target, fsync, rename). Refuses a foreign destination. */
export async function installWrapper(options: Required<WrapperOptions>): Promise<'installed' | 'replaced'> {
  const bundled = await readBundled(options.source);
  if (bundled === null) throw new Error(`The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at ${options.source}).`);
  const directory = wrapperDestination(options.skillsRoot);
  const presence = await inspectWrapper(options.skillsRoot);
  if (presence.kind === 'foreign') throw new Error(`${directory} exists and is not the bundled /terum-skills skill (${presence.why}); move it aside and re-run.`);
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'SKILL.md');
  const temporary = join(directory, `.SKILL.md.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'w');
    try { await handle.writeFile(bundled, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  return presence.kind === 'managed' ? 'replaced' : 'installed';
}

/** Remove only our own copy: the marked SKILL.md, then the folder if nothing else is in it. A foreign folder is left alone. */
export async function removeWrapper(options: Pick<Required<WrapperOptions>, 'skillsRoot'>): Promise<'removed' | 'absent' | 'foreign'> {
  const presence = await inspectWrapper(options.skillsRoot);
  if (presence.kind !== 'managed') return presence.kind;
  const directory = wrapperDestination(options.skillsRoot);
  await rm(join(directory, 'SKILL.md'));
  try { await rmdir(directory); }
  catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error; }
  return 'removed';
}

export type WrapperOffer = 'installed' | 'replaced' | 'present' | 'declined' | 'foreign' | 'unavailable';

/**
 * The offer `setup` makes right after the hook. Asks exactly once, and only for a first install:
 * an outdated copy of our own is refreshed without a question (the consent was given when it was
 * installed; a stale copy teaches Claude the wrong verbs), a current one is reported, a foreign
 * folder is named and left alone, and a copy of the package built without the bundle says so.
 */
export async function offerWrapper(io: Prompter, options: Required<WrapperOptions>): Promise<WrapperOffer> {
  const directory = wrapperDestination(options.skillsRoot);
  const state = await wrapperState(options);
  if (state === 'unavailable') { io.print(`The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at ${options.source}); skipped.`); return 'unavailable'; }
  if (state === 'foreign') { io.print(`${directory} exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.`); return 'foreign'; }
  if (state === 'current') { io.print(`The /terum-skills Claude Code skill at ${directory} is current.`); return 'present'; }
  if (state === 'outdated') { await installWrapper(options); io.print(`Updated the /terum-skills Claude Code skill at ${directory}.`); return 'replaced'; }
  if (!(await io.confirm(`Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ${directory})`))) {
    io.print('Skipped the /terum-skills skill; re-run setup to install it later.');
    return 'declined';
  }
  await installWrapper(options);
  io.print(`Installed the /terum-skills Claude Code skill at ${directory}.`);
  return 'installed';
}
