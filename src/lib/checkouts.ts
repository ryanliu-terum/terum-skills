import { realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ConfigStore } from './config.js';
import type { Config } from './schema.js';
import type { Prompter } from './prompt.js';
import { nearestRepoRoot } from './local-skills.js';
import { assertNotInsideStateRoot } from './skill-source.js';

/** Retain lexical ledger evidence when a folder has disappeared. */
export async function checkoutPath(path: string): Promise<string> { return realpath(path).catch(() => resolve(path)); }
export function underCheckout(path: string, root: string): boolean { return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep); }

/** Automatic writes only register repository ancestors, excluding Global and recovery state. */
export async function writableCheckout(cwd: string | undefined, home: string, stateRoot: string): Promise<string | undefined> {
  if (cwd === undefined) return undefined;
  const canonical = await checkoutPath(cwd);
  if (underCheckout(canonical, await checkoutPath(join(home, '.claude', 'skills')))) return undefined;
  const root = await nearestRepoRoot(canonical);
  if (!root || await checkoutPath(root) === await checkoutPath(home)) return undefined;
  try { assertNotInsideStateRoot(root, stateRoot); }
  catch { return undefined; }
  return root;
}

/** One registration transaction, optionally including the connected-source ledger write. */
export async function registerCheckout(store: ConfigStore, root: string, io: Prompter, options: { home: string; explicit?: boolean; mutate?: (config: Config) => void } ): Promise<{ path: string; registered: boolean }> {
  assertNotInsideStateRoot(root, store.root);
  let path: string;
  try { path = await realpath(root); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new Error(`${root} does not exist.`);
    throw error;
  }
  if (!(await stat(path)).isDirectory()) throw new Error(`${root} is not a folder.`);
  if (path === await checkoutPath(options.home)) throw new Error(`${path} is the Global home root and cannot be registered as a checkout.`);
  let registered = false;
  await store.update(async config => {
    const roots = [...new Set(await Promise.all((config.checkouts ?? []).map(checkoutPath)))];
    registered = !roots.includes(path);
    config.checkouts = registered ? [...roots, path] : roots;
    options.mutate?.(config);
  }, { preserveUnchanged: true });
  if (registered) io.print(options.explicit ? `Registered ${path}` : `Registered ${path} in your library.`);
  else if (options.explicit) io.print(`Already registered ${path}`);
  return { path, registered };
}
