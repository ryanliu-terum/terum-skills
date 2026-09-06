import { resolve } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { guardRawPush, GuardTree } from '../lib/guard.js';
import { Prompter } from '../lib/prompt.js';
import { normalizeRemote, stripRemoteCredentials } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { CommandResult, Runner, systemRunner } from '../lib/runner.js';

export interface GuardPushArgs { remote: string; url: string; refs?: readonly string[]; cwd?: string; config?: ConfigStore; runner?: Runner; }
export interface GuardPushResult { team: string; checked: number; }

const ZERO_SHA = /^0{40}$/;
type Git = (parts: readonly string[]) => Promise<CommandResult>;

/**
 * The hidden pre-push hook entry (D12, the clone-local half of the write guard). git's
 * `<local ref> <local sha> <remote ref> <remote sha>` lines arrive as arguments — the hook turns
 * its stdin into them, because the CLI reads stdin nowhere outside the Prompter (§3) — and every
 * branch update is diffed against the ref it replaces (`origin/main` for a new branch) and held
 * to the pusher's own identity. A refusal is one line on stderr and exit 1, which makes git abort
 * the push. Accidents, not abuse: `--no-verify` bypasses it, attributed to the pusher.
 */
export async function run(args: GuardPushArgs, io: Prompter): Promise<Result<GuardPushResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const cwd = args.cwd ?? resolve('.');
    const config = await store.read();
    const normalized = normalizeRemote(args.url);
    const configured = Object.entries(config.teams).find(([, entry]) => normalizeRemote(entry.remote) === normalized);
    if (!configured) throw new Error(`Push guard: ${stripRemoteCredentials(args.url)} is not a team this machine has joined, so ownership cannot be checked. Push from a configured clone, or bypass with \`git push --no-verify\` (attributed to you).`);
    const [team, binding] = configured;
    const author = config.display_name && config.email ? `${config.display_name} <${config.email}>` : undefined;
    const git: Git = (parts) => runner.run('git', parts, { cwd });
    const refs = args.refs ?? [];
    if (refs.length % 4 !== 0) throw new Error('Push guard: expected <local ref> <local sha> <remote ref> <remote sha> groups.');
    let checked = 0;
    for (let index = 0; index < refs.length; index += 4) {
      const localSha = refs[index + 1]!; const remoteRef = refs[index + 2]!; const remoteSha = refs[index + 3]!;
      if (ZERO_SHA.test(localSha) || !remoteRef.startsWith('refs/heads/')) continue; // a deletion, or not a branch: no content to own
      const base = ZERO_SHA.test(remoteSha) ? await revParse(git, 'refs/remotes/origin/main') : remoteSha;
      if (base === null) continue; // a first push to an empty remote: nothing to diff against
      const listed = await git(['diff', '--name-only', base, localSha]);
      if (listed.code !== 0) throw new Error(`Push guard could not diff ${base.slice(0, 8)}..${localSha.slice(0, 8)}: ${(listed.stderr || listed.stdout).trim()}`);
      const changedPaths = listed.stdout.split('\n').filter(Boolean).sort();
      guardRawPush(await treeBetween(git, base, localSha, changedPaths), { handle: binding.handle, author });
      checked += changedPaths.length;
    }
    if (checked) io.print(`terum-skills push guard: ${checked} path(s) to ${stripRemoteCredentials(args.url)} are yours.`);
    return success({ team, checked });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

async function revParse(git: Git, ref: string): Promise<string | null> {
  const result = await git(['rev-parse', '--verify', '--quiet', ref]);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

/** A GuardTree over two commits: the changed paths, plus each touched skill folder's SKILL.md, which ownership is read from. */
async function treeBetween(git: Git, base: string, head: string, changedPaths: readonly string[]): Promise<GuardTree> {
  const wanted = new Set(changedPaths);
  for (const path of changedPaths) { const folder = /^skills\/([^/]+)\//.exec(path); if (folder) wanted.add(`skills/${folder[1]}/SKILL.md`); }
  const before = new Map<string, string>(); const after = new Map<string, string>();
  for (const path of wanted) {
    const [was, is] = await Promise.all([git(['show', `${base}:${path}`]), git(['show', `${head}:${path}`])]);
    if (was.code === 0) before.set(path, was.stdout);
    if (is.code === 0) after.set(path, is.stdout);
  }
  return { before: (path) => before.get(path), after: (path) => after.get(path), changedPaths };
}
