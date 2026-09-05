import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigStore } from './config.js';
import { isExistingDestination } from './placer.js';
import { Runner, systemRunner } from './runner.js';

/** §7: resolve exactly a skill tree, never a commit or a history walk. */
export async function resolveVersion(clone: string, name: string, version: string | undefined, runner: Runner = systemRunner): Promise<string> {
  if (version) {
    // A 39-character value is a truncated full hash, not the display short form accepted by §7.
    if (/^[0-9a-f]{39}$/i.test(version)) throw new Error(`Version ${version} for ${name} must be a full skill tree hash or a short display prefix.`);
    const kind = await runner.run('git', ['cat-file', '-t', version], { cwd: clone });
    if (kind.code !== 0 || kind.stdout.trim() !== 'tree') throw new Error(`Version ${version} for ${name} must be a skill tree hash, not a commit, tag, or blob.`);
    const result = await runner.run('git', ['rev-parse', '--verify', version], { cwd: clone });
    const tree = result.stdout.trim();
    if (result.code !== 0 || !/^[0-9a-f]{40}$/i.test(tree)) throw new Error(`Version ${version} for ${name} must resolve to a full skill tree hash.`);
    const skill = await runner.run('git', ['cat-file', '-e', `${tree}:SKILL.md`], { cwd: clone });
    if (skill.code !== 0) throw new Error(`Version ${version} for ${name} must be a skill tree containing SKILL.md at its root.`);
    return tree.toLowerCase();
  }
  const expression = `HEAD:skills/${name}`;
  const result = await runner.run('git', ['rev-parse', '--verify', expression], { cwd: clone });
  if (result.code !== 0) throw new Error(`Could not resolve version ${version ?? 'latest'} for ${name}: ${(result.stderr || result.stdout).trim()}`);
  const tree = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(tree)) throw new Error(`Resolved version for ${name} is not a full tree hash.`);
  return tree.toLowerCase();
}

/**
 * Materialize one immutable cache entry. The permitted `git` executable checks out the exact
 * tree through a disposable index; this is equivalent to `git archive <tree> | tar -x`
 * without a shell pipeline or a second executable, and never changes the team clone.
 */
export async function materializeVersion(store: ConfigStore, team: string, clone: string, name: string, tree: string, runner: Runner = systemRunner): Promise<string> {
  const destination = join(store.root, 'cache', team, tree, name);
  try { await readdir(destination); return destination; } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const staging = `${destination}.tmp-${randomUUID()}`;
  const index = `${staging}.index`;
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    const env = { GIT_INDEX_FILE: index };
    const readTree = await runner.run('git', ['read-tree', tree], { cwd: clone, env });
    if (readTree.code !== 0) throw new Error(`git read-tree failed: ${(readTree.stderr || readTree.stdout).trim()}`);
    const checkout = await runner.run('git', ['checkout-index', '-a', `--prefix=${staging}/`], { cwd: clone, env });
    if (checkout.code !== 0) throw new Error(`git checkout-index failed: ${(checkout.stderr || checkout.stdout).trim()}`);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    try { await rename(staging, destination); }
    catch (error) {
      if (!isExistingDestination(error)) throw error;
      await rm(staging, { recursive: true, force: true });
    }
    return destination;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(index, { force: true });
  }
}
