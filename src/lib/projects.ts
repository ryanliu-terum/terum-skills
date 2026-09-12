import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { ConfigStore } from './config.js';
import { projectLabels, type LibraryProject } from './schema.js';
import type { Prompter } from './prompt.js';
import { assertNotInsideStateRoot } from './skill-source.js';

/** Retain lexical ledger evidence when a folder has disappeared. */
export async function projectPath(path: string): Promise<string> { return realpath(path).catch(() => resolve(path)); }
export function underProject(path: string, root: string): boolean { return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep); }

/** The registered roots, canonicalized and deduplicated — what every reader of the Library scans. */
export function projectRoots(projects: readonly LibraryProject[] | undefined): string[] {
  return [...new Set((projects ?? []).map((project) => project.root))];
}

/**
 * §7.1's one writer. The Library only ever gains a project because someone said so — §7.2 deleted
 * every implicit registration, so there is no longer an `explicit` distinction to draw: every caller
 * is a person choosing a folder.
 */
export async function addLibraryProject(store: ConfigStore, root: string, io: Prompter, options: { home: string }): Promise<{ path: string; label: string; added: boolean }> {
  assertNotInsideStateRoot(root, store.root);
  let path: string;
  try { path = await realpath(root); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new Error(`${root} does not exist.`);
    throw error;
  }
  if (!(await stat(path)).isDirectory()) throw new Error(`${root} is not a folder.`);
  if (path === await projectPath(options.home)) throw new Error(`${path} is the Global home root and cannot be added as a project.`);
  let added = false;
  let label = '';
  await store.update(async (config) => {
    // Canonicalize what is already stored before comparing: two entries that realpath to one folder
    // are one project, and the Library must not show it twice.
    const existing = new Map<string, LibraryProject>();
    for (const project of config.projects ?? []) {
      const canonical = await projectPath(project.root);
      if (!existing.has(canonical)) existing.set(canonical, { ...project, root: canonical });
    }
    added = !existing.has(path);
    if (added) existing.set(path, { root: path, label: '', added_at: new Date().toISOString().slice(0, 10) });
    // Labels are derived from the whole set, so adding /b/web relabels an existing /a/web too.
    const entries = [...existing.values()];
    const labels = projectLabels(entries.map((project) => project.root));
    config.projects = entries.map((project, index) => ({ ...project, label: labels[index]! }));
    label = config.projects.find((project) => project.root === path)!.label;
  }, { preserveUnchanged: true });
  io.print(added ? `Added ${path} to your library.` : `${path} is already in your library.`);
  return { path, label, added };
}
