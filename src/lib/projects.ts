import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ConfigStore } from './config.js';
import { insideRoot, isLibraryProjectLabel, LIBRARY_PROJECT_LABEL_RULE, libraryProjectLabels, projectParents, type LibraryProject } from './schema.js';
import type { Prompter } from './prompt.js';
import { assertNotInsideStateRoot } from './skill-source.js';

/** Retain lexical ledger evidence when a folder has disappeared. */
export async function projectPath(path: string): Promise<string> { return realpath(path).catch(() => resolve(path)); }
export function underProject(path: string, root: string): boolean { return path === root || insideRoot(path, root); }

/** The registered roots, canonicalized and deduplicated — what every reader of the Library scans. */
export function projectRoots(projects: readonly LibraryProject[] | undefined): string[] {
  return [...new Set((projects ?? []).map((project) => project.root))];
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** What `project add` reports: the parent is the registered project the folder sits inside, when it is a sub-project. */
export interface ProjectAdded { path: string; label: string; added: boolean; parent: string | null; }

/**
 * §7.1's one writer. The Library only ever gains a project because someone said so — §7.2 deleted
 * every implicit registration, so there is no longer an `explicit` distinction to draw: every caller
 * is a person choosing a folder.
 *
 * A folder inside a registered project becomes that project's sub-project, and a folder above
 * registered projects adopts them as its sub-projects: the tree is the folder structure, read off
 * the paths (`projectParents`), so nothing here records it.
 */
export async function addLibraryProject(store: ConfigStore, root: string, io: Prompter, options: { home: string }): Promise<ProjectAdded> {
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
  let parent: string | null = null;
  let parentLabel = '';
  let adopted: string[] = [];
  await store.update(async (config) => {
    // Canonicalize what is already stored before comparing: two entries that realpath to one folder
    // are one project, and the Library must not show it twice.
    const existing = new Map<string, LibraryProject>();
    for (const project of config.projects ?? []) {
      const canonical = await projectPath(project.root);
      if (!existing.has(canonical)) existing.set(canonical, { ...project, root: canonical });
    }
    added = !existing.has(path);
    if (added) existing.set(path, { root: path, label: '', added_at: today() });
    // Labels are derived from the whole set, so adding /b/web relabels an existing /a/web too.
    const entries = [...existing.values()];
    const labels = libraryProjectLabels(entries);
    config.projects = entries.map((project, index) => ({ ...project, label: labels[index]! }));
    const parents = projectParents(entries.map((project) => project.root));
    const index = entries.findIndex((project) => project.root === path);
    label = labels[index]!;
    parent = parents[index] ?? null;
    parentLabel = parent === null ? '' : labels[entries.findIndex((project) => project.root === parent)]!;
    adopted = added ? entries.flatMap((project, at) => parents[at] === path ? [labels[at]!] : []) : [];
  }, { preserveUnchanged: true });
  if (!added) io.print(`${path} is already in your library.`);
  else if (parent !== null) io.print(`Added ${path} to your library as a sub-project of ${parentLabel}.`);
  else io.print(`Added ${path} to your library.`);
  if (adopted.length) io.print(`${adopted.length} ${adopted.length === 1 ? 'project' : 'projects'} already in your library ${adopted.length === 1 ? 'sits' : 'sit'} inside it and ${adopted.length === 1 ? 'is' : 'are'} now its sub-${adopted.length === 1 ? 'project' : 'projects'}: ${adopted.join(', ')}.`);
  return { path, label, added, parent };
}

/** What `project rename` reports. */
export interface ProjectRenamed { path: string; label: string; previous: string; }

/**
 * `project rename`: the person's name for a Library row. It is display text and nothing else — the
 * folder on disk keeps its name, every path in the ledger stays as it is, and no team file learns of
 * it. The label is stored as typed with `renamed_at`, so the derived labels are the ones that move
 * when a later add would read the same. Only another CHOSEN name is refused: a derived label that
 * reads the same is simply re-qualified, because the person asked for this name on purpose.
 */
export async function renameLibraryProject(store: ConfigStore, root: string, name: string, io: Prompter): Promise<ProjectRenamed> {
  const label = name.trim();
  if (!isLibraryProjectLabel(label)) throw new Error(LIBRARY_PROJECT_LABEL_RULE);
  const path = await projectPath(root);
  let previous = '';
  await store.update(async (config) => {
    const registered = config.projects ?? [];
    const canonical = await Promise.all(registered.map((project) => projectPath(project.root)));
    const index = canonical.indexOf(path);
    if (index === -1) throw new Error(`${path} is not in your library.`);
    const clash = registered.find((project, at) => at !== index && project.renamed_at !== undefined && project.label.toLowerCase() === label.toLowerCase());
    if (clash !== undefined) throw new Error(`Another project is already named ${clash.label} (${clash.root}).`);
    previous = registered[index]!.label;
    const entries = registered.map((project, at) => at === index ? { ...project, label, renamed_at: today() } : project);
    const labels = libraryProjectLabels(entries);
    config.projects = entries.map((project, at) => ({ ...project, label: labels[at]! }));
  }, { preserveUnchanged: true });
  io.print(`Renamed ${previous} to ${label}; the folder ${path} is unchanged.`);
  return { path, label, previous };
}
